// auth-user.js — runs on every sign-in for ANY Bluesky user
// Uses service_role key so RLS never blocks it

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Parse body
  let did;
  try {
    const body = JSON.parse(event.body || '{}');
    did = body.did;
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  if (!did || typeof did !== 'string' || !did.startsWith('did:')) {
    return { statusCode: 400, body: 'Invalid DID' };
  }

  // Validate env vars
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
    return { statusCode: 500, body: 'Server configuration error' };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const ADMIN_DID = process.env.ADMIN_DID || '';

  // Fetch Bluesky profile
  let handle = did;
  let displayName = null;
  let avatarUrl = null;

  try {
    const res = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (res.ok) {
      const profile = await res.json();
      handle      = profile.handle      || did;
      displayName = profile.displayName || null;
      avatarUrl   = profile.avatar      || null;
    }
  } catch (e) {
    // Non-fatal — we still create/update the user with DID as handle
    console.warn('Bluesky profile fetch failed for', did, e.message);
  }

  // Check if user already exists to preserve role
  const { data: existing } = await supabase
    .from('users')
    .select('role')
    .eq('did', did)
    .maybeSingle();

  // Determine role — never downgrade
  let role = existing?.role || 'guest';
  if (did === ADMIN_DID) role = 'admin';

  // Upsert — works for first-time users AND returning users
  const { data: user, error } = await supabase
    .from('users')
    .upsert(
      {
        did,
        handle,
        display_name: displayName,
        avatar_url:   avatarUrl,
        role,
        updated_at:   new Date().toISOString(),
      },
      {
        onConflict:        'did',
        ignoreDuplicates:  false,
      }
    )
    .select('did, handle, display_name, avatar_url, role')
    .maybeSingle();

  if (error) {
    console.error('Supabase upsert error:', JSON.stringify(error));
    return { statusCode: 500, body: 'Database error: ' + error.message };
  }

  if (!user) {
    console.error('No user returned after upsert for DID:', did);
    return { statusCode: 500, body: 'User record not created' };
  }

  // Log event (non-fatal if this fails)
  try {
    const isNew = !existing;
    await supabase.from('events_log').insert({
      event_type: isNew ? 'user_created' : 'user_signed_in',
      user_did:   did,
      metadata:   { handle },
    });
  } catch (e) { /* non-fatal */ }

  return {
    statusCode: 200,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(user),
  };
};
