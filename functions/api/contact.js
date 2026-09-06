// ─────────────────────────────────────────────────────────────────
//  Cloudflare Pages Function — POST /api/contact
//  Thin adapter over lib/lead-pipeline.mjs (shared with Netlify).
//  Workers has no process.env, so credentials arrive via `env`.
// ─────────────────────────────────────────────────────────────────
import { processLead, validateLead } from "../../lib/lead-pipeline.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (payload, status) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const invalid = validateLead(body);
  if (invalid) return json({ error: invalid }, 400);

  // processLead never throws: a CRM outage must not lose the lead or show the
  // visitor an error after they have already filled the form in.
  await processLead(env, body);

  return json({ success: true }, 200);
}
