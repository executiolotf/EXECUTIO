/**
 * Fixes broken or missing images in published articles.
 * Replaces null images and expired replicate.delivery URLs with fresh Pexels images.
 * Run locally: node .github/scripts/repair-images.js
 * Requires PEXELS_API_KEY in .env or environment.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const ARTICLES_JSON = path.join(ROOT, 'data', 'articles.json');

const PEXELS_QUERIES = {
  'Stratégie dirigeant': 'business strategy boardroom executive',
  'Vision & Recul': 'leadership perspective office window',
  'Croissance & Scale': 'business growth startup office',
  'Organisation & Ops': 'team collaboration workplace professional',
};

async function getPexelsImage(category, title, excludeIds = new Set()) {
  const query = encodeURIComponent(PEXELS_QUERIES[category] || 'business professional office');
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(`https://api.pexels.com/v1/search?query=${query}&per_page=80&page=${page}&orientation=landscape&size=large`, {
      headers: { Authorization: process.env.PEXELS_API_KEY },
    });
    if (!res.ok) throw new Error(`Pexels ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!data.photos?.length) break;
    const available = data.photos.filter(p => !excludeIds.has(String(p.id)));
    if (available.length) {
      const photo = available[Math.floor(Math.random() * available.length)];
      return { url: photo.src.large, alt: photo.alt || title };
    }
  }
  throw new Error('No unused photos found after 5 pages');
}

function needsRepair(imageUrl) {
  if (!imageUrl) return true;
  if (imageUrl.includes('replicate.delivery')) return true;
  return false;
}

async function main() {
  if (!process.env.PEXELS_API_KEY) {
    console.error('❌ PEXELS_API_KEY manquante dans l\'environnement');
    process.exit(1);
  }

  const articles = JSON.parse(fs.readFileSync(ARTICLES_JSON, 'utf-8'));
  const toFix = articles.filter(a => needsRepair(a.image));

  if (!toFix.length) {
    console.log('✅ Toutes les images sont déjà OK — rien à réparer.');
    return;
  }

  console.log(`\n🔧 ${toFix.length} article(s) à réparer...\n`);

  // Track used photo IDs to avoid duplicates across repairs
  const usedIds = new Set();
  for (const a of articles) {
    if (a.image && a.image.includes('pexels.com/photos/')) {
      const m = a.image.match(/\/photos\/(\d+)\//);
      if (m) usedIds.add(m[1]);
    }
  }

  for (const article of toFix) {
    console.log(`  → ${article.slug}`);
    try {
      const { url, alt } = await getPexelsImage(article.category, article.title, usedIds);
      article.image = url;

      // Track this photo so next article in the loop doesn't reuse it
      const m = url.match(/\/photos\/(\d+)\//);
      if (m) usedIds.add(m[1]);

      // Update the article HTML
      const htmlPath = path.join(ROOT, 'insights', article.slug, 'index.html');
      if (fs.existsSync(htmlPath)) {
        // Normalize line endings to \n for reliable regex matching
        let html = fs.readFileSync(htmlPath, 'utf-8').replace(/\r\n/g, '\n');

        if (html.includes('<figure class="art-img">')) {
          html = html.replace(
            /<figure class="art-img">[\s\S]*?<\/figure>/,
            `<figure class="art-img">\n  <img src="${url}" alt="${alt}" loading="lazy">\n</figure>`
          );
        } else {
          html = html.replace(
            /(<div class="art-body">)\n/,
            `$1\n<figure class="art-img">\n  <img src="${url}" alt="${alt}" loading="lazy">\n</figure>\n`
          );
        }

        if (html.includes('og:image')) {
          html = html.replace(
            /<meta property="og:image" content="[^"]*">/,
            `<meta property="og:image" content="${url}">`
          );
        } else {
          html = html.replace(
            '<meta property="og:type" content="article">',
            `<meta property="og:type" content="article">\n<meta property="og:image" content="${url}">`
          );
        }

        fs.writeFileSync(htmlPath, html, 'utf-8');
        console.log(`    ✓ HTML mis à jour`);
      } else {
        console.log(`    ⚠ Fichier HTML introuvable : ${htmlPath}`);
      }
    } catch (e) {
      console.error(`    ❌ Erreur pour ${article.slug}: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  fs.writeFileSync(ARTICLES_JSON, JSON.stringify(articles, null, 2), 'utf-8');
  console.log(`\n✅ articles.json mis à jour`);
  console.log('\n👉 Commit et push pour déployer :');
  console.log('   git add data/articles.json insights/');
  console.log('   git commit -m "fix: repair article images (Pexels)"');
  console.log('   git push');
}

main().catch(err => {
  console.error('Erreur:', err.message);
  process.exit(1);
});
