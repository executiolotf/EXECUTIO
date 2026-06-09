import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const ARTICLES_JSON = path.join(ROOT, 'data', 'articles.json');

const articles = JSON.parse(fs.readFileSync(ARTICLES_JSON, 'utf-8'));

// Patch 1: Fix all article HTML files
for (const article of articles) {
  const filePath = path.join(ROOT, 'insights', article.slug, 'index.html');
  if (!fs.existsSync(filePath)) continue;

  let html = fs.readFileSync(filePath, 'utf-8');

  // Replace "Moad Lotf" with "Executio Team" everywhere
  html = html.replace(/Moad Lotf/g, 'Executio Team');

  // Fix author Person with Executio Team instead of personal name
  html = html.replace(
    /"author": \{\s*"@type": "Person",\s*"@id": "[^"]+",\s*"name": "[^"]+",\s*"url": "[^"]+"\s*\}/g,
    `"author": {\n    "@type": "Person",\n    "@id": "https://exe-cutio.com/a-propos/#team",\n    "name": "Executio Team",\n    "url": "https://exe-cutio.com/a-propos/"\n  }`
  );

  // Fix publisher: add logo if missing
  html = html.replace(
    /"publisher": \{"@type": "Organization", "name": "EXECUTIO", "url": "https:\/\/exe-cutio\.com"\},/g,
    `"publisher": {\n    "@type": "Organization",\n    "@id": "https://exe-cutio.com/#organization",\n    "name": "EXECUTIO",\n    "url": "https://exe-cutio.com",\n    "logo": {"@type": "ImageObject", "url": "https://exe-cutio.com/favicon.svg", "width": 32, "height": 32}\n  },`
  );

  // Fix publisher with og-home.jpg logo → favicon.svg
  html = html.replace(
    /"logo": \{"@type": "ImageObject", "url": "https:\/\/exe-cutio\.com\/og-home\.jpg"\}/g,
    `"logo": {"@type": "ImageObject", "url": "https://exe-cutio.com/favicon.svg", "width": 32, "height": 32}`
  );

  // Fix article:author meta
  html = html.replace(
    /content="Moad Lotf"/g,
    'content="Executio Team"'
  );

  fs.writeFileSync(filePath, html, 'utf-8');
  console.log(`✓ Pass2: insights/${article.slug}/index.html`);
}

console.log('\n✅ Pass 2 done.');
