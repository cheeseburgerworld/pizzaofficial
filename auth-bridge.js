/* ============================================================
   PIZZA⚡OFFICIAL — auth bridge (shared sign-in modal)
   Same pattern as CBDB's auth-bridge.js: one sign-in UI, reusable
   from any page via window.signIn(), instead of a duplicated inline
   handle-input form on every page. Pizza's auth.js is already a real
   ES module (CBDB's isn't), so this bridge imports signIn/signOut
   directly rather than re-implementing the /auth/start redirect.
   Loaded as: <script type="module" src="/auth-bridge.js"></script>
   ============================================================ */
import { signIn, signOut } from '/auth.js';

const BSKY_LOGO = '<svg width="15" height="13" viewBox="0 0 568 501" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;" aria-hidden="true"><path fill="#3B9AF8" d="M123.121 33.664C188.241 82.553 258.281 181.68 284 234.873c25.719-53.193 95.759-152.32 160.879-201.21C491.866-1.611 568-28.906 568 57.947c0 17.346-9.945 145.713-15.778 166.555-20.275 72.453-94.155 90.933-159.875 79.748C507.222 323.8 536.444 388.56 473.333 453.32c-119.86 122.992-172.272-30.859-185.702-70.281-2.462-7.227-3.614-10.608-3.631-7.733-.017-2.875-1.169.506-3.631 7.733-13.43 39.422-65.842 193.273-185.702 70.281-63.111-64.76-33.89-129.52 80.986-149.071-65.72 11.185-139.6-7.295-159.875-79.748C9.945 203.66 0 75.293 0 57.947 0-28.906 76.135-1.611 123.121 33.664Z"/></svg>';

// ─── Sign-in modal ────────────────────────────────────────────────────────
// Same two-section UI as CBDB's: sign in with a handle, or a link out to
// create an account. Styled with pizza-theme.css's CSS variables rather
// than CBDB's literal hex, so it stays correct if the palette ever moves.
function ensureModal() {
  if (document.getElementById('pzofSignInModal')) return;
  const wrap = document.createElement('div');
  wrap.id = 'pzofSignInModal';
  wrap.setAttribute('style', 'display:none;position:fixed;inset:0;z-index:3000;align-items:center;justify-content:center;padding:20px;background:rgba(13,8,0,0.82);');
  wrap.innerHTML =
    '<div role="dialog" aria-label="Sign in" style="width:100%;max-width:420px;background:var(--surface);border:1px solid var(--border);font-family:var(--font-body);color:var(--text);">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border);">' +
        '<span style="font-family:var(--font-display);font-size:22px;letter-spacing:0.5px;color:var(--red);line-height:1.05;">Login with your Bluesky / Atmosphere account</span>' +
        '<button id="pzofSignInX" aria-label="Close" style="background:none;border:none;color:var(--text-3);font-size:24px;line-height:1;cursor:pointer;">×</button>' +
      '</div>' +
      '<div style="padding:20px;">' +
        '<div style="padding:0;margin-bottom:18px;">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">' + BSKY_LOGO +
            '<span style="font-size:14px;font-weight:600;color:var(--text);">Sign in</span>' +
          '</div>' +
          '<input id="pzofHandleInput" type="text" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="you.bsky.social" style="width:100%;background:var(--inset);border:1px solid var(--border);color:var(--text);font-family:var(--font-body);font-size:14px;padding:11px 13px;margin-bottom:10px;box-sizing:border-box;">' +
          '<button id="pzofHandleGo" style="width:100%;background:var(--bsky);color:#fff;border:none;font-family:var(--font-body);font-weight:600;font-size:14px;padding:12px;cursor:pointer;">Sign in</button>' +
          '<div id="pzofSignInErr" style="display:none;font-size:12px;color:var(--error);margin-top:10px;"></div>' +
        '</div>' +
        '<div style="padding:18px 0 0;border-top:1px solid var(--border);">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">' + BSKY_LOGO +
            '<span style="font-size:14px;font-weight:600;color:var(--text);">Don\u2019t have an account?</span>' +
          '</div>' +
          '<div style="font-size:12px;color:var(--text-2);line-height:1.65;margin-bottom:12px;">Or have one, but don\u2019t want to post pizzas on main?</div>' +
          '<button id="pzofCreate" style="width:100%;background:none;color:var(--red);border:1px solid var(--red);font-family:var(--font-body);font-weight:600;font-size:14px;padding:12px;cursor:pointer;">Create an account →</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(wrap);

  function close() { wrap.style.display = 'none'; }
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  document.getElementById('pzofSignInX').addEventListener('click', close);

  async function go() {
    const input = document.getElementById('pzofHandleInput');
    const err = document.getElementById('pzofSignInErr');
    const btn = document.getElementById('pzofHandleGo');
    err.style.display = 'none';
    if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }
    try {
      // signIn() navigates to /auth/start on success — the server resolves
      // the handle, generates PKCE + DPoP, and redirects to Bluesky.
      await signIn(input.value);
    } catch (e) {
      err.textContent = e.message || 'Enter your Bluesky handle.';
      err.style.display = 'block';
      if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
    }
  }

  document.getElementById('pzofHandleGo').addEventListener('click', go);
  document.getElementById('pzofHandleInput').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  document.getElementById('pzofCreate').addEventListener('click', () => {
    window.open('https://bsky.app/signup', '_blank', 'noopener');
  });
}

window.pzofSignInPrompt = function () {
  ensureModal();
  const m = document.getElementById('pzofSignInModal');
  m.style.display = 'flex';
  const input = document.getElementById('pzofHandleInput');
  if (input) { input.value = ''; setTimeout(() => input.focus(), 50); }
};
// Alias so page-level markup can just call signIn(), matching CBDB's
// submit.html/profile.html buttons (onclick="signIn()").
window.signIn = window.pzofSignInPrompt;

window.pzofSignOut = function () { signOut(); };
