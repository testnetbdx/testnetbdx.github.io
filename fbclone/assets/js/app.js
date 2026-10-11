/* ============================================================
   FaceClone — main app (Supabase + realtime)
   ============================================================ */
const S = {
  view: 'home', profileId: null, query: '',
  dark: (() => { try { return localStorage.getItem('fbclone_dark') === '1'; } catch (e) { return false; } })(),
  openMenu: null, composerBg: '', followingCache: [],
  _csort: {}, _cshow: {}, _cexp: {},
};

const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2400);
}
function closeModal() { const m = $('#modal'); if (m) m.remove(); }

/* ---------------- Facebook-style reactions ---------------- */
const RX = {
  like:  { e: '\u{1F44D}', label: 'Like',  c: '#1877F2' },
  love:  { e: '\u2764\uFE0F', label: 'Love',  c: '#F33E58' },
  haha:  { e: '\u{1F602}', label: 'Haha',  c: '#F7B125' },
  wow:   { e: '\u{1F62E}', label: 'Wow',   c: '#F7B125' },
  sad:   { e: '\u{1F622}', label: 'Sad',   c: '#F7B125' },
  angry: { e: '\u{1F621}', label: 'Angry', c: '#E9710F' },
  care:  { e: '\u{1F970}', label: 'Care',  c: '#F7B125' },
};
function fmtCount(n) {
  n = n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return '' + n;
}
/* Non-blocking confirm dialog (native confirm() hangs some browsers) */
function confirmDialog(msg, okLabel) {
  return new Promise((resolve) => {
    closeModal();
    const m = document.createElement('div');
    m.id = 'modal';
    m.innerHTML = `<div class="modal-back"></div><div class="modal-box" style="text-align:center">
      <h3 style="margin-bottom:8px">${esc(msg)}</h3>
      <div class="modal-actions" style="justify-content:center">
        <button class="btn-ghost" id="cf_no">Cancel</button>
        <button class="btn-danger" id="cf_yes">${esc(okLabel || 'Delete')}</button>
      </div></div>`;
    document.body.appendChild(m);
    m.querySelector('.modal-back').onclick = () => { m.remove(); resolve(false); };
    m.querySelector('#cf_no').onclick = () => { m.remove(); resolve(false); };
    m.querySelector('#cf_yes').onclick = () => { m.remove(); resolve(true); };
  });
}
function openModal(html) {
  closeModal();
  const m = document.createElement('div');
  m.id = 'modal';
  m.innerHTML = `<div class="modal-back" onclick="closeModal()"></div><div class="modal-box">${html}</div>`;
  document.body.appendChild(m);
}
function err(e) {
  console.error(e);
  toast(e.message || 'Something went wrong.');
}

/* ---------------- Boot ---------------- */
async function boot() {
  if (!supabaseConfigured()) { renderSetup(); return; }
  try {
    await bootSession();
  } catch (e) { console.error(e); }
  sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') renderAuth('reset');
  });
  let st;
  try {
    st = await getSettings();
  } catch (e) {
    if (e.code === '42P01' || /relation[^]*does not exist/i.test(e.message || '')) { renderSchemaMissing(); return; }
    st = { site_name: 'FaceClone' };
  }
  S.settings = st;
  document.title = st.site_name || 'FaceClone';
  if (st.maintenance && !(ME && ME.is_admin)) { renderMaintenance(); return; }
  if (ME) {
    if (ME.banned) { await signOut(); renderAuth(); toast('This account has been banned.'); return; }
    S.followingCache = await followingIds().catch(() => []);
    renderApp();
  } else {
    renderAuth();
  }
}

function renderSetup() {
  document.getElementById('root').innerHTML = `
  <div class="maint"><div class="brand-big">FaceClone</div>
    <h2>⚙️ Setup needed</h2>
    <p class="muted" style="max-width:520px;line-height:1.7">
      This site needs a Supabase backend.<br><br>
      1. Create a free project at <b>supabase.com</b><br>
      2. Run <b>supabase/schema.sql</b> in the SQL Editor<br>
      3. Paste your Project URL + anon key into <b>assets/js/config.js</b> and redeploy.
    </p></div>`;
}

function renderSchemaMissing() {
  document.getElementById('root').innerHTML = `
  <div class="maint"><div class="brand-big">FaceClone</div>
    <h2>🗄️ Database not ready</h2>
    <p class="muted" style="max-width:520px;line-height:1.7">
      Supabase connect hoyeche, kintu tables toiri hoyni.<br><br>
      Supabase dashboard → <b>SQL Editor</b> → <b>supabase/schema.sql</b>-er puro content paste kore <b>Run</b> chap dao, tarpor page reload dao.
    </p></div>`;
}

/* ---------------- Auth ---------------- */
function authCardHTML(mode, regOpen) {
  if (mode === 'login') return `
        <input id="li_email" class="inp" type="email" placeholder="Email address" autocomplete="username">
        <input id="li_pass" class="inp" type="password" placeholder="Password" onkeydown="if(event.key==='Enter')doLogin()" autocomplete="current-password">
        <button class="btn-primary" id="li_btn" onclick="doLogin()">Log in</button>
        <div class="auth-link"><a href="#" onclick="event.preventDefault();renderAuth('forgot')">Forgot password?</a></div>
        <hr class="auth-hr">
        ${regOpen ? `<button class="btn-green" onclick="renderAuth('signup')">Create new account</button>`
                  : `<div class="muted" style="text-align:center">Registrations are currently closed.</div>`}`;
  if (mode === 'verify') return `
        <div class="su-title">\u2709\uFE0F Check your email</div>
        <div class="su-sub">We sent a verification link to<br><b>${esc(S.pendingEmail || '')}</b>.<br>Click the link to activate your account.</div>
        <div class="muted" style="text-align:center;font-size:13px">Didn't get it? Check spam, or:</div>
        <button class="btn-ghost" id="rs_btn" onclick="doResend()">Resend verification email</button>
        <div class="auth-link"><a href="#" onclick="event.preventDefault();renderAuth('login')">Back to log in</a></div>`;
  if (mode === 'forgot') return `
        <div class="su-title">Find your account</div>
        <div class="su-sub">Enter your Gmail address to get a password reset link.</div>
        <input id="fp_email" class="inp" type="email" placeholder="Gmail address" onkeydown="if(event.key==='Enter')doForgot()">
        <button class="btn-primary" id="fp_btn" onclick="doForgot()">Send reset link</button>
        <div class="auth-link"><a href="#" onclick="event.preventDefault();renderAuth('login')">Back to log in</a></div>`;
  if (mode === 'forgot-sent') return `
        <div class="su-title">\u2709\uFE0F Reset link sent</div>
        <div class="su-sub">We sent a password reset link to<br><b>${esc(S.pendingEmail || '')}</b>.<br>Click the link in the email, then set a new password.</div>
        <div class="auth-link"><a href="#" onclick="event.preventDefault();renderAuth('login')">Back to log in</a></div>`;
  if (mode === 'reset') return `
        <div class="su-title">Set new password</div>
        <div class="su-sub">Enter a new password for your account.</div>
        <input id="np_pass" class="inp" type="password" placeholder="New password (min 6 chars)" onkeydown="if(event.key==='Enter')doResetPassword()">
        <button class="btn-primary" id="np_btn" onclick="doResetPassword()">Set new password</button>`;
  return `
        <div class="su-title">Sign Up</div>
        <div class="su-sub">It's quick and easy.</div>
        <input id="su_name" class="inp" placeholder="Full name">
        <input id="su_email" class="inp" type="email" placeholder="Gmail address">
        <div class="muted" style="font-size:12px;margin-top:-8px">Only @gmail.com addresses allowed.</div>
        <input id="su_pass" class="inp" type="password" placeholder="New password" onkeydown="if(event.key==='Enter')doSignup()">
        <button class="btn-green" id="su_btn" onclick="doSignup()">Sign Up</button>
        <div class="auth-link"><a href="#" onclick="event.preventDefault();renderAuth('login')">Already have an account?</a></div>`;
}
function renderAuth(mode) {
  mode = mode || 'login';
  const st = S.settings || { site_name: 'FaceClone', tagline: '' };
  document.body.classList.remove('app-body');
  const regOpen = st.reg_open !== false;
  $('#root').innerHTML = `
  <div class="auth-wrap">
    <div class="auth-left">
      <div class="brand-big">${esc(st.site_name)}</div>
      <p class="tagline">${esc(st.tagline || '')}</p>
      <div class="demo-box">
        <div class="demo-title">Real accounts, realtime</div>
        <div class="demo-note">Sign up with your email — posts, likes, comments and notifications sync live across every device via Supabase.</div>
      </div>
    </div>
    <div class="auth-card">
      ${authCardHTML(mode, regOpen)}
    </div>
  <div class="auth-foot"><a href="admin.html">Admin Panel</a> · FaceClone — powered by Supabase</div>`;
}
async function doLogin() {
  const btn = $('#li_btn'); btn.disabled = true; btn.textContent = 'Logging in...';
  try {
    await signIn($('#li_email').value.trim(), $('#li_pass').value);
    S.followingCache = await followingIds().catch(() => []);
    renderApp(); toast('Welcome back, ' + ME.name.split(' ')[0] + '!');
  } catch (e) { err(e); btn.disabled = false; btn.textContent = 'Log in'; }
}
async function doSignup() {
  const name = $('#su_name').value.trim(), email = $('#su_email').value.trim(), pass = $('#su_pass').value;
  if (!name || !email || pass.length < 6) { toast('Fill all fields (password min 6 chars).'); return; }
  if (!/@gmail\.com$/i.test(email)) { toast('Only @gmail.com addresses can sign up.'); return; }
  const btn = $('#su_btn'); btn.disabled = true; btn.textContent = 'Creating...';
  try {
    const res = await signUp(name, email, pass);
    if (res && res.needsVerification) {
      S.pendingEmail = email;
      renderAuth('verify');
      toast('Verification email sent!');
    } else {
      S.followingCache = [];
      renderApp(); toast('Account created. Welcome, ' + name.split(' ')[0] + '!');
    }
  } catch (e) { err(e); btn.disabled = false; btn.textContent = 'Sign Up'; }
}
async function doResend() {
  const btn = $('#rs_btn'); if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
  try { await resendVerification(S.pendingEmail); toast('Verification email resent!'); }
  catch (e) { err(e); }
  if (btn) { btn.disabled = false; btn.textContent = 'Resend verification email'; }
}
async function doForgot() {
  const email = $('#fp_email').value.trim();
  if (!/@gmail\.com$/i.test(email)) { toast('Enter your @gmail.com address.'); return; }
  const btn = $('#fp_btn'); btn.disabled = true; btn.textContent = 'Sending...';
  try {
    await sendPasswordReset(email);
    S.pendingEmail = email;
    renderAuth('forgot-sent');
    toast('Reset link sent!');
  } catch (e) { err(e); btn.disabled = false; btn.textContent = 'Send reset link'; }
}
async function doResetPassword() {
  const pass = $('#np_pass').value;
  if (!pass || pass.length < 6) { toast('Password must be at least 6 characters.'); return; }
  const btn = $('#np_btn'); btn.disabled = true; btn.textContent = 'Saving...';
  try {
    await updatePassword(pass);
    S.followingCache = await followingIds().catch(() => []);
    renderApp(); toast('Password updated! Welcome back.');
  } catch (e) { err(e); btn.disabled = false; btn.textContent = 'Set new password'; }
}
async function logout() {
  teardownRealtime();
  await signOut();
  S.view = 'home'; S.profileId = null;
  renderAuth();
}

/* ---------------- App shell ---------------- */
let rtChannels = [];
function teardownRealtime() {
  rtChannels.forEach(ch => { try { sb.removeChannel(ch); } catch (e) {} });
  rtChannels = [];
  (S.chats || []).forEach(ch => { try { ch.channel && sb.removeChannel(ch.channel); } catch (e) {} });
  S.chats = [];
  const dock = document.getElementById('chatDock');
  if (dock) dock.remove();
}

function renderApp() {
  teardownRealtime();
  document.body.classList.add('app-body');
  document.body.classList.toggle('dark', S.dark);
  const st = S.settings || { site_name: 'FaceClone' };
  document.title = st.site_name;
  $('#root').innerHTML = `
  <header class="topbar">
    <div class="tb-left">
      <div class="logo" onclick="goHome()">${esc((st.site_name || 'F')[0])}</div>
      <div class="search-box">
        ${icon('search', 16)}
        <input id="q" placeholder="Search ${esc(st.site_name)}" value="${esc(S.query)}"
          onkeydown="if(event.key==='Enter')doSearch(this.value)">
      </div>
    </div>
    <nav class="tb-center">
      <button class="tb-tab ${S.view === 'home' ? 'active' : ''}" onclick="goHome()" title="Home">${icon('home', 26)}</button>
      <button class="tb-tab ${S.view === 'watch' ? 'active' : ''}" onclick="goWatch()" title="Watch">${icon('video', 26)}</button>
      <button class="tb-tab ${S.view === 'marketplace' ? 'active' : ''}" onclick="goMarketplace()" title="Marketplace">${icon('store', 26)}</button>
      <button class="tb-tab ${S.view === 'friends' ? 'active' : ''}" onclick="showFriends()" title="Friends">${icon('users', 26)}</button>
    </nav>
    <div class="tb-right">
      <span class="live-dot" title="Realtime connected"></span>
      <button class="tb-ico" onclick="toggleInbox(event)" title="Messenger">${icon('chat', 20)}<span class="badge" id="msgBadge" style="display:none">0</span></button>
      <button class="tb-ico" onclick="toggleNotif(event)" title="Notifications">${icon('bell', 20)}<span class="badge" id="notifBadge" style="display:none">0</span></button>
      <button class="tb-avatar" onclick="toggleMenu(event,'profile')">${pav(ME, 36)}</button>
    </div>
  </header>
  <div id="dropdown"></div>
  <div id="chatDock"></div>
  <div class="layout">
    <aside class="side left">${leftNavHTML()}</aside>
    <main class="feed" id="feed"><div class="card empty">Loading feed...</div></main>
    <aside class="side right" id="rightBar"><div class="card empty">Loading...</div></aside>
  </div>
  <div class="foot-link"><a href="admin.html">Admin Panel</a></div>`;
  if (!window._fcClickBound) { document.addEventListener('click', closeDropdowns); window._fcClickBound = true; }
  renderView();
  setupRealtime();
  refreshNotifBadge();
  refreshMsgBadge();
  cleanupMyStories().then(() => { if (S.view === 'home') refreshStories(); }).catch(() => {});
}
function closeDropdowns(e) {
  if (!e.target.closest('#dropdown') && !e.target.closest('.tb-ico') && !e.target.closest('.tb-avatar') && !e.target.closest('.post-menu-btn'))
    $('#dropdown').innerHTML = '';
}
function goHome() { S.view = 'home'; S.profileId = null; S.query = ''; S.composerGroup = null; renderApp(); }
function goWatch() { S.view = 'watch'; renderApp(); }
function goMarketplace() { S.view = 'marketplace'; renderApp(); }
function goEvents() { S.view = 'events'; renderApp(); }
function goGroups() { S.view = 'groups'; renderApp(); }
function goSaved() { S.view = 'saved'; renderApp(); }
function goMemories() { S.view = 'memories'; renderApp(); }
function goFeeds() { S.view = 'feeds'; renderApp(); }
function doSearch(v) { S.query = v.trim(); if (S.query) { S.view = 'search'; renderApp(); } }
function showFriends() { S.view = 'friends'; renderApp(); }
function openGroup(id) { S.view = 'group'; S.groupId = id; S.groupTab = 'discussion'; renderApp(); window.scrollTo(0, 0); }
function openProfile(id) { S.view = 'profile'; S.profileId = id; PROFILE_TAB = 'posts'; renderApp(); window.scrollTo(0, 0); }

async function renderView() {
  closeRxPicker();
  const f = $('#feed');
  try {
    if (S.view === 'profile') f.innerHTML = await profileHTML(S.profileId);
    else if (S.view === 'friends') f.innerHTML = await friendsHTML();
    else if (S.view === 'search') f.innerHTML = await searchHTML();
    else if (S.view === 'watch') f.innerHTML = await watchHTML();
    else if (S.view === 'marketplace') f.innerHTML = await marketplaceHTML();
    else if (S.view === 'events') f.innerHTML = await eventsHTML();
    else if (S.view === 'groups') f.innerHTML = await groupsHTML();
    else if (S.view === 'group') f.innerHTML = await groupHTML();
    else if (S.view === 'saved') f.innerHTML = await savedHTML();
    else if (S.view === 'memories') f.innerHTML = await memoriesHTML();
    else if (S.view === 'feeds') { f.innerHTML = feedsHTML(); loadFeedsChrono(); }
    else f.innerHTML = homeSkeleton();
    if (S.view === 'home') loadHomeFeed();
    loadRightBar();
  } catch (e) { err(e); }
}
async function loadFeedsChrono() {
  try {
    const posts = await getFeedChrono();
    cachePosts(posts);
    const el = $('#posts');
    if (el) el.innerHTML = postsHTML(posts.filter(p => !p.author.banned));
  } catch (e) { err(e); }
}
function homeSkeleton() {
  return composerHTML() + `<div id="posts"><div class="card empty">Loading posts...</div></div>`;
}
async function loadHomeFeed() {
  try {
    const posts = await getFeed();
    cachePosts(posts);
    const el = $('#posts');
    if (el) el.innerHTML = postsHTML(posts.filter(p => !p.author.banned));
    const st = $('#storiesRow');
    if (st) {
      const html = await storiesHTML();
      st.innerHTML = myStoryCardHTML() + html;
    }
  } catch (e) { err(e); }
}
function refreshFeedSoon() {
  if (S._rt) clearTimeout(S._rt);
  S._rt = setTimeout(() => { renderView(); }, 700);
}

/* ---------------- Realtime ---------------- */
function setupRealtime() {
  // Full re-render only for OTHER users' changes; own actions already update the UI locally.
  let rtPending = false;
  const doReload = debounce(() => {
    if (!rtPending) return;
    rtPending = false;
    if (S.view === 'home' || S.view === 'profile') refreshFeedSoon();
  }, 400);
  const reload = (payload) => {
    const row = (payload && (payload.new || payload.old)) || {};
    const isMine = (row.author_id && row.author_id === ME.id) || (row.user_id && row.user_id === ME.id);
    if (!isMine) rtPending = true;
    doReload();
  };
  rtChannels.push(onTable('posts', reload));
  rtChannels.push(onTable('comments', reload));
  rtChannels.push(onTable('reactions', reload));
  rtChannels.push(onTable('comment_reactions', reload));
  rtChannels.push(onTable('stories', debounce(() => { if (S.view === 'home') refreshStories(); }, 600)));
  rtChannels.push(onTable('profiles', debounce(() => loadRightBar(), 800)));
  rtChannels.push(sb.channel('rt-msg-badge')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
      if (payload.new.sender_id !== ME.id) refreshMsgBadge();
    }).subscribe());
  rtChannels.push(onTable('notifications', async (payload) => {
    if (payload.eventType === 'INSERT' && payload.new.user_id === ME.id) {
      refreshNotifBadge();
      const dd = $('.notif-menu');
      if (dd) toggleNotif._dirty = true;
      toast('🔔 ' + (payload.new.message || 'New notification'));
    }
  }, `user_id=eq.${ME.id}`));
}
async function refreshNotifBadge() {
  const n = await unreadNotifCount().catch(() => 0);
  const b = $('#notifBadge');
  if (b) { b.textContent = Math.min(n, 9); b.style.display = n ? 'flex' : 'none'; }
}

/* ---------------- Sidebars ---------------- */
function leftNavHTML() {
  const items = [
    ['me', ME.name, 'profile', () => `openProfile('${ME.id}')`],
    ['users', 'Friends', 'friends', 'showFriends()'],
    ['clock', 'Memories', 'memories', 'goMemories()'],
    ['bookmark', 'Saved', 'saved', 'goSaved()'],
    ['users', 'Groups', 'groups', 'goGroups()'],
    ['video', 'Watch', 'watch', 'goWatch()'],
    ['store', 'Marketplace', 'marketplace', 'goMarketplace()'],
    ['news', 'Feeds', 'feeds', 'goFeeds()'],
    ['calendar', 'Events', 'events', 'goEvents()'],
  ];
  return items.map(([ic, label, view, act]) => `
    <button class="nav-item ${S.view === view ? 'active' : ''}" onclick="${typeof act === 'function' ? act() : act}">
      ${ic === 'me' ? pav(ME, 32) : `<span class="nav-ico">${icon(ic, 26)}</span>`}
      <span>${esc(label)}</span>
    </button>`).join('');
}
async function loadRightBar() {
  try {
    const others = await getUsersList();
    const el = $('#rightBar');
    if (!el) return;
    el.innerHTML = `
      <div class="side-sec"><div class="side-title">Contacts · ${others.length}</div>
        ${others.slice(0, 14).map(u => `
          <button class="contact" onclick="openChat('${u.id}')">
            <span class="contact-av">${pav(u, 32)}<span class="dot"></span></span>
            <span>${esc(u.name)}</span>
          </button>`).join('') || '<div class="muted">No other users yet.</div>'}
      </div>`;
  } catch (e) { /* ignore */ }
}

/* ---------------- Stories / composer ---------------- */
const STORY_GRADS = ['sg1', 'sg2', 'sg3', 'sg4'];
async function storiesHTML() {
  let stories = [];
  try { stories = await getStories(); } catch (e) { console.error(e); }
  S._stories = stories;
  const byAuthor = {};
  stories.forEach(s => { if (!byAuthor[s.author_id]) byAuthor[s.author_id] = s; });
  const mine = byAuthor[ME.id];
  const others = Object.values(byAuthor).filter(s => s.author_id !== ME.id).slice(0, 10);
  return others.map((s, i) => {
    const a = s.author;
    return `<div ${s.image_url ? 'class="story"' : `class="story ${s.bg || STORY_GRADS[i % 4]}"`} ${s.image_url ? `style="background-image:url('${esc(s.image_url)}');background-size:cover;background-position:center"` : ''} onclick="openStoryViewer('${s.author_id}')">
      <div class="story-av">${pav(a, 36)}</div>
      ${!s.image_url && s.text ? `<div class="story-text-prev">${esc(s.text.slice(0, 60))}</div>` : ''}
      <div class="story-label">${esc((a.name || '?').split(' ')[0])}</div>
    </div>`;
  }).join('');
}
function myStoryCardHTML() {
  const mine = (S._stories || []).find(s => s.author_id === ME.id);
  return `<div class="story create" onclick="${mine ? `openStoryViewer('${ME.id}')` : 'openStoryComposer()'}">
    <div class="story-top">${mine && mine.image_url
      ? `<img src="${esc(mine.image_url)}" style="width:100%;height:100%;object-fit:cover">`
      : pav(ME, 64)}</div>
    <div class="story-plus" onclick="event.stopPropagation();openStoryComposer()">+</div>
    <div class="story-label">${mine ? 'Your story' : 'Create story'}</div>
  </div>`;
}
async function refreshStories() {
  const row = $('#storiesRow');
  if (!row || S.view !== 'home') return;
  try {
    const stories = await getStories();
    S._stories = stories;
    row.innerHTML = myStoryCardHTML() + await storiesHTML();
  } catch (e) { /* ignore */ }
}

/* ---- story composer ---- */
function openStoryComposer() {
  S.storyBg = '';
  openModal(`<h3>Create story</h3>
    <p class="muted" style="text-align:center;margin:-8px 0 10px">Visible for 24 hours</p>
    <textarea id="st_text" class="cp-text" placeholder="Say something..." rows="2" maxlength="200"></textarea>
    <div class="swatches" id="st_sw">${BG_SWATCHES.map(b => `<button class="sw ${b} ${b === '' ? 'sw-none sel' : ''}" onclick="pickStoryBg('${b}',this)"></button>`).join('')}</div>
    <label class="lbl">Photo (optional)</label>
    <input id="st_file" type="file" accept="image/*" class="inp">
    <div class="modal-actions"><button class="btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn-primary" id="st_btn" onclick="submitStory()">Share story</button></div>`);
}
function pickStoryBg(b, el) {
  S.storyBg = b;
  $$('#st_sw .sw').forEach(x => x.classList.remove('sel'));
  el.classList.add('sel');
}
async function submitStory() {
  const text = $('#st_text').value.trim();
  const file = $('#st_file').files[0];
  if (!text && !file) { toast('Add a photo or text first.'); return; }
  const btn = $('#st_btn'); btn.disabled = true; btn.textContent = 'Sharing...';
  try {
    let image_url = null;
    if (file) { btn.textContent = 'Uploading...'; image_url = await uploadToMedia(file, 'story'); }
    await createStory({ image_url, text, bg: S.storyBg || null });
    closeModal(); refreshStories(); toast('Story shared! 📸');
  } catch (e) { err(e); btn.disabled = false; btn.textContent = 'Share story'; }
}

/* ---- story viewer ---- */
let STORY_VIEW = null;
async function openStoryViewer(authorId) {
  let stories = S._stories || [];
  if (!stories.length) { try { stories = await getStories(); S._stories = stories; } catch (e) {} }
  const list = stories.filter(s => s.author_id === authorId);
  if (!list.length) { toast('Story expired.'); refreshStories(); return; }
  STORY_VIEW = { list, idx: 0, timer: null };
  renderStoryViewer();
}
function renderStoryViewer() {
  closeStoryViewer(true);
  const s = STORY_VIEW.list[STORY_VIEW.idx];
  const a = s.author || { name: '?' };
  const mine = s.author_id === ME.id;
  const v = document.createElement('div');
  v.id = 'storyViewer';
  v.innerHTML = `
    <div class="sv-card">
      <div class="sv-progress">${STORY_VIEW.list.map((_, i) =>
        `<div class="sv-bar"><div class="sv-fill ${i < STORY_VIEW.idx ? 'done' : ''} ${i === STORY_VIEW.idx ? 'now' : ''}"></div></div>`).join('')}</div>
      <div class="sv-head">${pav(a, 36)}<div class="sv-who"><b>${esc(a.name)}</b><div class="muted">${timeAgo(s.created_at)}</div></div>
        ${mine ? `<button class="sv-del" onclick="deleteCurrentStory()" title="Delete story">🗑️</button>` : ''}
        <button class="sv-close" onclick="closeStoryViewer()">✕</button></div>
      <div class="sv-body ${s.image_url ? '' : (s.bg || 'sg1')}">
        ${s.image_url ? `<img src="${esc(s.image_url)}">` : `<div class="sv-text">${esc(s.text)}</div>`}
      </div>
      <div class="sv-tap sv-left" onclick="storyNav(-1)"></div>
      <div class="sv-tap sv-right" onclick="storyNav(1)"></div>
    </div>`;
  document.body.appendChild(v);
  clearTimeout(STORY_VIEW.timer);
  STORY_VIEW.timer = setTimeout(() => storyNav(1), 5000);
}
function storyNav(d) {
  if (!STORY_VIEW) return;
  const n = STORY_VIEW.idx + d;
  if (n < 0) { renderStoryViewer(); return; }
  if (n >= STORY_VIEW.list.length) { closeStoryViewer(); return; }
  STORY_VIEW.idx = n;
  renderStoryViewer();
}
function closeStoryViewer(keep) {
  const v = $('#storyViewer');
  if (v) v.remove();
  if (STORY_VIEW) clearTimeout(STORY_VIEW.timer);
  if (!keep) STORY_VIEW = null;
}
async function deleteCurrentStory() {
  if (!STORY_VIEW) return;
  const s = STORY_VIEW.list[STORY_VIEW.idx];
  if (!await confirmDialog('Delete this story?')) return;
  try { await deleteStory(s.id); closeStoryViewer(); refreshStories(); toast('Story deleted.'); }
  catch (e) { err(e); }
}
function composerHTML() {
  return `<div id="storiesRow" class="stories">
      <div class="story create" onclick="openStoryComposer()">
        <div class="story-top">${pav(ME, 64)}</div>
        <div class="story-plus">+</div><div class="story-label">Create story</div>
      </div>
    </div>
  <div class="composer card">
    <div class="composer-top" onclick="openComposer()">
      ${pav(ME, 40)}
      <div class="composer-fake">What's on your mind, ${esc(ME.name.split(' ')[0])}?</div>
    </div>
    <hr>
    <div class="composer-actions">
      <button onclick="openVideoUpload()">${icon('videocam', 20)}<span>Reel</span></button>
      <button onclick="openComposer()">${icon('image', 20)}<span>Photo</span></button>
      <button onclick="openFeelingPicker()">${icon('smile', 20)}<span>Feeling</span></button>
    </div>
  </div>`;
}

/* ---------------- Posts ---------------- */
function postsHTML(list) {
  if (!list.length) return `<div class="card empty">No posts yet. Be the first to share something!</div>`;
  return list.map(postHTML).join('');
}
function postHTML(p) {
  const a = p.author || { name: '?' };
  return `<article class="post card" id="post_${p.id}">
    <div class="post-head">
      <span onclick="openProfile('${a.id || ''}')" class="clickable">${pav(a, 40)}</span>
      <div class="post-meta">
        <div class="post-name" onclick="openProfile('${a.id || ''}')">${esc(a.name)}${p.feeling ? ` <span class="feeling">— is feeling ${esc(p.feeling)}</span>` : ''}
          ${p.pinned ? ' <span class="pin-tag">Pinned</span>' : ''}</div>
        <div class="post-time">${timeAgo(p.created_at)} · ${icon('globe', 12)}</div>
      </div>
      <button class="post-menu-btn" onclick="toggleMenu(event,'post_${p.id}')">${icon('dots', 20)}</button>
    </div>
    ${p.text ? (p.bg
      ? `<div class="post-bgtext ${p.bg}">${esc(p.text)}</div>`
      : `<div class="post-text">${esc(p.text)}</div>`) : ''}
    ${p.image_url ? `<img class="post-img" loading="lazy" src="${esc(p.image_url)}" onerror="this.style.display='none'">` : ''}
    ${p.video_url ? `<video class="post-video" controls preload="metadata" playsinline src="${esc(p.video_url)}"></video>` : ''}
    ${p.shared ? `<div class="shared-box">${sharedHTML(p.shared)}</div>` : ''}
    <div class="post-counts">${rxCountsHTML(p)}</div>
    <hr>
    <div class="post-actions">
      ${rxBtnHTML(p)}
      <button onclick="focusComment('${p.id}')">${icon('comment', 20)}<span>Comment</span></button>
      <button onclick="sharePostUI('${p.id}')">${icon('share', 20)}<span>Share</span></button>
    </div>
    <hr>
    <div class="comments" id="comments_${p.id}">${commentsSectionHTML(p)}</div>
    <div class="add-comment">
      ${pav(ME, 32)}
      <input id="cin_${p.id}" placeholder="Write a comment..." onkeydown="if(event.key==='Enter')addCommentUI('${p.id}')" oninput="cInputUI('${p.id}')">
      <button class="c-emoji-btn" id="cemoji_${p.id}" onclick="openEmojiPicker('cin_${p.id}', this)" title="Emoji">\u{1F60A}</button>
      <button class="c-send-btn" id="csend_${p.id}" hidden onclick="addCommentUI('${p.id}')" title="Send">\u27A4</button>
    </div>
  </article>`;
}
function sharedHTML(s) {
  const a = s.author || { name: '?' };
  return `<div class="post" style="box-shadow:none">
    <div class="post-head"><span class="clickable" onclick="openProfile('${a.id || ''}')">${pav(a, 36)}</span>
      <div class="post-meta"><div class="post-name" onclick="openProfile('${a.id || ''}')">${esc(a.name)}</div>
      <div class="post-time">${timeAgo(s.created_at)}</div></div></div>
    ${s.text ? `<div class="post-text">${esc(s.text)}</div>` : ''}
    ${s.image_url ? `<img class="post-img" loading="lazy" src="${esc(s.image_url)}" onerror="this.style.display='none'">` : ''}
  </div>`;
}
/* ---------------- comments: threads, replies, sort, translate ---------------- */
function commentThreads(comments) {
  const map = {}, tops = [];
  (comments || []).forEach(c => { c.replies = []; map[c.id] = c; });
  (comments || []).forEach(c => {
    if (c.parent_id && map[c.parent_id]) {
      let anc = map[c.parent_id];
      while (anc.parent_id && map[anc.parent_id]) anc = map[anc.parent_id];
      if (anc.id !== c.id) anc.replies.push(c); else tops.push(c);
    } else tops.push(c);
  });
  return tops;
}
function sortComments(tops, mode) {
  const arr = [...tops];
  if (mode === 'new') arr.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  else if (mode === 'old') arr.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  else arr.sort((a, b) => ((b.reactionTotal || 0) * 2 + (b.replies || []).length * 3) - ((a.reactionTotal || 0) * 2 + (a.replies || []).length * 3));
  return arr;
}
function commentsSectionHTML(p) {
  const tops = commentThreads(p.comments);
  const total = (p.comments || []).length;
  const sort = S._csort[p.id] || 'top';
  let h = '';
  if (tops.length > 1) {
    h += `<div class="c-sortrow"><select class="c-sort" onchange="setCsort('${p.id}',this.value)" aria-label="Sort comments">
      <option value="top"${sort === 'top' ? ' selected' : ''}>Most relevant</option>
      <option value="new"${sort === 'new' ? ' selected' : ''}>Newest</option>
      <option value="old"${sort === 'old' ? ' selected' : ''}>Oldest</option>
    </select></div>`;
  }
  const sorted = sortComments(tops, sort);
  const showAll = S._cshow[p.id];
  const list = showAll ? sorted : sorted.slice(0, 3);
  h += list.map(c => commentHTML(c, p.id, false)).join('');
  if (!showAll && sorted.length > 3)
    h += `<button class="more-c" onclick="showAllComments('${p.id}')">View all ${total} comments</button>`;
  return h;
}
function cRxBtnHTML(c) {
  const r = c.myReaction ? RX[c.myReaction] : null;
  return `<button data-rxbtn class="c-like${r ? ' on' : ''}"
    onpointerdown="rxDown(event,'c','${c.id}')" onpointerup="rxUp()" onpointerleave="rxUp()" onpointercancel="rxUp()"
    onclick="rxTap(event,'c','${c.id}')"
    style="${r ? `color:${r.c};font-weight:700` : ''}">${r ? r.label : 'Like'}</button>`;
}
function cRxBadgeHTML(c) {
  if (!c.reactionTotal) return '';
  const t = c.reactionCounts || {};
  const top = Object.keys(t).filter(k => t[k] > 0).sort((a, b) => t[b] - t[a]).slice(0, 3);
  return `<span class="c-badge"><span class="rx-top">${top.map(k => `<span>${RX[k].e}</span>`).join('')}</span>${c.reactionTotal > 1 ? `<i>${fmtCount(c.reactionTotal)}</i>` : ''}</span>`;
}
function commentHTML(c, pid, isReply) {
  const rc = (c.replies || []).length;
  const expKey = pid + '_' + c.id;
  const expanded = !!S._cexp[expKey];
  return `<div class="comment${isReply ? ' reply' : ''}" data-ccard="${c.id}">
    ${pav(c.author, isReply ? 28 : 32)}
    <div class="c-main">
      <div class="comment-body">
        <b>${esc(c.author.name)}</b>
        <div class="c-text">${esc(c.text)}</div>
        ${hasBangla(c.text) ? `<button class="c-tr" onclick="translateUI('${c.id}', this)">See translation</button><div class="c-tr-out" id="tro_${c.id}" hidden></div>` : ''}
      </div>
      <div class="c-actions">
        ${cRxBtnHTML(c)}
        ${isReply ? '' : `<button onclick="replyBoxUI('${pid}','${c.id}')">Reply</button>`}
        <span class="muted">${timeAgo(c.created_at)}</span>
      </div>
      ${!isReply && rc ? (expanded
        ? `<div class="replies">${c.replies.map(rp => commentHTML(rp, pid, true)).join('')}</div>`
        : `<button class="more-c" onclick="toggleReplies('${pid}','${c.id}')">View ${rc} repl${rc > 1 ? 'ies' : 'y'}</button>`) : ''}
      <div class="rbox" id="rbox_${c.id}" hidden></div>
    </div>
    <div class="c-badge-wrap">${cRxBadgeHTML(c)}</div>
  </div>`;
}
function refreshComments(pid) {
  const p = POST_CACHE[pid]; if (!p) return;
  const box = $('#comments_' + pid);
  if (box) box.innerHTML = commentsSectionHTML(p);
  paintRx('p', pid);
}
function showAllComments(pid) { S._cshow[pid] = true; refreshComments(pid); }
function toggleReplies(pid, cid) {
  const k = pid + '_' + cid;
  S._cexp[k] = !S._cexp[k];
  refreshComments(pid);
}
function setCsort(pid, v) { S._csort[pid] = v; S._cshow[pid] = false; refreshComments(pid); }
function replyBoxUI(pid, cid) {
  const box = $('#rbox_' + cid); if (!box) return;
  if (!box.hidden) { box.hidden = true; box.innerHTML = ''; return; }
  const c = findComment(cid);
  const nm = esc(((c && c.author && c.author.name) || 'them').split(' ')[0]);
  box.innerHTML = `<div class="add-comment reply-box">
      ${pav(ME, 28)}
      <input id="rin_${cid}" placeholder="Reply to ${nm}..." onkeydown="if(event.key==='Enter')addReplyUI('${pid}','${cid}')" oninput="rInputUI('${cid}')">
      <button class="c-emoji-btn" id="remo_${cid}" onclick="openEmojiPicker('rin_${cid}', this)" title="Emoji">\u{1F60A}</button>
      <button class="c-send-btn" id="rsend_${cid}" hidden onclick="addReplyUI('${pid}','${cid}')" title="Send">\u27A4</button>
    </div>`;
  box.hidden = false;
  setTimeout(() => { const i = $('#rin_' + cid); if (i) i.focus(); }, 60);
}
async function addReplyUI(pid, cid) {
  const inp = $('#rin_' + cid); if (!inp) return;
  const text = inp.value.trim(); if (!text) return;
  const p = POST_CACHE[pid]; if (!p) return;
  inp.disabled = true;
  try {
    const c = await addComment(p, text, cid);
    c.author = { id: ME.id, name: ME.name, avatar_url: ME.avatar_url };
    c.reactionCounts = {}; c.reactionTotal = 0; c.myReaction = null; c.replies = [];
    p.comments.push(c);
    S._cexp[pid + '_' + cid] = true;
    refreshComments(pid);
  } catch (e) { err(e); }
  inp.disabled = false;
}
function cInputUI(pid) {
  const i = $('#cin_' + pid), e = $('#cemoji_' + pid), s = $('#csend_' + pid);
  const has = !!(i && i.value.trim());
  if (e) e.hidden = has;
  if (s) s.hidden = !has;
}
function rInputUI(cid) {
  const i = $('#rin_' + cid), e = $('#remo_' + cid), s = $('#rsend_' + cid);
  const has = !!(i && i.value.trim());
  if (e) e.hidden = has;
  if (s) s.hidden = !has;
}
async function addCommentUI(pid) {
  const inp = $('#cin_' + pid); const text = inp.value.trim(); if (!text) return;
  const p = POST_CACHE[pid]; if (!p) return;
  inp.disabled = true;
  try {
    const c = await addComment(p, text);
    c.author = { id: ME.id, name: ME.name, avatar_url: ME.avatar_url };
    c.reactionCounts = {}; c.reactionTotal = 0; c.myReaction = null; c.replies = [];
    p.comments.push(c);
    inp.value = '';
    cInputUI(pid);
    refreshComments(pid);
  } catch (e) { err(e); }
  inp.disabled = false;
}
/* ----- translation (free API, Bangla -> English) ----- */
const _trCache = {};
function hasBangla(t) { return /[\u0980-\u09FF]/.test(t || ''); }
async function translateUI(cid, btn) {
  const out = $('#tro_' + cid);
  const c = findComment(cid);
  if (!out || !c) return;
  if (!out.hidden) { out.hidden = true; btn.textContent = 'See translation'; return; }
  if (_trCache[cid]) { out.textContent = _trCache[cid]; out.hidden = false; btn.textContent = 'See original'; return; }
  btn.textContent = 'Translating...';
  try {
    const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(c.text) + '&langpair=bn|en';
    const r = await fetch(url);
    const j = await r.json();
    const t = (j.responseData && j.responseData.translatedText) || '';
    if (!t || /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID EMAIL/i.test(t)) throw new Error('bad');
    _trCache[cid] = t;
    out.textContent = t; out.hidden = false; btn.textContent = 'See original';
  } catch (e) {
    btn.textContent = 'See translation';
    toast('Translation unavailable right now.');
  }
}
/* ----- emoji picker (no API needed) ----- */
const EMOJIS = ['\u{1F600}','\u{1F601}','\u{1F602}','\u{1F923}','\u{1F60A}','\u{1F60D}','\u{1F60E}','\u{1F62D}','\u{1F621}','\u{1F44D}','\u{1F44E}','\u{1F64F}','\u{1F44F}','\u{1F525}','\u2764\uFE0F','\u{1F494}','\u{1F389}','\u{1F62E}','\u{1F622}','\u{1F605}','\u{1F914}','\u{1F634}','\u{1F973}','\u{1F607}','\u{1F917}','\u{1F440}','\u{1F4AF}','\u2728','\u{1F64C}','\u{1F91D}','\u{1F44B}','\u270C\uFE0F','\u{1F91E}','\u{1F4AA}','\u{1F9E0}','\u{1F339}','\u2B50','\u{1F382}','\u{1F355}','\u26BD'];
let _emojiFor = null;
function openEmojiPicker(inputId, anchor) {
  closeEmojiPicker();
  _emojiFor = inputId;
  const r = anchor.getBoundingClientRect();
  const d = document.createElement('div');
  d.id = 'emojiPicker'; d.className = 'emoji-picker';
  d.innerHTML = EMOJIS.map(e => `<button onclick="pickEmoji('${e}')">${e}</button>`).join('');
  document.body.appendChild(d);
  const w = 264;
  d.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left - w + 40)) + 'px';
  d.style.top = Math.max(8, r.top - d.offsetHeight - 10) + 'px';
}
function closeEmojiPicker() { const d = $('#emojiPicker'); if (d) d.remove(); _emojiFor = null; }
function pickEmoji(e) {
  const inp = _emojiFor && document.getElementById(_emojiFor);
  if (inp) {
    const s = inp.selectionStart != null ? inp.selectionStart : inp.value.length;
    const en = inp.selectionEnd != null ? inp.selectionEnd : s;
    inp.value = inp.value.slice(0, s) + e + inp.value.slice(en);
    inp.focus();
    try { inp.setSelectionRange(s + e.length, s + e.length); } catch (_) {}
  }
  closeEmojiPicker();
}

/* post cache for actions */
let POST_CACHE = {};
function cachePosts(list) { list.forEach(p => { POST_CACHE[p.id] = p; }); }

/* ----- reaction picker (long-press), posts + comments ----- */
let rxTimer = null, rxPickerFor = null;
function rxTarget(kind, id) {
  if (kind === 'p') return POST_CACHE[id] || null;
  return findComment(id);
}
function findComment(cid) {
  for (const pid in POST_CACHE) {
    const cs = (POST_CACHE[pid].comments || []);
    for (const c of cs) if (c.id === cid) return c;
  }
  return null;
}
async function rxDoReact(obj, kind, type) {
  if (kind === 'p') await reactToPost(obj, type); else await reactToComment(obj, type);
}
async function rxDoUnreact(obj, kind) {
  if (kind === 'p') await unreactToPost(obj); else await unreactToComment(obj);
}
function rxDown(ev, kind, id) {
  const key = kind + ':' + id;
  if (rxPickerFor === key) { closeRxPicker(); S._rxAte = key; return; }
  closeRxPicker();
  const el = ev.currentTarget;
  rxTimer = setTimeout(() => { rxTimer = null; openRxPicker(kind, id, el); }, 450);
}
function rxUp() { if (rxTimer) { clearTimeout(rxTimer); rxTimer = null; } }
async function rxTap(ev, kind, id) {
  ev.stopPropagation(); rxUp();
  const key = kind + ':' + id;
  if (S._rxAte === key) { S._rxAte = null; return; }
  if (S._rxLong === key) { S._rxLong = null; return; }
  const o = rxTarget(kind, id); if (!o) return;
  try {
    if (o.myReaction) { applyLocalRx(o, null); paintRx(kind, id); await rxDoUnreact(o, kind); }
    else { applyLocalRx(o, 'like'); paintRx(kind, id); await rxDoReact(o, kind, 'like'); }
  } catch (e) { err(e); renderView(); }
}
function openRxPicker(kind, id, anchor) {
  closeRxPicker();
  const key = kind + ':' + id;
  S._rxLong = key; rxPickerFor = key;
  const r = anchor.getBoundingClientRect();
  const d = document.createElement('div');
  d.id = 'rxPicker'; d.className = 'rx-picker';
  d.innerHTML = Object.keys(RX).map((t, i) =>
    `<button class="rx-opt" style="animation-delay:${i * 45}ms" title="${RX[t].label}" aria-label="${RX[t].label}"
      onpointerdown="event.stopPropagation();event.preventDefault()"
      onclick="pickRx(event,'${kind}','${id}','${t}')"><span>${RX[t].e}</span></button>`).join('');
  document.body.appendChild(d);
  const w = d.offsetWidth, h = d.offsetHeight;
  d.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  d.style.top = Math.max(8, r.top - h - 12) + 'px';
}
function closeRxPicker() {
  const d = $('#rxPicker'); if (d) d.remove();
  rxPickerFor = null; S._rxLong = null;
}
async function pickRx(ev, kind, id, type) {
  ev.stopPropagation(); ev.preventDefault();
  const o = rxTarget(kind, id);
  closeRxPicker(); S._rxLong = null; S._rxAte = null;
  if (!o) return;
  try {
    applyLocalRx(o, type); paintRx(kind, id);
    await rxDoReact(o, kind, type);
  } catch (e) { err(e); renderView(); }
}
document.addEventListener('pointerdown', (e) => {
  const d = $('#rxPicker');
  if (d && !d.contains(e.target) && !e.target.closest('[data-rxbtn]')) closeRxPicker();
  const em = $('#emojiPicker');
  if (em && !em.contains(e.target) && !e.target.closest('.c-emoji-btn')) closeEmojiPicker();
}, true);
window.addEventListener('scroll', () => { if (rxPickerFor) closeRxPicker(); }, { passive: true, capture: true });
function applyLocalRx(p, nt) {
  const ot = p.myReaction;
  p.reactionCounts = p.reactionCounts || {};
  p.reactionTotal = p.reactionTotal || 0;
  if (ot && ot !== nt) {
    p.reactionCounts[ot] = Math.max(0, (p.reactionCounts[ot] || 0) - 1);
    p.reactionTotal = Math.max(0, p.reactionTotal - 1);
    if (!p.reactionCounts[ot]) delete p.reactionCounts[ot];
  }
  if (nt && nt !== ot) {
    p.reactionCounts[nt] = (p.reactionCounts[nt] || 0) + 1;
    p.reactionTotal += 1;
  }
  p.myReaction = nt || null;
}
function rxCountsHTML(p) {
  const c = p.reactionCounts || {};
  const top = Object.keys(c).filter(t => c[t] > 0).sort((a, b) => c[b] - c[a]).slice(0, 3);
  const left = top.length
    ? `<span class="rx-top">${top.map(t => `<span>${RX[t].e}</span>`).join('')}</span><span>${fmtCount(p.reactionTotal)}</span>` : '';
  const cc = (p.comments || []).length, sc = p.shareCount || 0;
  const bits = [];
  if (cc) bits.push(fmtCount(cc) + ' comment' + (cc > 1 ? 's' : ''));
  if (sc) bits.push(fmtCount(sc) + ' share' + (sc > 1 ? 's' : ''));
  return `${left}<span class="right-counts">${bits.join(' \u00b7 ')}</span>`;
}
function rxBtnHTML(p, compact) {
  const r = p.myReaction ? RX[p.myReaction] : null;
  const inner = r
    ? `<span class="rx-e">${r.e}</span>${compact ? '' : `<span style="color:${r.c};font-weight:700">${r.label}</span>`}`
    : `${icon('like', 20)}${compact ? '' : '<span>Like</span>'}`;
  return `<button data-rxbtn class="${compact ? 'rx-compact ' : ''}${r ? 'rx-' + p.myReaction : ''}"
    onpointerdown="rxDown(event,'p','${p.id}')" onpointerup="rxUp()" onpointerleave="rxUp()" onpointercancel="rxUp()"
    onclick="rxTap(event,'p','${p.id}')">${inner}</button>`;
}
function paintRx(kind, id) {
  if (kind === 'c') return paintCommentRx(id);
  const p = POST_CACHE[id]; if (!p) return;
  document.querySelectorAll('#post_' + id).forEach(card => {
    const btn = card.querySelector('[data-rxbtn]');
    if (btn) {
      const tmp = document.createElement('div');
      tmp.innerHTML = rxBtnHTML(p, btn.classList.contains('rx-compact'));
      btn.replaceWith(tmp.firstChild);
    }
    const cr = card.querySelector('.post-counts');
    if (cr) cr.innerHTML = rxCountsHTML(p);
  });
}
function paintCommentRx(cid) {
  const c = findComment(cid); if (!c) return;
  document.querySelectorAll(`[data-ccard="${cid}"]`).forEach(card => {
    const btn = card.querySelector('[data-rxbtn]');
    if (btn) { const tmp = document.createElement('div'); tmp.innerHTML = cRxBtnHTML(c); btn.replaceWith(tmp.firstChild); }
    const bw = card.querySelector('.c-badge-wrap');
    if (bw) bw.innerHTML = cRxBadgeHTML(c);
  });
}

function focusComment(pid) { const i = $('#cin_' + pid); if (i) i.focus(); }
async function sharePostUI(pid) {
  const p = POST_CACHE[pid]; if (!p) return;
  try {
    await createPost({ shared_from: p.shared_from || p.id });
    refreshFeedSoon();
    toast('Post shared to your timeline.');
  } catch (e) { err(e); }
}

/* post ⋯ menu */
function toggleMenu(e, id) {
  e.stopPropagation();
  const dd = $('#dropdown');
  if (S.openMenu === id) { dd.innerHTML = ''; S.openMenu = null; return; }
  S.openMenu = id;
  const r = e.currentTarget.getBoundingClientRect();
  let html = '';
  if (id === 'profile') {
    html = `<div class="menu" style="top:${r.bottom + 6}px;right:${window.innerWidth - r.right}px">
      <button onclick="openProfile('${ME.id}')">${pav(ME, 32)}<span><b>${esc(ME.name)}</b><br><span class="muted">See your profile</span></span></button>
      <hr>
      <button onclick="toggleDark()">${icon('moon', 20)}<span>Dark mode: ${S.dark ? 'On' : 'Off'}</span></button>
      ${ME.is_admin ? `<button onclick="location.href='admin.html'">${icon('shield', 20)}<span>Admin Panel</span></button>` : ''}
      <button onclick="logout()">${icon('logout', 20)}<span>Log out</span></button>
    </div>`;
  } else if (id.startsWith('post_')) {
    const pid = id.slice(5); const p = POST_CACHE[pid];
    const mine = p && p.author_id === ME.id;
    html = `<div class="menu" style="top:${r.bottom + 4}px;right:${window.innerWidth - r.right}px;min-width:200px">
      ${mine ? `<button onclick="deletePostUI('${pid}')">${icon('trash', 20)}<span>Delete post</span></button>` : ''}
      <button onclick="openReport('${pid}')">${icon('flag', 20)}<span>Report post</span></button>
      <button onclick="toggleSaveUI('${pid}')">${icon('bookmark', 20)}<span>Save post</span></button>
    </div>`;
  }
  dd.innerHTML = html;
}
async function toggleSaveUI(pid) {
  $('#dropdown').innerHTML = ''; S.openMenu = null;
  try {
    const saved = await toggleSave(pid);
    toast(saved ? 'Saved to your items.' : 'Removed from saved items.');
  } catch (e) { err(e); }
}

function toggleDark() {
  S.dark = !S.dark;
  try { localStorage.setItem('fbclone_dark', S.dark ? '1' : '0'); } catch (e) {}
  renderApp();
}
async function deletePostUI(pid) {
  if (!await confirmDialog('Delete this post?')) return;
  try { await deletePost(pid); $('#dropdown').innerHTML = ''; S.openMenu = null; refreshFeedSoon(); toast('Post deleted.'); }
  catch (e) { err(e); }
}
function openReport(pid) {
  $('#dropdown').innerHTML = ''; S.openMenu = null;
  const reasons = ['Spam', 'Harassment', 'Hate speech', 'False information', 'Nudity', 'Something else'];
  openModal(`<h3>Report post</h3><p class="muted">Why are you reporting this?</p>
    ${reasons.map((r, i) => `<label class="radio"><input type="radio" name="rr" value="${r}" ${i === 0 ? 'checked' : ''}> ${r}</label>`).join('')}
    <div class="modal-actions"><button class="btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn-primary" onclick="submitReport('${pid}')">Submit report</button></div>`);
}
async function submitReport(pid) {
  const reason = ($('input[name=rr]:checked') || {}).value || 'Other';
  try { await reportPost(pid, reason); closeModal(); toast('Thanks — admins will review this.'); }
  catch (e) { err(e); }
}

/* ---------------- Composer ---------------- */
const BG_SWATCHES = ['', 'bg-blue', 'bg-purple', 'bg-green', 'bg-orange', 'bg-teal', 'bg-pink'];
function openComposer() {
  if (S.view !== 'group') S.composerGroup = null;
  S.composerBg = '';
  const f = S.composerFeeling;
  openModal(`<h3>${S.composerGroup ? 'Post in group' : 'Create post'}</h3>
    <div class="composer-user">${pav(ME, 40)}<div><b>${esc(ME.name)}</b><div class="muted">${icon('globe', 12)} Public</div></div>
    ${f ? `<span class="feel-chip">${f.emoji} feeling ${esc(f.label)} <button onclick="clearFeeling()" title="Remove">✕</button></span>` : ''}</div>
    <textarea id="cp_text" class="cp-text" placeholder="What's on your mind, ${esc(ME.name.split(' ')[0])}?" rows="4"></textarea>
    <div class="swatches" id="cp_sw">${BG_SWATCHES.map(b => `<button class="sw ${b} ${b === '' ? 'sw-none sel' : ''}" onclick="pickBg('${b}',this)"></button>`).join('')}</div>
    <label class="lbl">Photo (optional)</label>
    <input id="cp_file" type="file" accept="image/*" class="inp">
    <div class="muted" id="cp_hint" style="margin-top:6px">or paste an image URL:</div>
    <input id="cp_img" class="inp" placeholder="https://...">
    <div class="modal-actions"><button class="btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn-primary" id="cp_btn" onclick="submitPost()">Post</button></div>`);
  setTimeout(() => $('#cp_text').focus(), 50);
}
function pickBg(b, el) {
  S.composerBg = b;
  $$('#cp_sw .sw').forEach(x => x.classList.remove('sel'));
  el.classList.add('sel');
  $('#cp_text').className = 'cp-text big ' + b;
}
async function submitPost() {
  const text = $('#cp_text').value.trim();
  const imgUrl = $('#cp_img').value.trim();
  const file = $('#cp_file').files[0];
  if (!text && !imgUrl && !file) { toast('Write something or add a photo first.'); return; }
  const btn = $('#cp_btn'); btn.disabled = true; btn.textContent = 'Posting...';
  try {
    let image_url = imgUrl || null;
    if (file) { btn.textContent = 'Uploading...'; image_url = await uploadImage(file); }
    const feeling = S.composerFeeling ? `${S.composerFeeling.label} ${S.composerFeeling.emoji}` : null;
    await createPost({ text, image_url, bg: S.composerBg || null, feeling, group_id: S.composerGroup || null });
    S.composerFeeling = null; S.composerGroup = null;
    closeModal(); window.scrollTo(0, 0);
    refreshFeedSoon(); toast('Posted!');
  } catch (e) { err(e); btn.disabled = false; btn.textContent = 'Post'; }
}

/* ---------------- Feelings ---------------- */
const FEELINGS = [
  ['happy', '😊'], ['in love', '😍'], ['celebrating', '🎉'], ['motivated', '💪'],
  ['sad', '😢'], ['angry', '😡'], ['sick', '🤒'], ['tired', '😴'],
];
function openFeelingPicker() {
  openModal(`<h3>How are you feeling?</h3>
    <div class="feel-grid">${FEELINGS.map(([l, e]) => `<button class="feel" onclick="pickFeeling('${l}','${e}')"><span>${e}</span>${l}</button>`).join('')}
    <button class="feel" onclick="pickFeeling('','')">✕<span>None</span></button></div>`);
}
function pickFeeling(label, emoji) {
  S.composerFeeling = label ? { label, emoji } : null;
  closeModal(); openComposer();
}
function clearFeeling() { S.composerFeeling = null; openComposer(); }

/* ---------------- Video recorder ---------------- */
/* ----- Reel upload: pick from gallery -> preview -> caption -> upload (no in-app recording) ----- */
let VU = null;
function openVideoUpload() {
  if (VU && VU.url) { try { URL.revokeObjectURL(VU.url); } catch (e) {} }
  VU = null;
  openModal(`<h3>Upload reel</h3><p class="muted" style="text-align:center;margin:-6px 0 10px">Pick a video from your gallery</p>
    <div id="vuPick">
      <label class="vu-drop">
        <input type="file" id="vuFile" accept="video/*" style="display:none" onchange="previewPickedVideo(this)">
        <span class="vu-drop-ico">\u{1F3AC}</span>
        <span><b>Choose video</b></span>
        <span class="muted">from your gallery</span>
      </label>
    </div>
    <div id="vuEdit" style="display:none">
      <video id="vuPreview" controls playsinline preload="metadata" style="width:100%;border-radius:10px;background:#000;aspect-ratio:4/5;max-height:44vh"></video>
      <label class="lbl">Caption</label>
      <textarea id="vuCaption" class="inp" rows="2" placeholder="Write a caption..."></textarea>
      <div class="muted" id="vuInfo" style="margin:6px 0;font-size:13px"></div>
      <div class="modal-actions" style="justify-content:center;margin-top:12px">
        <button class="btn-ghost" onclick="resetVideoPick()">Change video</button>
        <button class="btn-primary" id="vuPost" onclick="postPickedVideo()">Upload reel</button>
      </div>
    </div>`);
}
function previewPickedVideo(input) {
  const f = input.files && input.files[0];
  if (!f) return;
  if (VU && VU.url) { try { URL.revokeObjectURL(VU.url); } catch (e) {} }
  VU = { file: f, url: URL.createObjectURL(f) };
  $('#vuPick').style.display = 'none';
  $('#vuEdit').style.display = 'block';
  const v = $('#vuPreview');
  const mb = (f.size / 1048576).toFixed(1);
  const info = $('#vuInfo');
  if (info) info.textContent = `${f.name} · ${mb} MB`;
  if (v) {
    v.src = VU.url;
    v.onloadedmetadata = () => {
      if (info && v.duration && isFinite(v.duration)) {
        const d = Math.round(v.duration);
        info.textContent = `${f.name} · ${mb} MB · ${d}s`;
      }
    };
  }
}
function resetVideoPick() {
  if (VU && VU.url) { try { URL.revokeObjectURL(VU.url); } catch (e) {} }
  VU = null;
  const fi = $('#vuFile'); if (fi) fi.value = '';
  $('#vuEdit').style.display = 'none';
  $('#vuPick').style.display = 'block';
}
async function postPickedVideo() {
  if (!VU || !VU.file) return;
  const caption = (($('#vuCaption') || {}).value || '').trim();
  const btn = $('#vuPost');
  if (btn) { btn.disabled = true; btn.textContent = 'Uploading...'; }
  try {
    const url = await uploadToMedia(VU.file, 'video');
    await createPost({ text: caption, video_url: url });
    if (VU.url) { try { URL.revokeObjectURL(VU.url); } catch (e) {} }
    VU = null;
    closeModal();
    S.view = 'home'; renderApp(); window.scrollTo(0, 0);
    toast('Reel uploaded!');
  } catch (e) { err(e); if (btn) { btn.disabled = false; btn.textContent = 'Upload reel'; } }
}

/* ---------------- Messenger (realtime 1-1 chat) ---------------- */
S.chats = [];

async function toggleInbox(e) {
  e.stopPropagation();
  const dd = $('#dropdown');
  if (S.openMenu === 'inbox') { dd.innerHTML = ''; S.openMenu = null; return; }
  S.openMenu = 'inbox';
  const r = e.currentTarget.getBoundingClientRect();
  dd.innerHTML = `<div class="menu notif-menu" style="top:${r.bottom + 6}px;right:${Math.max(8, window.innerWidth - r.right - 160)}px;min-width:300px">
    <div class="notif-head"><b>Chats</b></div>
    <div id="inboxList"><div class="notif muted">Loading...</div></div></div>`;
  try {
    const convs = await getConversations();
    const list = $('#inboxList');
    if (!list) return;
    list.innerHTML = convs.length ? convs.map(c => `
      <div class="notif ${c.unread ? 'unread' : ''}" onclick="openChatById('${c.id}')">
        ${pav(c.other, 44)}
        <div style="flex:1;min-width:0"><b>${esc(c.other.name)}</b>
          <div class="muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.last ? c.last.text.slice(0, 60) : 'Say hello!')}</div></div>
        ${c.unread ? `<span class="a-pill">${c.unread}</span>` : ''}
      </div>`).join('')
      : '<div class="notif muted">No conversations yet.<br>Tap a contact to start chatting!</div>';
  } catch (err2) {
    const list = $('#inboxList');
    if (list) list.innerHTML = '<div class="notif muted">Could not load chats.</div>';
  }
}

async function openChatById(cid) {
  const dd = $('#dropdown');
  if (dd) dd.innerHTML = '';
  S.openMenu = null;
  let ch = S.chats.find(c => c.cid === cid);
  if (!ch) {
    const convs = await getConversations().catch(() => []);
    const conv = convs.find(c => c.id === cid);
    ch = { cid, other: conv ? conv.other : { name: '?' }, messages: [], channel: null };
    S.chats.push(ch);
    while (S.chats.length > 3) {
      const old = S.chats.shift();
      if (old.channel) { try { sb.removeChannel(old.channel); } catch (e) {} }
    }
  }
  renderChatDock();
  try {
    ch.messages = await getMessages(cid);
    renderChatDock(); scrollChat(cid);
    markConvRead(cid).catch(() => {});
    refreshMsgBadge();
  } catch (e) { err(e); }
  subscribeChat(ch);
}

async function openChat(userId) {
  if (!userId || userId === ME.id) return;
  try {
    const cid = await getOrCreateConversation(userId);
    await openChatById(cid);
  } catch (e) { err(e); }
}

function subscribeChat(ch) {
  if (ch.channel) return;
  ch.channel = sb.channel('chat-' + ch.cid)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${ch.cid}` },
      (payload) => {
        const m = payload.new;
        if (!ch.messages.some(x => x.id === m.id)) {
          ch.messages.push(m);
          renderChatDock(); scrollChat(ch.cid);
          if (m.sender_id !== ME.id) markConvRead(ch.cid).catch(() => {});
          refreshMsgBadge();
        }
      })
    .subscribe();
}

function renderChatDock() {
  let dock = $('#chatDock');
  if (!dock) {
    dock = document.createElement('div');
    dock.id = 'chatDock';
    document.body.appendChild(dock);
  }
  dock.innerHTML = S.chats.map(ch => `
    <div class="chat-win" id="chat_${ch.cid}">
      <div class="chat-head" onclick="toggleChatMin('${ch.cid}')">
        ${pav(ch.other, 32)}<b>${esc(ch.other.name)}</b>
        <span class="chat-head-x" onclick="event.stopPropagation();closeChat('${ch.cid}')">✕</span>
      </div>
      <div class="chat-body" id="chatbody_${ch.cid}">
        ${(ch.messages || []).map(chatMsgHTML).join('') || '<div class="muted" style="text-align:center;padding:14px;font-size:13px">Say hello! 👋</div>'}
      </div>
      <div class="chat-input">
        <input id="chatin_${ch.cid}" placeholder="Aa" autocomplete="off" onkeydown="if(event.key==='Enter')sendChat('${ch.cid}')">
        <button onclick="sendChat('${ch.cid}')" title="Send">${icon('send', 18)}</button>
      </div>
    </div>`).join('');
}

function chatMsgHTML(m) {
  const mine = m.sender_id === ME.id;
  return `<div class="msg-row ${mine ? 'mine' : ''}"><div class="msg-bubble">${esc(m.text)}</div></div>`;
}

async function sendChat(cid) {
  const inp = $('#chatin_' + cid);
  if (!inp) return;
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  const ch = S.chats.find(c => c.cid === cid);
  try {
    const m = await sendMessage(cid, text);
    if (ch && !ch.messages.some(x => x.id === m.id)) {
      ch.messages.push(m);
      renderChatDock(); scrollChat(cid);
    }
  } catch (e) { err(e); }
}

function scrollChat(cid) {
  const b = $('#chatbody_' + cid);
  if (b) b.scrollTop = b.scrollHeight;
}

function closeChat(cid) {
  const i = S.chats.findIndex(c => c.cid === cid);
  if (i >= 0) {
    const [ch] = S.chats.splice(i, 1);
    if (ch.channel) { try { sb.removeChannel(ch.channel); } catch (e) {} }
  }
  renderChatDock();
}

function toggleChatMin(cid) {
  const w = $('#chat_' + cid);
  if (w) w.classList.toggle('min');
}

async function refreshMsgBadge() {
  try {
    const convs = await getConversations();
    const n = convs.reduce((a, c) => a + (c.unread || 0), 0);
    const b = $('#msgBadge');
    if (b) {
      b.textContent = n > 9 ? '9+' : n;
      b.style.display = n ? 'flex' : 'none';
    }
  } catch (e) { /* ignore */ }
}

/* ---------------- Watch (video feed) ---------------- */
async function watchHTML() {
  const posts = await getVideoPosts();
  cachePosts(posts);
  if (!posts.length) {
    return `<div class="card empty">${icon('video', 44)}<br><br><b>No videos yet</b><br><span class="muted">Record one from the home composer!</span><br><br><button class="btn-primary" onclick="goHome()">Back home</button></div>`;
  }
  return `<div class="page-head card"><h2>${icon('video', 22)} Watch</h2><span class="muted">${posts.length} videos</span></div>` +
    posts.map(p => {
      const a = p.author || { name: '?' };
      return `<div class="post card" id="post_${p.id}">
        <div class="post-head">
          <span onclick="openProfile('${a.id || ''}')" class="clickable">${pav(a, 40)}</span>
          <div class="post-meta">
            <div class="post-name" onclick="openProfile('${a.id || ''}')">${esc(a.name)}</div>
            <div class="post-time">${timeAgo(p.created_at)} · ${icon('globe', 12)}</div>
          </div>
        </div>
        ${p.text ? `<div class="post-text">${esc(p.text)}</div>` : ''}
        <video class="watch-video" controls preload="metadata" playsinline src="${esc(p.video_url)}"></video>
        <div class="post-actions">
          ${rxBtnHTML(p, true)}
          <button onclick="focusComment('${p.id}')">${icon('comment', 20)}<span>${(p.comments || []).length || ''}</span></button>
          <button onclick="sharePostUI('${p.id}')">${icon('share', 20)}</button>
        </div>
        <div class="comments" id="comments_${p.id}">${commentsSectionHTML(p)}</div>
        <div class="add-comment">${pav(ME, 32)}<input id="cin_${p.id}" placeholder="Write a comment..." onkeydown="if(event.key==='Enter')addCommentUI('${p.id}')"></div>
      </div>`;
    }).join('');
}

/* ---------------- Marketplace ---------------- */
async function marketplaceHTML() {
  const listings = await getListings();
  S._listings = listings;
  return `<div class="page-head card"><h2>${icon('store', 22)} Marketplace</h2>
      <button class="btn-primary" onclick="openListingComposer()">${icon('plus', 18)}<span>Sell something</span></button></div>
    <div class="market-grid">${listings.map(l => `
      <div class="listing-card card" onclick="openListingDetail('${l.id}')">
        ${l.image_url ? `<img src="${esc(l.image_url)}" loading="lazy" alt="">` : `<div class="listing-noimg">${icon('image', 40)}</div>`}
        <div class="listing-body">
          <div class="listing-price">৳${Number(l.price).toLocaleString()}</div>
          <div class="listing-title">${esc(l.title)}</div>
          <div class="muted" style="display:flex;align-items:center;gap:6px">${pav(l.seller, 20)} ${esc(l.seller.name)}</div>
        </div>
      </div>`).join('') || `<div class="card empty">No listings yet.<br><span class="muted">Be the first to sell something!</span></div>`}</div>`;
}

function openListingComposer() {
  openModal(`<h3>Sell something</h3>
    <label class="lbl">Title</label>
    <input id="li_title" class="inp" placeholder="What are you selling?" maxlength="80">
    <label class="lbl">Price (৳)</label>
    <input id="li_price" class="inp" type="number" min="0" placeholder="0">
    <label class="lbl">Description</label>
    <textarea id="li_desc" class="cp-text" rows="2" placeholder="Condition, details..."></textarea>
    <label class="lbl">Photo</label>
    <input id="li_file" type="file" accept="image/*" class="inp">
    <div class="modal-actions"><button class="btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn-primary" id="li_btn" onclick="submitListing()">List item</button></div>`);
}

async function submitListing() {
  const title = $('#li_title').value.trim();
  const price = $('#li_price').value;
  if (!title) { toast('Add a title.'); return; }
  const btn = $('#li_btn'); btn.disabled = true; btn.textContent = 'Listing...';
  try {
    let image_url = null;
    const file = $('#li_file').files[0];
    if (file) { btn.textContent = 'Uploading...'; image_url = await uploadImage(file); }
    await createListing({ title, price, description: $('#li_desc').value.trim(), image_url });
    closeModal(); renderView(); toast('Item listed! 🏷️');
  } catch (e) { err(e); btn.disabled = false; btn.textContent = 'List item'; }
}

function openListingDetail(id) {
  const l = (S._listings || []).find(x => x.id === id);
  if (!l) return;
  const mine = l.seller_id === ME.id;
  openModal(`<div class="listing-detail">
    ${l.image_url ? `<img src="${esc(l.image_url)}" alt="">` : ''}
    <h3>${esc(l.title)}</h3>
    <div class="listing-price big">৳${Number(l.price).toLocaleString()}</div>
    <div class="muted">${esc(l.description || 'No description.')}</div>
    <div class="seller-row" onclick="closeModal();openProfile('${l.seller_id}')">${pav(l.seller, 36)}<div><b>${esc(l.seller.name)}</b><div class="muted">Seller</div></div></div>
    <div class="modal-actions">
      ${mine
        ? `<button class="btn-ghost" onclick="toggleSoldUI('${l.id}',${l.sold})">${l.sold ? 'Mark available' : 'Mark as sold'}</button>
           <button class="btn-ghost" onclick="deleteListingUI('${l.id}')">${icon('trash', 16)}<span>Delete</span></button>`
        : `<button class="btn-primary" onclick="closeModal();openChat('${l.seller_id}')">${icon('chat', 18)}<span>Message seller</span></button>`}
    </div></div>`);
}

async function deleteListingUI(id) {
  if (!await confirmDialog('Delete this listing?')) return;
  try { await deleteListing(id); closeModal(); renderView(); toast('Listing deleted.'); }
  catch (e) { err(e); }
}

async function toggleSoldUI(id, sold) {
  try { await toggleSold(id, sold); closeModal(); renderView(); toast(sold ? 'Marked as available.' : 'Marked as sold.'); }
  catch (e) { err(e); }
}

/* ---------------- Events ---------------- */
async function eventsHTML() {
  const events = await getEvents();
  S._events = events;
  return `<div class="page-head card"><h2>${icon('calendar', 22)} Events</h2>
      <button class="btn-primary" onclick="openEventComposer()">${icon('plus', 18)}<span>Create event</span></button></div>
    ${events.map(e => `
      <div class="card event-card" onclick="openEventDetail('${e.id}')">
        <div class="event-date"><span>${new Date(e.starts_at).toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}</span><b>${new Date(e.starts_at).getDate()}</b></div>
        <div style="flex:1;min-width:0"><b>${esc(e.title)}</b>
          <div class="muted">${esc(e.location || '')} · ${new Date(e.starts_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</div>
          <div class="muted">${e.counts.going} going · ${e.counts.interested} interested${e.myRsvp ? ` · <b style="color:var(--blue)">You: ${e.myRsvp}</b>` : ''}</div>
        </div>
        ${icon('chev', 20)}
      </div>`).join('') || `<div class="card empty">No upcoming events.<br><span class="muted">Create one and invite the world!</span></div>`}`;
}

function openEventComposer() {
  const min = new Date(Date.now() + 3600000).toISOString().slice(0, 16);
  openModal(`<h3>Create event</h3>
    <label class="lbl">Event name</label>
    <input id="ev_title" class="inp" placeholder="Event name" maxlength="80">
    <label class="lbl">Date & time</label>
    <input id="ev_when" class="inp" type="datetime-local" min="${min}" value="${min}">
    <label class="lbl">Location</label>
    <input id="ev_loc" class="inp" placeholder="Where?">
    <label class="lbl">Description</label>
    <textarea id="ev_desc" class="cp-text" rows="2" placeholder="Details..."></textarea>
    <label class="lbl">Cover photo (optional)</label>
    <input id="ev_file" type="file" accept="image/*" class="inp">
    <div class="modal-actions"><button class="btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn-primary" id="ev_btn" onclick="submitEvent()">Create</button></div>`);
}

async function submitEvent() {
  const title = $('#ev_title').value.trim();
  const when = $('#ev_when').value;
  if (!title) { toast('Add an event name.'); return; }
  if (!when) { toast('Pick a date & time.'); return; }
  const btn = $('#ev_btn'); btn.disabled = true; btn.textContent = 'Creating...';
  try {
    let image_url = null;
    const file = $('#ev_file').files[0];
    if (file) { btn.textContent = 'Uploading...'; image_url = await uploadImage(file); }
    await createEvent({ title, description: $('#ev_desc').value.trim(), location: $('#ev_loc').value.trim(), starts_at: new Date(when).toISOString(), image_url });
    closeModal(); renderView(); toast('Event created! 📅');
  } catch (e) { err(e); btn.disabled = false; btn.textContent = 'Create'; }
}

function openEventDetail(id) {
  const e = (S._events || []).find(x => x.id === id);
  if (!e) return;
  const mine = e.creator_id === ME.id;
  openModal(`<div class="listing-detail">
    ${e.image_url ? `<img src="${esc(e.image_url)}" alt="">` : ''}
    <div class="event-date big"><span>${new Date(e.starts_at).toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}</span><b>${new Date(e.starts_at).getDate()}</b></div>
    <h3>${esc(e.title)}</h3>
    <div class="muted">${icon('clock', 14)} ${new Date(e.starts_at).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}</div>
    ${e.location ? `<div class="muted">${icon('mappin', 14)} ${esc(e.location)}</div>` : ''}
    <div class="post-text">${esc(e.description || '')}</div>
    <div class="muted"><b>${e.counts.going}</b> going · <b>${e.counts.interested}</b> interested</div>
    <div class="modal-actions" style="justify-content:flex-start">
      <button class="${e.myRsvp === 'interested' ? 'btn-primary' : 'btn-ghost'}" onclick="rsvpUI('${e.id}','interested')">Interested</button>
      <button class="${e.myRsvp === 'going' ? 'btn-primary' : 'btn-ghost'}" onclick="rsvpUI('${e.id}','going')">Going</button>
      ${mine ? `<button class="btn-ghost" onclick="deleteEventUI('${e.id}')" style="margin-left:auto">${icon('trash', 16)}</button>` : ''}
    </div></div>`);
}

async function rsvpUI(id, status) {
  try {
    await setRsvp(id, status);
    const e = (S._events || []).find(x => x.id === id);
    if (e) {
      if (e.myRsvp && e.myRsvp !== status) e.counts[e.myRsvp]--;
      if (!e.myRsvp || e.myRsvp !== status) e.counts[status]++;
      e.myRsvp = status;
    }
    openEventDetail(id);
    if (S.view === 'events') renderView();
  } catch (e) { err(e); }
}

async function deleteEventUI(id) {
  if (!await confirmDialog('Delete this event?')) return;
  try { await deleteEvent(id); closeModal(); renderView(); toast('Event deleted.'); }
  catch (e) { err(e); }
}

/* ---------------- Groups ---------------- */
async function groupsHTML() {
  const groups = await getGroups();
  S._groups = groups;
  const mine = groups.filter(g => g.joined);
  const discover = groups.filter(g => !g.joined);
  const card = g => `<div class="card group-card" onclick="openGroup('${g.id}')">
      <div class="group-cover" ${g.cover_url ? `style="background-image:url('${esc(g.cover_url)}')"` : ''}>${g.cover_url ? '' : icon('users', 36)}</div>
      <div style="padding:10px 2px 0"><b>${esc(g.name)}</b><div class="muted">${g.memberCount} member${g.memberCount === 1 ? '' : 's'}</div>
      <button class="${g.joined ? 'btn-ghost' : 'btn-primary'}" style="margin-top:8px;width:100%" onclick="event.stopPropagation();toggleJoinUI('${g.id}',${g.joined})">${g.joined ? '✓ Joined' : '+ Join'}</button></div>
    </div>`;
  return `<div class="page-head card"><h2>${icon('users', 22)} Groups</h2>
      <button class="btn-primary" onclick="openGroupComposer()">${icon('plus', 18)}<span>Create group</span></button></div>
    <h3 class="sec-h">Your groups</h3>
    <div class="group-grid">${mine.map(card).join('') || '<div class="muted" style="padding:0 4px">You haven\'t joined any groups yet.</div>'}</div>
    <h3 class="sec-h">Discover</h3>
    <div class="group-grid">${discover.map(card).join('') || '<div class="muted" style="padding:0 4px">No other groups yet.</div>'}</div>`;
}

function openGroupComposer() {
  openModal(`<h3>Create group</h3>
    <label class="lbl">Group name</label>
    <input id="gr_name" class="inp" placeholder="Group name" maxlength="80">
    <label class="lbl">Description</label>
    <textarea id="gr_desc" class="cp-text" rows="2" placeholder="What's this group about?"></textarea>
    <label class="lbl">Cover photo (optional)</label>
    <input id="gr_file" type="file" accept="image/*" class="inp">
    <div class="modal-actions"><button class="btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn-primary" id="gr_btn" onclick="submitGroup()">Create</button></div>`);
}

async function submitGroup() {
  const name = $('#gr_name').value.trim();
  if (!name) { toast('Add a group name.'); return; }
  const btn = $('#gr_btn'); btn.disabled = true; btn.textContent = 'Creating...';
  try {
    let cover_url = null;
    const file = $('#gr_file').files[0];
    if (file) { btn.textContent = 'Uploading...'; cover_url = await uploadImage(file); }
    const g = await createGroup({ name, description: $('#gr_desc').value.trim(), cover_url });
    closeModal(); openGroup(g.id); toast('Group created! 👪');
  } catch (e) { err(e); btn.disabled = false; btn.textContent = 'Create'; }
}

async function toggleJoinUI(groupId, joined) {
  try {
    await toggleGroupJoin(groupId, joined);
    if (S._group && S._group.group.id === groupId) {
      S._group.joined = !joined;
      if (!joined) {
        S._group.members.push({ id: ME.id, name: ME.name, avatar_url: ME.avatar_url, bio: ME.bio });
      } else {
        S._group.members = S._group.members.filter(m => m.id !== ME.id);
      }
    }
    renderView();
    toast(joined ? 'Left the group.' : 'Joined the group!');
  } catch (e) { err(e); }
}

async function deleteGroupUI(id) {
  if (!await confirmDialog('Delete this group and all its posts?')) return;
  try { await deleteGroup(id); goGroups(); toast('Group deleted.'); }
  catch (e) { err(e); }
}

function setGroupTab(t) {
  S.groupTab = t;
  $$('.ptab').forEach(b => b.classList.toggle('active', b.textContent.toLowerCase() === t));
  groupTabHTML().then(html => { $('#groupTabContent').innerHTML = html; }).catch(err);
}

async function groupHTML() {
  const { group, members, posts, joined } = await getGroupPage(S.groupId);
  cachePosts(posts);
  S._group = { group, members, posts, joined };
  return `<div class="card profile-top">
    <div class="cover" ${group.cover_url ? `style="background-image:url('${esc(group.cover_url)}')"` : ''}></div>
    <div class="profile-row">
      <div class="profile-info"><h2>${esc(group.name)}</h2>
        <div class="muted">${icon('users', 14)} ${members.length} member${members.length === 1 ? '' : 's'}</div>
        <div class="muted">${esc(group.description || '')}</div>
      </div>
      <div class="profile-btns">
        ${joined ? `<button class="btn-ghost" onclick="toggleJoinUI('${group.id}',true)">✓ Joined</button>`
          : `<button class="btn-primary" onclick="toggleJoinUI('${group.id}',false)">+ Join group</button>`}
        ${(group.creator_id === ME.id || ME.is_admin) ? `<button class="btn-ghost" onclick="deleteGroupUI('${group.id}')" title="Delete group">${icon('trash', 16)}</button>` : ''}
      </div>
    </div>
    <div class="profile-tabs">${['discussion', 'about', 'members'].map(t =>
      `<button class="ptab ${S.groupTab === t ? 'active' : ''}" onclick="setGroupTab('${t}')">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
  </div>
  <div id="groupTabContent">${await groupTabHTML()}</div>`;
}

async function groupTabHTML() {
  const { group, members, posts, joined } = S._group;
  if (S.groupTab === 'about') {
    return `<div class="card"><div class="posts-head"><h3>About this group</h3></div>
      <div class="post-text">${esc(group.description || 'No description yet.')}</div>
      <div class="muted">Created ${new Date(group.created_at).toLocaleDateString(undefined, { dateStyle: 'long' })}</div></div>`;
  }
  if (S.groupTab === 'members') {
    return `<div class="card"><div class="posts-head"><h3>Members</h3><span class="muted">${members.length}</span></div>
      <div class="people-grid">${members.map(u => `<div class="person" onclick="openProfile('${u.id}')" style="cursor:pointer">${pav(u, 64)}<b>${esc(u.name)}</b><div class="muted">${esc(u.bio || '')}</div></div>`).join('')}</div></div>`;
  }
  return `${joined ? `<div class="card"><div class="composer-top" onclick="openGroupComposerPost()">${pav(ME, 40)}<div class="composer-fake">Write something in ${esc(group.name)}...</div></div></div>` : ''}
    <div id="posts">${postsHTML(posts)}</div>`;
}

function openGroupComposerPost() {
  S.composerGroup = S.groupId;
  openComposer();
}

/* ---------------- Saved ---------------- */
async function savedHTML() {
  const posts = await getSavedPosts();
  cachePosts(posts);
  return `<div class="page-head card"><h2>${icon('bookmark', 22)} Saved</h2><span class="muted">${posts.length} item${posts.length === 1 ? '' : 's'}</span></div>
    ${posts.length ? postsHTML(posts) : `<div class="card empty">${icon('bookmark', 44)}<br><br><b>Nothing saved yet</b><br><span class="muted">Tap the ⋯ menu on any post, then "Save post".</span></div>`}`;
}

/* ---------------- Memories ---------------- */
async function memoriesHTML() {
  const posts = await getMemories();
  cachePosts(posts);
  if (!posts.length) {
    return `<div class="card empty">${icon('clock', 44)}<br><br><b>No memories today</b><br><span class="muted">Posts you shared on this date in past years will appear here.</span></div>`;
  }
  const byYear = {};
  posts.forEach(p => {
    const y = new Date(p.created_at).getFullYear();
    (byYear[y] = byYear[y] || []).push(p);
  });
  const nowY = new Date().getFullYear();
  return `<div class="page-head card"><h2>${icon('clock', 22)} Memories</h2><span class="muted">On this day</span></div>` +
    Object.keys(byYear).sort((a, b) => b - a).map(y => {
      const ago = nowY - y;
      return `<div class="card"><div class="posts-head"><h3>${y}</h3><span class="muted">${ago} year${ago > 1 ? 's' : ''} ago</span></div></div>${postsHTML(byYear[y])}`;
    }).join('');
}

/* ---------------- Feeds (chronological) ---------------- */
function feedsHTML() {
  return composerHTML() + `<div id="posts"><div class="card empty">Loading...</div></div>`;
}

/* ---------------- Profile ---------------- */
let PROFILE_TAB = 'posts';

async function profileHTML(uidv) {
  const { profile: u, posts, followers } = await getProfilePage(uidv);
  cachePosts(posts);
  S._profile = { u, posts, followers };
  S._profilePosts = posts;
  const mine = u.id === ME.id;
  const following = S.followingCache.includes(u.id);
  return `
  <div class="card profile-top">
    <div class="cover" ${u.cover_url ? `style="background-image:url('${esc(u.cover_url)}')"` : ''}>
      ${mine ? `<button class="cover-cam" onclick="document.getElementById('coverFile').click()" title="Edit cover photo">📷</button>
      <input type="file" id="coverFile" accept="image/*" style="display:none" onchange="doChangeCover(this)">` : ''}
    </div>
    <div class="profile-row">
      <div class="pfp-wrap">
        ${pav(u, 120)}
        ${mine ? `<button class="pfp-cam" onclick="openAvatarMenu()" title="Edit profile picture">📷</button>` : ''}
      </div>
      <div class="profile-info"><h2>${esc(u.name || (mine ? ME.name : "") || "User")}</h2>
        ${u.thought
          ? `<div class="thought-bubble" ${mine ? 'onclick="editThought()" title="Edit thought"' : ''}>💭 ${esc(u.thought)}</div>`
          : (mine ? `<div class="thought-bubble empty" onclick="editThought()">+ Drop a thought...</div>` : '')}
        <div class="muted">${posts.length} posts · ${followers} followers</div>
      </div>
      <div class="profile-btns">
        ${mine
          ? `<button class="btn-primary" onclick="openStoryComposer()">⊕ Add to story</button>
             <button class="btn-ghost" onclick="editProfile()">✏️ Edit profile</button>`
          : `<button class="${following ? 'btn-ghost' : 'btn-primary'}" id="followBtn" onclick="toggleFollowUI('${u.id}')">${following ? '✓ Following' : '+ Follow'}</button>
             <button class="btn-ghost" onclick="openChat('${u.id}')">${icon('chat', 18)}<span>Message</span></button>`}
      </div>
    </div>
    <div class="profile-tabs">
      ${['posts', 'about', 'photos', 'friends'].map(t =>
        `<button class="ptab ${PROFILE_TAB === t ? 'active' : ''}" onclick="setProfileTab('${t}')">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
    </div>
  </div>
  <div id="profileTabContent">${await profileTabHTML()}</div>`;
}

async function setProfileTab(t) {
  PROFILE_TAB = t;
  $$('.ptab').forEach(b => b.classList.toggle('active', b.textContent.toLowerCase() === t));
  const el = $('#profileTabContent');
  el.innerHTML = '<div class="card empty">Loading...</div>';
  try { el.innerHTML = await profileTabHTML(); }
  catch (e) { err(e); }
}

async function profileTabHTML() {
  const { u, posts } = S._profile;
  const mine = u.id === ME.id;
  if (PROFILE_TAB === 'about') return aboutHTML(u, mine);
  if (PROFILE_TAB === 'photos') return photosHTML(await getUserPhotos(u.id));
  if (PROFILE_TAB === 'friends') {
    const [fl, fg] = await Promise.all([getFollowers(u.id), getFollowing(u.id)]);
    return friendsTabHTML(fl, fg);
  }
  return `${mine ? `<div class="card"><div class="composer-top" onclick="openComposer()">${pav(ME, 40)}<div class="composer-fake">What's on your mind?</div></div></div>` : ''}
  <div class="card"><div class="posts-head"><h3>Posts</h3>
    <select id="postFilter" class="inp" style="width:auto;padding:8px 10px" onchange="applyPostFilter()">
      <option value="recent">Most recent</option><option value="top">Top posts</option>
    </select></div>
    <div id="profilePosts">${postsHTML(posts)}</div></div>`;
}

function applyPostFilter() {
  const v = $('#postFilter').value;
  const list = [...(S._profilePosts || [])];
  if (v === 'top') list.sort((a, b) => (b.reactionTotal || 0) - (a.reactionTotal || 0));
  else list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  cachePosts(list);
  $('#profilePosts').innerHTML = postsHTML(list);
}

function aboutHTML(u, mine) {
  const bday = u.birthday
    ? new Date(u.birthday + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
    : null;
  const rows = [
    ['🎂', 'Birthday', bday || '—'],
    ['📝', 'Bio', u.bio || '—'],
    ['📅', 'Joined', new Date(u.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })],
  ];
  return `<div class="card"><div class="posts-head"><h3>Personal details</h3>${mine ? `<button class="btn-ghost" onclick="editProfile()">✏️ Edit</button>` : ''}</div>
    ${rows.map(([i, l, v]) => `<div class="detail-row"><span class="detail-ico">${i}</span><div><div class="muted">${l}</div><div><b>${esc(v)}</b></div></div></div>`).join('')}</div>`;
}

function photosHTML(photos) {
  return `<div class="card"><div class="posts-head"><h3>Photos</h3><span class="muted">${photos.length}</span></div>
    ${photos.length
      ? `<div class="photo-grid">${photos.map(p => `<img src="${esc(p.image_url)}" loading="lazy" alt="" onclick="window.open('${esc(p.image_url)}','_blank')">`).join('')}</div>`
      : `<div class="muted">No photos yet.</div>`}</div>`;
}

function friendsTabHTML(followers, following) {
  const person = (u) => {
    const isMe = u.id === ME.id;
    const f = S.followingCache.includes(u.id);
    return `<div class="person" onclick="openProfile('${u.id}')" style="cursor:pointer">${pav(u, 64)}<b>${esc(u.name)}</b>
      <div class="muted">${esc(u.bio || '')}</div>
      ${isMe ? '' : `<button class="${f ? 'btn-ghost' : 'btn-primary'}" onclick="event.stopPropagation();toggleFollowUI2('${u.id}',this)">${f ? 'Following' : 'Follow'}</button>`}</div>`;
  };
  const grid = (list) => list.length ? `<div class="people-grid">${list.map(person).join('')}</div>` : `<div class="muted">Nothing here yet.</div>`;
  return `<div class="card"><h3>Followers · ${followers.length}</h3>${grid(followers)}</div>
          <div class="card"><h3>Following · ${following.length}</h3>${grid(following)}</div>`;
}

/* profile photo / thought uploads */
async function doChangeCover(input) {
  const f = input.files[0]; if (!f) return;
  toast('Uploading cover photo...');
  try {
    const url = await uploadToMedia(f, 'cover');
    await updateProfile({ cover_url: url });
    renderView(); toast('Cover photo updated!');
  } catch (e) { err(e); }
}
function openAvatarMenu() {
  const has = !!(ME.avatar_url);
  openModal(`<h3>Profile picture</h3>
    <div class="modal-actions" style="flex-direction:column;align-items:stretch;gap:8px">
      <button class="btn-primary" onclick="document.getElementById('avatarFile').click()">\u{1F4F7} Upload photo</button>
      ${has ? `<button class="btn-ghost" onclick="removeAvatar()">\u{1F5D1}\uFE0F Remove photo</button>` : ''}
      <button class="btn-ghost" onclick="closeModal()">Cancel</button>
    </div>
    <input type="file" id="avatarFile" accept="image/*" style="display:none" onchange="doChangeAvatar(this)">`);
}
async function removeAvatar() {
  if (!await confirmDialog('Remove your profile picture?')) return;
  try {
    await updateProfile({ avatar_url: null });
    closeModal(); renderApp(); toast('Profile picture removed.');
  } catch (e) { err(e); }
}
async function doChangeAvatar(input) {
  const f = input.files[0]; if (!f) return;
  toast('Uploading profile picture...');
  try {
    const url = await uploadToMedia(f, 'avatar');
    await updateProfile({ avatar_url: url });
    closeModal(); renderApp(); toast('Profile picture updated!');
  } catch (e) { err(e); }
}
function editThought() {
  openModal(`<h3>Drop a thought</h3>
    <input id="th_val" class="inp" maxlength="120" placeholder="Share a quick thought..." value="${esc(ME.thought || '')}">
    <div class="modal-actions"><button class="btn-ghost" onclick="saveThought(true)">Remove</button>
    <button class="btn-primary" onclick="saveThought(false)">Save</button></div>`);
  setTimeout(() => $('#th_val').focus(), 50);
}
async function saveThought(remove) {
  try {
    await updateProfile({ thought: remove ? '' : $('#th_val').value.trim().slice(0, 120) });
    closeModal(); renderView(); toast(remove ? 'Thought removed.' : 'Thought updated!');
  } catch (e) { err(e); }
}
async function toggleFollowUI(uidv) {
  try {
    const nowFollowing = await toggleFollow(uidv);
    S.followingCache = await followingIds();
    const b = $('#followBtn');
    if (b) { b.className = nowFollowing ? 'btn-ghost' : 'btn-primary'; b.innerHTML = nowFollowing ? '✓ Following' : '+ Follow'; }
  } catch (e) { err(e); }
}
function editProfile() {
  openModal(`<h3>Edit profile</h3>
    <label class="lbl">Name</label>
    <input id="ep_name" class="inp" value="${esc(ME.name)}">
    <label class="lbl">Bio</label>
    <input id="ep_bio" class="inp" placeholder="Bio" value="${esc(ME.bio || '')}">
    <label class="lbl">Birthday</label>
    <input id="ep_bday" class="inp" type="date" value="${esc(ME.birthday || '')}">
    <div class="modal-actions"><button class="btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn-primary" onclick="saveProfile()">Save</button></div>`);
}
async function saveProfile() {
  const name = $('#ep_name').value.trim();
  if (!name) { toast('Name is required.'); return; }
  try {
    await updateProfile({ name, bio: $('#ep_bio').value.trim(), birthday: $('#ep_bday').value || null });
    closeModal(); renderApp(); toast('Profile updated.');
  } catch (e) { err(e); }
}

/* ---------------- Friends / Search ---------------- */
async function friendsHTML() {
  const others = await getUsersList();
  return `<div class="card"><h3>People you may know</h3><div class="people-grid">
    ${others.map(u => {
      const f = S.followingCache.includes(u.id);
      return `<div class="person">${pav(u, 64)}<b>${esc(u.name)}</b>
        <div class="muted">${esc(u.bio || '')}</div>
        <button class="${f ? 'btn-ghost' : 'btn-primary'}" onclick="toggleFollowUI2('${u.id}',this)">${f ? 'Following' : 'Follow'}</button></div>`;
    }).join('') || '<div class="muted">No other users yet — invite friends!</div>'}
  </div></div>`;
}
async function toggleFollowUI2(uidv, btn) {
  try {
    const nowFollowing = await toggleFollow(uidv);
    S.followingCache = await followingIds();
    btn.className = nowFollowing ? 'btn-ghost' : 'btn-primary';
    btn.textContent = nowFollowing ? 'Following' : 'Follow';
  } catch (e) { err(e); }
}
async function searchHTML() {
  const { users, posts } = await searchAll(S.query);
  cachePosts(posts);
  return `<div class="card"><h3>Results for "${esc(S.query)}"</h3>
    ${users.length ? `<div class="side-title">People</div>` + users.map(u =>
      `<button class="contact" onclick="openProfile('${u.id}')">${pav(u, 40)}<span><b>${esc(u.name)}</b><br><span class="muted">${esc(u.bio || '')}</span></span></button>`).join('') : ''}
    ${posts.length ? `<div class="side-title" style="margin-top:12px">Posts</div></div><div style="margin-top:14px">${postsHTML(posts)}</div>`
                   : (users.length ? '</div>' : `</div><div class="card empty" style="margin-top:14px">No results found.</div>`)}
  `;
}

/* ---------------- Notifications ---------------- */
async function toggleNotif(e) {
  e.stopPropagation();
  const dd = $('#dropdown');
  if (S.openMenu === 'notif') { dd.innerHTML = ''; S.openMenu = null; return; }
  S.openMenu = 'notif';
  const r = e.currentTarget.getBoundingClientRect();
  let items = [];
  try { items = await getNotifications(); } catch (e2) { console.error(e2); }
  const icons = { like: '👍', comment: '💬', follow: '👥' };
  dd.innerHTML = `<div class="menu notif-menu" style="top:${r.bottom + 6}px;right:${Math.max(8, window.innerWidth - r.right - 200)}px">
    <div class="notif-head"><b>Notifications</b>
      <button class="mini" style="float:right" onclick="markAllRead(event)">Mark all read</button></div>
    ${items.length ? items.map(n => `
      <div class="notif ${n.read ? '' : 'unread'}">${pav(n.actor, 40)}
        <div>${icons[n.type] || '🔔'} <b>${esc(n.actor.name)}</b> ${esc((n.message || '').replace(n.actor.name, '').trim()) || n.type}
        <div class="muted">${timeAgo(n.created_at)}</div></div>
      </div>`).join('') : '<div class="notif muted">No notifications yet.</div>'}
  </div>`;
  markNotifsRead().then(refreshNotifBadge).catch(() => {});
}
async function markAllRead(e) {
  e.stopPropagation();
  await markNotifsRead(); refreshNotifBadge();
  $('#dropdown').innerHTML = ''; S.openMenu = null; toast('All caught up!');
}

/* ---------------- Maintenance ---------------- */
function renderMaintenance() {
  const st = S.settings || { site_name: 'FaceClone' };
  document.getElementById('root').innerHTML = `
    <div class="maint"><div class="brand-big">${esc(st.site_name)}</div>
    <h2>We'll be back soon 🛠️</h2><p class="muted">The site is under maintenance. Please check back later.</p>
    <div class="auth-link"><a href="admin.html">Admin login</a></div></div>`;
}

document.addEventListener('DOMContentLoaded', boot);
