// ─────────────────────────────────────────────────────────────────
//  Executio — Lead Pipeline (form 3 steps)
//  HubSpot: contact + deal avec lead score + Brevo: liste prospects
//
//  Netlify env vars:
//    HUBSPOT_TOKEN   — Private App (scopes: contacts rw, deals w, associations w)
//    BREVO_API_KEY   — Brevo > Account > API Keys
//    BREVO_LIST_ID   — (optionnel) ID liste "Prospects" dans Brevo
// ─────────────────────────────────────────────────────────────────

// Lead scoring : estime la valeur du deal selon le profil
function scoreDeal({ role, company_type, stage, budget, urgency }) {
  // Base par budget déclaré
  const budgetMap = {
    'Plus de €3.000 / mois':    5500,
    '€1.500 – €3.000 / mois':  2500,
    '€500 – €1.500 / mois':    1100,
    'Moins de €500 / mois':     500,
    'À définir':                2000
  };
  let amount = budgetMap[budget] || 2000;

  // Boost rôle décisionnaire
  if (['Fondateur / CEO','Co-fondateur','CFO / Directeur Financier'].includes(role)) amount *= 1.4;

  // Boost stage avancé
  if (['Série A','Série B+','Scale-up','PME en croissance'].includes(stage)) amount *= 1.2;

  // Boost urgence
  if (urgency === 'Urgent (< 1 mois)') amount *= 1.3;

  // Priorité
  const priority = amount >= 4000 ? 'HIGH' : amount >= 1500 ? 'MEDIUM' : 'LOW';

  return { amount: Math.round(amount), priority };
}

// ── HubSpot helpers ──────────────────────────────────────────────

async function hs(token, method, path, body) {
  const r = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: r.status, data: await r.json() };
}

async function upsertContact(token, fields) {
  const props = {
    firstname:      fields.firstname,
    email:          fields.email,
    jobtitle:       fields.role,
    company:        fields.company_type,
    industry:       fields.industry,
    hs_lead_status: 'NEW'
  };

  const { status, data } = await hs(token, 'POST', '/crm/v3/objects/contacts', { properties: props });

  if (status === 409) {
    const { data: updated } = await hs(
      token, 'PATCH',
      `/crm/v3/objects/contacts/${encodeURIComponent(fields.email)}?idProperty=email`,
      { properties: { firstname: fields.firstname, jobtitle: fields.role, company: fields.company_type, industry: fields.industry } }
    );
    return updated.id || null;
  }

  return data.id || null;
}

async function createDeal(token, fields, contactId) {
  const { amount, priority } = scoreDeal(fields);
  const close = new Date();
  close.setDate(close.getDate() + 45);

  const description = [
    `Stade: ${fields.stage || '—'}`,
    `CA annuel: ${fields.revenue || '—'}`,
    `Problème: ${fields.problem || '—'}`,
    `Urgence: ${fields.urgency || '—'}`,
    fields.message ? `\nMessage: ${fields.message}` : ''
  ].filter(Boolean).join('\n');

  const { data: deal } = await hs(token, 'POST', '/crm/v3/objects/deals', {
    properties: {
      dealname:    `Executio — ${fields.firstname} (${fields.company_type})`,
      pipeline:    'default',
      dealstage:   'appointmentscheduled',
      amount,
      closedate:   close.toISOString().split('T')[0],
      description,
      hs_priority: priority.toLowerCase(),
      deal_source: 'Website Form'
    }
  });

  if (deal.id && contactId) {
    await hs(token, 'PUT',
      `/crm/v4/objects/contacts/${contactId}/associations/default/deals/${deal.id}`
    );
  }

  return deal.id || null;
}

// ── Brevo ────────────────────────────────────────────────────────

async function addToBrevo(apiKey, listId, fields) {
  const payload = {
    email: fields.email,
    attributes: {
      FIRSTNAME:  fields.firstname,
      COMPANY:    fields.company_type,
      JOBTITLE:   fields.role,
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

// ── Handler ──────────────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' } };
  }
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  if (!body.firstname || !body.email || !body.company_type) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Champs requis manquants' }) };
  }

  const HS = process.env.HUBSPOT_TOKEN;
  const BR = process.env.BREVO_API_KEY;
  const BR_LIST = process.env.BREVO_LIST_ID;

  if (HS) {
    try {
      const contactId = await upsertContact(HS, body);
      await createDeal(HS, body, contactId);
    } catch (e) { console.error('[HubSpot]', e.message); }
  }

  if (BR) {
    try { await addToBrevo(BR, BR_LIST, body); }
    catch (e) { console.error('[Brevo]', e.message); }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ success: true })
  };
};
