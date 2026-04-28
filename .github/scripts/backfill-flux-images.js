import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const ARTICLES_JSON = path.join(ROOT, 'data', 'articles.json');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function buildFluxPrompt(title, category) {
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 180,
    messages: [{
      role: 'user',
      content: `You are a creative director for a premium B2B financial advisory brand (Executio, CFO as a Service for startups and SMEs).

Write a FLUX image generation prompt for a blog article hero image.
Article title: "${title}"
Category: "${category}"

VISUAL DIRECTION: Editorial photography — McKinsey or HBR article imagery. BE SPECIFIC AND ORIGINAL based on the article topic. DO NOT default to the generic laptop+notebook scene. Choose a genuinely distinctive visual:
- A dramatic action: hands marking a printed P&L with a highlighter, a whiteboard being filled with arrows and numbers, a founder reviewing a printed report
- A strong setting: a glass-walled boardroom, an open-plan startup office at dusk, a city-view window, a printed financial deck spread on a conference table
- A textural close-up: a dog-eared page with a red pen, a sticky note on a screen, a hand-written metric in a leather notebook
- A human moment: silhouette at floor-to-ceiling windows, two people reviewing a projected chart, a lone founder still at work after hours

The image must feel like a magazine editorial — specific, visually interesting, not generic.

HARD RULES:
- NO full human faces — hands, arms, silhouettes only
- NO stock-photo clichés: no handshakes, no coin stacks, no generic suits, no generic MacBook-on-white-desk
- NO logos or brand names on any screen or document
- Photorealistic — NOT illustrated, NOT CGI
- Clean neutral tones: white, warm grey, natural wood, soft ambient or natural light
- Landscape 16:9 composition

Reply with ONLY the prompt — 2 sharp, specific sentences.`,
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
  const prompt = await buildFluxPrompt(title, category);
  console.log(`  Prompt: ${prompt.slice(0, 80)}...`);

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

  if (!res.ok) throw new Error(`Replicate ${res.status}: ${await res.text()}`);
  const prediction = await res.json();
  return prediction.status === 'succeeded'
    ? prediction.output
    : await pollReplicate(prediction.urls.get);
}

function updateArticleHtml(slug, newImageUrl, altText) {
  const htmlPath = path.join(ROOT, 'insights', slug, 'index.html');
  if (!fs.existsSync(htmlPath)) {
    console.warn(`  ⚠ HTML non trouvé: insights/${slug}/index.html`);
    return false;
  }

  let html = fs.readFileSync(htmlPath, 'utf-8');

  // Replace og:image meta
  html = html.replace(
    /<meta property="og:image" content="[^"]*">/,
    `<meta property="og:image" content="${newImageUrl}">`
  );

  // Replace figure/img block (Pexels or previous image)
  const figureRegex = /<figure class="art-img">[\s\S]*?<\/figure>/;
  const newFigure = `<figure class="art-img">
  <img src="${newImageUrl}" alt="${altText}" loading="lazy">
</figure>`;

  if (figureRegex.test(html)) {
    html = html.replace(figureRegex, newFigure);
  } else {
    // Insert before article content if no figure exists
    html = html.replace(
      /(<div class="art-wrap">[\s\S]*?<div class="art-body">)/,
      `$1\n${newFigure}\n`
    );
  }

  fs.writeFileSync(htmlPath, html, 'utf-8');
  return true;
}

async function main() {
  if (!process.env.REPLICATE_API_TOKEN) {
    console.error('REPLICATE_API_TOKEN manquant');
    process.exit(1);
  }

  const articles = JSON.parse(fs.readFileSync(ARTICLES_JSON, 'utf-8'));
  console.log(`\n🖼️  Backfill FLUX — ${articles.length} articles\n`);

  const updated = [];

  for (const article of articles) {
    console.log(`\n→ ${article.title}`);

    try {
      const imageUrl = await generateFluxImage(article.title, article.category);
      console.log(`  ✓ Image: ${imageUrl.slice(0, 60)}...`);

      const htmlUpdated = updateArticleHtml(article.slug, imageUrl, article.title);
      if (htmlUpdated) console.log(`  ✓ HTML mis à jour: insights/${article.slug}/`);

      updated.push({ ...article, image: imageUrl });
    } catch (err) {
      console.warn(`  ✗ Erreur: ${err.message} — image inchangée`);
      updated.push(article);
    }

    // Pause entre chaque image pour éviter rate limit
    if (articles.indexOf(article) < articles.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  fs.writeFileSync(ARTICLES_JSON, JSON.stringify(updated, null, 2), 'utf-8');
  console.log(`\n✅ data/articles.json mis à jour`);
  console.log(`✅ Backfill terminé — ${updated.filter(a => a.image && !a.image.includes('pexels')).length}/${articles.length} images FLUX`);
}

main().catch(err => {
  console.error('Erreur:', err.message);
  process.exit(1);
});
