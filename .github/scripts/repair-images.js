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

async function getPexelsImage(category, title) {
  const query = encodeURIComponent(PEXELS_QUERIES[category] || 'business professional office');
  const res = await fetch(`https://api.pexels.com/v1/search?query=${query}&per_page=10&orientation=landscape&size=large`, {
    headers: { Authorization: process.env.PEXELS_API_KEY },
  });
  if (!res.ok) throw new Error(`Pexels ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (!data.photos?.length) throw new Error('No Pexels results');
  const photo = data.photos[Math.floor(Math.random() * data.photos.length)];
  return { url: photo.src.large, alt: photo.alt || title };
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

  for (const article of toFix) {
    console.log(`  → ${article.slug}`);
    try {
      const { url, alt } = await getPexelsImage(article.category, article.title);
      article.image = url;

      // Update the article HTML
      const htmlPath = path.join(ROOT, 'insights', article.slug, 'index.html');
      if (fs.existsSync(htmlPath)) {
        let html = fs.readFileSync(htmlPath, 'utf-8');

        if (html.includes('<figure class="art-img">')) {
          // Replace existing broken figure
          html = html.replace(
            /<figure class="art-img">[\s\S]*?<\/figure>/,
            `<figure class="art-img">\n  <img src="${url}" alt="${alt}" loading="lazy">\n</figure>`
          );
        } else {
          // No figure exists — inject after opening of art-body
          html = html.replace(
            /(<div class="art-body">)\n/,
            `$1\n<figure class="art-img">\n  <img src="${url}" alt="${alt}" loading="lazy">\n</figure>\n`
          );
        }

        // Update og:image meta if present
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

    // Pexels rate limit: be gentle
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
