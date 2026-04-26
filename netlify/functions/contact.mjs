export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { firstname, email, company_type, message } = data;
  if (!firstname || !email || !company_type) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Champs manquants' }) };
  }

  const HS_TOKEN  = process.env.HUBSPOT_TOKEN;
  const BR_KEY    = process.env.BREVO_API_KEY;

  const calls = [];

  // HubSpot — crée ou met à jour le contact par email
  if (HS_TOKEN) {
    calls.push(
      fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${HS_TOKEN}` },
        body: JSON.stringify({
          properties: { firstname, email, company: company_type, message: message || '' }
        })
      }).then(async r => {
        // 409 = contact existe déjà → on met à jour
        if (r.status === 409) {
          return fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${HS_TOKEN}` },
            body: JSON.stringify({
              properties: { firstname, company: company_type, message: message || '' }
            })
          });
        }
        return r;
      })
    );
  }

  // Brevo — ajoute à la liste principale, updateEnabled pour les doublons
  if (BR_KEY) {
    calls.push(
      fetch('https://api.brevo.com/v3/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': BR_KEY },
        body: JSON.stringify({
          email,
          attributes: { FIRSTNAME: firstname, COMPANY: company_type },
          updateEnabled: true
        })
      })
    );
  }

  await Promise.allSettled(calls);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ success: true })
  };
};
