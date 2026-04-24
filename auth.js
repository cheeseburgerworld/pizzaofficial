import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON, OAUTH_CLIENT_ID, OAUTH_REDIRECT, ATPROTO_HANDLE_RESOLVER } from '../config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
export let currentUser = null;
export let currentSession = null;

let _client = null;
async function getClient() {
  if (_client) return _client;
  const { BrowserOAuthClient } = await import('https://esm.sh/@atproto/oauth-client-browser@0.3.12');
  _client = await BrowserOAuthClient.load({
    clientId: OAUTH_CLIENT_ID,
    handleResolver: ATPROTO_HANDLE_RESOLVER,
  });
  return _client;
}

export async function initAuth() {
  try {
    const client = await getClient();
    const result = await client.init();
    if (!result?.session) return null;
    currentSession = result.session;
    currentUser = await syncUser(currentSession.did);
    return { user: currentUser, session: currentSession };
  } catch (err) {
    console.warn('[auth] init failed:', err.message);
    return null;
  }
}

export async function signIn(handle) {
  const clean = handle.trim().replace(/^@/, '');
  if (!clean) throw new Error('Enter your Bluesky handle');
  sessionStorage.setItem('pzof_return', location.pathname + location.search);
  const client = await getClient();
  await client.signIn(clean, { redirect_uri: OAUTH_REDIRECT });
}

export async function signOut() {
  try {
    if (currentSession?.signOut) await currentSession.signOut();
  } catch (_) {}
  currentUser = null;
  currentSession = null;
  location.href = '/';
}

export async function handleCallback() {
  const client = await getClient();
  const result = await client.init();
  if (!result?.session) throw new Error('No session returned from Bluesky');
  currentSession = result.session;
  currentUser = await syncUser(currentSession.did);
  return { user: currentUser, session: currentSession };
}

async function syncUser(did) {
  try {
    const res = await fetch('/.netlify/functions/auth-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did }),
    });
    if (!res.ok) throw new Error(`auth-user ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('[auth] syncUser failed:', err.message);
    return { did, handle: did, role: 'guest' };
  }
}

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
  if (!['contributor', 'admin'].includes(auth.user?.role)) {
    location.href = '/contributor.html';
    return null;
  }
  return auth;
}

export async function getApprovedReviews(filters = {}) {
  let q = supabase
    .from('pizza_reviews')
    .select('id, name, location, city, rating, style, crust, char_level, sauce, cheese, notes, image_url, created_at, contributor_did, users!pizza_reviews_contributor_did_fkey(handle, display_name)')
    .eq('status', 'approved');
  if (filters.style) q = q.eq('style', filters.style);
  if (filters.rating !== undefined && filters.rating !== '') q = q.eq('rating', Number(filters.rating));
  q = q.order(filters.sort === 'rating' ? 'rating' : 'created_at', { ascending: false });
  const { data, error } = await q;
  if (error) { console.error('[auth] getApprovedReviews:', error); return []; }
  return data || [];
}

export async function getPublicStats() {
  const { data, error } = await supabase.from('public_stats').select('*').single();
  if (error) { console.error('[auth] getPublicStats:', error); return null; }
  return data;
}

export async function getMyReviews(did) {
  const { data, error } = await supabase
    .from('pizza_reviews')
    .select('id, name, location, rating, style, status, created_at')
    .eq('contributor_did', did)
    .order('created_at', { ascending: false });
  if (error) return [];
  return data || [];
}

export async function getAdminQueue() {
  const { data, error } = await supabase
    .from('admin_queue')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) return [];
  return data || [];
}
