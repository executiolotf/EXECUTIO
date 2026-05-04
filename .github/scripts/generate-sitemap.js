import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const BASE = 'https://exe-cutio.com';

const articles = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'articles.json'), 'utf8'));

const staticPages = [
  { url: '/', priority: '1.0', changefreq: 'weekly' },
  { url: '/insights/', priority: '0.9', changefreq: 'daily' },
];

const articleEntries = articles.map(a => ({
  url: `/insights/${a.slug}/`,
  lastmod: a.date,
  priority: '0.8',
  changefreq: 'monthly'
}));

const allPages = [...staticPages, ...articleEntries];

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allPages.map(p => `  <url>
    <loc>${BASE}${p.url}</loc>${p.lastmod ? `\n    <lastmod>${p.lastmod}</lastmod>` : ''}
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml);
console.log(`sitemap.xml generated — ${allPages.length} URLs`);
