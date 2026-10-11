/* ============================================================
   FaceClone — Admin Panel (Supabase + realtime)
   Login with any account that has is_admin=true in profiles.
   ============================================================ */
const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
let TAB = 'dashboard';
let userQuery = '';
let rtChannels = [];

function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2400);
}
function err(e) { console.error(e); toast(e.message || 'Something went wrong.'); }
function teardownRealtime() { rtChannels.forEach(ch => { try { sb.removeChannel(ch); } catch (e) {} }); rtChannels = []; }

async function boot() {
  document.body.classList.add('admin-body');
  if (!supabaseConfigured()) {
    $('#root').innerHTML = `<div class="a-login-wrap"><div class="a-login-card">
      <div class="a-brand">FaceClone <span>Admin</span></div>
      <p class="muted">⚙️ Supabase is not configured yet. Add your Project URL + anon key to <b>assets/js/config.js</b>.</p>
      <div class="auth-link"><a href="index.html">← Back to site</a></div></div></div>`;
    return;
  }
  try { await bootSession(); } catch (e) { console.error(e); }
  try { await getSettings(); }
  catch (e) {
    if (e.code === '42P01' || /relation[^]*does not exist/i.test(e.message || '')) {
      $('#root').innerHTML = `<div class="a-login-wrap"><div class="a-login-card">
        <div class="a-brand">FaceClone <span>Admin</span></div>
        <p class="muted">🗄️ Supabase connect hoyeche kintu tables toiri hoyni.<br>
        <b>SQL Editor</b>-e <b>supabase/schema.sql</b> run koro, tarpor reload dao.</p>
        <div class="auth-link"><a href="index.html">← Back to site</a></div></div></div>`;
      return;
    }
  }
  if (ME && !ME.banned && ME.is_admin) renderPanel();
  else renderLogin();
}

/* ---------------- Login ---------------- */
function renderLogin() {
  const st = { site_name: 'FaceClone' };
  $('#root').innerHTML = `
  <div class="a-login-wrap">
    <div class="a-login-card">
      <div class="a-brand">${esc(st.site_name)} <span>Admin</span></div>
      <p class="muted">Sign in with an admin account</p>
      <input id="a_email" class="inp" type="email" placeholder="Admin email" autocomplete="username">
      <input id="a_pass" class="inp" type="password" placeholder="Password" onkeydown="if(event.key==='Enter')doAdminLogin()" autocomplete="current-password">
      <button class="btn-primary" id="a_btn" onclick="doAdminLogin()">Log in</button>
      <div class="demo-note">Use an account with <b>is_admin = true</b>.<br>
        First time? Sign up on the site, then run in SQL Editor:<br>
        <code>update profiles set is_admin = true where email = 'you@example.com';</code></div>
      <div class="auth-link"><a href="index.html">← Back to site</a></div>
    </div>
  </div>`;
}
async function doAdminLogin() {
  const btn = $('#a_btn'); btn.disabled = true; btn.textContent = 'Checking...';
  try {
    await signIn($('#a_email').value.trim(), $('#a_pass').value);
    if (!ME.is_admin) { await signOut(); throw new Error('This account is not an admin.'); }
    renderPanel();
  } catch (e) { err(e); btn.disabled = false; btn.textContent = 'Log in'; }
}
async function adminLogout() {
  teardownRealtime();
  await signOut();
  renderLogin();
}

/* ---------------- Shell ---------------- */
const TABS = [
  ['dashboard', '📊 Dashboard'], ['users', '👥 Users'], ['posts', '📰 Posts'],
  ['reports', '🚩 Reports'], ['settings', '⚙️ Settings'],
];
let openReportCount = 0;
function qTimeoutTop(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
}
function renderPanel() {
  teardownRealtime();
  document.title = 'Admin — FaceClone';
  $('#root').innerHTML = `
  <div class="a-shell">
    <aside class="a-side">
      <div class="a-brand">FaceClone <span>Admin</span> <span class="live-tag">● LIVE</span></div>
      <nav id="a_nav"></nav>
      <div class="a-side-foot">
        <button class="a-nav" onclick="location.href='index.html'">🌐 View site</button>
        <button class="a-nav" onclick="adminLogout()">🚪 Log out</button>
      </div>
    </aside>
    <div class="a-main">
      <div class="a-top"><h2 id="a_title"></h2>
        <div class="a-admin">${pav(ME, 32)}<span>${esc(ME.name)}</span></div>
      </div>
      <div class="a-content" id="a_content"><div class="a-card">Loading...</div></div>
    </div>
  </div>`;
  goTab(TAB || 'dashboard');
}
async function goTab(id) {
  TAB = id;
  teardownRealtime();
  const stats = await qTimeoutTop(adminStats(), 15000).catch(() => ({ openReports: 0 }));
  openReportCount = stats.openReports || 0;
  $('#a_nav').innerHTML = TABS.map(([tid, label]) =>
    `<button class="a-nav ${TAB === tid ? 'active' : ''}" onclick="goTab('${tid}')">${label}
     ${tid === 'reports' && openReportCount ? `<span class="a-pill">${openReportCount}</span>` : ''}</button>`).join('');
  $('#a_title').textContent = TABS.find(t => t[0] === TAB)[1];
  await renderTab();
  // realtime: refresh current tab on relevant changes
  const reload = debounce(() => renderTab(true), 900);
  rtChannels.push(onTable('reports', reload));
  rtChannels.push(onTable('profiles', (payload) => {
    const row = (payload && (payload.new || payload.old)) || {};
    if (row.id && ME && row.id === ME.id && payload.new) {
      ME.avatar_url = payload.new.avatar_url;
      ME.name = payload.new.name;
      const ah = document.querySelector('.a-admin');
      if (ah) ah.innerHTML = `${pav(ME, 32)}<span>${esc(ME.name)}</span>`;
    }
    reload();
  }));
  rtChannels.push(onTable('posts', reload));
}
async function renderTab(soft) {
  const c = $('#a_content');
  if (!c) return;
  try {
    if (TAB === 'dashboard') c.innerHTML = await dashHTML();
    else if (TAB === 'users') c.innerHTML = await usersHTML();
    else if (TAB === 'posts') c.innerHTML = await postsHTML();
    else if (TAB === 'reports') c.innerHTML = await reportsHTML();
    else if (TAB === 'settings') c.innerHTML = await settingsHTML();

  } catch (e) {
    console.error(e);
    if (!soft) {
      c.innerHTML = `<div class="a-card"><h3>Couldn't load this tab</h3>
        <p class="muted">${esc(e.message || 'Unknown error')}</p>
        <button class="btn-primary" onclick="renderTab()">Retry</button></div>`;
    }
  }
}

/* ---------------- Dashboard ---------------- */
async function dashHTML() {
  // Render skeleton instantly; data fills in async (never blocks on slow queries)
  setTimeout(fillDashboard, 50);
  const icons = ['\u{1F465}', '\u{1F4F0}', '\u{1F4AC}', '\u{1F44D}', '\u{1F6A9}'];
  const labels = ['Total users', 'Total posts', 'Comments', 'Likes', 'Open reports'];
  return `
  <div class="stat-grid">${icons.map((ico, i) =>
    `<div class="stat"><div class="stat-ico">${ico}</div><div class="stat-n" id="dstat${i}">\u2026</div><div class="stat-l">${labels[i]}</div></div>`).join('')}
  </div>
  <div class="a-row">
    <div class="a-card grow"><h3>Posts \u2014 last 7 days <span class="live-tag">\u25CF LIVE</span></h3><canvas id="chart" width="520" height="220"></canvas><div class="muted" id="dchartmsg" style="font-size:12px"></div></div>
    <div class="a-card grow"><h3>Recent posts</h3><div id="drecent"><div class="muted">Loading...</div></div></div>
  </div>`;
}
async function fillDashboard() {
  try {
    const s = await qTimeoutTop(adminStats(), 15000);
    [s.users, s.posts, s.comments, s.likes, s.openReports].forEach((v, i) => {
      const el = $('#dstat' + i); if (el) el.textContent = (v ?? 0);
    });
  } catch (e) { console.error('stats failed:', e); }
  try { drawChart(await qTimeoutTop(adminPostsPerDay(), 15000)); }
  catch (e) { const m = $('#dchartmsg'); if (m) m.textContent = 'Chart unavailable.'; console.error('chart failed:', e); }
  try {
    const recent = (await qTimeoutTop(adminGetPosts(), 15000)).slice(0, 5);
    const box = $('#drecent');
    if (box) box.innerHTML = recent.map(p => `
      <div class="recent-row">${pav(p.author, 32)}
        <div><b>${esc(p.author.name)}</b><div class="muted">${esc((p.text || '(photo post)').slice(0, 70))} \u00B7 ${timeAgo(p.created_at)}</div></div>
      </div>`).join('') || '<div class="muted">No posts yet.</div>';
  } catch (e) {
    const box = $('#drecent'); if (box) box.innerHTML = '<div class="muted">Failed to load posts.</div>';
    console.error('recent failed:', e);
  }
}
function drawChart(days) {
  const cv = $('#chart'); if (!cv || !days) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height, pad = 34;
  const max = Math.max(...days.map(d => d.count), 1);
  ctx.clearRect(0, 0, W, H);
  const bw = (W - pad * 2) / 7;
  days.forEach((d, i) => {
    const h = (H - pad * 2 - 20) * (d.count / max);
    const x = pad + i * bw + bw * 0.2, y = H - pad - h;
    ctx.fillStyle = '#1877F2';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, bw * 0.6, Math.max(h, 2), 4); else ctx.rect(x, y, bw * 0.6, Math.max(h, 2));
    ctx.fill();
    ctx.fillStyle = '#65676B'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(d.label, x + bw * 0.3, H - pad + 14);
    if (d.count) ctx.fillText(d.count, x + bw * 0.3, y - 6);
  });
}

/* ---------------- Users ---------------- */
async function usersHTML() {
  const users = await adminGetUsers();
  return `
  <div class="a-card">
    <div class="a-toolbar">
      <input class="inp" style="max-width:280px" placeholder="Search users..." value="${esc(userQuery)}"
        oninput="userQuery=this.value;refreshUsersTable()">
      <span class="muted">${users.length} users · <span class="live-tag">● LIVE</span></span>
    </div>
    <div class="tbl-wrap"><table class="tbl" id="usersTbl"><thead><tr>
      <th>User</th><th>Email</th><th>Joined</th><th>Posts</th><th>Status</th><th>Actions</th>
    </tr></thead><tbody>${usersRows(filterUsers(users))}</tbody></table></div>
  </div>`;
}
let _allUsers = [];
function filterUsers(users) {
  _allUsers = users;
  const q = userQuery.toLowerCase();
  return users.filter(u => !q || u.name.toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q));
}
function refreshUsersTable() {
  $('#usersTbl tbody').innerHTML = usersRows(filterUsers(_allUsers));
}
function usersRows(users) {
  return users.map(u => `<tr>
      <td><div class="cell-user">${pav(u, 32)}<b>${esc(u.name)}</b>${u.is_admin ? ' <span class="tag admin-tag">ADMIN</span>' : ''}</div></td>
      <td class="muted">${esc(u.email || '')}</td>
      <td class="muted">${new Date(u.created_at).toLocaleDateString()}</td>
      <td>${u.postCount}</td>
      <td>${u.banned ? '<span class="tag ban-tag">BANNED</span>' : '<span class="tag ok-tag">ACTIVE</span>'}</td>
      <td class="actions">
        <button class="mini" onclick="toggleBan('${u.id}',${u.banned})">${u.banned ? 'Unban' : 'Ban'}</button>
        <button class="mini" onclick="toggleAdmin('${u.id}',${u.is_admin})">${u.is_admin ? 'Demote' : 'Make admin'}</button>
        <button class="mini danger" onclick="wipeUser('${u.id}','${esc(u.name).replace(/'/g, "\\'")}')">Delete</button>
      </td></tr>`).join('');
}
async function toggleBan(id, banned) {
  if (id === ME.id) { toast("You can't ban yourself."); return; }
  try { await adminSetUser(id, { banned: !banned }); toast(banned ? 'User unbanned.' : 'User banned.'); }
  catch (e) { err(e); }
}
async function toggleAdmin(id, isAdmin) {
  if (id === ME.id && isAdmin) { toast("You can't demote yourself."); return; }
  try { await adminSetUser(id, { is_admin: !isAdmin }); toast(isAdmin ? 'Admin revoked.' : 'User is now an admin.'); }
  catch (e) { err(e); }
}
async function wipeUser(id, name) {
  if (id === ME.id) { toast("You can't delete yourself."); return; }
  if (!confirm(`Delete ALL content of ${name} and ban them? (Their login stays in Auth.)`)) return;
  try { await adminWipeUser(id); toast('User wiped + banned.'); renderTab(); }
  catch (e) { err(e); }
}

/* ---------------- Posts ---------------- */
async function postsHTML() {
  const posts = await adminGetPosts();
  return `<div class="a-card"><div class="a-toolbar"><span class="muted">${posts.length} posts · <span class="live-tag">● LIVE</span></span></div>
  <div class="tbl-wrap"><table class="tbl"><thead><tr>
    <th>Post</th><th>Author</th><th>Likes</th><th>Comments</th><th>Date</th><th>Actions</th>
  </tr></thead><tbody>
  ${posts.map(p => `<tr>
    <td><div class="post-cell">${p.pinned ? '<span class="tag pin-tag2">PINNED</span> ' : ''}${esc((p.text || (p.image_url ? '[photo]' : '[shared]')).slice(0, 80))}</div></td>
    <td><div class="cell-user">${pav(p.author, 28)}${esc(p.author.name)}</div></td>
    <td>${p.likeCount}</td><td>${(p.comments || []).length}</td>
    <td class="muted">${fullDate(p.created_at)}</td>
    <td class="actions">
      <button class="mini" onclick="togglePin('${p.id}',${p.pinned})">${p.pinned ? 'Unpin' : 'Pin'}</button>
      <button class="mini danger" onclick="adminDeletePost('${p.id}')">Delete</button>
    </td></tr>`).join('') || '<tr><td colspan="6" class="muted">No posts.</td></tr>'}
  </tbody></table></div></div>`;
}
async function togglePin(id, pinned) {
  try { await setPinned(id, !pinned); toast(pinned ? 'Post unpinned.' : 'Post pinned to top.'); }
  catch (e) { err(e); }
}
async function adminDeletePost(id) {
  if (!confirm('Delete this post?')) return;
  try { await deletePost(id); toast('Post deleted.'); }
  catch (e) { err(e); }
}

/* ---------------- Reports ---------------- */
async function reportsHTML() {
  const rs = await adminGetReports();
  return `<div class="a-card"><div class="a-toolbar"><span class="muted">${rs.filter(r => r.status === 'open').length} open · <span class="live-tag">● LIVE</span></span></div>
    ${rs.length ? rs.map(r => `
      <div class="report ${r.status}">
        <div><b>${esc(r.reporter.name)}</b> reported ${r.post ? `<b>${esc(r.post.author.name)}</b>'s post` : 'a deleted post'}
          <span class="tag">${esc(r.reason)}</span>
          <div class="muted">${r.post ? '“' + esc((r.post.text || '[photo post]').slice(0, 120)) + '”' : '(post deleted)'} · ${timeAgo(r.created_at)}</div>
        </div>
        ${r.status === 'open' ? `<div class="actions">
          <button class="mini" onclick="resolveReport('${r.id}')">Dismiss</button>
          ${r.post ? `<button class="mini danger" onclick="reportDeletePost('${r.id}','${r.post.id}')">Delete post</button>
          <button class="mini danger" onclick="reportBanAuthor('${r.id}','${r.post.author_id || ''}')">Ban author</button>` : ''}
        </div>` : '<span class="tag ok-tag">RESOLVED</span>'}
      </div>`).join('') : '<div class="muted">No reports. 🎉</div>'}
  </div>`;
}
async function resolveReport(id) {
  try { await adminResolveReport(id, 'resolved'); toast('Report dismissed.'); }
  catch (e) { err(e); }
}
async function reportDeletePost(rid, pid) {
  if (!confirm('Delete the reported post?')) return;
  try { await deletePost(pid); await adminResolveReport(rid, 'resolved'); toast('Post deleted.'); }
  catch (e) { err(e); }
}
async function reportBanAuthor(rid, authorId) {
  if (!authorId) return;
  if (!confirm('Ban this author?')) return;
  try { await adminSetUser(authorId, { banned: true }); await adminResolveReport(rid, 'resolved'); toast('Author banned.'); }
  catch (e) { err(e); }
}

/* ---------------- Settings ---------------- */
async function settingsHTML() {
  const st = await getSettings();
  return `<div class="a-row">
  <div class="a-card grow"><h3>General</h3>
    <label class="lbl">Site name</label>
    <input id="s_name" class="inp" value="${esc(st.site_name)}">
    <label class="lbl">Tagline</label>
    <input id="s_tag" class="inp" value="${esc(st.tagline || '')}">
    <label class="check"><input type="checkbox" id="s_reg" ${st.reg_open ? 'checked' : ''}> Allow new registrations</label>
    <label class="check"><input type="checkbox" id="s_maint" ${st.maintenance ? 'checked' : ''}> Maintenance mode (visitors see a notice)</label>
    <button class="btn-primary" style="margin-top:12px" onclick="saveSiteSettings()">Save settings</button>
  </div>
  <div class="a-card grow"><h3>Demo content</h3>
    <p class="muted">Insert 8 demo posts under your admin account.</p>
    <button class="btn-ghost" onclick="seedDemo()">Insert demo posts</button>
    <h3 style="margin-top:24px">Danger zone</h3>
    <p class="muted">Delete every post on the site. Users stay.</p>
    <button class="mini danger" onclick="wipeAllPosts()">Delete all posts</button>
  </div></div>`;
}
async function saveSiteSettings() {
  try {
    await saveSettings({
      site_name: $('#s_name').value.trim() || 'FaceClone',
      tagline: $('#s_tag').value.trim(),
      reg_open: $('#s_reg').checked,
      maintenance: $('#s_maint').checked,
    });
    toast('Settings saved.');
  } catch (e) { err(e); }
}
async function seedDemo() {
  if (!confirm('Insert 8 demo posts as yourself?')) return;
  try { await seedDemoPosts(); toast('Demo posts added — watch the feed update live!'); }
  catch (e) { err(e); }
}
async function wipeAllPosts() {
  if (!confirm('Delete EVERY post on the site? This cannot be undone.')) return;
  if (!confirm('Really sure? Type OK mentally and click OK 😅')) return;
  try {
    const posts = await adminGetPosts();
    for (const p of posts) { /* eslint-disable-next-line no-await-in-loop */ await deletePost(p.id); }
    toast('All posts deleted.');
  } catch (e) { err(e); }
}

document.addEventListener('DOMContentLoaded', boot);
