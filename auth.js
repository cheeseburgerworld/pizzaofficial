// PIZZA⚡OFFICIAL — auth.js
// Session persistence: user cached in sessionStorage for instant cross-page auth
// OAuth session stored by ATProto client in localStorage

const SUPABASE_URL  = 'https://imhgcbirrtewxuusqcat.supabase.co';
const SUPABASE_ANON = 'sb_publishable_oxuCF_UbJXDgem1cyUNGWQ_46LnIBhT';
const CLIENT_ID     = 'https://pizzaofficial.biz/oauth/client-metadata.json';
const REDIRECT_URI  = 'https://pizzaofficial.biz/oauth/callback';
const RESOLVER      = 'https://bsky.social';
const SESSION_KEY   = 'pzof_user';

let _db    = null;
let _oauth = null;

export let currentUser    = null;
export let currentSession = null;

// ── Lazy singletons ───────────────────────────────────────────

async function db() {
  if (_db) return _db;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2?bundle');
  _db = createClient(SUPABASE_URL, SUPABASE_ANON);
  return _db;
}

async function oauth() {
  if (_oauth) return _oauth;
  const { BrowserOAuthClient } = await import('https://esm.sh/@atproto/oauth-client-browser@0.3.37?bundle');
  _oauth = await BrowserOAuthClient.load({ clientId: CLIENT_ID, handleResolver: RESOLVER });
  return _oauth;
}

export { db as getDb };

// ── Session cache helpers ─────────────────────────────────────

function getCachedUser() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setCachedUser(user) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(user)); } catch {}
}

function clearCachedUser() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}

// ── initAuth ──────────────────────────────────────────────────
// Returns { user, session } or null.
// Uses sessionStorage cache so cross-page auth is instant.

export async function initAuth() {
  // 1. Check session cache first — instant
  const cached = getCachedUser();
  if (cached) {
    currentUser = cached;
    // Validate OAuth session in background, update cache if needed
    validateSessionBackground();
    return { user: cached, session: null };
  }

  // 2. No cache — full OAuth init
  try {
    const client = await oauth();
    const result = await client.init();
    if (!result?.session) return null;
    currentSession = result.session;
    currentUser = await syncUser(currentSession.did);
    if (currentUser) setCachedUser(currentUser);
    return { user: currentUser, session: currentSession };
  } catch (e) {
    console.warn('[auth] initAuth:', e.message);
    return null;
  }
}

// Silently revalidate the OAuth session and refresh cache
async function validateSessionBackground() {
  try {
    const client = await oauth();
    const result = await client.init();
    if (!result?.session) {
      clearCachedUser();
      currentUser = null;
      return;
    }
    currentSession = result.session;
    // Refresh user data from server
    const fresh = await syncUser(currentSession.did);
    if (fresh) {
      currentUser = fresh;
      setCachedUser(fresh);
    }
  } catch { /* silent */ }
}

// ── signIn ────────────────────────────────────────────────────

export async function signIn(handle) {
  const clean = handle.trim().replace(/^@/, '');
  if (!clean) throw new Error('Enter your Bluesky handle');
  sessionStorage.setItem('pzof_return', location.pathname + location.search);
  const client = await oauth();
  await client.signIn(clean, { redirect_uri: REDIRECT_URI });
}

// ── signOut ───────────────────────────────────────────────────

export async function signOut() {
  clearCachedUser();
  try {
    const client = await oauth();
    if (currentSession?.signOut) await currentSession.signOut();
  } catch {}
  currentUser = null;
  currentSession = null;
  location.href = '/';
}

// ── handleCallback ────────────────────────────────────────────

export async function handleCallback() {
  const client = await oauth();
  const result = await client.init();
  if (!result?.session) throw new Error('No session returned from Bluesky');
  currentSession = result.session;
  currentUser = await syncUser(currentSession.did);
  if (currentUser) setCachedUser(currentUser);
  return { user: currentUser, session: currentSession };
}

// ── syncUser ──────────────────────────────────────────────────

async function syncUser(did) {
  try {
    const res = await fetch('/.netlify/functions/auth-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did })
    });
    if (!res.ok) throw new Error('auth-user ' + res.status);
    return await res.json();
  } catch (e) {
    console.error('[auth] syncUser:', e.message);
    return { did, handle: did, role: 'guest' };
  }
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

// ── Data helpers ──────────────────────────────────────────────

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

// ── refreshUser ───────────────────────────────────────────────
// Call after role changes (e.g. after becoming contributor)
// to update the cache.

export async function refreshUser(did) {
  const fresh = await syncUser(did);
  if (fresh) {
    currentUser = fresh;
    setCachedUser(fresh);
  }
  return fresh;
}
