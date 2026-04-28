import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const ARTICLES_JSON = path.join(ROOT, 'data', 'articles.json');
const TOPICS_JSON = path.join(ROOT, 'data', 'article-topics.json');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function buildFluxPrompt(title, category) {
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 180,
    messages: [{
      role: 'user',
      content: `You are a creative director for a premium B2B financial advisory brand (Executio, CFO as a Service for startups and SMEs).

Write a FLUX image generation prompt for a blog article hero image.
Article title: "${title}"
Category: "${category}"

VISUAL DIRECTION: Editorial, clean, modern. Think McKinsey or HBR article imagery. A real productive workspace — laptop with a clean dashboard, open notebook with figures, natural window light. Professional but human, not cold or corporate.

HARD RULES:
- NO full human faces — hands, arms, silhouettes from behind only
- NO stock-photo clichés: no handshakes, no stacks of coins, no generic suits
- NO logos or brand names on any screen
- Photorealistic, NOT illustrated
- Clean neutral tones: white, warm grey, natural wood, soft light
- Landscape 16:9 composition

Reply with ONLY the prompt — 2 sharp sentences.`,
    }],
  });
  return msg.content[0].text.trim();
}

async function pollReplicate(url, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` },
    });
    const data = await res.json();
    if (data.status === 'succeeded') return data.output;
    if (data.status === 'failed') throw new Error(`Replicate failed: ${data.error}`);
  }
  throw new Error('Replicate timeout');
}

async function generateFluxImage(title, category) {
  if (!process.env.REPLICATE_API_TOKEN) return null;
  try {
    const prompt = await buildFluxPrompt(title, category);
    console.log(`  FLUX prompt: ${prompt.slice(0, 80)}...`);

    const res = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
        Prefer: 'wait=60',
      },
      body: JSON.stringify({
        input: {
          prompt,
          aspect_ratio: '16:9',
          output_format: 'jpg',
          output_quality: 90,
          safety_tolerance: 2,
          prompt_upsampling: true,
        },
      }),
    });

    if (!res.ok) throw new Error(`Replicate ${res.status}`);
    const prediction = await res.json();
    const imageUrl = prediction.status === 'succeeded'
      ? prediction.output
      : await pollReplicate(prediction.urls.get);

    return { large: imageUrl, medium: imageUrl, alt: title };
  } catch (e) {
    console.warn(`⚠ FLUX: ${e.message}`);
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

  const image = await generateFluxImage(topic.title, topic.category);
  if (image) console.log(`✓ Image FLUX générée`);
  else console.log('⚠ Pas d\'image (Replicate indisponible)');

  const resp = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 3000,
    messages: [{
      role: 'user',
      content: `Tu es partner senior dans un cabinet de conseil financier de premier plan — l'équivalent d'un directeur McKinsey spécialisé finance d'entreprise. Tu rédiges des articles qui font référence dans la communauté des fondateurs et dirigeants de PME francophones.

Rédige un article de fond sur : "${topic.title}"
Mots-clés à intégrer naturellement : ${topic.keywords}

VOIX ET TON — ce qui distingue un article d'autorité d'un article SEO générique :
- Tu ouvres avec une vérité inconfortable, un paradoxe, ou une situation concrète que le lecteur reconnaît immédiatement. Jamais avec "Découvrez", "Dans cet article" ou une définition.
- Tu as un point de vue affirmé : tu dis ce qui est vrai, ce qui est faux, ce que la majorité rate. Pas de langue de bois.
- Tes exemples sont précis et crédibles : "un fondateur SaaS B2B que nous accompagnons depuis 18 mois" ou "sur les 40 levées suivies cette année". Jamais vagues.
- Tes benchmarks ont un contexte : "un CAC payback > 18 mois dans le SaaS B2B mid-market est un signal d'alerte" plutôt que "un bon CAC".
- Ton lecteur est un pair, pas un élève. Tu l'informes, tu ne l'instruis pas.

STRUCTURE NARRATIVE — pas une liste de sections, une progression logique :
1. Ouverture : une tension, un problème réel, une erreur commune (1 paragraphe percutant)
2. Le fond du problème : pourquoi c'est plus complexe qu'il n'y paraît
3. Ce que font les meilleurs : 2-3 pratiques concrètes, avec chiffres et contexte
4. L'erreur classique à éviter : la chose que tout le monde fait et qui ne marche pas
5. Ce qu'il faut retenir : synthèse actionnable, pas un résumé bateau

FORMAT HTML STRICT :
- <p class="art-lead"> : UNE seule phrase d'ouverture, max 180 caractères, qui crée une tension immédiate
- <h2> : 4-5 sections max, titres affirmés (pas de questions, pas de "comment")
- <h3> : sous-sections uniquement si indispensable (2 max par article)
- <p> : paragraphes courts, 2-4 phrases. Respiration entre les idées.
- <ul><li> : listes de 3-5 items max, chacun actionnable et précis
- <div class="highlight"><strong>Point clé :</strong> ...</div> : UN seul encadré, pour la donnée ou la formule la plus importante
- <strong> : pour les termes techniques et chiffres clés — pas pour décorer
- <em> : pour les formules de calcul uniquement

RÈGLES ABSOLUES :
✗ Jamais : "Dans cet article, nous allons", "Il est important de", "En conclusion, nous avons vu", "N'hésitez pas à"
✗ Pas de conclusion bateau qui résume ce qui vient d'être dit
✗ Pas de keyword stuffing — les mots-clés s'intègrent naturellement dans les phrases
✗ Pas de rembourrage — si une phrase n'apporte pas de valeur nouvelle, elle n'existe pas
✓ Minimum 750 mots, maximum 1100 mots
✓ Au moins 3 chiffres/benchmarks contextualisés dans l'article
✓ Terminer sur une note prospective ou une question qui pousse à l'action — pas une répétition

À la fin, sur une NOUVELLE LIGNE, écris exactement :
EXCERPT: [une phrase de 150-180 caractères qui capture l'angle principal de l'article — écrite pour donner envie de lire, pas pour résumer]
READTIME: [minutes de lecture entre 6 et 12]`
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
