// ─────────────────────────────────────────────────────────────────
//  Executio — Lead Pipeline (form 3 steps)
//  Attio: person upsert + pipeline list entry + note
//  Brevo: liste prospects email
//
//  Netlify env vars:
//    ATTIO_API_KEY   — Attio > Settings > Developer > API Keys
//    ATTIO_LIST_ID   — ID de la liste "Pipeline Commerciale" dans Attio
//    BREVO_API_KEY   — Brevo > Account > API Keys
//    BREVO_LIST_ID   — (optionnel) ID liste "Prospects" dans Brevo
// ─────────────────────────────────────────────────────────────────

// Lead scoring : estime la valeur du deal selon le profil
function scoreDeal({ role, company_type, stage, budget, urgency }) {
  const budgetMap = {
    'Plus de €3.000 / mois':    5500,
    '€1.500 – €3.000 / mois':  2500,
    '€500 – €1.500 / mois':    1100,
    'Moins de €500 / mois':     500,
    'À définir':                2000
  };
  let amount = budgetMap[budget] || 2000;

  if (['Fondateur / CEO','Co-fondateur','CFO / Directeur Financier'].includes(role)) amount *= 1.4;
  if (['Série A','Série B+','Scale-up','PME en croissance'].includes(stage)) amount *= 1.2;
  if (urgency === 'Urgent (< 1 mois)') amount *= 1.3;

  const priority = amount >= 4000 ? 'HIGH' : amount >= 1500 ? 'MEDIUM' : 'LOW';
  return { amount: Math.round(amount), priority };
}

// ── Attio helpers ─────────────────────────────────────────────────

async function attio(apiKey, method, path, body) {
  const r = await fetch(`https://api.attio.com/v2${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: r.status, data: await r.json() };
}

async function upsertPerson(apiKey, fields) {
  const nameParts = (fields.firstname || '').trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName  = nameParts.slice(1).join(' ') || '';

  const { status, data } = await attio(apiKey, 'PUT',
    '/objects/people/records?matching_attribute=email_addresses',
    {
      data: {
        values: {
          name:            [{ first_name: firstName, last_name: lastName }],
          email_addresses: [{ email_address: fields.email }]
        }
      }
    }
  );

  if (status !== 200 && status !== 201) {
    console.error('[Attio] upsertPerson failed', status, JSON.stringify(data));
    return null;
  }
  return data?.data?.id?.record_id || null;
}

async function addToPipeline(apiKey, listId, personId, fields) {
  // Step 1: create the entry (minimal — always works)
  const { status, data } = await attio(apiKey, 'POST',
    `/lists/${listId}/entries`,
    { data: { record_id: { object: 'people', record_id: personId } } }
  );
  if (status !== 200 && status !== 201) {
    console.error('[Attio] addToPipeline failed', status, JSON.stringify(data));
    return;
  }

  // Step 2: patch custom fields (isolated — won't break entry creation if slugs differ)
  const entryId = data?.data?.id?.entry_id;
  if (!entryId) return;

  const { amount, priority } = scoreDeal(fields);
  const closeDate = new Date();
  closeDate.setDate(closeDate.getDate() + 45);
  const probabilityMap = { HIGH: 75, MEDIUM: 45, LOW: 20 };

  const { status: ps, data: pd } = await attio(apiKey, 'PATCH',
    `/lists/${listId}/entries/${entryId}`,
    {
      data: {
        valore_deal:            [{ currency_value: amount, currency_code: 'EUR' }],
        data_chiusura_prevista: [{ value: closeDate.toISOString().split('T')[0] }],
        probabilita:            [{ value: probabilityMap[priority] }],
        priorite:               [{ value: priority }],
        urgence:                fields.urgency  ? [{ value: fields.urgency }]      : [],
        industrie:              fields.industry ? [{ value: fields.industry }]     : [],
        role_contact:           fields.role     ? [{ value: fields.role }]         : [],
        type_structure:         fields.company_type ? [{ value: fields.company_type }] : []
      }
    }
  );
  if (ps !== 200 && ps !== 201) {
    console.error('[Attio] patchEntry failed', ps, JSON.stringify(pd));
  }
}

async function createNote(apiKey, personId, fields) {
  const { amount, priority } = scoreDeal(fields);

  const content = [
    `Rôle        : ${fields.role || '—'}`,
    `Structure   : ${fields.company_type || '—'}`,
    `Industrie   : ${fields.industry || '—'}`,
    `Stade       : ${fields.stage || '—'}`,
    `CA annuel   : ${fields.revenue || '—'}`,
    `Problème    : ${fields.problem || '—'}`,
    `Budget/mois : ${fields.budget || '—'}`,
    `Urgence     : ${fields.urgency || '—'}`,
    `Score deal  : €${amount} — Priorité ${priority}`,
    fields.message ? `\nMessage :\n${fields.message}` : ''
  ].filter(Boolean).join('\n');

  const { status, data } = await attio(apiKey, 'POST', '/notes', {
    data: {
      parent_object:    'people',
      parent_record_id: personId,
      title:            `Lead Executio — ${fields.firstname} (${fields.company_type})`,
      content,
      format:           'plaintext'
    }
  });
  if (status !== 200 && status !== 201) {
    console.error('[Attio] createNote failed', status, JSON.stringify(data));
  }
}

// ── Brevo ─────────────────────────────────────────────────────────

async function addToBrevo(apiKey, listId, fields) {
  const payload = {
    email: fields.email,
    attributes: {
      FIRSTNAME: fields.firstname,
      COMPANY:   fields.company_type,
      JOBTITLE:  fields.role,
      SOURCE:    'Site web Executio'
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

// ── Handler ───────────────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }
    };
  }
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  if (!body.firstname || !body.email || !body.company_type) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Champs requis manquants' }) };
  }

  const AT      = process.env.ATTIO_API_KEY;
  const AT_LIST = process.env.ATTIO_LIST_ID;
  const BR      = process.env.BREVO_API_KEY;
  const BR_LIST = process.env.BREVO_LIST_ID;

  if (AT) {
    try {
      const personId = await upsertPerson(AT, body);
      if (personId) {
        if (AT_LIST) await addToPipeline(AT, AT_LIST, personId, body);
        await createNote(AT, personId, body);
      }
    } catch (e) { console.error('[Attio]', e.message); }
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
