import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const ARTICLES_JSON = path.join(ROOT, 'data', 'articles.json');
const TOPICS_JSON = path.join(ROOT, 'data', 'article-topics.json');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PEXELS_SEARCH = {
  'KPIs & Métriques':   'business analytics data',
  'Levée de fonds':     'startup investment funding',
  'Trésorerie':         'cash flow finance',
  'CFO as a Service':   'financial advisor executive',
  'Fiscalité Belge':    'tax business office',
  'Restructuration':    'business strategy meeting'
};

async function fetchPexelsImage(category) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return null;
  const query = PEXELS_SEARCH[category] || 'finance business';
  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=10&orientation=landscape`,
      { headers: { Authorization: apiKey } }
    );
    const data = await res.json();
    if (!data.photos?.length) return null;
    const photo = data.photos[Math.floor(Math.random() * data.photos.length)];
    return {
      large: photo.src.large2x,
      medium: photo.src.large,
      photographer: photo.photographer,
      photographerUrl: photo.photographer_url,
      alt: photo.alt || query
    };
  } catch (e) {
    console.warn('Pexels API error:', e.message);
    return null;
  }
}

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

function formatDateFR(d) {
  const months = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

async function regenerateTopics(existingSlugs) {
  console.log('\n🔄 Pool de sujets épuisé — génération de nouveaux sujets via Claude...\n');

  const currentYear = new Date().getFullYear();
  const resp = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Tu es un expert SEO spécialisé en finance d'entreprise pour la Belgique et la France.

Génère exactement 20 nouveaux sujets d'articles de blog SEO pour un cabinet de conseil financier belge (Executio). Ces articles ciblent dirigeants de startups, PME, indépendants.

Mélange obligatoire :
- 6 sujets sur la fiscalité belge (VVPRbis, ISOC, TVA, cotisations INASTI, subsides régionaux, précompte, etc.)
- 5 sujets sur l'actualité financière belge ${currentYear} (budget fédéral, réformes fiscales, aides régionales Wallonie/Bruxelles/Flandre)
- 5 sujets evergreen finance startup/PME (KPIs, levée de fonds, trésorerie, modèles financiers)
- 4 sujets sur la stratégie financière (optimisation rémunération dirigeant, exit, valorisation, restructuration)

Pour chaque sujet, réponds en JSON strict (tableau de 20 objets), chaque objet ayant :
- "title": titre SEO optimisé en français (60-80 chars, mot-clé principal dedans)
- "slug": slug URL (minuscules, tirets, sans accents, 3-6 mots)
- "category": une parmi ["Fiscalité Belge", "KPIs & Métriques", "Levée de fonds", "Trésorerie", "CFO as a Service"]
- "icon": une parmi ["activity", "trending-up", "bar-chart", "dollar", "shield", "briefcase", "clock", "users"]
- "keywords": 3 mots-clés SEO séparés par des virgules

Réponds UNIQUEMENT avec le tableau JSON, sans texte autour.`
    }]
  });

  const raw = resp.content[0].text.trim();
  let newTopics;
  try {
    // Strip potential markdown code fences
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    newTopics = JSON.parse(cleaned);
  } catch (e) {
    console.error('Erreur parsing JSON sujets:', e.message);
    console.error('Raw response:', raw.substring(0, 500));
    throw new Error('Impossible de parser les nouveaux sujets générés');
  }

  // Dédupliquer par rapport aux slugs existants
  const fresh = newTopics.filter(t => !existingSlugs.has(t.slug));
  console.log(`✓ ${fresh.length} nouveaux sujets générés (${newTopics.length - fresh.length} doublons ignorés)`);

  fs.writeFileSync(TOPICS_JSON, JSON.stringify(fresh, null, 2), 'utf-8');
  console.log(`✓ data/article-topics.json mis à jour\n`);

  return fresh;
}

async function main() {
  const existing = JSON.parse(fs.readFileSync(ARTICLES_JSON, 'utf-8'));
  const existingSlugs = new Set(existing.map(a => a.slug));

  let topics = JSON.parse(fs.readFileSync(TOPICS_JSON, 'utf-8'));
  let available = topics.filter(t => !existingSlugs.has(t.slug));

  if (!available.length) {
    topics = await regenerateTopics(existingSlugs);
    available = topics;
  }

  if (!available.length) {
    console.log('Aucun sujet disponible même après régénération.');
    process.exit(0);
  }

  const topic = available[0];
  const now = new Date();
  const dateStr = formatDate(now);
  const dateFR = formatDateFR(now);

  console.log(`\n📝 Génération de l'article : "${topic.title}"\n`);

  const image = await fetchPexelsImage(topic.category);
  if (image) console.log(`✓ Image Pexels : ${image.medium}`);
  else console.log('⚠ Pas d\'image Pexels (API key manquante ou erreur)');

  const resp = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 3000,
    messages: [{
      role: 'user',
      content: `Tu es un expert financier senior (CFO, advisory financier, startups et PME belges et françaises) qui rédige un article de blog SEO professionnel en français.

Rédige un article complet sur : "${topic.title}"

Mots-clés cibles : ${topic.keywords}

Structure OBLIGATOIRE (HTML, utilise les balises suivantes uniquement) :
- <p class="art-lead">...</p> pour le paragraphe d'introduction (2-3 phrases percutantes avec le mot-clé principal)
- <h2>...</h2> pour les titres de section (4 à 6 sections)
- <h3>...</h3> pour les sous-sections si nécessaire
- <p>...</p> pour les paragraphes (contenu dense, pratique, actionnable)
- <ul><li>...</li></ul> pour les listes à puces
- <div class="highlight"><strong>...</strong>...</div> pour les encadrés conseil/définition (1-2 max)
- <strong>...</strong> pour le gras (mots-clés importants)
- <em>...</em> pour les formules de calcul

Règles SEO strictes :
1. Mot-clé principal dans le premier paragraphe
2. Mots-clés secondaires dans au moins 2 titres H2
3. Contenu utile, actionnable, basé sur l'expérience terrain
4. Ton professionnel mais accessible, jamais condescendant
5. Minimum 700 mots, maximum 1000 mots
6. Inclure des chiffres, benchmarks, exemples concrets quand pertinent
7. Terminer avec un paragraphe de conclusion (h2 "Conclusion") qui résume les points clés
8. NE PAS inclure de CTA, de balises <html>, <head>, <body> — uniquement le contenu de l'article

À la fin, sur une NOUVELLE LIGNE, écris exactement :
EXCERPT: [une phrase de 150-180 caractères max qui résume l'article, optimisée pour le meta excerpt]
READTIME: [nombre de minutes de lecture estimé, entre 6 et 12]`
    }]
  });

  const raw = resp.content[0].text.trim();

  const excerptMatch = raw.match(/\nEXCERPT:\s*(.+)/);
  const readtimeMatch = raw.match(/\nREADTIME:\s*(\d+)/);
  const excerpt = excerptMatch ? excerptMatch[1].trim() : topic.title;
  const readTime = readtimeMatch ? readtimeMatch[1] + ' min' : '8 min';

  const content = raw.replace(/\nEXCERPT:.+/, '').replace(/\nREADTIME:.+/, '').trim();

  console.log(`✓ Contenu généré (${content.length} caractères)`);
  console.log(`✓ Excerpt : ${excerpt}`);
  console.log(`✓ Temps de lecture : ${readTime}`);

  const related = existing.slice(0, 3).map(a => `
      <a href="/insights/${a.slug}/" class="rcard">
        <div class="rcat">${a.category}</div>
        <div class="rtitle">${a.title}</div>
        <div class="rread">${a.readTime} de lecture</div>
      </a>`).join('');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${topic.title} | EXECUTIO</title>
<meta name="description" content="${excerpt}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://exe-cutio.com/insights/${topic.slug}/">
<meta property="og:title" content="${topic.title}">
<meta property="og:description" content="${excerpt}">
<meta property="og:url" content="https://exe-cutio.com/insights/${topic.slug}/">
<meta property="og:type" content="article">
<meta property="og:site_name" content="EXECUTIO — Financial Advisory">${image ? `\n<meta property="og:image" content="${image.large}">` : ''}
<meta property="article:published_time" content="${dateStr}">
<meta property="article:section" content="${topic.category}">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "${topic.title}",
  "description": "${excerpt}",
  "url": "https://exe-cutio.com/insights/${topic.slug}/",
  "datePublished": "${dateStr}",
  "dateModified": "${dateStr}",
  "author": {"@type": "Organization", "name": "EXECUTIO", "url": "https://exe-cutio.com"},
  "publisher": {"@type": "Organization", "name": "EXECUTIO", "url": "https://exe-cutio.com"},
  "mainEntityOfPage": {"@type": "WebPage", "@id": "https://exe-cutio.com/insights/${topic.slug}/"},
  "keywords": "${topic.keywords}"
}
<\/script>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600;700&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/insights/style.css">
</head>
<body>

<nav>
  <a href="/" class="logo"><span>EXECUTIO</span></a>
  <div class="nav-links">
    <a href="/#services">Services</a>
    <a href="/insights/">Insights</a>
    <a href="/#booking" class="nav-cta">Réserver un appel</a>
  </div>
</nav>
<div style="background:#fff;padding-top:62px"><div class="breadcrumb"><a href="/">Accueil</a><span>›</span><a href="/insights/">Insights</a><span>›</span>${topic.category}</div></div>

<div class="art-hero">
  <div class="art-hero-inner">
    <div class="art-cat">${topic.category}</div>
    <h1>${topic.title}</h1>
    <div class="art-meta">
      <span class="art-author">Par EXECUTIO</span>
      <span class="art-date">${dateFR}</span>
      <span class="art-read">${readTime} de lecture</span>
    </div>
  </div>
</div>

<div class="art-wrap">
  <div class="art-body">
${image ? `<figure class="art-img">
  <img src="${image.medium}" alt="${image.alt}" loading="lazy">
  <figcaption>Photo : <a href="${image.photographerUrl}" target="_blank" rel="noopener">${image.photographer}</a> via Pexels</figcaption>
</figure>
` : ''}${content}
  </div>

  <div class="art-cta">
    <h3>Une question sur votre situation ?</h3>
    <p>Discutons lors d'un appel de 30 minutes — gratuit et sans engagement.</p>
    <a href="/#booking">Réserver un appel gratuit →</a>
  </div>
</div>

<div class="related">
  <div class="related-inner">
    <h2>Articles liés</h2>
    <div class="related-grid">${related}</div>
  </div>
</div>

<footer>
  <div class="fbrand"><span>EXECUTIO</span></div>
  <span class="fcopy">© 2026 Executio — Financial Advisory · Tous droits réservés</span>
  <a href="mailto:contact@exe-cutio.com" class="flink">contact@exe-cutio.com</a>
</footer>
</body>
</html>`;

  const dir = path.join(ROOT, 'insights', topic.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf-8');
  console.log(`✓ Fichier créé : insights/${topic.slug}/index.html`);

  const newArticle = {
    slug: topic.slug,
    title: topic.title,
    category: topic.category,
    excerpt,
    readTime,
    date: dateStr,
    icon: topic.icon,
    image: image ? image.medium : null
  };

  const updatedArticles = [newArticle, ...existing];
  fs.writeFileSync(ARTICLES_JSON, JSON.stringify(updatedArticles, null, 2), 'utf-8');
  console.log(`✓ data/articles.json mis à jour (${updatedArticles.length} articles)`);

  // Retirer le sujet publié du pool
  const remainingTopics = topics.filter(t => t.slug !== topic.slug);
  fs.writeFileSync(TOPICS_JSON, JSON.stringify(remainingTopics, null, 2), 'utf-8');
  console.log(`✓ data/article-topics.json mis à jour (${remainingTopics.length} sujets restants)`);

  console.log(`\n✅ Article publié : "${topic.title}"`);

  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    fs.appendFileSync(output, `title=${topic.title.substring(0, 80)}\n`);
  }
}

main().catch(err => {
  console.error('Erreur:', err.message);
  process.exit(1);
});
