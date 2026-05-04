import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const INSIGHTS = path.join(ROOT, 'insights');

const articles = fs.readdirSync(INSIGHTS).filter(f => {
  const p = path.join(INSIGHTS, f);
  return fs.statSync(p).isDirectory();
});

for (const slug of articles) {
  const file = path.join(INSIGHTS, slug, 'index.html');
  let html = fs.readFileSync(file, 'utf8');
  let changed = false;

  // 1. Fix og:site_name
  if (html.includes('EXECUTIO — Financial Advisory')) {
    html = html.replace(/EXECUTIO — Financial Advisory/g, 'EXECUTIO — Conseil stratégique');
    changed = true;
  }

  // 2. Extract OG values for Twitter Cards
  const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] || '';
  const ogDesc = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1] || '';
  const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] || '';
  const title = (html.match(/<title>([^<]+)<\/title>/)?.[1] || '').replace(' | EXECUTIO', '');

  // 3. Add og:locale after og:site_name
  if (!html.includes('og:locale')) {
    html = html.replace(
      '<meta property="og:site_name" content="EXECUTIO — Conseil stratégique">',
      '<meta property="og:site_name" content="EXECUTIO — Conseil stratégique">\n<meta property="og:locale" content="fr_FR">'
    );
    changed = true;
  }

  // 4. Add Twitter Cards before the JSON-LD script block
  if (!html.includes('twitter:card')) {
    const twitterBlock = [
      '<meta name="twitter:card" content="summary_large_image">',
      `<meta name="twitter:title" content="${ogTitle}">`,
      `<meta name="twitter:description" content="${ogDesc}">`,
      ogImage ? `<meta name="twitter:image" content="${ogImage}">` : ''
    ].filter(Boolean).join('\n');

    html = html.replace(
      '<script type="application/ld+json">',
      twitterBlock + '\n<script type="application/ld+json">'
    );
    changed = true;
  }

  // 5. Add BreadcrumbList as a second JSON-LD block (after the first </script>)
  if (!html.includes('BreadcrumbList')) {
    const breadcrumb = `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    {"@type": "ListItem", "position": 1, "name": "Accueil", "item": "https://exe-cutio.com/"},
    {"@type": "ListItem", "position": 2, "name": "Insights", "item": "https://exe-cutio.com/insights/"},
    {"@type": "ListItem", "position": 3, "name": "${title}", "item": "https://exe-cutio.com/insights/${slug}/"}
  ]
}
</script>`;

    // Insert after the first closing </script> of the JSON-LD block
    const scriptEnd = html.indexOf('</script>');
    if (scriptEnd !== -1) {
      html = html.slice(0, scriptEnd + '</script>'.length) + '\n' + breadcrumb + html.slice(scriptEnd + '</script>'.length);
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(file, html);
    console.log(`✓ ${slug}`);
  } else {
    console.log(`- ${slug} (no changes)`);
  }
}

console.log(`\nDone. ${articles.length} articles processed.`);
