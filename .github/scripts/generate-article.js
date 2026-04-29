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
      content: `You are a creative director for a premium B2B strategic advisory brand (Executio, strategic partner for SME leaders and founders).

Write a FLUX image generation prompt for a blog article hero image.
Article title: "${title}"
Category: "${category}"

VISUAL DIRECTION: Editorial photography — McKinsey or HBR article imagery. BE SPECIFIC AND ORIGINAL based on the article topic. DO NOT default to the generic laptop+notebook scene. Choose a genuinely distinctive visual:
- A dramatic action: hands marking a printed P&L with a highlighter, a whiteboard being filled with arrows and numbers, a founder reviewing a printed report
- A strong setting: a glass-walled boardroom, an open-plan startup office at dusk, a city-view window, a printed financial deck spread on a conference table
- A textural close-up: a dog-eared page with a red pen, a sticky note on a screen, a hand-written metric in a leather notebook
- A human moment: silhouette at floor-to-ceiling windows, two people reviewing a projected chart, a lone founder still at work after hours

The image must feel like a magazine editorial — specific, visually interesting, not generic.

HARD RULES:
- NO full human faces — hands, arms, silhouettes only
- NO stock-photo clichés: no handshakes, no coin stacks, no generic suits, no generic MacBook-on-white-desk
- NO logos or brand names on any screen or document
- Photorealistic — NOT illustrated, NOT CGI
- Clean neutral tones: white, warm grey, natural wood, soft ambient or natural light
- Landscape 16:9 composition

Reply with ONLY the prompt — 2 sharp, specific sentences.`,
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
      content: `Tu es un expert SEO spécialisé en stratégie d'entreprise et management pour les PME et startups en France et en Belgique.

Génère exactement 20 nouveaux sujets d'articles de blog SEO pour Executio (partenaire stratégique externe pour dirigeants de PME). Ces articles ciblent des dirigeants de PME (5 à 50 personnes), fondateurs et entrepreneurs en croissance.

Narrative centrale : les dirigeants sont trop souvent "la tête dans le guidon" — pris dans l'opérationnel, sans recul pour voir ce qui freine leur croissance et ce qui mérite d'être scalé. Executio apporte ce regard extérieur.

Mélange obligatoire :
- 5 sujets "Stratégie dirigeant" : décision stratégique, priorisation, positionnement, sortie vs croissance, gestion de l'incertitude
- 5 sujets "Vision & Recul" : angles morts, biais du fondateur, regard extérieur, recul stratégique, ce que la proximité cache
- 5 sujets "Croissance & Scale" : paliers de croissance, unit economics, leviers de scale organique, croissance rentable, modèle scalable
- 5 sujets "Organisation & Ops" : délégation, processus, réunions, recrutement vs automatisation, structure organisationnelle

Pour chaque sujet, réponds en JSON strict (tableau de 20 objets), chaque objet ayant :
- "title": titre SEO en français (60-80 chars, direct, affirmé — éviter "Comment", préférer "Les X...", "Pourquoi...", affirmations directes)
- "slug": slug URL (minuscules, tirets, sans accents, 3-6 mots)
- "category": une parmi ["Stratégie dirigeant", "Vision & Recul", "Croissance & Scale", "Organisation & Ops"]
- "icon": une parmi ["activity", "trending-up", "bar-chart", "briefcase", "clock", "users"]
- "keywords": 3 mots-clés SEO séparés par des virgules (focus scale PME, stratégie dirigeant, croissance)

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
      content: `Tu es un conseiller stratégique senior — l'équivalent d'un partner de cabinet de conseil de direction (McKinsey OPS, Roland Berger, Kearney) qui travaille exclusivement avec des dirigeants de PME et de startups en croissance en France et en Belgique. Tu rédiges des articles qui font référence dans la communauté des fondateurs et dirigeants francophones.

Narrative de marque : les dirigeants sont trop souvent "la tête dans le guidon" — absorbés par l'opérationnel, sans recul pour voir ce qui freine leur croissance ou ce qui mérite d'être scalé. Le regard extérieur d'un partenaire stratégique change ça.

Rédige un article de fond sur : "${topic.title}"
Mots-clés à intégrer naturellement : ${topic.keywords}

VOIX ET TON — ce qui distingue un article d'autorité d'un article SEO générique :
- Tu ouvres avec une vérité inconfortable, un paradoxe, ou une situation concrète que le lecteur reconnaît immédiatement. Jamais avec "Découvrez", "Dans cet article" ou une définition.
- Tu as un point de vue affirmé : tu dis ce qui est vrai, ce qui est faux, ce que la majorité rate. Pas de langue de bois.
- Tes exemples sont précis et crédibles : "un fondateur e-commerce que nous accompagnons depuis 14 mois" ou "sur les 30 dirigeants de PME rencontrés cette année". Jamais vagues.
- Tes benchmarks ont un contexte réel : "en France, 73% des dirigeants de PME déclarent manquer de temps pour la réflexion stratégique (Bpifrance, 2024)" ou "les PME qui franchissent le palier 2M→5M de CA ont presque toutes structuré leur délégation avant de scaler".
- Tu parles de croissance, d'organisation, de décision, de recul — pas de fiscalité ou de comptabilité sauf si le sujet l'exige.
- Ton lecteur est un pair, pas un élève. Tu l'informes, tu ne l'instruis pas.

STRUCTURE NARRATIVE — pas une liste de sections, une progression logique :
1. Ouverture : une tension, un problème réel, une situation concrète que le lecteur vit (1 paragraphe percutant)
2. Le fond du problème : pourquoi c'est plus complexe et systémique qu'il n'y paraît
3. Ce que font les dirigeants qui s'en sortent : 2-3 pratiques concrètes, avec observations de terrain
4. L'erreur classique à éviter : la chose que tout le monde fait et qui bloque la croissance
5. Ce qu'il faut retenir : synthèse actionnable avec une question ou une tension qui pousse à l'action

FORMAT HTML STRICT :
- <p class="art-lead"> : UNE seule phrase d'ouverture, max 180 caractères, qui crée une tension immédiate
- <h2> : 4-5 sections max, titres affirmés (pas de questions, pas de "comment")
- <h3> : sous-sections uniquement si indispensable (2 max par article)
- <p> : paragraphes courts, 2-4 phrases. Respiration entre les idées.
- <ul><li> : listes de 3-5 items max, chacun actionnable et précis
- <div class="highlight"><strong>Point clé :</strong> ...</div> : UN seul encadré, pour l'observation ou le principe le plus important
- <strong> : pour les concepts clés et chiffres — pas pour décorer
- <em> : pour les formules ou principes synthétiques uniquement

RÈGLES ABSOLUES :
✗ Jamais : "Dans cet article, nous allons", "Il est important de", "En conclusion, nous avons vu", "N'hésitez pas à"
✗ Pas de conclusion bateau qui résume ce qui vient d'être dit
✗ Pas de keyword stuffing — les mots-clés s'intègrent naturellement dans les phrases
✗ Pas de rembourrage — si une phrase n'apporte pas de valeur nouvelle, elle n'existe pas
✗ Pas de conseils sur la comptabilité, la fiscalité ou les outils logiciels sauf si directement lié au sujet
✓ Minimum 750 mots, maximum 1100 mots
✓ Au moins 3 observations concrètes ou benchmarks contextualisés dans l'article
✓ Terminer sur une note prospective ou une tension qui pousse à l'action — pas une répétition

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

  const content = raw
    .replace(/\nEXCERPT:.+/, '').replace(/\nREADTIME:.+/, '')
    .replace(/^```(?:html)?\n?/m, '').replace(/\n?```$/m, '')
    .replace(/^<article[^>]*>\n?/, '').replace(/\n?<\/article>$/m, '')
    .trim();

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
    <p>Discutons lors d'un appel d'une heure — gratuit et sans engagement.</p>
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
