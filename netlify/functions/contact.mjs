// ─────────────────────────────────────────────────────────────────
//  Executio — Contact Form Pipeline
//  Flow: Contact form → HubSpot (contact + deal + association) + Brevo
//
//  Env vars requis dans Netlify (Site settings > Environment variables) :
//    HUBSPOT_TOKEN   — Private App token (scopes: contacts rw, deals w, associations w)
//    BREVO_API_KEY   — Brevo > Account > API Keys
//    BREVO_LIST_ID   — (optionnel) ID de ta liste "Prospects" dans Brevo
// ─────────────────────────────────────────────────────────────────

// Valeur estimée du deal selon le type de structure
const DEAL_AMOUNTS = {
  'Startup':               2500,
  'Scale-up':              5000,
  'PME':                   2000,
  'Indépendant / Freelance': 900,
  'Autre':                 2000
};

// ── HubSpot helpers ───────────────────────────────────────────────

async function hsPost(token, path, body) {
  const r = await fetch(`https://api.hubapi.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  return { status: r.status, data: await r.json() };
}

async function hsPatch(token, path, body) {
  const r = await fetch(`https://api.hubapi.com${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  return { status: r.status, data: await r.json() };
}

async function hsPut(token, path) {
  await fetch(`https://api.hubapi.com${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  });
}

// ── 1. Upsert contact ─────────────────────────────────────────────

async function upsertContact(token, { firstname, email, company_type }) {
  const props = { firstname, email, company: company_type, hs_lead_status: 'NEW' };
  const { status, data } = await hsPost(token, '/crm/v3/objects/contacts', { properties: props });

  if (status === 409) {
    // Contact déjà existant → mise à jour + récupération de l'ID
    const { data: updated } = await hsPatch(
      token,
      `/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email`,
      { properties: { firstname, company: company_type } }
    );
    return updated.id || null;
  }

  return data.id || null;
}

// ── 2. Créer deal dans la pipeline ────────────────────────────────

async function createDeal(token, { firstname, company_type, message }, contactId) {
  const amount  = DEAL_AMOUNTS[company_type] || 2000;
  const close   = new Date();
  close.setDate(close.getDate() + 30);

  const { data: deal } = await hsPost(token, '/crm/v3/objects/deals', {
    properties: {
      dealname:    `Executio — ${firstname} (${company_type})`,
      pipeline:    'default',
      // Stage par défaut = premier stage "Appointment Scheduled"
      // Si tu as une pipeline custom, remplace par l'ID de ton premier stage
      dealstage:   'appointmentscheduled',
      amount:       amount,
      closedate:    close.toISOString().split('T')[0],
      description:  message || '',
      deal_source: 'Website Form'
    }
  });

  if (!deal.id) return null;

  // ── 3. Associer contact ↔ deal ───────────────────────────────────
  if (contactId) {
    await hsPut(
      token,
      `/crm/v4/objects/contacts/${contactId}/associations/default/deals/${deal.id}`
    );
  }

  return deal.id;
}

// ── 4. Brevo ──────────────────────────────────────────────────────

async function addToBrevo(apiKey, listId, { firstname, email, company_type }) {
  const payload = {
    email,
    attributes: {
      FIRSTNAME:  firstname,
      COMPANY:    company_type,
      SOURCE:     'Site web Executio'
    },
    updateEnabled: true
  };
  if (listId) payload.listIds = [parseInt(listId, 10)];

  await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify(payload)
  });
}

// ── Handler principal ─────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' } };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { firstname, email, company_type, message } = body;
  if (!firstname || !email || !company_type) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Champs requis manquants' }) };
  }

  const HS = process.env.HUBSPOT_TOKEN;
  const BR = process.env.BREVO_API_KEY;
  const BR_LIST = process.env.BREVO_LIST_ID;

  // HubSpot : contact → deal → association (en séquence car le deal dépend de l'ID contact)
  if (HS) {
    try {
      const contactId = await upsertContact(HS, { firstname, email, company_type });
      await createDeal(HS, { firstname, company_type, message }, contactId);
    } catch (e) {
      console.error('[HubSpot]', e.message);
    }
  }

  // Brevo : indépendant du reste
  if (BR) {
    try {
      await addToBrevo(BR, BR_LIST, { firstname, email, company_type });
    } catch (e) {
      console.error('[Brevo]', e.message);
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ success: true })
  };
};
