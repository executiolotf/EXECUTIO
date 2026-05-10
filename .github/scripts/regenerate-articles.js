import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const ARTICLES_JSON = path.join(ROOT, 'data', 'articles.json');

// Charger .env local si présent
const envPath = path.join(ROOT, '.env');
if (!process.env.ANTHROPIC_API_KEY && fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^ANTHROPIC_API_KEY=(.+)/);
    if (m) { process.env.ANTHROPIC_API_KEY = m[1].trim(); break; }
  }
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('❌ ANTHROPIC_API_KEY manquante.');
  console.error('   Option 1 : crée un fichier .env à la racine du projet avec : ANTHROPIC_API_KEY=sk-ant-...');
  console.error('   Option 2 : lance avec : ANTHROPIC_API_KEY=sk-ant-... node .github/scripts/regenerate-articles.js');
  process.exit(1);
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
  const top = scored.slice(0, n);
  if (top.length < n) top.push(...scored.slice(n, n + (n - top.length)));
  return top;
}

function formatDateFR(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const months = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function buildFaqSchema(faqPairs) {
  if (!faqPairs.length) return '';
  const items = faqPairs.map(f =>
    `    {\n      "@type": "Question",\n      "name": "${f.q.replace(/"/g, '\\"')}",\n      "acceptedAnswer": {"@type": "Answer", "text": "${f.a.replace(/"/g, '\\"')}"}\n    }`
  ).join(',\n');
  return `\n<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "FAQPage",\n  "mainEntity": [\n${items}\n  ]\n}\n<\/script>`;
}

function buildFaqHtml(faqPairs) {
  if (!faqPairs.length) return '';
  const items = faqPairs.map(f =>
    `  <details class="faq-item"><summary>${f.q}</summary><p>${f.a}</p></details>`
  ).join('\n');
  return `\n<div class="art-faq">\n  <h2>Questions fréquentes</h2>\n${items}\n</div>`;
}

async function regenerate(article, allArticles) {
  const filePath = path.join(ROOT, 'insights', article.slug, 'index.html');
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠ Fichier introuvable : ${article.slug}`);
    return null;
  }

  const existing = fs.readFileSync(filePath, 'utf-8');

  // Extraire le head complet (tout jusqu'à </head>)
  const headEnd = existing.indexOf('</head>');
  let head = existing.slice(0, headEnd);

  // Extraire le HTML de la figure (image hero)
  const figMatch = existing.match(/<figure class="art-img">[\s\S]+?<\/figure>/);
  const figureHtml = figMatch ? figMatch[0] + '\n' : '';

  // Extraire la section related + footer (depuis <div class="related"> jusqu'à </html>)
  const relatedIdx = existing.indexOf('<div class="related">');
  const relatedAndFooter = relatedIdx !== -1 ? existing.slice(relatedIdx) : `<footer>\n  <div class="fbrand"><span>EXECUTIO</span></div>\n  <span class="fcopy">© 2026 Executio — Conseil stratégique · Tous droits réservés</span>\n  <a href="mailto:contact@exe-cutio.com" class="flink">contact@exe-cutio.com</a>\n</footer>\n</body>\n</html>`;

  console.log(`\n📝 Regénération : "${article.title}"`);

  const resp = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8000,
    messages: [{
      role: 'user',
      content: `Tu es un conseiller stratégique senior qui rédige des articles de référence pour des dirigeants de PME et startups en croissance. Tu rédiges des articles qui font référence dans la communauté des fondateurs et dirigeants de PME.

Narrative de marque : les dirigeants sont trop souvent "la tête dans le guidon" — absorbés par l'opérationnel, sans recul pour voir ce qui freine leur croissance ou ce qui mérite d'être scalé. Le regard extérieur d'un partenaire stratégique change ça.

Rédige un article complet et approfondi sur : "${article.title}"
Catégorie : ${article.category}

VOIX ET TON :
- Ouvre avec une vérité inconfortable, un paradoxe, ou une situation concrète que le lecteur reconnaît immédiatement. Jamais avec "Découvrez" ou "Dans cet article".
- Point de vue affirmé : dis ce qui est vrai, ce qui est faux, ce que la majorité rate. Pas de langue de bois.
- Exemples précis et crédibles : "un fondateur e-commerce accompagné depuis 14 mois" ou "sur les 30 dirigeants rencontrés cette année"
- Benchmarks contextualisés avec sources réelles : "(Bpifrance, 2024)", "(McKinsey, 2023)", "(Harvard Business Review, 2023)"
- Ton pair-à-pair : ton lecteur est un dirigeant, pas un élève

STRUCTURE NARRATIVE (progression logique, pas un plan de cours) :
1. Ouverture : tension ou paradoxe immédiat que le lecteur reconnaît (1-2 paragraphes)
2. Le fond du problème : pourquoi c'est systémique, pas anecdotique
3. Ce que font les dirigeants qui s'en sortent : 2-3 pratiques concrètes avec observations terrain
4. L'erreur classique que presque tout le monde commet
5. Synthèse actionnable avec une question ou tension qui pousse à agir (pas une conclusion bateau)

FORMAT HTML STRICT :
- <p class="art-lead"> : UNE seule phrase d'ouverture, max 180 caractères, tension immédiate
- <h2> : 4-5 sections max, titres affirmés (pas de questions)
- <h3> : sous-sections si nécessaire (2 max par article)
- <p> : paragraphes courts, 2-4 phrases
- <ul><li> : listes de 3-5 items actionnables et précis
- <div class="highlight"><strong>Point clé :</strong> ...</div> : UN seul encadré
- <strong> : concepts clés et chiffres
- <em> : formules synthétiques

RÈGLES ABSOLUES :
✗ Jamais : "Dans cet article, nous allons", "Il est important de", "En conclusion, nous avons vu"
✗ Pas de conclusion qui résume ce qui vient d'être dit
✗ Pas de keyword stuffing
✓ Minimum 1800 mots, idéalement 2000-2200 mots de contenu réel
✓ Au moins 4 observations terrain concrètes avec chiffres ou durée
✓ Inclure 1 à 2 liens externes vers des articles de référence, uniquement parmi cette liste — choisis les 1 ou 2 plus pertinents, intégrés naturellement dans le texte au format <a href="URL" target="_blank" rel="noopener noreferrer">texte ancre descriptif</a> :
${getRelevantLinks(article.title, article.category).map(l => `  - ${l.url} — "${l.title}"`).join('\n')}
✗ INTERDIT : n'utilise JAMAIS une URL que tu inventes ou qui ne figure pas dans cette liste. Si aucun lien ne s'applique naturellement, cite la source par son nom sans lien — ex. : "selon McKinsey (2023)" sans balise <a>.
✓ Inclure 1 à 2 liens internes vers d'autres articles Executio si le contexte s'y prête naturellement :
${allArticles.filter(a => a.slug !== article.slug).slice(0, 5).map(a => `  - "${a.title}" → https://exe-cutio.com/insights/${a.slug}/`).join('\n')}
✓ Terminer sur une tension prospective, une question qui pousse à agir

À la fin, sur des NOUVELLES LIGNES séparées, écris exactement :
EXCERPT: [phrase 150-180 chars qui donne envie de lire, pas un résumé]
READTIME: [nombre entier de minutes entre 10 et 15]
FAQ_START
Q: [question concrète que pose un dirigeant sur ce sujet, 60-90 chars]
A: [réponse directe et actionnable, 1-2 phrases max]
Q: [deuxième question, angle différent du premier]
A: [réponse directe]
Q: [troisième question]
A: [réponse directe]
FAQ_END`
    }]
  });

  const raw = resp.content[0].text.trim();

  // Parser les métadonnées
  const excerptMatch = raw.match(/\nEXCERPT:\s*(.+)/);
  const readtimeMatch = raw.match(/\nREADTIME:\s*(\d+)/);
  const newExcerpt = excerptMatch ? excerptMatch[1].trim() : article.excerpt;
  const newReadTime = readtimeMatch ? readtimeMatch[1] + ' min' : '10 min';

  // Parser les FAQ
  const faqMatch = raw.match(/FAQ_START\n([\s\S]+?)\nFAQ_END/);
  const faqPairs = [];
  if (faqMatch) {
    const lines = faqMatch[1].trim().split('\n');
    for (let i = 0; i < lines.length - 1; i += 2) {
      const q = lines[i]?.replace(/^Q:\s*/, '').trim();
      const a = lines[i + 1]?.replace(/^A:\s*/, '').trim();
      if (q && a) faqPairs.push({ q, a });
    }
  }

  // Nettoyer le contenu
  const content = raw
    .replace(/\nEXCERPT:.+/, '')
    .replace(/\nREADTIME:.+/, '')
    .replace(/\nFAQ_START[\s\S]+?FAQ_END/, '')
    .replace(/^```(?:html)?\n?/m, '').replace(/\n?```$/m, '')
    .replace(/^<article[^>]*>\n?/, '').replace(/\n?<\/article>$/m, '')
    .trim();

  console.log(`  ✓ Contenu : ${content.split(' ').length} mots environ, ${newReadTime}`);
  console.log(`  ✓ FAQ : ${faqPairs.length} paires`);

  // Mettre à jour le head : description + injecter FAQPage schema
  let updatedHead = head
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${newExcerpt.replace(/"/g, '&quot;')}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${newExcerpt.replace(/"/g, '&quot;')}">`)
    .replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${newExcerpt.replace(/"/g, '&quot;')}">`)
    // Aussi mettre à jour la description dans le JSON-LD Article
    .replace(/"description": "[^"]*",\n  "url": "https:\/\/exe-cutio\.com\/insights/, `"description": "${newExcerpt.replace(/"/g, '\\"')}",\n  "url": "https://exe-cutio.com/insights`);

  // Injecter speakable dans l'Article JSON-LD si absent
  if (!updatedHead.includes('"speakable"')) {
    updatedHead = updatedHead.replace(
      /"mainEntityOfPage": \{"@type": "WebPage", "@id": "[^"]+"\}/,
      `"mainEntityOfPage": {"@type": "WebPage", "@id": "https://exe-cutio.com/insights/${article.slug}/"},\n  "speakable": {"@type": "SpeakableSpecification", "cssSelector": ["h1", ".art-lead"]}`
    );
  }

  // Injecter FAQPage schema juste avant </head>
  updatedHead += buildFaqSchema(faqPairs);

  // Reconstruire le HTML complet
  const dateFR = formatDateFR(article.date);
  const newHtml = `${updatedHead}
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
<div style="background:#fff;padding-top:62px"><div class="breadcrumb"><a href="/">Accueil</a><span>›</span><a href="/insights/">Insights</a><span>›</span>${article.category}</div></div>

<div class="art-hero">
  <div class="art-hero-inner">
    <div class="art-cat">${article.category}</div>
    <h1>${article.title}</h1>
    <div class="art-meta">
      <span class="art-author">Par EXECUTIO</span>
      <span class="art-date">${dateFR}</span>
      <span class="art-read">${newReadTime} de lecture</span>
    </div>
  </div>
</div>

<div class="art-wrap">
  <div class="art-body">
${figureHtml}${content}${buildFaqHtml(faqPairs)}
  </div>

  <div class="art-cta">
    <h3>Une question sur votre situation ?</h3>
    <p>Discutons lors d'un appel d'une heure — gratuit et sans engagement.</p>
    <a href="/#booking">Réserver un appel gratuit →</a>
  </div>
</div>

${relatedAndFooter}`;

  fs.writeFileSync(filePath, newHtml, 'utf-8');
  console.log(`  ✓ insights/${article.slug}/index.html mis à jour`);

  return { newExcerpt, newReadTime };
}

async function main() {
  const articles = JSON.parse(fs.readFileSync(ARTICLES_JSON, 'utf-8'));
  console.log(`\n🔄 Regénération de ${articles.length} articles...\n`);

  const updated = [];
  for (const article of articles) {
    try {
      const result = await regenerate(article, articles);
      updated.push(result ? { ...article, excerpt: result.newExcerpt, readTime: result.newReadTime } : article);
    } catch (err) {
      console.error(`  ❌ Erreur sur ${article.slug}: ${err.message}`);
      updated.push(article);
    }
    await new Promise(r => setTimeout(r, 800));
  }

  fs.writeFileSync(ARTICLES_JSON, JSON.stringify(updated, null, 2), 'utf-8');
  console.log('\n✅ Tous les articles regénérés. articles.json mis à jour.');
}

main().catch(err => {
  console.error('Erreur fatale:', err.message);
  process.exit(1);
});
