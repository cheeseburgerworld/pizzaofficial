// agree.js — saves agreed_at timestamp when contributor accepts code of conduct
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let did, signature_name;
  try {
    const b = JSON.parse(event.body || '{}');
    did = b.did; signature_name = b.signature_name;
  } catch { return { statusCode: 400, body: 'Bad JSON' }; }

  if (!did || !did.startsWith('did:')) return { statusCode: 400, body: 'Invalid DID' };
  if (!signature_name?.trim()) return { statusCode: 400, body: 'Signature required' };

  const now = new Date().toISOString();

  const { error } = await supabase
    .from('users')
    .update({ agreed_at: now })
    .eq('did', did);

  if (error) return { statusCode: 500, body: error.message };

  // Log it
  supabase.from('events_log').insert({
    event_type: 'contributor_agreed',
    user_did: did,
    metadata: { signature_name: signature_name.trim() },
  }).catch(() => {});

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, agreed_at: now }),
  };
};
