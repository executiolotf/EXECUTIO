import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const ARTICLES_JSON = path.join(ROOT, 'data', 'articles.json');
const TOPICS_JSON = path.join(ROOT, 'data', 'article-topics.json');
const CLUSTERS_JSON = path.join(ROOT, 'data', 'keyword-clusters.json');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Quality gate (2026-06-08): regenerate with editor feedback until score >= target.
const QUALITY_THRESHOLD = 90;
const MAX_ATTEMPTS = 6;
const WRITER_MODEL = 'claude-sonnet-4-6'; // upgraded from Haiku to reach the 90 bar
const REVIEW_MODEL = 'claude-sonnet-4-6';

const AUTHORITY_LINKS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'authority-links.json'), 'utf-8'));

function getRelevantLinks(title, category, n = 18) {
  const needle = (title + ' ' + category).toLowerCase();
  const scored = AUTHORITY_LINKS
    .filter(l => l.title)
    .map(l => {
      const hits = l.topics.filter(t => needle.includes(t.toLowerCase())).length;
      return { ...l, hits };
    })
    .sort((a, b) => b.hits - a.hits || Math.random() - 0.5);
  // Always return at least n links — pad with non-matched ones if needed
  const top = scored.slice(0, n);
  if (top.length < n) {
    const rest = scored.slice(n);
    top.push(...rest.slice(0, n - top.length));
  }
  return top;
}

const FLUX_VISUAL_APPROACHES = [
  'A dramatic close-up of hands in action (marking documents, writing metrics, pointing at a chart)',
  'A strong environmental shot (glass-walled boardroom, open-plan office at dusk, city-view window)',
  'A textural detail (dog-eared report with red annotations, sticky note on a screen, leather notebook with handwritten numbers)',
  'A human silhouette moment (lone figure at floor-to-ceiling windows, two people reviewing a projected chart, founder still at desk after hours)',
  'An overhead desk composition (financial deck spread on conference table, printed strategy map with coffee cup, annotated org chart)',
  'A candid in-motion shot (someone walking through a modern open-plan office, a whiteboard being actively filled with arrows)',
];

async function buildFluxPrompt(title, category) {
  // Pick a random visual approach to force variety across articles
  const approach = FLUX_VISUAL_APPROACHES[Math.floor(Math.random() * FLUX_VISUAL_APPROACHES.length)];

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 180,
    messages: [{
      role: 'user',
      content: `You are a creative director for a premium B2B strategic advisory brand (Executio, strategic partner for SME leaders and founders).

Write a FLUX image generation prompt for a blog article hero image.
Article title: "${title}"
Category: "${category}"

MANDATORY VISUAL APPROACH FOR THIS IMAGE: ${approach}
You MUST use this specific type of shot — do not default to another approach even if it seems easier.

VISUAL DIRECTION: Editorial photography — McKinsey or HBR article imagery. BE SPECIFIC AND ORIGINAL based on the article topic.

HARD RULES:
- NO full human faces — hands, arms, silhouettes only
- NO stock-photo clichés: no handshakes, no coin stacks, no generic suits, no generic MacBook-on-white-desk
- NO logos or brand names on any screen or document
- Photorealistic — NOT illustrated, NOT CGI
- Clean neutral tones: white, warm grey, natural wood, soft ambient or natural light
- Landscape 16:9 composition

Reply with ONLY the prompt — 2 sharp, specific sentences that implement the mandatory approach.`,
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

// Per-category query pools — picked randomly to ensure visual variety
const PEXELS_QUERY_POOLS = {
  'Stratégie dirigeant': [
    'executive strategy meeting boardroom',
    'business decision making office',
    'corporate leadership planning',
    'CEO desk strategy documents',
    'professional business presentation',
    'business plan whiteboard office',
  ],
  'Vision & Recul': [
    'office window city view executive',
    'thinking businessman window light',
    'strategic perspective aerial view office',
    'founder reflection glass wall',
    'solitary executive office dusk',
    'business vision horizon wide angle',
  ],
  'Croissance & Scale': [
    'startup growth team office',
    'business expansion chart meeting',
    'growth metrics dashboard office',
    'modern tech office open space',
    'team scaling company progress',
    'business momentum energy office',
  ],
  'Organisation & Ops': [
    'team workflow collaboration office',
    'business process operations desk',
    'project management meeting room',
    'organized workplace productivity',
    'office operations professional team',
    'delegation meeting whiteboard office',
  ],
};

function usedPexelsIds(articles) {
  const ids = new Set();
  for (const a of articles) {
    // Support both old URL format and new pexelsId field
    if (a.pexelsId) {
      ids.add(String(a.pexelsId));
    } else if (a.image && a.image.includes('pexels.com/photos/')) {
      const m = a.image.match(/\/photos\/(\d+)\//);
      if (m) ids.add(m[1]);
    }
  }
  return ids;
}

async function getPexelsImage(title, category, excludeIds = new Set()) {
  if (!process.env.PEXELS_API_KEY) return null;
  try {
    const pool = PEXELS_QUERY_POOLS[category] || ['business professional office modern'];
    // Pick a random query from the pool each time for visual variety
    const query = encodeURIComponent(pool[Math.floor(Math.random() * pool.length)]);
    // Start on a random page to further diversify results
    const startPage = Math.floor(Math.random() * 3) + 1;
    for (let offset = 0; offset < 5; offset++) {
      const page = ((startPage + offset - 1) % 5) + 1;
      const res = await fetch(`https://api.pexels.com/v1/search?query=${query}&per_page=80&page=${page}&orientation=landscape&size=large`, {
        headers: { Authorization: process.env.PEXELS_API_KEY },
      });
      if (!res.ok) throw new Error(`Pexels ${res.status}`);
      const data = await res.json();
      if (!data.photos?.length) continue;
      const available = data.photos.filter(p => !excludeIds.has(String(p.id)));
      if (available.length) {
        const photo = available[Math.floor(Math.random() * available.length)];
        return { large: photo.src.large2x, medium: photo.src.large, alt: photo.alt || title, pexelsId: photo.id };
      }
    }
    throw new Error('No unused photos found after 5 pages');
  } catch (e) {
    console.warn(`⚠ Pexels: ${e.message}`);
    return null;
  }
}

async function downloadImage(url, destPath) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    return true;
  } catch (e) {
    console.warn(`⚠ Download image: ${e.message}`);
    return false;
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
      content: `Tu es un expert SEO spécialisé en stratégie d'entreprise et management pour les PME et startups en croissance.

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

// Sélectionne des articles de la même thématique (cluster) en priorité, pour
// renforcer le maillage interne hub-and-spoke ; complète avec les plus récents.
function clusterSiblings(existing, topic, n) {
  if (!topic || !topic.cluster) return existing.slice(0, n);
  const same = existing.filter(a => a.cluster === topic.cluster);
  const rest = existing.filter(a => a.cluster !== topic.cluster);
  return [...same, ...rest].slice(0, n);
}

// Retourne la page pilier d'un cluster UNIQUEMENT si elle est marquée live
// (pillarLive) — garantit qu'on ne génère jamais de lien interne en 404.
function livePillarFor(clusterId) {
  if (!clusterId) return null;
  try {
    const data = JSON.parse(fs.readFileSync(CLUSTERS_JSON, 'utf-8'));
    const c = (data.clusters || []).find(x => x.id === clusterId);
    if (c && c.pillarLive && c.pillarUrl) return { url: c.pillarUrl, title: c.pillarTitle };
  } catch { /* pas de carte de clusters : on ignore */ }
  return null;
}

// Liste des liens internes proposés au modèle : la page pilier live du thème
// en premier (si elle existe), puis les articles frères du même cluster.
function internalLinkList(existing, topic) {
  const lines = [];
  const pillar = livePillarFor(topic && topic.cluster);
  if (pillar) lines.push(`  - "${pillar.title}" (PAGE PILIER du thème — à lier en priorité) → https://exe-cutio.com${pillar.url}`);
  clusterSiblings(existing, topic, pillar ? 5 : 6).forEach(a =>
    lines.push(`  - "${a.title}" → https://exe-cutio.com/insights/${a.slug}/`));
  return lines.join('\n');
}

async function reviewArticle(raw, topic) {
  const body = raw.replace(/\nEXCERPT:[\s\S]*/, '').replace(/```/g, '').trim();
  const msg = await client.messages.create({
    model: REVIEW_MODEL,
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `Tu es rédacteur en chef exigeant d'un cabinet de conseil de direction. Note cet article (sujet : "${topic.title}") sur 100. Juge : utilité et profondeur réelles, point de vue affirmé, exemples/benchmarks concrets et crédibles, absence de remplissage et de formules creuses, qualité d'écriture en français, structure. Sois sévère — un article IA moyen mérite 60-75.\n\nRéponds UNIQUEMENT en JSON compact, sans prose :\n{"score": <0-100>, "verdict": "<une phrase>", "issues": ["correction concrète", "correction concrète"]}\n\nARTICLE :\n${body.slice(0, 14000)}`,
    }],
  });
  const text = msg.content[0].text.trim();
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch { /* fall through */ }
  }
  // Parse failed: score low so a glitchy review never falsely passes the gate.
  return { score: 0, verdict: 'review-unparseable', issues: [] };
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

  let image = await generateFluxImage(topic.title, topic.category);
  if (image) {
    console.log(`✓ Image FLUX générée`);
  } else {
    console.log('→ Fallback Pexels...');
    image = await getPexelsImage(topic.title, topic.category, usedPexelsIds(existing));
    if (image) console.log(`✓ Image Pexels obtenue`);
    else console.log('⚠ Pas d\'image (FLUX + Pexels indisponibles)');
  }

  // Compute local image path early (slug is known)
  const localImagePath = `/insights/${topic.slug}/hero.jpg`;
  // Open Graph / Twitter exigent une URL ABSOLUE (les scrapers LinkedIn/FB
  // ignorent les chemins relatifs). On préfixe le domaine.
  const absoluteImagePath = `https://exe-cutio.com${localImagePath}`;

  const articlePrompt = `Tu es un conseiller stratégique senior — l'équivalent d'un partner de cabinet de conseil de direction (McKinsey OPS, Roland Berger, Kearney) qui travaille avec des dirigeants de PME et de startups en croissance. Tu rédiges des articles qui font référence dans la communauté des fondateurs et dirigeants de PME.

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
✓ Minimum 1800 mots, idéalement 2000-2200 mots
✓ Au moins 4 observations concrètes ou benchmarks contextualisés dans l'article
✓ Inclure 1 à 2 liens externes vers des articles de référence, uniquement parmi cette liste — choisis les 1 ou 2 plus pertinents par rapport au sujet traité, intégrés naturellement dans le texte au format <a href="URL" target="_blank" rel="noopener noreferrer">texte ancre descriptif</a> :
${getRelevantLinks(topic.title, topic.category).map(l => `  - ${l.url} — "${l.title}"`).join('\n')}
✗ INTERDIT : n'utilise JAMAIS une URL que tu inventes ou qui ne figure pas dans cette liste. Si aucun lien ne s'applique naturellement, cite la source par son nom sans lien — ex. : "selon McKinsey (2023)" sans balise <a>.
✓ Inclure 2 à 3 liens internes contextuels vers d'autres articles Executio de la MÊME thématique (priorité aux plus pertinents ci-dessous), intégrés naturellement dans le corps du texte au format <a href="URL">ancre descriptive</a> — ce maillage interne renforce l'autorité thématique :
${internalLinkList(existing, topic)}
✓ Terminer sur une note prospective ou une tension qui pousse à l'action — pas une répétition

À la fin, sur une NOUVELLE LIGNE, écris exactement :
EXCERPT: [une phrase de 150-180 caractères qui capture l'angle principal de l'article — écrite pour donner envie de lire, pas pour résumer]
READTIME: [minutes de lecture entre 8 et 15]
FAQ_START
Q: [question fréquente des dirigeants sur ce sujet, 60-90 chars]
A: [réponse directe et actionnable, 100-150 chars]
Q: [deuxième question, différente angle]
A: [réponse directe]
Q: [troisième question]
A: [réponse directe]
FAQ_END`;

  // Quality gate: regenerate with the editor's feedback until score >= threshold.
  let best = null; // { raw, score }
  let feedback = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const fullPrompt = feedback
      ? `${articlePrompt}\n\nNOTE : un brouillon précédent a été noté ${feedback.score}/100 par l'éditeur. Corrige ces points et écris un article nettement meilleur, plus concret et plus affirmé :\n${(feedback.issues || []).map((i) => `- ${i}`).join('\n')}`
      : articlePrompt;
    const r = await client.messages.create({
      model: WRITER_MODEL,
      max_tokens: 5000,
      messages: [{ role: 'user', content: fullPrompt }],
    });
    const candidate = r.content[0].text.trim();
    const review = await reviewArticle(candidate, topic);
    console.log(`  essai ${attempt} : ${review.score}/100 — ${review.verdict}`);
    if (!best || review.score > best.score) best = { raw: candidate, score: review.score };
    if (review.score >= QUALITY_THRESHOLD) break;
    feedback = review;
  }
  if (best.score < QUALITY_THRESHOLD) {
    console.log(`⚠ Meilleur score après ${MAX_ATTEMPTS} essais : ${best.score}/100 (cible ${QUALITY_THRESHOLD}). Publication du meilleur brouillon.`);
  }
  const raw = best.raw;

  const excerptMatch = raw.match(/\nEXCERPT:\s*(.+)/);
  const readtimeMatch = raw.match(/\nREADTIME:\s*(\d+)/);
  const excerpt = excerptMatch ? excerptMatch[1].trim() : topic.title;
  const readTime = readtimeMatch ? readtimeMatch[1] + ' min' : '10 min';

  // Extract FAQ pairs
  const faqMatch = raw.match(/FAQ_START\n([\s\S]+?)\nFAQ_END/);
  const faqPairs = [];
  if (faqMatch) {
    const faqLines = faqMatch[1].trim().split('\n');
    for (let i = 0; i < faqLines.length - 1; i += 2) {
      const q = faqLines[i]?.replace(/^Q:\s*/, '').trim();
      const a = faqLines[i + 1]?.replace(/^A:\s*/, '').trim();
      if (q && a) faqPairs.push({ q, a });
    }
  }

  const content = raw
    .replace(/\nEXCERPT:.+/, '').replace(/\nREADTIME:.+/, '')
    .replace(/\nFAQ_START[\s\S]+?FAQ_END/, '')
    .replace(/^```(?:html)?\n?/m, '').replace(/\n?```$/m, '')
    .replace(/^<article[^>]*>\n?/, '').replace(/\n?<\/article>$/m, '')
    .trim();

  console.log(`✓ Contenu généré (${content.length} caractères)`);
  console.log(`✓ Excerpt : ${excerpt}`);
  console.log(`✓ Temps de lecture : ${readTime}`);

  const related = clusterSiblings(existing, topic, 3).map(a => `
      <a href="/insights/${a.slug}/" class="rcard">
        <div class="rcat">${a.category}</div>
        <div class="rtitle">${a.title}</div>
        <div class="rread">${a.readTime} de lecture</div>
      </a>`).join('');

  const faqSchema = faqPairs.length ? `,\n{\n  "@context": "https://schema.org",\n  "@type": "FAQPage",\n  "mainEntity": [\n${faqPairs.map(f => `    {\n      "@type": "Question",\n      "name": "${f.q.replace(/"/g, '\\"')}",\n      "acceptedAnswer": {"@type": "Answer", "text": "${f.a.replace(/"/g, '\\"')}"}\n    }`).join(',\n')}\n  ]\n}` : '';

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${topic.title} | EXECUTIO</title>
<meta name="description" content="${excerpt}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://exe-cutio.com/insights/${topic.slug}/">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/favicon.svg">
<meta property="og:title" content="${topic.title}">
<meta property="og:description" content="${excerpt}">
<meta property="og:url" content="https://exe-cutio.com/insights/${topic.slug}/">
<meta property="og:type" content="article">
<meta property="og:site_name" content="EXECUTIO — Conseil stratégique">
<meta property="og:locale" content="fr_FR">${image ? `\n<meta property="og:image" content="${absoluteImagePath}">` : ''}
<meta property="article:published_time" content="${dateStr}">
<meta property="article:section" content="${topic.category}">
<meta property="article:author" content="Executio Team">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${topic.title}">
<meta name="twitter:description" content="${excerpt}">${image ? `\n<meta name="twitter:image" content="${absoluteImagePath}">` : ''}
<script type="application/ld+json">
[
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "${topic.title}",
  "description": "${excerpt}",
  "url": "https://exe-cutio.com/insights/${topic.slug}/",
  "datePublished": "${dateStr}",
  "dateModified": "${dateStr}",
  "author": {
    "@type": "Person",
    "@id": "https://exe-cutio.com/a-propos/#founder",
    "name": "Executio Team",
    "url": "https://exe-cutio.com/a-propos/"
  },
  "publisher": {
    "@type": "Organization",
    "@id": "https://exe-cutio.com/#organization",
    "name": "EXECUTIO",
    "url": "https://exe-cutio.com",
    "logo": {"@type": "ImageObject", "url": "https://exe-cutio.com/favicon.svg", "width": 112, "height": 112}
  },
  "mainEntityOfPage": {"@type": "WebPage", "@id": "https://exe-cutio.com/insights/${topic.slug}/"},
  "speakable": {"@type": "SpeakableSpecification", "cssSelector": ["h1", ".art-lead"]},
  "keywords": "${topic.keywords}"${image ? `,\n  "image": {"@type": "ImageObject", "url": "https://exe-cutio.com${localImagePath}", "width": 940, "height": 650}` : ''}
},
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    {"@type": "ListItem", "position": 1, "name": "Accueil", "item": "https://exe-cutio.com/"},
    {"@type": "ListItem", "position": 2, "name": "Insights", "item": "https://exe-cutio.com/insights/"},
    {"@type": "ListItem", "position": 3, "name": "${topic.title}", "item": "https://exe-cutio.com/insights/${topic.slug}/"}
  ]
}${faqSchema}
]
<\/script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600;700&family=DM+Sans:wght@300;400;500&display=swap" as="style" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600;700&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet"></noscript>
<link rel="stylesheet" href="/insights/style.css">
</head>
<body>

<nav>
  <a href="/" class="logo"><span>EXECUTIO</span></a>
  <div class="nav-links">
    <a href="/#services">Services</a>
    <a href="/insights/">Insights</a>
    <a href="/#contact">Contact</a>
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
  <img src="${localImagePath}" alt="${image.alt}" width="940" height="650" loading="lazy">
</figure>
` : ''}${content}${faqPairs.length ? `
<div class="art-faq">
  <h2>Questions fréquentes</h2>
  ${faqPairs.map(f => `<details class="faq-item"><summary>${f.q}</summary><p>${f.a}</p></details>`).join('\n  ')}
</div>` : ''}
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

  // Download image locally so og:image never expires
  if (image) {
    const downloaded = await downloadImage(image.large, path.join(dir, 'hero.jpg'));
    if (downloaded) console.log(`✓ Image téléchargée : insights/${topic.slug}/hero.jpg`);
  }

  fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf-8');
  console.log(`✓ Fichier créé : insights/${topic.slug}/index.html`);

  const newArticle = {
    slug: topic.slug,
    title: topic.title,
    category: topic.category,
    cluster: topic.cluster || null,
    excerpt,
    readTime,
    date: dateStr,
    icon: topic.icon,
    image: image ? localImagePath : null,
    pexelsId: image?.pexelsId ?? null
  };

  const updatedArticles = [newArticle, ...existing];
  fs.writeFileSync(ARTICLES_JSON, JSON.stringify(updatedArticles, null, 2), 'utf-8');
  console.log(`✓ data/articles.json mis à jour (${updatedArticles.length} articles)`);

  // Retirer le sujet publié du pool
  const remainingTopics = topics.filter(t => t.slug !== topic.slug);
  fs.writeFileSync(TOPICS_JSON, JSON.stringify(remainingTopics, null, 2), 'utf-8');
  console.log(`✓ data/article-topics.json mis à jour (${remainingTopics.length} sujets restants)`);

  // Régénérer sitemap.xml
  const BASE = 'https://exe-cutio.com';
  const sitemapPages = [
    { url: '/', priority: '1.0', changefreq: 'weekly' },
    { url: '/insights/', priority: '0.9', changefreq: 'daily' },
    { url: '/daf-externalise/', priority: '0.9', changefreq: 'monthly' },
    { url: '/a-propos/', priority: '0.8', changefreq: 'monthly' },
    ...updatedArticles.map(a => ({ url: `/insights/${a.slug}/`, lastmod: a.date, priority: '0.8', changefreq: 'monthly' }))
  ];
  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapPages.map(p => `  <url>\n    <loc>${BASE}${p.url}</loc>${p.lastmod ? `\n    <lastmod>${p.lastmod}</lastmod>` : ''}\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`).join('\n')}\n</urlset>`;
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemapXml, 'utf-8');
  console.log(`✓ sitemap.xml régénéré (${sitemapPages.length} URLs)`);

  // Mettre à jour insights/index.html : blogPost[] JSON-LD + noscript
  updateBlogIndex(updatedArticles);
  console.log(`✓ insights/index.html mis à jour (blogPost + noscript)`);

  console.log(`\n✅ Article publié : "${topic.title}"`);

  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    fs.appendFileSync(output, `title=${topic.title.substring(0, 80)}\n`);
  }
}

function updateBlogIndex(articles) {
  const indexPath = path.join(ROOT, 'insights', 'index.html');
  let html = fs.readFileSync(indexPath, 'utf-8');

  // Remplacer le tableau blogPost[] dans le JSON-LD
  const blogPostItems = articles
    .map(a => `    {"@type": "BlogPosting", "headline": ${JSON.stringify(a.title)}, "url": "https://exe-cutio.com/insights/${a.slug}/", "datePublished": "${a.date}"}`)
    .join(',\n');
  html = html.replace(
    /"blogPost": \[[\s\S]*?\]/,
    `"blogPost": [\n${blogPostItems}\n  ]`
  );

  // Remplacer la section <noscript> avec les liens statiques
  const noscriptCards = articles
    .map(a => `      <a href="/insights/${a.slug}/" class="bcard"><div class="bcard-body"><div class="bcat">${a.category}</div><div class="btitle">${a.title}</div></div></a>`)
    .join('\n');
  html = html.replace(
    /<noscript>\s*<div class="blog-grid">[\s\S]*?<\/div>\s*<\/noscript>/,
    `<noscript>\n    <div class="blog-grid">\n${noscriptCards}\n    </div>\n  </noscript>`
  );

  fs.writeFileSync(indexPath, html, 'utf-8');
}

main().catch(err => {
  console.error('Erreur:', err.message);
  process.exit(1);
});
