// PIZZA⚡OFFICIAL — auth-callback Netlify edge function
// GET /oauth/callback?code=...&state=...   (Bluesky redirects here)
// Ported from CBDB's netlify/functions/auth-callback.js, with one addition:
// step 6a upserts the pizza `users` row (role, handle, avatar) at login time,
// preserving what the old client-side syncUser()->auth-user.js call did —
// see _auth-utils.js's upsertPizzaUser().

import {
  verifyPayload,
  parseCookies,
  setCookie,
  clearCookie,
  createSession,
  exchangeCode,
  upsertPizzaUser,
  PKCE_COOKIE,
  SESSION_COOKIE,
} from '../_auth-utils.js';

export default async function handler(req) {
  const url   = new URL(req.url);
  const code  = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return redirect('/?auth_error=' + encodeURIComponent(error), [clearCookie(PKCE_COOKIE)]);
  }

  if (!code || !state) {
    return redirect('/?auth_error=missing_params', [clearCookie(PKCE_COOKIE)]);
  }

  const cookies = parseCookies(req.headers.get('cookie'));
  const pkceData = verifyPayload(cookies[PKCE_COOKIE]);

  if (!pkceData) {
    console.error('[auth-callback] PKCE cookie missing or invalid');
    return redirect('/?auth_error=session_expired', [clearCookie(PKCE_COOKIE)]);
  }

  if (pkceData.state !== state) {
    console.error('[auth-callback] state mismatch — possible CSRF');
    return redirect('/?auth_error=state_mismatch', [clearCookie(PKCE_COOKIE)]);
  }

  if (pkceData.exp && Math.floor(Date.now() / 1000) > pkceData.exp) {
    return redirect('/?auth_error=session_expired', [clearCookie(PKCE_COOKIE)]);
  }

  const { verifier, privateJwk, publicJwk, tokenEndpoint, revocationEndpoint, issuer, pds, did, return: returnPath } = pkceData;

  try {
    const tokens = await exchangeCode({ code, verifier, privateJwk, publicJwk, tokenEndpoint, issuer });

    if (tokens.sub && tokens.sub !== did) {
      throw new Error('Account mismatch — token response did not match the expected account');
    }

    const finalDid = tokens.did || tokens.sub || did;

    const sessionId = await createSession({
      did:                 finalDid,
      access_token:        tokens.access_token,
      refresh_token:       tokens.refresh_token,
      private_jwk:         privateJwk,
      public_jwk:          publicJwk,
      token_endpoint:      tokenEndpoint,
      revocation_endpoint: revocationEndpoint || null,
      issuer:              issuer,
      pds_endpoint:        pds || 'https://bsky.social',
    });

    // Pizza-specific: upsert the users row (role, handle, avatar) now,
    // so every session already has a role by the time auth-session.js
    // is first called. Non-fatal if it fails — the session itself is
    // still valid; role just falls back to whatever auth-session finds.
    try { await upsertPizzaUser(finalDid); }
    catch (e) { console.warn('[auth-callback] user upsert failed (non-fatal):', e.message); }

    const sessionCookie = setCookie(SESSION_COOKIE, sessionId, {
      maxAge:   60 * 60 * 24 * 7,  // 7 days
      path:     '/',
      httpOnly: true,
      secure:   true,
      sameSite: 'Lax',
    });

    const dest = (returnPath && returnPath.startsWith('/') && returnPath !== '/oauth/callback')
      ? returnPath
      : '/database.html';

    return redirect(dest, [sessionCookie, clearCookie(PKCE_COOKIE)]);

  } catch (err) {
    console.error('[auth-callback] login failed:', err);
    const msg = encodeURIComponent(err.message || 'Sign-in failed');
    return redirect(`/?auth_error=${msg}`, [clearCookie(PKCE_COOKIE)]);
  }
}

function redirect(location, cookies = []) {
  const headers = new Headers({ 'Location': location });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

export const config = { path: '/oauth/callback' };
