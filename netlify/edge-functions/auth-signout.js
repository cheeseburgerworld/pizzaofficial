// PIZZA⚡OFFICIAL — auth-signout Netlify edge function
// POST /auth/signout
// Ported verbatim from CBDB's netlify/functions/auth-signout.js.

import {
  getSession,
  deleteSession,
  parseCookies,
  clearCookie,
  revokeToken,
  SESSION_COOKIE,
} from '../_auth-utils.js';

export default async function handler(req) {
  const cookies   = parseCookies(req.headers.get('cookie'));
  const sessionId = cookies[SESSION_COOKIE];

  if (sessionId) {
    const session = await getSession(sessionId);

    if (session?.refresh_token) {
      try {
        await revokeToken({
          token:              session.refresh_token,
          tokenTypeHint:      'refresh_token',
          revocationEndpoint: session.revocation_endpoint || 'https://bsky.social/oauth/revoke',
          privateJwk:         session.private_jwk,
          publicJwk:          session.public_jwk,
          issuer:             session.issuer || 'https://bsky.social',
        });
      } catch (err) {
        console.warn('[auth-signout] revocation failed (non-fatal):', err.message);
      }
    }

    await deleteSession(sessionId);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie':   clearCookie(SESSION_COOKIE),
    },
  });
}

export const config = { path: '/auth/signout' };
