import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const ARTICLES_JSON = path.join(ROOT, 'data', 'articles.json');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Sujets financiers ciblés SEO — enrichis automatiquement
const TOPICS = [
  { title: "Modèle financier SaaS : construire des projections qui convainquent les investisseurs", slug: "modele-financier-saas", category: "KPIs & Métriques", icon: "activity", keywords: "modèle financier SaaS, projections financières startup, ARR SaaS modélisation" },
  { title: "Levée de fonds Seed : préparer son dossier pour les business angels", slug: "levee-fonds-seed-business-angels", category: "Levée de fonds", icon: "trending-up", keywords: "levée de fonds seed, business angels, dossier investisseur seed" },
  { title: "Tableau de bord financier startup : les indicateurs essentiels à suivre chaque mois", slug: "tableau-de-bord-financier-startup", category: "KPIs & Métriques", icon: "bar-chart", keywords: "tableau de bord financier, indicateurs financiers startup, reporting mensuel" },
  { title: "Valorisation startup : méthodes et benchmarks pour négocier sa levée de fonds", slug: "valorisation-startup-methodes", category: "Levée de fonds", icon: "dollar", keywords: "valorisation startup, méthodes valorisation, multiples SaaS, term sheet" },
  { title: "Plan de trésorerie PME : comment anticiper et éviter les crises de liquidité", slug: "plan-tresorerie-pme", category: "Trésorerie", icon: "clock", keywords: "plan de trésorerie PME, gestion liquidité, prévisions trésorerie" },
  { title: "Due diligence financière : ce que les VCs vérifient dans votre data room", slug: "due-diligence-financiere-vc", category: "Levée de fonds", icon: "shield", keywords: "due diligence financière, data room startup, vérification investisseur" },
  { title: "Contrôle de gestion startup : mettre en place un reporting efficace", slug: "controle-de-gestion-startup", category: "CFO as a Service", icon: "briefcase", keywords: "contrôle de gestion startup, reporting financier, tableaux de bord gestion" },
  { title: "Optimisation du BFR : libérer du cash sans emprunter", slug: "optimisation-bfr-besoin-fonds-roulement", category: "Trésorerie", icon: "activity", keywords: "BFR, besoin en fonds de roulement, optimisation trésorerie PME" },
  { title: "Économie unitaire d'une startup : CAC, LTV et les ratios qui rassurent les VCs", slug: "economie-unitaire-startup-cac-ltv", category: "KPIs & Métriques", icon: "bar-chart", keywords: "économie unitaire startup, CAC LTV ratio, unit economics" },
  { title: "Pacte d'actionnaires : clauses financières essentielles pour protéger les fondateurs", slug: "pacte-actionnaires-clauses-financieres", category: "Levée de fonds", icon: "users", keywords: "pacte d'actionnaires, clauses financières, ratchet, anti-dilution" },
  { title: "Externalisation de la paie et des RH pour une startup en croissance", slug: "externalisation-paie-rh-startup", category: "CFO as a Service", icon: "users", keywords: "externalisation paie startup, RH externalisé, charges sociales startup" },
  { title: "Comment fixer le prix de son SaaS : stratégies de pricing pour maximiser le MRR", slug: "pricing-saas-strategie-mrr", category: "KPIs & Métriques", icon: "dollar", keywords: "pricing SaaS, stratégie prix abonnement, MRR optimisation" }
];

function slugify(str) {
  return str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

function formatDateFR(d) {
  const months = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

async function main() {
  // Charger les articles existants
  const existing = JSON.parse(fs.readFileSync(ARTICLES_JSON, 'utf-8'));
  const existingSlugs = new Set(existing.map(a => a.slug));

  // Trouver un sujet non encore publié
  const available = TOPICS.filter(t => !existingSlugs.has(t.slug));
  if (!available.length) {
    console.log('Tous les sujets ont été publiés. Ajoutez de nouveaux sujets dans TOPICS.');
    process.exit(0);
  }

  // Choisir le premier disponible
  const topic = available[0];
  const now = new Date();
  const dateStr = formatDate(now);
  const dateFR = formatDateFR(now);

  console.log(`\n📝 Génération de l'article : "${topic.title}"\n`);

  // Générer le contenu avec Claude Haiku
  const resp = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 3000,
    messages: [{
      role: 'user',
      content: `Tu es un expert financier senior (CFO, advisory financier, startups et PME françaises) qui rédige un article de blog SEO professionnel en français.

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

  // Extraire excerpt et readtime
  const excerptMatch = raw.match(/\nEXCERPT:\s*(.+)/);
  const readtimeMatch = raw.match(/\nREADTIME:\s*(\d+)/);
  const excerpt = excerptMatch ? excerptMatch[1].trim() : topic.title;
  const readTime = readtimeMatch ? readtimeMatch[1] + ' min' : '8 min';

  // Nettoyer le contenu (enlever les lignes EXCERPT/READTIME)
  const content = raw.replace(/\nEXCERPT:.+/, '').replace(/\nREADTIME:.+/, '').trim();

  console.log(`✓ Contenu généré (${content.length} caractères)`);
  console.log(`✓ Excerpt : ${excerpt}`);
  console.log(`✓ Temps de lecture : ${readTime}`);

  // Articles liés (3 premiers autres que celui-ci)
  const related = existing.slice(0, 3).map(a => `
      <a href="/insights/${a.slug}/" class="rcard">
        <div class="rcat">${a.category}</div>
        <div class="rtitle">${a.title}</div>
        <div class="rread">${a.readTime} de lecture</div>
      </a>`).join('');

  // Générer le HTML de l'article
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
<meta property="og:site_name" content="EXECUTIO — Financial Advisory">
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
${content}
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

  // Écrire le fichier HTML
  const dir = path.join(ROOT, 'insights', topic.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf-8');
  console.log(`✓ Fichier créé : insights/${topic.slug}/index.html`);

  // Mettre à jour articles.json
  const newArticle = {
    slug: topic.slug,
    title: topic.title,
    category: topic.category,
    excerpt,
    readTime,
    date: dateStr,
    icon: topic.icon
  };

  // Ajouter en début de tableau (plus récent en premier)
  const updated = [newArticle, ...existing];
  fs.writeFileSync(ARTICLES_JSON, JSON.stringify(updated, null, 2), 'utf-8');
  console.log(`✓ data/articles.json mis à jour (${updated.length} articles)`);

  // Exporter le titre pour le message de commit
  console.log(`\n✅ Article publié : "${topic.title}"`);

  // Output pour GitHub Actions
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    fs.appendFileSync(output, `title=${topic.title.substring(0, 80)}\n`);
  }
}

main().catch(err => {
  console.error('Erreur:', err.message);
  process.exit(1);
});
