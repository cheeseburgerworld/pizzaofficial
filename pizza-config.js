/* ============================================================
   PIZZA⚡OFFICIAL — shared config + data layer
   Loaded by database.html and map.html before their own scripts.
   Ported from cheeseburger.world's cbdb-config.js — same shape,
   same fail-open verification logic, pizza's schema/rating tiers.
   LIVE DATA ONLY — reads reviews from Supabase, no fallback.
   ============================================================ */

// ---- Supabase connection (publishable key is browser-safe; RLS protects writes) ----
const PZOF_SUPABASE_URL  = 'https://nchgwskvhbvsistqrdst.supabase.co';
const PZOF_SUPABASE_ANON = 'sb_publishable_7nIM5JBTjoYE3Gq4jUwUGA_Ne_yXGj7';

// ---- Rating metadata (shared across pages) ----
// `color` = chip/pin background. `text` = readable label color ON that background.
// Values match pizza-theme.css's --rate-* tokens — kept as literal hex here
// (not var() lookups) so this object works the same wherever it's used,
// same tradeoff CBDB's cbdb-config.js makes.
const RATING = {
  legendary:{glyph:'⭐⭐⭐',label:'Legendary',cls:'pin-legendary',color:'#FFD60A',text:'#15130f'},
  trip:{glyph:'⭐⭐',label:'Worth A Trip',cls:'pin-trip',color:'#FFB800',text:'#15130f'},
  solid:{glyph:'⭐',label:'Solid',cls:'pin-solid',color:'#E8843C',text:'#15130f'},
  skip:{glyph:'ㄨ',label:'Skip It',cls:'pin-skip',color:'#6B4A2F',text:'#F5F4F2'}
};

// Live reviews — empty until loadReviews() pulls from Supabase.
let reviews = [];

/* Map a Supabase row (snake_case columns) to the shape the pages expect. */
function mapRow(r){
  return {
    name: r.restaurant,
    loc: r.location,
    lat: r.lat, lng: r.lng,
    rating: r.rating,
    tier: r.price_tier,
    style: r.style,
    pizza: r.pizza,
    value: r.value_experience,
    // Admin-set per-city crown (nullable bool) — same convention as CBDB's
    // legendary_canonical: one editorial crown per city, not code-enforced.
    legendaryCanonical: r.legendary_canonical === true,
    photoUrl: r.photo_url || '',
    bskyUri: r.bsky_post_uri || r.bsky_uri || '',
    createdAt: r.created_at || '',
    did: r.author_did || (r.contributors && r.contributors.did) || '',
    by: (r.contributors && r.contributors.handle) || r.author_handle || '',
    byAvatar: (r.contributors && r.contributors.avatar) || ''
  };
}

/* Return the signed-in contributor's own reviews.
   `st` is the shared session state (window.__pzof_state). */
function myReviews(st){
  if(!st) return [];
  const did = st.did || '';
  const handle = (st.handle || '').replace(/^@/, '');
  return reviews.filter(r => {
    if(did && r.did) return r.did === did;
    return r.by && r.by.replace(/^@/, '') === handle;
  });
}

/* "Jun 2026" style short date for cards/map */
function shortDate(iso){
  if(!iso) return '';
  const d=new Date(iso);
  if(isNaN(d)) return '';
  return d.toLocaleDateString('en-US',{ month:'short', year:'numeric' });
}

/* Convert an at:// URI to a clickable bsky.app post URL. */
function bskyWebUrl(uri, handle){
  if(!uri || !uri.startsWith('at://')) return '';
  const parts = uri.split('/');
  const rkey = parts[parts.length-1];
  const who = handle || parts[2];
  return 'https://bsky.app/profile/'+who+'/post/'+rkey;
}

/* Verify each indexed review still exists on Bluesky.
   Supabase is a cache of canonical posts; if a contributor deletes a post
   (or their account), the post 404s on the AppView and we must not show it.
   FAILS OPEN: any network/AppView error keeps the rows visible. */
async function verifyLivePosts(rows){
  const checkable = rows.filter(r => r.bskyUri && r.bskyUri.startsWith('at://'));
  if(!checkable.length) return { live: rows, orphans: [] };

  const existing = new Set();
  let verificationFailed = false;
  const API = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts';
  const TIMEOUT_MS = 4000;

  const batches = [];
  for(let i=0; i<checkable.length; i+=25) batches.push(checkable.slice(i, i+25));

  await Promise.all(batches.map(async batch => {
    const qs = batch.map(r => 'uris=' + encodeURIComponent(r.bskyUri)).join('&');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try{
      const res = await fetch(API + '?' + qs, { signal: controller.signal });
      if(!res.ok){ verificationFailed = true; return; }
      const data = await res.json();
      (data.posts || []).forEach(p => { if(p && p.uri) existing.add(p.uri); });
    }catch(e){
      verificationFailed = true;
    }finally{
      clearTimeout(timer);
    }
  }));

  if(verificationFailed){
    console.warn('Pizza Official: post verification incomplete (AppView slow/unreachable). Showing all indexed rows.');
    return { live: rows, orphans: [] };
  }

  const orphans = checkable.filter(r => !existing.has(r.bskyUri));
  const orphanUris = new Set(orphans.map(r => r.bskyUri));
  const live = rows.filter(r => !(r.bskyUri && orphanUris.has(r.bskyUri)));

  if(orphans.length){
    console.warn(
      'Pizza Official: %d indexed review(s) no longer exist on Bluesky and were hidden. ' +
      'Delete these rows in Supabase when ready:',
      orphans.length
    );
    orphans.forEach(o => console.warn(
      '  • "%s" (%s) — bsky_post_uri: %s', o.name, o.loc || '', o.bskyUri
    ));
  }

  return { live, orphans };
}

/* Fetch reviews from Supabase. Returns true if any rows loaded.
   Tries to pull the contributor avatar via the join; if that column
   isn't in the schema yet (PostgREST 400), retries WITHOUT avatar. */
async function loadReviews(){
  const base = PZOF_SUPABASE_URL + '/rest/v1/reviews?';
  const withAvatar = 'select=*,contributors(handle,did,avatar)&order=created_at.desc';
  const noAvatar   = 'select=*,contributors(handle,did)&order=created_at.desc';
  const headers = { apikey: PZOF_SUPABASE_ANON, Authorization: 'Bearer ' + PZOF_SUPABASE_ANON };
  async function pull(query){
    const res = await fetch(base + query, { headers });
    if(!res.ok) return { ok:false, status:res.status, body: await res.text() };
    return { ok:true, rows: await res.json() };
  }
  try{
    let r = await pull(withAvatar);
    if(!r.ok && r.status === 400){
      console.warn('Pizza Official: avatar column not found, loading without it.');
      r = await pull(noAvatar);
    }
    if(!r.ok){
      console.error('Pizza Official: Supabase fetch failed —', r.status, r.body);
      reviews = [];
      return false;
    }
    const mapped = Array.isArray(r.rows) ? r.rows.map(mapRow) : [];
    const { live } = await verifyLivePosts(mapped);
    reviews = live;
    try { window.dispatchEvent(new CustomEvent('pzof-reviews-loaded')); } catch(e){}
    return reviews.length > 0;
  }catch(e){
    console.error('Pizza Official: Supabase fetch error —', e.message);
    reviews = [];
    return false;
  }
}

/* ============================================================
   RANK LADDER — single source of truth, used by profile.html
   and ranks.html so the ladder can't drift between the two.
   Same 5-tier thresholds as CBDB (0/1/10/25/50 reviews); middle
   names (Guest/Reviewer/Regular/Editor) match CBDB's exact words —
   shared vocabulary across Cheeseburger World LLC brands. Only the
   top title and the build-up glyphs are pizza-specific: sauce →
   cheese → slice → bolt, landing on the same ⚡ CBDB's top rank does.
   ============================================================ */
const RANKS = [
  { min:0,  name:'Guest',        badge:'🍽️', desc:'Signed in. Nothing posted yet.' },
  { min:1,  name:'Reviewer',     badge:'🍅', desc:'One review live. You\u2019ve contributed to the database.' },
  { min:10, name:'Regular',      badge:'🧀', desc:'Ten reviews. You\u2019re a regular here now.' },
  { min:25, name:'Editor',       badge:'🍕', desc:'Twenty-five reviews in. Your palate is dialed.' },
  { min:50, name:'Pizza Master', badge:'⚡', desc:'Fifty reviews. A true connoisseur — and the top of the ladder.' }
];
function rankFor(n){ let r=RANKS[0]; for(const x of RANKS) if(n>=x.min) r=x; return r; }
function nextRank(n){ for(const x of RANKS) if(n<x.min) return x; return null; }
