const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ADMIN_DID  = process.env.ADMIN_DID;
const BSKY_API   = 'https://public.api.bsky.app';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let did;
  try { ({ did } = JSON.parse(event.body)); } catch { return { statusCode: 400, body: 'Bad JSON' }; }
  if (!did?.startsWith('did:')) return { statusCode: 400, body: 'Invalid DID' };

  // Fetch profile from Bluesky
  let profile;
  try {
    const res = await fetch(`${BSKY_API}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`);
    if (!res.ok) throw new Error(`Bluesky ${res.status}`);
    profile = await res.json();
  } catch (err) {
    return { statusCode: 502, body: 'Could not fetch Bluesky profile' };
  }

  // Check if user already exists to preserve their role
  const { data: existing } = await supabase.from('users').select('role').eq('did', did).single();

  // Determine role — never downgrade an existing contributor/admin
  let role = existing?.role || 'guest';
  if (did === ADMIN_DID) role = 'admin';

  const { data, error } = await supabase
    .from('users')
    .upsert({
      did,
      handle:       profile.handle,
      display_name: profile.displayName || profile.handle,
      avatar_url:   profile.avatar || null,
      role,
      updated_at:   new Date().toISOString(),
    }, { onConflict: 'did' })
    .select('did, handle, display_name, avatar_url, role')
    .single();

  if (error) return { statusCode: 500, body: 'Database error: ' + error.message };

  // Log first-time sign-in
  const { count } = await supabase
    .from('events_log')
    .select('*', { count: 'exact', head: true })
    .eq('user_did', did).eq('event_type', 'user_created');

  await supabase.from('events_log').insert({
    event_type: count === 0 ? 'user_created' : 'user_signed_in',
    user_did: did,
    metadata: { handle: profile.handle },
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
};
