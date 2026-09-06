// ─────────────────────────────────────────────────────────────────
//  Vercel Function — POST /api/contact
//  Thin adapter over lib/lead-pipeline.mjs (shared with Cloudflare Pages
//  and Netlify). This is what currently serves exe-cutio.com.
// ─────────────────────────────────────────────────────────────────
import { processLead, validateLead } from "../lib/lead-pipeline.mjs";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // Vercel parses JSON bodies, but fall back for safety.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); }
    catch { return res.status(400).json({ error: "Invalid JSON" }); }
  }

  const invalid = validateLead(body);
  if (invalid) return res.status(400).json({ error: invalid });

  // processLead never throws: a CRM outage must not lose the lead or show the
  // visitor an error after they have already filled the form in.
  await processLead(process.env, body);

  return res.status(200).json({ success: true });
}
