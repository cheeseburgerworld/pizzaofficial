// PIZZA⚡OFFICIAL — auth-session Netlify edge function
// GET /auth/session
// Ported from CBDB's netlify/functions/auth-session.js, with one addition:
// also returns `role` / `agreedAt` by reading the pizza `users` row, so the
// client doesn't need a separate call to know contributor/admin status.

import {
  getSession,
  updateSession,
  parseCookies,
  clearCookie,
  refreshAccessToken,
  SESSION_COOKIE,
} from '../_auth-utils.js';

const REFRESH_THRESHOLD_SECS = 90 * 60;

function env(name) {
  return typeof Deno !== 'undefined' ? Deno.env.get(name) : process.env[name];
}
const SUPABASE_URL = 'https://imhgcbirrtewxuusqcat.supabase.co';
const SUPABASE_SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY') || '';

export default async function handler(req) {
  const cookies   = parseCookies(req.headers.get('cookie'));
  const sessionId = cookies[SESSION_COOKIE];

  if (!sessionId) return json({ signedIn: false });

  const session = await getSession(sessionId);
  if (!session) {
    return json({ signedIn: false }, { 'Set-Cookie': clearCookie(SESSION_COOKIE) });
  }

  let current = session;
  const ageSecs = Math.floor((Date.now() - new Date(session.updated_at).getTime()) / 1000);

  if (ageSecs > REFRESH_THRESHOLD_SECS) {
    try {
      const fresh = await refreshAccessToken({
        refresh_token: session.refresh_token,
        privateJwk:    session.private_jwk,
        publicJwk:     session.public_jwk,
        tokenEndpoint: session.token_endpoint,
        issuer:        session.issuer,
      });
      current = { ...session, access_token: fresh.access_token, refresh_token: fresh.refresh_token };
      await updateSession(sessionId, {
        access_token:  fresh.access_token,
        refresh_token: fresh.refresh_token,
      });
    } catch (err) {
      console.warn('[auth-session] token refresh failed, session may be stale:', err.message);
    }
  }

  // Public Bluesky profile (handle, displayName, avatar)
  let profile = { handle: null, displayName: null, avatar: null };
  try {
    const profileRes = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(current.did)}`
    );
    if (profileRes.ok) {
      const p = await profileRes.json();
      profile = { handle: p.handle, displayName: p.displayName || p.handle, avatar: p.avatar || null };
    }
  } catch (err) {
    console.warn('[auth-session] profile fetch failed:', err.message);
  }

  // Pizza-specific: role + agreed_at from the users table (read-only here —
  // upsert happens once at login in auth-callback.js).
  let role = 'contributor', agreedAt = null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/users?did=eq.${encodeURIComponent(current.did)}&select=role,agreed_at`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    if (res.ok) {
      const rows = await res.json();
      if (rows[0]) { role = rows[0].role || 'contributor'; agreedAt = rows[0].agreed_at || null; }
    }
  } catch (err) {
    console.warn('[auth-session] role lookup failed:', err.message);
  }

  return json({
    signedIn:    true,
    did:         current.did,
    handle:      profile.handle,
    displayName: profile.displayName,
    avatar:      profile.avatar,
    role,
    agreedAt,
  });
}

function json(data, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

export const config = { path: '/auth/session' };
