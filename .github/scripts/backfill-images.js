import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const ARTICLES_JSON = path.join(ROOT, 'data', 'articles.json');

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
  if (!apiKey) throw new Error('PEXELS_API_KEY manquant');
  const query = PEXELS_SEARCH[category] || 'finance business';
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
}

function buildFigure(img) {
  return `<figure class="art-img">
  <img src="${img.medium}" alt="${img.alt}" loading="lazy">
  <figcaption>Photo : <a href="${img.photographerUrl}" target="_blank" rel="noopener">${img.photographer}</a> via Pexels</figcaption>
</figure>\n`;
}

async function main() {
  const articles = JSON.parse(fs.readFileSync(ARTICLES_JSON, 'utf-8'));
  let patched = 0;

  for (const article of articles) {
    const htmlPath = path.join(ROOT, 'insights', article.slug, 'index.html');
    if (!fs.existsSync(htmlPath)) {
      console.log(`⚠ Fichier introuvable : insights/${article.slug}/index.html`);
      continue;
    }

    const html = fs.readFileSync(htmlPath, 'utf-8');

    if (html.includes('class="art-img"')) {
      console.log(`✓ Déjà une image : ${article.slug}`);
      continue;
    }

    console.log(`🖼 Pexels pour "${article.title}" (${article.category})...`);
    const img = await fetchPexelsImage(article.category);
    if (!img) {
      console.warn(`  ⚠ Aucune image trouvée`);
      continue;
    }

    // Insert figure right after <div class="art-body"> (or <div class="art-body"\n>)
    const marker = '<div class="art-body">';
    if (!html.includes(marker)) {
      console.warn(`  ⚠ Marqueur art-body introuvable dans ${article.slug}`);
      continue;
    }

    // Also inject og:image if not present
    let updated = html;
    if (!html.includes('og:image')) {
      updated = updated.replace(
        '<meta property="og:type" content="article">',
        `<meta property="og:type" content="article">\n<meta property="og:image" content="${img.large}">`
      );
    }

    updated = updated.replace(
      marker + '\n',
      marker + '\n' + buildFigure(img)
    );
    // Fallback if no newline after marker
    if (updated === html) {
      updated = updated.replace(marker, marker + '\n' + buildFigure(img));
    }

    fs.writeFileSync(htmlPath, updated, 'utf-8');
    console.log(`  ✓ Image ajoutée : ${img.medium}`);
    patched++;

    // Respect Pexels rate limit (1 req/s is safe)
    await new Promise(r => setTimeout(r, 1100));
  }

  console.log(`\n✅ Backfill terminé : ${patched} articles mis à jour`);
}

main().catch(err => {
  console.error('Erreur:', err.message);
  process.exit(1);
});
