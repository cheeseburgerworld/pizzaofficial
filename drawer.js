/* ============================================================
   PIZZA⚡OFFICIAL — Shared Profile Drawer
   Single source of truth for the profile drawer across every page.
   Ported from CBDB's drawer.js. A page only needs:
     <script src="pizza-config.js"></script>
     <script type="module" src="/auth-bridge.js"></script>
     <script src="/drawer.js"></script>
   in that order — pizza-config.js provides RANKS/rankFor/nextRank/
   myReviews (Pizza keeps those there, not duplicated here the way
   CBDB's drawer.js does), auth-bridge.js provides window.signIn and
   window.pzofSignOut, and window.__pzof_state (from auth.js) is the
   live session.

   This module injects its own CSS + markup, then wires the behavior.
   ============================================================ */
(function(){
  'use strict';

  const PROFILE_FALLBACK_AVATAR = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#241600"/><circle cx="24" cy="19" r="9" fill="#FF3B30"/><ellipse cx="24" cy="42" rx="15" ry="11" fill="#FF3B30"/></svg>');

  // ---- Inject CSS once ----
  const CSS = `.drawer-bg { display:none; position:fixed; inset:0; background:rgba(13,8,0,0.7); z-index:90; }
  .drawer-bg.show { display:block; }
  .drawer { position:fixed; top:0; right:-420px; width:400px; max-width:90vw; height:100%; background:var(--surface); border-left:2px solid var(--border-interactive); z-index:95; transition:right .25s; overflow-y:auto; padding:24px 30px; }
  .drawer.show { right:0; }
  .drawer-head { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:22px; }
  .drawer-id { display:flex; gap:13px; align-items:center; }
  .rank-badge { width:34px; height:34px; border-radius:6px; background:var(--inset); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; font-size:18px; line-height:1; flex-shrink:0; }
  .p-avatar { width:48px; height:48px; border-radius:50%; flex-shrink:0; background:var(--raised); border:1px solid var(--border); object-fit:cover; }
  .p-name { font-family:var(--font-display); font-size:26px; letter-spacing:0.5px; color:var(--text); line-height:1; }
  .p-handle { font-size:12px; color:var(--bsky); margin-top:3px; }
  .drawer-x { background:none; border:none; color:var(--text); font-size:26px; cursor:pointer; line-height:1; }
  .p-rank-line { display:flex; align-items:center; gap:10px; background:var(--inset); border:1px solid var(--border); padding:11px 14px; margin-bottom:11px; cursor:pointer; transition:border-color .12s; }
  .p-rank-line:hover { border-color:var(--border-interactive); }
  .p-rank-emoji { font-size:20px; line-height:1; }
  .p-rank-name { font-family:var(--font-display); font-size:22px; letter-spacing:1px; color:var(--text); }
  .p-rank-tag { font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:var(--text-3); margin-left:auto; }
  .p-next { background:var(--inset); border:1px solid var(--border); border-left:3px solid var(--presence); padding:11px 13px; font-size:12px; color:var(--text); line-height:1.6; margin-bottom:11px; cursor:pointer; transition:border-color .12s; }
  .p-next:hover { border-color:var(--presence); }
  .p-next b { color:var(--presence); }
  .p-stats { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px; }
  .p-stat { background:var(--inset); border:1px solid var(--border); padding:14px 8px; text-align:center; }
  .p-num { font-family:var(--font-display); font-size:34px; line-height:1; color:var(--text); }
  .p-lab { font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:var(--text-3); margin-top:6px; }
  .p-hist-label { font-size:11px; letter-spacing:1.5px; text-transform:uppercase; color:var(--text-3); margin-bottom:11px; }
  .p-profile-cta { display:flex; align-items:center; justify-content:center; gap:8px; background:var(--red); color:var(--text-on-red); font-family:var(--font-body); font-weight:600; font-size:13px; letter-spacing:0.5px; text-decoration:none; padding:12px; margin-bottom:22px; transition:background .12s; }
  .p-profile-cta:hover { background:var(--red-hover); }
  .p-profile-cta span { font-size:15px; line-height:1; }
  .p-history { display:flex; flex-direction:column; gap:8px; }
  .ph-item { display:flex; align-items:center; gap:12px; padding:13px 14px; background:var(--inset); border:1px solid var(--raised); border-radius:9px; cursor:pointer; transition:border-color .12s, background .12s, transform .12s; }
  .ph-item:hover { border-color:var(--red); background:var(--raised); transform:translateX(2px); }
  .ph-item.leg { border-color:rgba(255,214,10,0.35); }
  .ph-item.leg:hover { border-color:var(--rate-legendary); }
  .ph-chip { font-size:16px; flex-shrink:0; width:40px; text-align:center; }
  .ph-body { flex:1; min-width:0; }
  .ph-name { font-size:14px; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ph-name.legendary { color:var(--rate-legendary); }
  .ph-loc { font-size:11px; color:var(--text-3); margin-top:2px; }
  .ph-arrow { color:var(--text-3); flex-shrink:0; font-size:13px; transition:color .12s; }
  .ph-item:hover .ph-arrow { color:var(--red); }
  .p-empty { font-size:13px; color:var(--text-3); padding:20px 0; text-align:center; line-height:1.6; }
  .p-signout { margin-top:26px; padding-top:18px; border-top:1px solid var(--raised); text-align:center; }
  .signout-link { background:none; border:1px solid var(--border); color:var(--text-3); font-family:var(--font-body); font-size:12px; letter-spacing:0.5px; padding:9px 18px; cursor:pointer; transition:border-color .12s, color .12s; }
  .signout-link:hover { border-color:var(--error); color:var(--error); }`;
  if(!document.getElementById('pzof-drawer-css')){
    const st=document.createElement('style');
    st.id='pzof-drawer-css';
    st.textContent=CSS;
    document.head.appendChild(st);
  }

  // ---- Inject markup once (if the page hasn't already got it) ----
  const MARKUP = `<div class="drawer-bg" id="drawerBg" onclick="closeProfile()"></div>
<div class="drawer" id="drawer">
  <div class="drawer-head">
    <div class="drawer-id">
      <img class="p-avatar" id="pAvatar" alt="">
      <div><div class="p-name" id="pName">—</div><div class="p-handle" id="pHandle">—</div></div>
    </div>
    <button class="drawer-x" onclick="closeProfile()">×</button>
  </div>
  <div class="p-rank-line" onclick="location.href='/ranks.html'">
    <span class="p-rank-emoji" id="pRankEmoji"></span>
    <span class="p-rank-name" id="pRank">—</span>
    <span class="p-rank-tag">Rank</span>
  </div>
  <div class="p-next" id="pNext" onclick="location.href='/ranks.html'"></div>
  <div class="p-stats">
    <div class="p-stat"><div class="p-num" id="pCount">0</div><div class="p-lab">Reviews</div></div>
    <div class="p-stat"><div class="p-num" id="pCities">0</div><div class="p-lab">Cities</div></div>
  </div>
  <a class="p-profile-cta" href="/profile.html">View full profile <span>&rarr;</span></a>
  <div class="p-signout"><button class="signout-link" onclick="pzofSignOut()">Sign out</button></div>
</div>`;
  if(!document.getElementById('drawer')){
    const wrap=document.createElement('div');
    wrap.innerHTML=MARKUP;
    while(wrap.firstChild) document.body.appendChild(wrap.firstChild);
  }

  // ---- Behavior ----
  function openProfile(){
    const state = window.__pzof_state || {};
    if(!state.signedIn){ window.signIn ? window.signIn() : (window.location.href='/submit.html'); return; }
    const mine = (typeof myReviews==="function") ? myReviews(state) : [];
    const cities = new Set(mine.map(r=>r.loc)).size;
    const rk = rankFor(mine.length);
    const av=document.getElementById('pAvatar');
    if(av){ av.src = state.avatar || PROFILE_FALLBACK_AVATAR; }
    const emo=document.getElementById('pRankEmoji');
    if(emo){ emo.textContent = rk.badge || '•'; }
    document.getElementById('pName').textContent=state.displayName||state.handle;
    document.getElementById('pHandle').textContent='@'+state.handle;
    document.getElementById('pCount').textContent=mine.length;
    document.getElementById('pRank').textContent=rk.name;
    document.getElementById('pCities').textContent=cities;
    const nx=nextRank(mine.length);
    document.getElementById('pNext').innerHTML = nx
      ? 'Next: <b>'+nx.name+'</b> at '+nx.min+' reviews. <b>'+(nx.min-mine.length)+'</b> to go.'
      : 'Top rank reached. <b>Pizza Master.</b>';
    document.getElementById('drawerBg').classList.add('show');
    document.getElementById('drawer').classList.add('show');
  }

  function closeProfile(){
    document.getElementById('drawerBg').classList.remove('show');
    document.getElementById('drawer').classList.remove('show');
  }

  // ---- Expose the handful of globals pages/markup call via inline onclick ----
  window.openProfile  = openProfile;
  window.closeProfile = closeProfile;
})();
