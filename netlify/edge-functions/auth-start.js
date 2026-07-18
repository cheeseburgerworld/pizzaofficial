// PIZZA⚡OFFICIAL — auth-start Netlify edge function
// GET /auth/start?handle=you.bsky.social&return=/submit.html
// Ported from CBDB's netlify/functions/auth-start.js — identical flow,
// pizza identifiers only. See that file's header comment for the full
// step-by-step rationale (PAR, PKCE, per-session DPoP keypair).

import {
  generatePKCE,
  generateDPoPKeypair,
  discoverAuthServer,
  pushAuthorizationRequest,
  signPayload,
  setCookie,
  PKCE_COOKIE,
  CLIENT_ID,
  REDIRECT_URI,
} from '../_auth-utils.js';
import { randomBytes } from 'node:crypto';

export default async function handler(req) {
  const url    = new URL(req.url);
  const handle = (url.searchParams.get('handle') || '').trim().replace(/^@/, '');
  const returnPath = url.searchParams.get('return') || '/database.html';

  if (!handle) {
    return new Response(JSON.stringify({ error: 'handle is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const { did, pds, issuer, authorizationEndpoint, tokenEndpoint, revocationEndpoint, pushedAuthorizationEndpoint } =
      await discoverAuthServer(handle);

    const { verifier, challenge } = generatePKCE();
    const { privateJwk, publicJwk } = await generateDPoPKeypair();
    const state = randomBytes(16).toString('hex');

    const { request_uri } = await pushAuthorizationRequest({
      pushedAuthorizationEndpoint,
      issuer,
      params: {
        response_type:         'code',
        client_id:             CLIENT_ID,
        redirect_uri:          REDIRECT_URI,
        scope:                 'atproto transition:generic',
        state,
        code_challenge:        challenge,
        code_challenge_method: 'S256',
        login_hint:            handle,
      },
      privateJwk, publicJwk,
    });

    const pkcePayload = {
      verifier,
      privateJwk,
      publicJwk,
      tokenEndpoint,
      revocationEndpoint,
      issuer,
      pds,
      did,
      state,
      return: returnPath,
      exp: Math.floor(Date.now() / 1000) + 600,
    };
    const pkceCookie = setCookie(PKCE_COOKIE, signPayload(pkcePayload), {
      maxAge: 600,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    });

    const authUrl = `${authorizationEndpoint}?${new URLSearchParams({ client_id: CLIENT_ID, request_uri })}`;

    return new Response(null, {
      status: 302,
      headers: {
        'Location':   authUrl,
        'Set-Cookie': pkceCookie,
      },
    });

  } catch (err) {
    console.error('[auth-start] error:', err);
    const msg = encodeURIComponent(err.message || 'Sign-in failed');
    return new Response(null, {
      status: 302,
      headers: { 'Location': `/?auth_error=${msg}` },
    });
  }
}

export const config = { path: '/auth/start' };
