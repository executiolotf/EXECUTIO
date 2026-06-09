import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const ARTICLES_JSON = path.join(ROOT, 'data', 'articles.json');

const articles = JSON.parse(fs.readFileSync(ARTICLES_JSON, 'utf-8'));

let fixed = 0;

for (const article of articles) {
  const filePath = path.join(ROOT, 'insights', article.slug, 'index.html');
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠ Not found: ${filePath}`);
    continue;
  }

  let html = fs.readFileSync(filePath, 'utf-8');
  let changed = false;

  // 1. Add favicon (after viewport meta, if not already present)
  if (!html.includes('rel="icon"')) {
    html = html.replace(
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<link rel="icon" type="image/svg+xml" href="/favicon.svg">\n<link rel="apple-touch-icon" href="/favicon.svg">'
    );
    changed = true;
    console.log(`  [favicon] ${article.slug}`);
  }

  // 2. Add article:author meta (after article:section)
  if (!html.includes('article:author')) {
    html = html.replace(
      '<meta property="article:section"',
      '<meta property="article:author" content="Moad Lotf">\n<meta property="article:section"'
    );
    changed = true;
    console.log(`  [article:author] ${article.slug}`);
  }

  // 3. Replace sync Google Fonts with async preload
  if (html.includes('<link href="https://fonts.googleapis.com') && !html.includes('rel="preload"')) {
    html = html.replace(
      /<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=([^"]+)" rel="stylesheet">/,
      (match, family) =>
        `<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="preload" href="https://fonts.googleapis.com/css2?family=${family}" as="style" onload="this.onload=null;this.rel='stylesheet'">\n<noscript><link href="https://fonts.googleapis.com/css2?family=${family}" rel="stylesheet"></noscript>`
    );
    changed = true;
    console.log(`  [async-fonts] ${article.slug}`);
  }

  // 4. Fix author: Organization → Person
  html = html.replace(
    /"author": \{"@type": "Organization", "name": "EXECUTIO", "url": "https:\/\/exe-cutio\.com"\}/,
    `"author": {\n    "@type": "Person",\n    "@id": "https://exe-cutio.com/a-propos/#founder",\n    "name": "Moad Lotf",\n    "url": "https://exe-cutio.com/a-propos/"\n  }`
  );
  if (html.includes('"@type": "Person"') && html.includes('Moad Lotf')) {
    changed = true;
    console.log(`  [author-person] ${article.slug}`);
  }

  // 5. Fix publisher logo from og-home.jpg to favicon.svg
  html = html.replace(
    /"logo": \{"@type": "ImageObject", "url": "https:\/\/exe-cutio\.com\/og-home\.jpg"\}/,
    `"logo": {"@type": "ImageObject", "url": "https://exe-cutio.com/favicon.svg", "width": 32, "height": 32}`
  );

  // 6. Fix image: string URL → ImageObject (for the Article schema image field)
  // Pattern: "image": "https://..." at the end of Article schema
  html = html.replace(
    /"image": "(https:\/\/[^"]+)"\n\}/,
    (match, url) =>
      `"image": {\n    "@type": "ImageObject",\n    "url": "${url}",\n    "width": 940,\n    "height": 650\n  }\n}`
  );
  changed = true;

  // 7. Add width/height to article img tags (already have alt, just add dimensions)
  html = html.replace(
    /<img src="([^"]+)" alt="([^"]*)" loading="lazy">/g,
    '<img src="$1" alt="$2" width="940" height="650" loading="lazy">'
  );

  fs.writeFileSync(filePath, html, 'utf-8');
  console.log(`✓ Fixed: insights/${article.slug}/index.html`);
  fixed++;
}

console.log(`\n✅ ${fixed} articles fixed.`);
