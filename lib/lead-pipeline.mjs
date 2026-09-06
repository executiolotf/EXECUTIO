// ─────────────────────────────────────────────────────────────────
//  Executio — Lead Pipeline (shared)
//  Attio: person upsert + pipeline list entry + note
//  Brevo: liste prospects email
//
//  Runtime-agnostic on purpose: uses only fetch/JSON/Date/console, so the same
//  code runs on Netlify Functions (Node) and Cloudflare Pages Functions
//  (Workers). Credentials are passed in as `env` rather than read from
//  process.env, which does not exist on Workers.
//
//  Required env keys:
//    ATTIO_API_KEY, ATTIO_LIST_ID, BREVO_API_KEY, BREVO_LIST_ID (optional)
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
  const parts     = (fields.firstname || '').trim().split(/\s+/);
  const firstName = parts[0] || '';
  const lastName  = parts.slice(1).join(' ') || '';
  const fullName  = (fields.firstname || '').trim();

  const { status, data } = await attio(apiKey, 'PUT',
    '/objects/people/records?matching_attribute=email_addresses',
    {
      data: {
        values: {
          name:            [{ first_name: firstName, last_name: lastName, full_name: fullName }],
          email_addresses: [{ email_address: fields.email }]
        }
      }
    }
  );

  if (status !== 200 && status !== 201) {
    throw new Error(`upsertPerson ${status}: ${JSON.stringify(data)}`);
  }
  return data?.data?.id?.record_id || null;
}

async function addToPipeline(apiKey, listId, personId, fields) {
  // Attio v2 correct format: parent_record_id + parent_object + entry_values
  const { status, data } = await attio(apiKey, 'POST',
    `/lists/${listId}/entries`,
    {
      data: {
        parent_record_id: personId,
        parent_object:    'people',
        entry_values:     {}
      }
    }
  );
  console.log('[Attio] POST /lists entries status:', status, JSON.stringify(data));
  if (status !== 200 && status !== 201) {
    throw new Error(`addToPipeline ${status}: ${JSON.stringify(data)}`);
  }

  // Step 2: patch custom fields wrapped under entry_values
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
        entry_values: {
          valore_deal:            [{ currency_value: amount, currency_code: 'EUR' }],
          data_chiusura_prevista: [{ value: closeDate.toISOString().split('T')[0] }],
          probabilita:            [{ value: probabilityMap[priority] }],
          priorite:               [{ value: priority }],
          urgence:                fields.urgency      ? [{ value: fields.urgency }]      : [],
          industrie:              fields.industry     ? [{ value: fields.industry }]     : [],
          role_contact:           fields.role         ? [{ value: fields.role }]         : [],
          type_structure:         fields.company_type ? [{ value: fields.company_type }] : [],
          message:                fields.message      ? [{ value: fields.message }]      : []
        }
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

// ── Orchestrator ──────────────────────────────────────────────────

/**
 * Runs the full lead pipeline. Never throws: a CRM outage must not cost a lead
 * or surface an error to the visitor — the form has already been filled in.
 * Returns a debug object; callers decide what (if anything) to expose.
 */
export async function processLead(env, body) {
  const AT      = env.ATTIO_API_KEY;
  const AT_LIST = env.ATTIO_LIST_ID;
  const BR      = env.BREVO_API_KEY;
  const BR_LIST = env.BREVO_LIST_ID;

  const dbg = {};
  console.log('[Attio] AT key present:', !!AT, '| LIST:', AT_LIST || 'NOT SET');

  if (AT) {
    try {
      const personId = await upsertPerson(AT, body);
      dbg.personId = personId;
      console.log('[Attio] upsertPerson personId:', personId);
      if (personId) {
        if (AT_LIST) {
          try { await addToPipeline(AT, AT_LIST, personId, body); dbg.pipeline = 'ok'; console.log('[Attio] pipeline ok'); }
          catch (e) { dbg.pipelineError = e.message; console.error('[Attio] pipeline error:', e.message); }
        } else {
          console.warn('[Attio] ATTIO_LIST_ID not set — skipping pipeline');
        }
        try { await createNote(AT, personId, body); dbg.note = 'ok'; console.log('[Attio] note ok'); }
        catch (e) { dbg.noteError = e.message; console.error('[Attio] note error:', e.message); }
      }
    } catch (e) { dbg.attioError = e.message; console.error('[Attio] upsertPerson error:', e.message); }
  } else {
    console.error('[Attio] ATTIO_API_KEY not set — skipping entirely');
  }

  if (BR) {
    try { await addToBrevo(BR, BR_LIST, body); }
    catch (e) { console.error('[Brevo]', e.message); }
  }

  return dbg;
}

/** Shared request validation, so both adapters reject identically. */
export function validateLead(body) {
  if (!body || !body.firstname || !body.email || !body.company_type) {
    return 'Champs requis manquants';
  }
  return null;
}
