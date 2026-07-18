// PIZZA⚡OFFICIAL — auth.js (BFF version)
// The OAuth mechanics below are ported from cheeseburger.world's BFF
// auth.js: session lives server-side (Netlify edge functions), this file
// is a thin client — no BrowserOAuthClient, no crypto.subtle, no IndexedDB.
//
// Everything from "Data helpers" down is UNCHANGED pizza-specific code
// (getApprovedReviews, getMyReviews, getAdminQueue, etc.) — database.html,
// profile.html, stats.html, and contributor.html import these and none of
// that changes. Only how we learn who's signed in changes.

// Shared session state the rest of the site reads via window.__pzof_state
const state = (window.__pzof_state = window.__pzof_state || {
  signedIn: false, did: null, handle: null, displayName: null, avatar: null,
  role: 'guest', agreedAt: null,
});

// Back-compat: some pages/older code may still read currentUser/currentSession
// directly rather than the state object. Kept in sync below.
export let currentUser    = null;
export let currentSession = null;

function syncLegacyExports() {
  currentUser = state.signedIn
    ? { did: state.did, handle: state.handle, display_name: state.displayName, avatar_url: state.avatar, role: state.role, agreed_at: state.agreedAt }
    : null;
  currentSession = state.signedIn ? { did: state.did } : null;
}

// Paint instantly from localStorage cache before the async session fetch,
// so signed-in users never flash as signed-out on page navigation.
(function restoreCache() {
  try {
    const c = JSON.parse(localStorage.getItem('pzof_auth') || 'null');
    if (c && c.signedIn) Object.assign(state, c);
  } catch {}
})();
syncLegacyExports();
if (state.signedIn) {
  window.dispatchEvent(new CustomEvent('pzof-auth', { detail: { ...state } }));
}

let initResolve;
const initPromise = new Promise(res => { initResolve = res; });

async function checkSession() {
  try {
    const res = await fetch('/auth/session', { credentials: 'include' });
    if (!res.ok) throw new Error(`auth-session ${res.status}`);
    const data = await res.json();

    if (data.signedIn) {
      Object.assign(state, {
        signedIn: true, did: data.did, handle: data.handle,
        displayName: data.displayName, avatar: data.avatar,
        role: data.role || 'contributor', agreedAt: data.agreedAt || null,
      });
      try { localStorage.setItem('pzof_auth', JSON.stringify(state)); } catch {}
    } else {
      Object.assign(state, { signedIn: false, did: null, handle: null, displayName: null, avatar: null, role: 'guest', agreedAt: null });
      try { localStorage.removeItem('pzof_auth'); } catch {}
    }
  } catch (err) {
    console.warn('[pzof-auth] session check failed (keeping cached state):', err.message);
  }

  syncLegacyExports();
  window.dispatchEvent(new CustomEvent('pzof-auth', { detail: { ...state } }));
  initResolve();
  return state;
}

// ── initAuth ──────────────────────────────────────────────────
// Kept as the same name/shape other pages already call: returns
// { user, session } if signed in, or null. Internally now backed
// by the BFF session check above instead of BrowserOAuthClient.
export async function initAuth() {
  await checkSession();
  if (!state.signedIn) return null;
  return {
    user: { did: state.did, handle: state.handle, display_name: state.displayName, avatar_url: state.avatar, role: state.role, agreed_at: state.agreedAt },
    session: { did: state.did },
  };
}

// ── signIn ────────────────────────────────────────────────────
// Redirects to the server-side auth start — the server handles
// PKCE + DPoP + the Bluesky redirect entirely.
export async function signIn(handle) {
  const clean = (handle || '').trim().replace(/^@/, '');
  if (!clean) throw new Error('Enter your Bluesky handle');
  const params = new URLSearchParams({ handle: clean, return: location.pathname + location.search });
  window.location.href = `/auth/start?${params}`;
}

// ── signOut ───────────────────────────────────────────────────
export async function signOut() {
  try { await fetch('/auth/signout', { method: 'POST', credentials: 'include' }); } catch {}
  Object.assign(state, { signedIn: false, did: null, handle: null, displayName: null, avatar: null, role: 'guest', agreedAt: null });
  try { localStorage.removeItem('pzof_auth'); } catch {}
  syncLegacyExports();
  window.dispatchEvent(new CustomEvent('pzof-auth', { detail: { ...state } }));
  location.href = '/';
}

// ── handleCallback ────────────────────────────────────────────
// No longer does any work itself — the edge function at /oauth/callback
// already completed the exchange and redirected here with a live session
// cookie set. Kept only so oauth/callback.html (if it's ever hit — see
// note below) doesn't need a different import shape. Just re-checks session.
export async function handleCallback() {
  await checkSession();
  if (!state.signedIn) throw new Error('No session found after callback');
  return {
    user: { did: state.did, handle: state.handle, display_name: state.displayName, avatar_url: state.avatar, role: state.role },
    session: { did: state.did },
  };
}

// ── Proxy an authenticated Bluesky action through the server ──
// action: 'post' | 'uploadBlob'. Nothing calls this yet (see auth-proxy.js
// note) — kept available for when/if reviews start posting to Bluesky.
export async function proxyAction(action, payload) {
  await initPromise;
  if (!state.signedIn) throw new Error('Not signed in');
  const res = await fetch('/auth/proxy', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload }),
  });
  if (res.status === 401) {
    await signOut();
    throw new Error('Your session expired. Please sign in again.');
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Proxy request failed (${res.status})`);
  return data;
}

// ── Guards ────────────────────────────────────────────────────
export async function requireAuth() {
  const auth = await initAuth();
  if (!auth) {
    sessionStorage.setItem('pzof_return', location.pathname);
    location.href = '/';
    return null;
  }
  return auth;
}

export async function requireContributor() {
  const auth = await requireAuth();
  if (!auth) return null;
  if (auth.user?.role !== 'contributor' && auth.user?.role !== 'admin') {
    location.href = '/contributor.html';
    return null;
  }
  return auth;
}

// ── refreshUser ───────────────────────────────────────────────
// Call after role changes (e.g. after an application gets approved)
// to force a fresh session check rather than trusting the cache.
export async function refreshUser(did) {
  await checkSession();
  return state.signedIn
    ? { did: state.did, handle: state.handle, display_name: state.displayName, avatar_url: state.avatar, role: state.role, agreed_at: state.agreedAt }
    : null;
}

// Tab-wake: re-check session when user returns to the tab
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.signedIn) {
    fetch('/auth/session', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && !data.signedIn) {
          Object.assign(state, { signedIn: false, did: null, handle: null, displayName: null, avatar: null, role: 'guest', agreedAt: null });
          try { localStorage.removeItem('pzof_auth'); } catch {}
          syncLegacyExports();
          window.dispatchEvent(new CustomEvent('pzof-auth', { detail: { ...state } }));
        }
      })
      .catch(() => {});
  }
});

// Auto-init on load
checkSession().catch(e => console.error('[pzof-auth] init failed:', e));

// ════════════════════════════════════════════════════════════════
// Data helpers — UNCHANGED from the previous auth.js. Nothing below
// this line has anything to do with authentication.
// ════════════════════════════════════════════════════════════════

const SUPABASE_URL  = 'https://nchgwskvhbvsistqrdst.supabase.co';
const SUPABASE_ANON = 'sb_publishable_7nIM5JBTjoYE3Gq4jUwUGA_Ne_yXGj7';

let _db = null;
async function db() {
  if (_db) return _db;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2?bundle');
  _db = createClient(SUPABASE_URL, SUPABASE_ANON);
  return _db;
}
export { db as getDb };

export async function getApprovedReviews(filters) {
  filters = filters || {};
  const d = await db();
  let q = d
    .from('pizza_reviews')
    .select('id,name,location,city,rating,style,experience,notes,image_url,created_at,contributor_did,users!pizza_reviews_contributor_did_fkey(handle,display_name)')
    .eq('status', 'approved');
  if (filters.style) q = q.eq('style', filters.style);
  if (filters.experience) q = q.eq('experience', filters.experience);
  if (filters.rating !== undefined && filters.rating !== '') q = q.eq('rating', Number(filters.rating));
  q = q.order(filters.sort === 'rating' ? 'rating' : 'created_at', { ascending: false });
  const { data, error } = await q;
  if (error) { console.error(error); return []; }
  return data || [];
}

export async function getPublicStats() {
  const d = await db();
  const { data, error } = await d.from('public_stats').select('*').single();
  if (error) { console.error(error); return null; }
  return data;
}

export async function getMyReviews(did) {
  const d = await db();
  const { data, error } = await d
    .from('pizza_reviews')
    .select('id,name,location,rating,style,status,created_at')
    .eq('contributor_did', did)
    .order('created_at', { ascending: false });
  if (error) return [];
  return data || [];
}

export async function getAdminQueue() {
  const d = await db();
  const { data, error } = await d
    .from('admin_queue')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) return [];
  return data || [];
}
