// ─────────────────────────────────────────────────────────────────
//  Netlify Function — POST /.netlify/functions/contact
//  Thin adapter over lib/lead-pipeline.mjs (shared with Cloudflare Pages).
//  Kept during the Cloudflare migration so the live site keeps working;
//  delete this directory once the Pages cutover is verified.
// ─────────────────────────────────────────────────────────────────
import { processLead, validateLead } from "../../lib/lead-pipeline.mjs";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const invalid = validateLead(body);
  if (invalid) return { statusCode: 400, body: JSON.stringify({ error: invalid }) };

  await processLead(process.env, body);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', ...CORS },
    body: JSON.stringify({ success: true })
  };
};
