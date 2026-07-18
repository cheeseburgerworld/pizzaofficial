// PIZZA⚡OFFICIAL — shared auth utilities for Netlify edge functions
// Ported directly from cheeseburger.world's netlify/_auth-utils.js.
// Same logic, same spec compliance (PAR, DPoP, private_key_jwt client
// assertions) — only the identifiers below differ. See CBDB's version
// for the full reasoning notes on PAR / client-assertion audience.
// Deno-compatible: no Buffer, no process.env, uses Web APIs throughout.

import { createHmac, randomBytes, createHash } from 'node:crypto';
import { SignJWT, importJWK, exportJWK, generateKeyPair } from 'https://esm.sh/jose@6.0.10';

// ─── Secrets / env ──────────────────────────────────────────────────────────
// Netlify.env is the documented API for edge functions; Deno.env is a
// working fallback (confirmed via Netlify's own docs + forum reports),
// process.env last for anywhere neither exists. Previously this only
// tried Deno.env, and read every secret at module top level — meaning
// a missing var didn't just fail a request, it could throw during the
// bundler's own evaluation of the module, before a real request (or
// its runtime env) was even involved. Everything below is now lazy:
// nothing throws until the value is actually needed.
function env(name) {
  try { if (typeof Netlify !== 'undefined' && Netlify.env) {
    const v = Netlify.env.get(name);
    if (v) return v;
  } } catch {}
  try { if (typeof Deno !== 'undefined') {
    const v = Deno.env.get(name);
    if (v) return v;
  } } catch {}
  try { if (typeof process !== 'undefined' && process.env) return process.env[name]; } catch {}
  return undefined;
}

function required(name) {
  const v = env(name);
  if (!v) throw new Error(`${name} env var is not set (check Site configuration → Environment variables — scope must include "Functions")`);
  return v;
}

let _secret;
function getSecret() { return _secret ??= required('PZOF_COOKIE_SECRET'); }

const SUPABASE_URL = 'https://nchgwskvhbvsistqrdst.supabase.co';
let _serviceKey;
function getServiceKey() { return _serviceKey ??= required('SUPABASE_SERVICE_ROLE_KEY'); }

// This app's own signing key (confidential client authentication) — one
// static keypair for the whole app, distinct from the per-session DPoP
// keypair generated in generateDPoPKeypair() below. Public half is
// published in oauth/client-metadata.json's `jwks`.
let _clientJwk, _clientKid;
function getClientJwk() {
  if (_clientJwk) return _clientJwk;
  const raw = required('PZOF_CLIENT_PRIVATE_JWK');
  _clientJwk = JSON.parse(raw);
  _clientKid = _clientJwk.kid;
  if (!_clientKid) throw new Error('PZOF_CLIENT_PRIVATE_JWK is missing a "kid"');
  return _clientJwk;
}
function getClientKid() { getClientJwk(); return _clientKid; }

export const CLIENT_ID    = 'https://official.pizza/oauth/client-metadata.json';
export const REDIRECT_URI = 'https://official.pizza/oauth/callback';

// ─── Cookie names ─────────────────────────────────────────────────────────────
export const PKCE_COOKIE    = 'pzof_pkce';     // short-lived, signed, holds PKCE+DPoP state during login
export const SESSION_COOKIE = 'pzof_session';  // long-lived, holds ONLY a random session id — never tokens

// ─── Base64url helpers (no Buffer needed) ────────────────────────────────────
function toBase64url(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function fromBase64url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/')
    + '=='.slice((str.length + 3) % 4);
  return decodeURIComponent(escape(atob(padded)));
}

// ─── Signed payload helpers — used only for the short-lived PKCE cookie now ──

export function signPayload(payload) {
  const data = toBase64url(JSON.stringify(payload));
  const sig  = createHmac('sha256', getSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyPayload(value) {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot < 0) return null;
  const data = value.slice(0, dot);
  const sig  = value.slice(dot + 1);
  const expected = createHmac('sha256', getSecret()).update(data).digest('base64url');
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try { return JSON.parse(fromBase64url(data)); }
  catch { return null; }
}

// ─── Cookie helpers ───────────────────────────────────────────────────────────

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export function setCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.path)           parts.push(`Path=${opts.path}`);
  if (opts.httpOnly)       parts.push('HttpOnly');
  if (opts.secure)         parts.push('Secure');
  if (opts.sameSite)       parts.push(`SameSite=${opts.sameSite}`);
  return parts.join('; ');
}

export function clearCookie(name) {
  return setCookie(name, '', { maxAge: 0, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' });
}

// ─── Random ids ───────────────────────────────────────────────────────────────
export function randomId() {
  return randomBytes(32).toString('base64url');
}

// ─── PKCE ─────────────────────────────────────────────────────────────────────
export function generatePKCE() {
  const verifier  = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// ─── DPoP (per-session keypair, proves possession of THIS session's tokens) ──
export async function generateDPoPKeypair() {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const privateJwk = await exportJWK(privateKey);
  const publicJwk  = await exportJWK(publicKey);
  privateJwk.kty = publicJwk.kty = 'EC';
  return { privateJwk, publicJwk };
}

export async function buildDPoPProof({ privateJwk, publicJwk, method, url, nonce, accessToken }) {
  const privateKey = await importJWK(privateJwk, 'ES256');
  const payload = {
    jti: randomBytes(16).toString('hex'),
    htm: method.toUpperCase(),
    htu: url,
    iat: Math.floor(Date.now() / 1000),
  };
  if (nonce)       payload.nonce = nonce;
  if (accessToken) payload.ath = createHash('sha256').update(accessToken).digest('base64url');
  return new SignJWT(payload)
    .setProtectedHeader({
      alg: 'ES256',
      typ: 'dpop+jwt',
      jwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y },
    })
    .sign(privateKey);
}

// ─── Client assertion (app-wide static keypair, proves THIS REQUEST really
// comes from Pizza Official's backend — RFC 7523 private_key_jwt).
// aud = the auth server's issuer, not the specific endpoint being called
// (see CBDB's _auth-utils.js for the verification note on this).
export async function buildClientAssertion({ issuer }) {
  const privateKey = await importJWK(getClientJwk(), 'ES256');
  return new SignJWT({ iss: CLIENT_ID, sub: CLIENT_ID })
    .setProtectedHeader({ alg: 'ES256', kid: getClientKid() })
    .setAudience(issuer)
    .setIssuedAt()
    .setExpirationTime('60s')
    .setJti(randomBytes(16).toString('hex'))
    .sign(privateKey);
}

function withClientAssertionFields(params, assertion) {
  return {
    ...params,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion,
  };
}

// ─── ATProto discovery ────────────────────────────────────────────────────────
export async function discoverAuthServer(handle) {
  const resolveRes = await fetch(
    `https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
  );
  if (!resolveRes.ok) throw new Error(`Could not resolve handle @${handle}`);
  const { did } = await resolveRes.json();

  let pds;
  if (did.startsWith('did:plc:')) {
    const docRes = await fetch(`https://plc.directory/${did}`);
    if (!docRes.ok) throw new Error(`Could not fetch DID document for ${did}`);
    const doc = await docRes.json();
    const svc = doc.service?.find(s => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer');
    pds = svc?.serviceEndpoint;
  } else if (did.startsWith('did:web:')) {
    pds = `https://${did.slice('did:web:'.length)}`;
  }
  if (!pds) throw new Error(`Could not determine PDS for ${did}`);

  const authServerBase = (pds.includes('bsky.network') || pds.includes('bsky.social'))
    ? 'https://bsky.social'
    : pds;

  const metaRes = await fetch(`${authServerBase}/.well-known/oauth-authorization-server`);
  if (!metaRes.ok) throw new Error(`Could not fetch OAuth metadata from ${authServerBase}`);
  const meta = await metaRes.json();

  if (!meta.pushed_authorization_request_endpoint) {
    throw new Error(`Auth server ${authServerBase} does not advertise a PAR endpoint`);
  }

  return {
    did,
    pds,
    issuer: meta.issuer || authServerBase,
    tokenEndpoint:               meta.token_endpoint,
    authorizationEndpoint:       meta.authorization_endpoint,
    revocationEndpoint:          meta.revocation_endpoint,
    pushedAuthorizationEndpoint: meta.pushed_authorization_request_endpoint,
  };
}

// ─── PAR (Pushed Authorization Request) ───────────────────────────────────────
export async function pushAuthorizationRequest({ pushedAuthorizationEndpoint, issuer, params, privateJwk, publicJwk }) {
  async function attempt(nonce) {
    const dpopProof = await buildDPoPProof({
      privateJwk, publicJwk,
      method: 'POST',
      url: pushedAuthorizationEndpoint,
      nonce,
    });
    const clientAssertion = await buildClientAssertion({ issuer });
    const body = new URLSearchParams(withClientAssertionFields(params, clientAssertion));
    return fetch(pushedAuthorizationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'DPoP': dpopProof },
      body,
    });
  }

  let res = await attempt(null);
  if ((res.status === 400 || res.status === 401) && res.headers.get('DPoP-Nonce')) {
    res = await attempt(res.headers.get('DPoP-Nonce'));
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PAR request failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ─── Token exchange (authorization_code) ──────────────────────────────────────
export async function exchangeCode({ code, verifier, privateJwk, publicJwk, tokenEndpoint, issuer }) {
  async function attempt(nonce) {
    const dpopProof = await buildDPoPProof({ privateJwk, publicJwk, method: 'POST', url: tokenEndpoint, nonce });
    const clientAssertion = await buildClientAssertion({ issuer });
    const body = new URLSearchParams(withClientAssertionFields({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  REDIRECT_URI,
      client_id:     CLIENT_ID,
      code_verifier: verifier,
    }, clientAssertion));
    return fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'DPoP': dpopProof },
      body,
    });
  }

  let res = await attempt(null);
  if ((res.status === 400 || res.status === 401) && res.headers.get('DPoP-Nonce')) {
    res = await attempt(res.headers.get('DPoP-Nonce'));
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ─── Token refresh ────────────────────────────────────────────────────────────
export async function refreshAccessToken({ refresh_token, privateJwk, publicJwk, tokenEndpoint, issuer }) {
  async function attempt(nonce) {
    const dpopProof = await buildDPoPProof({ privateJwk, publicJwk, method: 'POST', url: tokenEndpoint, nonce });
    const clientAssertion = await buildClientAssertion({ issuer });
    const body = new URLSearchParams(withClientAssertionFields({
      grant_type: 'refresh_token',
      refresh_token,
      client_id:  CLIENT_ID,
    }, clientAssertion));
    return fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'DPoP': dpopProof },
      body,
    });
  }

  let res = await attempt(null);
  if ((res.status === 400 || res.status === 401) && res.headers.get('DPoP-Nonce')) {
    res = await attempt(res.headers.get('DPoP-Nonce'));
  }
  if (!res.ok) throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`);
  const tokens = await res.json();
  return { access_token: tokens.access_token, refresh_token: tokens.refresh_token || refresh_token };
}

// ─── Token revocation ──────────────────────────────────────────────────────────
export async function revokeToken({ token, tokenTypeHint, revocationEndpoint, privateJwk, publicJwk, issuer }) {
  const dpopProof = await buildDPoPProof({ privateJwk, publicJwk, method: 'POST', url: revocationEndpoint });
  const clientAssertion = await buildClientAssertion({ issuer });
  const body = new URLSearchParams(withClientAssertionFields({
    token,
    token_type_hint: tokenTypeHint,
    client_id: CLIENT_ID,
  }, clientAssertion));
  await fetch(revocationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'DPoP': dpopProof },
    body,
  });
}

// ─── Session store (Supabase) ─────────────────────────────────────────────────
// Sessions are rows in `oauth_sessions`, keyed by a random id. RLS grants
// no access to anon/authenticated roles — only the service_role key
// (used here, server-side only) can read or write it.
// See supabase-oauth-sessions.sql for the table definition.

function supabaseHeaders(extra = {}) {
  return {
    apikey: getServiceKey(),
    Authorization: `Bearer ${getServiceKey()}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export async function createSession(session) {
  const id = randomId();
  const row = {
    id,
    ...session,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/oauth_sessions`, {
    method: 'POST',
    headers: supabaseHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Failed to create session (${res.status}): ${await res.text()}`);
  return id;
}

export async function getSession(id) {
  if (!id) return null;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/oauth_sessions?id=eq.${encodeURIComponent(id)}&select=*`,
    { headers: supabaseHeaders() }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

export async function updateSession(id, patch) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/oauth_sessions?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: supabaseHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    }
  );
  if (!res.ok) console.warn('[auth] session update failed:', res.status, await res.text());
}

export async function deleteSession(id) {
  if (!id) return;
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/oauth_sessions?id=eq.${encodeURIComponent(id)}`,
      { method: 'DELETE', headers: supabaseHeaders() }
    );
  } catch {}
}

// ─── App user upsert (role / profile) ─────────────────────────────────────────
// Pizza-specific: CBDB doesn't have this because it has no role/moderation
// system. This preserves the exact behavior of the existing auth-user.js
// Lambda function, called here at login time instead of from the client,
// so a session always has a role attached without an extra client round trip.
export async function upsertPizzaUser(did) {
  let handle = did, displayName = null, avatarUrl = null;
  try {
    const res = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`
    );
    if (res.ok) {
      const p = await res.json();
      handle = p.handle || did;
      displayName = p.displayName || null;
      avatarUrl = p.avatar || null;
    }
  } catch (e) {
    console.warn('[auth] profile fetch failed for', did, e.message);
  }

  const ADMIN_DID = env('ADMIN_DID') || '';

  const existingRes = await fetch(
    `${SUPABASE_URL}/rest/v1/users?did=eq.${encodeURIComponent(did)}&select=role`,
    { headers: supabaseHeaders() }
  );
  const existingRows = existingRes.ok ? await existingRes.json() : [];
  const existing = existingRows[0] || null;

  let role = existing?.role || 'contributor';
  if (did === ADMIN_DID) role = 'admin';

  const res = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
    method: 'POST',
    headers: supabaseHeaders({ Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify({
      did, handle,
      display_name: displayName,
      avatar_url: avatarUrl,
      role,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    console.warn('[auth] user upsert failed:', res.status, await res.text());
    return { did, handle, display_name: displayName, avatar_url: avatarUrl, role };
  }
  const rows = await res.json();

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/events_log`, {
      method: 'POST',
      headers: supabaseHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({
        event_type: existing ? 'user_signed_in' : 'user_created',
        user_did: did,
        metadata: { handle },
      }),
    });
  } catch {}

  return rows[0] || { did, handle, display_name: displayName, avatar_url: avatarUrl, role };
}
