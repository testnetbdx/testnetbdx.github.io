/* ============================================================
   CinePlay — admin panel (GitHub-as-database edition)
   No backend, no server bill — 100% free forever.
   The catalog lives in cineplay/data/movies.json in the GitHub
   repo; this panel reads/writes it through the GitHub Contents
   API using a personal access token that lives ONLY in
   sessionStorage (never in code, never committed).
   ============================================================ */

const TOKEN_KEY = 'cineplay_gh_token';
const CFG_KEY = 'cineplay_gh_cfg';

let gh = null;          // { token, owner, repo, branch }
let movies = [];
let moviesSha = null;   // SHA of data/movies.json (null = file doesn't exist yet)
let activeVtab = 'device';
let busy = false;

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

function showLoginError(msg) {
  const e = $('#loginError');
  e.textContent = msg;
  e.classList.add('show');
}
function showFormError(msg) {
  const e = $('#formError');
  e.textContent = msg;
  e.classList.add('show');
  e.scrollIntoView({ block: 'nearest' });
}
function clearFormError() { $('#formError').classList.remove('show'); }

/* ---------------- GitHub API ---------------- */
function ghHeaders() {
  return {
    'Authorization': 'Bearer ' + gh.token,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

async function ghApi(path, opts = {}) {
  const res = await fetch('https://api.github.com' + path, {
    ...opts,
    headers: { ...ghHeaders(), ...(opts.headers || {}) }
  });
  if (!res.ok) {
    let msg = 'GitHub API error ' + res.status;
    try { const j = await res.json(); if (j && j.message) msg = j.message; } catch (_) { /* ignore */ }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

function repoPath(p) {
  return `/repos/${gh.owner}/${gh.repo}/contents/${p}`;
}

/* base64 with proper UTF-8 handling (GitHub returns wrapped base64) */
function b64encodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64decodeUtf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* ---------------- Cloudinary (device video upload) ----------------
   Unsigned upload straight to Cloudinary — no backend needed.
   Cloud name + unsigned preset are public-safe values, but they stay
   in the admin's localStorage only (never in the repo). */
const CLOUD_NAME_KEY = 'cineplay_cloud_name';
const PRESET_KEY = 'cineplay_upload_preset';
const CLOUDINARY_MAX_BYTES = 100 * 1024 * 1024; // free plan cap per video

let cloudCfg = { name: '', preset: '' };
let deviceVideoUrl = '';

function loadCloudCfg() {
  cloudCfg.name = localStorage.getItem(CLOUD_NAME_KEY) || '';
  cloudCfg.preset = localStorage.getItem(PRESET_KEY) || '';
  $('#cloudName').value = cloudCfg.name;
  $('#uploadPreset').value = cloudCfg.preset;
  updateCloudStatus();
}

function updateCloudStatus() {
  const ok = !!(cloudCfg.name && cloudCfg.preset);
  const el = $('#cloudStatus');
  el.textContent = ok ? '✓ Ready for device uploads' : '— not configured yet';
  el.style.color = ok ? '#46d369' : '#999';
}

function saveCloudCfg() {
  cloudCfg.name = $('#cloudName').value.trim();
  cloudCfg.preset = $('#uploadPreset').value.trim();
  localStorage.setItem(CLOUD_NAME_KEY, cloudCfg.name);
  localStorage.setItem(PRESET_KEY, cloudCfg.preset);
  updateCloudStatus();
  toast('Cloudinary settings saved ✓');
}

/* Uploads a video file to Cloudinary (unsigned). Resolves with the
   video's secure_url, which is stored as a "direct" video URL. */
function uploadDeviceVideo(file) {
  return new Promise((resolve, reject) => {
    if (!cloudCfg.name || !cloudCfg.preset) {
      reject(new Error('Cloudinary is not configured — save your Cloud name + upload preset in the Cloudinary settings card first.'));
      return;
    }
    if (file.size > CLOUDINARY_MAX_BYTES) {
      reject(new Error('This video is over 100MB (Cloudinary free limit). Compress it first, or upload it as Unlisted to YouTube and use the YouTube tab — unlimited and free.'));
      return;
    }
    const wrap = $('#videoProgressWrap');
    const bar = $('#videoProgressBar');
    const label = $('#videoUploadStatus');
    wrap.classList.add('show');
    bar.style.width = '4%';
    label.textContent = 'Uploading… 0%';

    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://api.cloudinary.com/v1_1/' + encodeURIComponent(cloudCfg.name) + '/video/upload');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', cloudCfg.preset);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        const pct = Math.round((ev.loaded / ev.total) * 100);
        bar.style.width = pct + '%';
        label.textContent = 'Uploading… ' + pct + '%';
      }
    };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (_) { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300 && data && data.secure_url) {
        bar.style.width = '100%';
        label.textContent = 'Upload complete ✓';
        setTimeout(() => wrap.classList.remove('show'), 1500);
        resolve(data.secure_url);
      } else {
        wrap.classList.remove('show');
        const msg = (data && data.error && data.error.message)
          ? data.error.message
          : 'Upload failed (HTTP ' + xhr.status + ')';
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => {
      wrap.classList.remove('show');
      reject(new Error('Network error during upload — check your connection and try again.'));
    };
    xhr.send(fd);
  });
}

async function onDeviceFilePicked() {
  const input = $('#fVideoDevice');
  const file = input.files && input.files[0];
  if (!file) return;
  clearFormError();
  try {
    deviceVideoUrl = await uploadDeviceVideo(file);
    const done = $('#deviceVideoDone');
    done.style.display = 'block';
    done.textContent = '✓ Uploaded: ' + deviceVideoUrl;
    toast('Video uploaded ✓');
  } catch (e) {
    deviceVideoUrl = '';
    input.value = '';
    showFormError(e.message || String(e));
  }
}

/* ---------------- Connect / disconnect ---------------- */
function showLogin() {
  $('#loginView').style.display = 'flex';
  $('#dashView').style.display = 'none';
  $('#logoutBtn').style.display = 'none';
}
function showDashboard() {
  $('#loginView').style.display = 'none';
  $('#dashView').style.display = 'block';
  $('#logoutBtn').style.display = 'inline-block';
}

function readStoredCreds() {
  try {
    const token = sessionStorage.getItem(TOKEN_KEY);
    const cfg = JSON.parse(sessionStorage.getItem(CFG_KEY) || '{}');
    if (token && cfg.owner && cfg.repo) {
      return { token, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch || 'main' };
    }
  } catch (_) { /* ignore */ }
  return null;
}

async function doConnect(ev, silent) {
  if (ev) ev.preventDefault();
  if (busy) return;
  busy = true;
  const btn = $('#loginBtn');
  $('#loginError').classList.remove('show');

  const token = $('#ghToken').value.trim();
  const owner = $('#ghOwner').value.trim() || 'testnetbdx';
  const repo = $('#ghRepo').value.trim() || 'testnetbdx.github.io';
  const branch = $('#ghBranch').value.trim() || 'main';

  if (!token) {
    if (!silent) showLoginError('Paste your GitHub token first.');
    busy = false;
    return;
  }

  gh = { token, owner, repo, branch };
  btn.disabled = true;
  btn.textContent = 'Connecting…';
  try {
    const info = await ghApi(`/repos/${owner}/${repo}`);
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(CFG_KEY, JSON.stringify({ owner, repo, branch }));
    showDashboard();
    toast('Connected to ' + info.full_name + ' ✓');
    await loadMovies();
  } catch (e) {
    gh = null;
    showLogin();
    if (!silent) {
      showLoginError('Connect failed: ' + e.message +
        '. Check that the token is correct and has Contents: Read and write on this repo.');
    }
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = 'Connect';
  }
}

function doDisconnect() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(CFG_KEY);
  gh = null;
  movies = [];
  moviesSha = null;
  $('#ghToken').value = '';
  showLogin();
  toast('Disconnected — token cleared from this browser.');
}

/* ---------------- Catalog: load / save ---------------- */
function renderDashboard() {
  $('#statTotal').textContent = movies.length;
  $('#statFeatured').textContent = movies.filter((m) => m.is_featured).length;
  $('#statTrending').textContent = movies.filter((m) => m.is_trending).length;

  const tbody = $('#moviesTbody');
  if (!movies.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No movies yet — click <b>+ Add Movie</b> to add your first title. 🎬</td></tr>';
    return;
  }
  tbody.innerHTML = movies.map((m) => `
    <tr>
      <td>${m.poster_url ? `<img class="m-thumb" src="${esc(m.poster_url)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</td>
      <td><div class="m-title">${esc(m.title)}</div><div class="m-sub">${m.duration ? esc(m.duration) + ' • ' : ''}${m.rating != null ? '★ ' + esc(m.rating) : ''}</div></td>
      <td>${m.year ? esc(m.year) : '—'}</td>
      <td>${esc(m.genre || '—')}</td>
      <td>${m.is_featured ? '<span class="badge feat">Featured</span>' : ''}${m.is_trending ? '<span class="badge trend">Trending</span>' : ''}</td>
      <td><div class="row-actions">
        <button class="btn-small" data-edit="${esc(m.id)}">Edit</button>
        <button class="btn-danger" data-del="${esc(m.id)}">Delete</button>
      </div></td>
    </tr>`).join('');
}

async function loadMovies() {
  const tbody = $('#moviesTbody');
  tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Loading…</td></tr>';
  try {
    const data = await ghApi(repoPath('cineplay/data/movies.json') + `?ref=${encodeURIComponent(gh.branch)}`);
    moviesSha = data.sha;
    const parsed = JSON.parse(b64decodeUtf8(data.content));
    movies = Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    if (e.status === 404) {
      // first run — the data file doesn't exist yet; it will be created on first save
      movies = [];
      moviesSha = null;
    } else {
      tbody.innerHTML = `<tr><td colspan="6" class="table-empty">Could not load movies: ${esc(e.message)}</td></tr>`;
      return;
    }
  }
  renderDashboard();
}

/* PUT the whole catalog. On a 409 (SHA changed underneath us),
   refetch the SHA once and retry — our write wins. */
async function saveMoviesJson(message, retried = false) {
  const content = b64encodeUtf8(JSON.stringify(movies, null, 2) + '\n');
  const payload = { message, content, branch: gh.branch };
  if (moviesSha) payload.sha = moviesSha;
  try {
    const res = await ghApi(repoPath('cineplay/data/movies.json'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    moviesSha = res.content.sha;
  } catch (e) {
    if (e.status === 409 && !retried) {
      const data = await ghApi(repoPath('cineplay/data/movies.json') + `?ref=${encodeURIComponent(gh.branch)}`);
      moviesSha = data.sha;
      return saveMoviesJson(message, true);
    }
    throw e;
  }
}

async function deleteMovie(id) {
  const m = movies.find((x) => x.id === id);
  if (!m) return;
  if (!confirm(`Delete "${m.title}"?\n\nThis removes it from the site. This cannot be undone.`)) return;
  movies = movies.filter((x) => x.id !== id);
  try {
    await saveMoviesJson(`CinePlay: delete "${m.title}"`);
    toast('Movie deleted ✓ — site-e ~1 min-e update hobe');
    renderDashboard();
  } catch (e) {
    toast('Delete failed: ' + e.message);
    await loadMovies(); // restore the server state
  }
}

/* ---------------- Add / Edit form ---------------- */
function setVtab(name) {
  activeVtab = name;
  $$('.vtab').forEach((b) => b.classList.toggle('active', b.dataset.vtab === name));
  $$('.vpanel').forEach((p) => p.classList.toggle('active', p.id === 'vtab-' + name));
}

function previewImg(input, urlInput, imgEl) {
  const file = input.files && input.files[0];
  const url = urlInput.value.trim();
  if (file) {
    imgEl.src = URL.createObjectURL(file);
    imgEl.classList.add('show');
  } else if (url) {
    imgEl.src = url;
    imgEl.classList.add('show');
  } else {
    imgEl.classList.remove('show');
    imgEl.removeAttribute('src');
  }
}

function openForm(movie) {
  clearFormError();
  $('#editingId').value = movie ? movie.id : '';
  $('#formTitle').textContent = movie ? 'Edit Movie' : 'Add Movie';
  $('#fTitle').value = movie ? movie.title || '' : '';
  $('#fDesc').value = movie ? movie.description || '' : '';
  $('#fYear').value = movie && movie.year ? movie.year : '';
  $('#fGenre').value = movie ? movie.genre || '' : '';
  $('#fRating').value = movie && movie.rating != null ? movie.rating : '';
  $('#fDuration').value = movie ? movie.duration || '' : '';
  $('#fPosterFile').value = '';
  $('#fBackdropFile').value = '';
  $('#fPosterUrl').value = movie ? movie.poster_url || '' : '';
  $('#fBackdropUrl').value = movie ? movie.backdrop_url || '' : '';
  $('#fVideoDirect').value = '';
  $('#fVideoYoutube').value = '';
  $('#fVideoEmbed').value = '';
  $('#fVideoDevice').value = '';
  deviceVideoUrl = '';
  $('#deviceVideoDone').style.display = 'none';
  $('#videoProgressWrap').classList.remove('show');
  $('#fFeatured').checked = !!(movie && movie.is_featured);
  $('#fTrending').checked = !!(movie && movie.is_trending);

  // restore the right video tab for edits (new movies start on the device tab)
  const vt = movie ? (movie.video_type || 'direct') : 'device';
  setVtab(['direct', 'youtube', 'embed', 'device'].includes(vt) ? vt : 'direct');
  if (movie && vt === 'direct') $('#fVideoDirect').value = movie.video_url || '';
  if (movie && vt === 'youtube') $('#fVideoYoutube').value = movie.video_url || '';
  if (movie && vt === 'embed') $('#fVideoEmbed').value = movie.video_url || '';

  previewImg($('#fPosterFile'), $('#fPosterUrl'), $('#posterPreview'));
  previewImg($('#fBackdropFile'), $('#fBackdropUrl'), $('#backdropPreview'));
  $('#movieModal').classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeForm() {
  $('#movieModal').classList.remove('show');
  document.body.style.overflow = '';
}

function sanitizedName(name) {
  return (String(name || 'file').toLowerCase().replace(/[^a-z0-9._-]/g, '_').slice(0, 80) || 'file');
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('Could not read file.'));
    r.readAsDataURL(file);
  });
}

/* Uploads an image into the repo (cineplay/posters/ or cineplay/backdrops/)
   and returns its GitHub Pages URL. */
async function uploadImage(kind, file) {
  const base64 = await readFileAsBase64(file);
  const name = Date.now() + '_' + sanitizedName(file.name);
  const path = `cineplay/${kind}/${name}`;
  await ghApi(repoPath(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `CinePlay: upload ${kind} image ${name}`,
      content: base64,
      branch: gh.branch
    })
  });
  return `https://${gh.owner}.github.io/cineplay/${kind}/${name}`;
}

function newId() {
  return 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function saveMovie() {
  clearFormError();
  const saveBtn = $('#saveMovieBtn');
  const title = $('#fTitle').value.trim();
  if (!title) { showFormError('Title is required.'); return; }

  const editingId = $('#editingId').value || null;
  const existing = editingId ? movies.find((m) => m.id === editingId) : null;

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  try {
    // ---- video source ----
    // "device" uploads to Cloudinary and is stored as a direct MP4 URL
    // (video files can't live in the repo, so no repo upload here).
    let video_url = '', video_type = activeVtab;
    if (activeVtab === 'device') {
      if (!deviceVideoUrl) throw new Error('Upload a video from your device first, or pick another tab.');
      video_url = deviceVideoUrl;
      video_type = 'direct';
    } else if (activeVtab === 'direct') {
      video_url = $('#fVideoDirect').value.trim();
      if (!video_url) throw new Error('Paste a direct MP4 URL.');
    } else if (activeVtab === 'youtube') {
      video_url = $('#fVideoYoutube').value.trim();
      if (!video_url) throw new Error('Paste a YouTube URL.');
    } else {
      video_url = $('#fVideoEmbed').value.trim();
      video_type = 'embed';
      if (!video_url) throw new Error('Paste an embed URL.');
    }

    // ---- poster / backdrop (file upload wins, else pasted URL, else existing) ----
    saveBtn.textContent = 'Uploading images…';
    let poster_url = $('#fPosterUrl').value.trim() || (existing ? existing.poster_url || '' : '');
    const pf = $('#fPosterFile').files[0];
    if (pf) poster_url = await uploadImage('posters', pf);

    let backdrop_url = $('#fBackdropUrl').value.trim() || (existing ? existing.backdrop_url || '' : '');
    const bf = $('#fBackdropFile').files[0];
    if (bf) backdrop_url = await uploadImage('backdrops', bf);

    const yearVal = parseInt($('#fYear').value, 10);
    const ratingVal = parseFloat($('#fRating').value);
    const now = new Date().toISOString();

    const row = {
      id: existing ? existing.id : newId(),
      title,
      description: $('#fDesc').value.trim(),
      year: Number.isFinite(yearVal) ? yearVal : null,
      genre: $('#fGenre').value.trim(),
      rating: Number.isFinite(ratingVal) ? Math.min(10, Math.max(0, ratingVal)) : null,
      duration: $('#fDuration').value.trim(),
      poster_url,
      backdrop_url,
      video_url,
      video_type,
      is_featured: $('#fFeatured').checked,
      is_trending: $('#fTrending').checked,
      created_at: existing ? (existing.created_at || now) : now
    };

    if (existing) {
      const i = movies.findIndex((m) => m.id === existing.id);
      movies[i] = row;
    } else {
      movies.unshift(row);
    }

    saveBtn.textContent = 'Saving catalog…';
    await saveMoviesJson(existing ? `CinePlay: update "${title}"` : `CinePlay: add "${title}"`);

    toast('Saved ✓ — site-e live hote ~1 min lagte pare');
    closeForm();
    renderDashboard();
  } catch (e) {
    showFormError(e.message || String(e));
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Movie';
  }
}

/* ---------------- Init ---------------- */
function init() {
  $('#loginForm').addEventListener('submit', (ev) => doConnect(ev, false));
  $('#logoutBtn').addEventListener('click', doDisconnect);
  $('#saveCloudBtn').addEventListener('click', saveCloudCfg);
  $('#fVideoDevice').addEventListener('change', onDeviceFilePicked);
  loadCloudCfg();

  $('#addMovieBtn').addEventListener('click', () => openForm(null));
  $('#cancelMovieBtn').addEventListener('click', closeForm);
  $('#movieModal').addEventListener('click', (e) => { if (e.target.id === 'movieModal') closeForm(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#movieModal').classList.contains('show')) closeForm();
  });
  $('#saveMovieBtn').addEventListener('click', saveMovie);

  $$('.vtab').forEach((b) => b.addEventListener('click', () => setVtab(b.dataset.vtab)));

  $('#fPosterFile').addEventListener('change', () =>
    previewImg($('#fPosterFile'), $('#fPosterUrl'), $('#posterPreview')));
  $('#fPosterUrl').addEventListener('input', () =>
    previewImg($('#fPosterFile'), $('#fPosterUrl'), $('#posterPreview')));
  $('#fBackdropFile').addEventListener('change', () =>
    previewImg($('#fBackdropFile'), $('#fBackdropUrl'), $('#backdropPreview')));
  $('#fBackdropUrl').addEventListener('input', () =>
    previewImg($('#fBackdropFile'), $('#fBackdropUrl'), $('#backdropPreview')));

  $('#moviesTbody').addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (edit) openForm(movies.find((m) => m.id === edit.dataset.edit));
    else if (del) deleteMovie(del.dataset.del);
  });

  // auto-connect if a token was saved earlier in this browser session
  const stored = readStoredCreds();
  if (stored) {
    $('#ghToken').value = stored.token;
    $('#ghOwner').value = stored.owner;
    $('#ghRepo').value = stored.repo;
    $('#ghBranch').value = stored.branch;
    doConnect(null, true);
  } else {
    showLogin();
  }
}

document.addEventListener('DOMContentLoaded', init);
