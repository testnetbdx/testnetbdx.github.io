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
let formShots = [];       // screenshot URLs for the movie being edited
let pendingShotFiles = []; // newly picked screenshot File objects (uploaded on save)

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

/* ---- quality + category helpers (backward compatible: old movies without these fields render fine) ---- */
const CATEGORY_LABELS = { 'movie': 'Movie', 'web-series': 'Web Series', 'anime': 'Anime', 'ott': 'OTT' };
function movieCategory(m) {
  const c = String((m && m.category) || 'movie').toLowerCase().trim();
  return CATEGORY_LABELS[c] ? c : 'movie';
}
function qualityList(m) {
  return m && Array.isArray(m.quality) ? m.quality.filter(Boolean) : [];
}

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
let deviceResult = { url: '', type: '' }; // result of the device tab: {url, type:'direct'|'youtube'}

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
    const url = await uploadDeviceVideo(file);
    deviceResult = { url, type: 'direct' };
    const done = $('#deviceVideoDone');
    done.style.display = 'block';
    done.textContent = '✓ Uploaded: ' + url;
    toast('Video uploaded ✓');
  } catch (e) {
    deviceResult = { url: '', type: '' };
    input.value = '';
    showFormError(e.message || String(e));
  }
}

/* ---------------- YouTube direct upload (OAuth2 PKCE + resumable) ----
   Uploads 3-10GB movie files straight from this panel to YouTube
   (Unlisted by default). Client ID/secret + tokens live ONLY in this
   browser's localStorage — never in the repo, never in code. */
const YT_CLIENT_KEY = 'cineplay_yt_client_id';
const YT_SECRET_KEY = 'cineplay_yt_client_secret';
const YT_TOKENS_KEY = 'cineplay_yt_tokens';
const YT_VERIFIER_KEY = 'cineplay_yt_verifier';
const YT_CHUNK = 8 * 1024 * 1024; // 8MB per chunk — must be a multiple of 256KB

let ytCfg = { clientId: '', clientSecret: '' };
let ytTokens = null;   // { access_token, refresh_token, expires_at }
let ytUpload = null;   // { file, uri, xhr, cancelled }
let activeDest = 'youtube';

/* ---------- settings ---------- */
function loadYtCfg() {
  ytCfg.clientId = localStorage.getItem(YT_CLIENT_KEY) || '';
  ytCfg.clientSecret = localStorage.getItem(YT_SECRET_KEY) || '';
  $('#ytClientId').value = ytCfg.clientId;
  $('#ytClientSecret').value = ytCfg.clientSecret;
  try { ytTokens = JSON.parse(localStorage.getItem(YT_TOKENS_KEY) || 'null'); }
  catch (_) { ytTokens = null; }
  updateYtStatus();
}
function saveYtCfg() {
  ytCfg.clientId = $('#ytClientId').value.trim();
  ytCfg.clientSecret = $('#ytClientSecret').value.trim();
  localStorage.setItem(YT_CLIENT_KEY, ytCfg.clientId);
  localStorage.setItem(YT_SECRET_KEY, ytCfg.clientSecret);
  updateYtStatus();
  toast('YouTube settings saved ✓');
}
function updateYtStatus() {
  const connected = !!(ytTokens && ytTokens.access_token);
  const el = $('#ytStatus');
  el.textContent = connected ? '✓ Connected to YouTube'
    : (ytCfg.clientId && ytCfg.clientSecret ? '— settings saved, not connected yet' : '— not configured yet');
  el.style.color = connected ? '#46d369' : '#999';
  $('#ytConnectBtn').style.display = connected ? 'none' : 'inline-block';
  $('#ytDisconnectBtn').style.display = connected ? 'inline-block' : 'none';
  updateYtNotConnected();
}
function ytDisconnect() {
  ytTokens = null;
  localStorage.removeItem(YT_TOKENS_KEY);
  updateYtStatus();
  toast('YouTube disconnected.');
}
function ytError(msg) {
  const e = $('#ytError');
  e.textContent = msg || '';
  e.classList.toggle('show', !!msg);
}

/* ---------- destination toggle (YouTube vs Cloudinary) ---------- */
function setDest(name) {
  activeDest = name;
  $$('.dest-btn').forEach((b) => b.classList.toggle('active', b.dataset.dest === name));
  $('#dest-youtube').style.display = name === 'youtube' ? 'block' : 'none';
  $('#dest-cloudinary').style.display = name === 'cloudinary' ? 'block' : 'none';
  updateYtNotConnected();
}
function updateYtNotConnected() {
  const el = $('#ytNotConnected');
  if (!el) return;
  el.style.display = (activeDest === 'youtube' && !(ytTokens && ytTokens.access_token)) ? 'block' : 'none';
}

/* ---------- PKCE ---------- */
function b64urlEncode(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function ytCodeChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64urlEncode(digest);
}
/* EXACT — this URL must be registered as an Authorized redirect URI in Google Cloud */
function ytRedirectUri() {
  return location.origin + location.pathname;
}

async function ytConnect() {
  ytError('');
  if (!ytCfg.clientId || !ytCfg.clientSecret) {
    ytError('Age Client ID + Client secret save koro, tarpor Connect chap dao.');
    return;
  }
  const verifierBytes = new Uint8Array(64);
  crypto.getRandomValues(verifierBytes);
  const verifier = b64urlEncode(verifierBytes);
  const challenge = await ytCodeChallenge(verifier);
  sessionStorage.setItem(YT_VERIFIER_KEY, verifier);
  const params = new URLSearchParams({
    client_id: ytCfg.clientId,
    redirect_uri: ytRedirectUri(),
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/youtube.upload',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent'
  });
  location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
}

/* Runs on every page load — completes the OAuth flow after Google
   redirects back with ?code= (or shows ?error=). */
async function handleYtCallback() {
  let qs;
  try { qs = new URLSearchParams(location.search); } catch (_) { return; }
  const err = qs.get('error');
  const code = qs.get('code');
  if (!err && !code) return;
  history.replaceState(null, '', location.pathname); // clean URL so reloads don't re-exchange
  if (err) {
    ytError(err === 'access_denied'
      ? 'Access denied — Google-e Allow chap dao, ar nijeke OAuth consent screen-er Test user hishebe add koro (ADMIN_SETUP.md dekho).'
      : 'YouTube connect failed: ' + err);
    return;
  }
  if (!ytCfg.clientId || !ytCfg.clientSecret) {
    ytError('Client ID/secret pawa jayni — age YouTube settings-e save koro, tarpor abar Connect koro.');
    return;
  }
  const verifier = sessionStorage.getItem(YT_VERIFIER_KEY);
  if (!verifier) {
    ytError('Session expired — abar Connect YouTube chap dao.');
    return;
  }
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: ytCfg.clientId,
        client_secret: ytCfg.clientSecret,
        redirect_uri: ytRedirectUri(),
        grant_type: 'authorization_code',
        code_verifier: verifier
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(ytTokenErrMsg(data, res.status));
    storeYtTokens(data);
    sessionStorage.removeItem(YT_VERIFIER_KEY);
    updateYtStatus();
    toast('YouTube connected ✓');
  } catch (e) {
    ytError('Token exchange failed: ' + (e.message || e));
  }
}

function ytTokenErrMsg(data, status) {
  const errCode = data && data.error ? String(data.error) : '';
  if (/redirect_uri_mismatch/i.test(errCode)) {
    return 'redirect_uri_mismatch — Google Cloud-e Authorized redirect URI EXACT "https://testnetbdx.github.io/cineplay/admin.html" hote hobe (kono trailing slash na).';
  }
  if (/invalid_grant/i.test(errCode)) return 'Code expired — abar Connect YouTube chap dao.';
  const desc = data && (data.error_description || data.error);
  return desc ? String(desc) : 'HTTP ' + status;
}

function storeYtTokens(data) {
  ytTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || (ytTokens && ytTokens.refresh_token) || '',
    expires_at: Date.now() + (data.expires_in || 3600) * 1000
  };
  localStorage.setItem(YT_TOKENS_KEY, JSON.stringify(ytTokens));
}

/* Returns a valid access token, refreshing silently when needed.
   Throws Error('not-connected') / Error('reconnect') — caller shows UI text. */
async function ytGetToken(forceRefresh = false) {
  if (!ytTokens || !ytTokens.access_token) throw new Error('not-connected');
  if (!forceRefresh && Date.now() < ytTokens.expires_at - 60000) return ytTokens.access_token;
  if (!ytTokens.refresh_token) throw new Error('reconnect');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: ytTokens.refresh_token,
      client_id: ytCfg.clientId,
      client_secret: ytCfg.clientSecret,
      grant_type: 'refresh_token'
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    // refresh token dead (testing-mode tokens expire after ~7 days)
    ytTokens = null;
    localStorage.removeItem(YT_TOKENS_KEY);
    updateYtStatus();
    throw new Error('reconnect');
  }
  storeYtTokens(data);
  return ytTokens.access_token;
}

/* ---------- resumable upload ---------- */
function fmtMB(b) { return (b / (1024 * 1024)).toFixed(1); }

function ytUiProgress(doneBytes, total) {
  const pct = Math.min(100, Math.round((doneBytes / total) * 100));
  $('#ytProgressBar').style.width = pct + '%';
  $('#ytUploadStatus').textContent = `Uploading… ${pct}% (${fmtMB(doneBytes)} / ${fmtMB(total)} MB)`;
}

async function ytUploadError(res, fallback) {
  let msg = `${fallback} (HTTP ${res.status})`;
  try {
    const d = await res.json();
    const reason = d && d.error && d.error.errors && d.error.errors[0] && d.error.errors[0].reason;
    if (reason === 'quotaExceeded') msg = 'YouTube API daily limit sesh (~6 ta video/day) — kal abar try koro.';
    else if (reason === 'uploadLimitExceeded') msg = 'YouTube upload limit exceeded — kal abar try koro.';
    else if (d && d.error && d.error.message) msg = d.error.message;
  } catch (_) { /* ignore */ }
  return new Error(msg);
}

async function ytStartUpload() {
  const input = $('#fVideoYtUpload');
  const file = input.files && input.files[0];
  if (!file) { showFormError('Age ekta video file select koro.'); return; }
  let token;
  try { token = await ytGetToken(); }
  catch (e) {
    showFormError(e.message === 'reconnect'
      ? 'YouTube session expired — dashboard-er YouTube settings theke abar Connect koro.'
      : 'YouTube connect kora nai — age dashboard-er YouTube settings theke Connect koro.');
    return;
  }
  const titleInput = $('#fYtTitle');
  if (!titleInput.value.trim()) {
    titleInput.value = $('#fTitle').value.trim() || file.name.replace(/\.[^.]+$/, '');
  }
  const title = titleInput.value.trim() || 'Untitled';
  const privacy = $('#fYtPrivacy').value || 'unlisted';
  const description = $('#fDesc').value.trim();

  $('#ytVideoDone').style.display = 'none';
  $('#ytProgressWrap').classList.add('show');
  $('#ytProgressBar').style.width = '2%';
  $('#ytUploadStatus').textContent = 'Starting upload session…';
  $('#ytCancelBtn').style.display = 'inline-block';
  $('#ytUploadBtn').disabled = true;
  clearFormError();
  ytUpload = { file, uri: null, xhr: null, cancelled: false };

  try {
    // Step 1 — open a resumable session (retry once on 401 with a forced refresh)
    let initRes = await ytInitSession(token, title, description, privacy, file);
    if (initRes.status === 401) {
      token = await ytGetToken(true);
      initRes = await ytInitSession(token, title, description, privacy, file);
    }
    if (!initRes.ok) throw await ytUploadError(initRes, 'Could not start YouTube upload');
    const uri = initRes.headers.get('Location');
    if (!uri) throw new Error('YouTube did not return an upload session — network issue, abar try koro.');
    ytUpload.uri = uri;

    // Step 2 — chunked upload (8MB chunks, resumable)
    const videoId = await ytPutChunks();
    const watchUrl = 'https://www.youtube.com/watch?v=' + videoId;
    deviceResult = { url: watchUrl, type: 'youtube' };
    $('#ytProgressBar').style.width = '100%';
    $('#ytUploadStatus').textContent = 'Upload complete ✓';
    const done = $('#ytVideoDone');
    done.style.display = 'block';
    done.textContent = '✓ Uploaded to YouTube: ' + watchUrl;
    toast('YouTube upload complete ✓');
  } catch (e) {
    if (ytUpload && ytUpload.cancelled) {
      $('#ytUploadStatus').textContent = 'Upload cancelled.';
    } else {
      showFormError(e.message || String(e));
      $('#ytProgressWrap').classList.remove('show');
    }
    deviceResult = { url: '', type: '' };
  } finally {
    ytUpload = null;
    $('#ytCancelBtn').style.display = 'none';
    $('#ytUploadBtn').disabled = false;
  }
}

function ytInitSession(token, title, description, privacy, file) {
  return fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': file.type || 'video/mp4',
      'X-Upload-Content-Length': String(file.size)
    },
    body: JSON.stringify({
      snippet: { title, description, categoryId: '22' },
      status: { privacyStatus: privacy }
    })
  });
}

/* PUTs the file in 8MB chunks. Resolves with the YouTube video id.
   Handles 308 (resume), 5xx (exponential backoff), 403 quota, cancel. */
function ytPutChunks() {
  return new Promise((resolve, reject) => {
    const file = ytUpload.file;
    const uri = ytUpload.uri;
    const total = file.size;

    const putChunk = (offset, attempt) => {
      if (!ytUpload || ytUpload.cancelled) return reject(new Error('cancelled'));
      const end = Math.min(offset + YT_CHUNK, total) - 1;
      const chunk = file.slice(offset, end + 1);
      const xhr = new XMLHttpRequest();
      ytUpload.xhr = xhr;
      xhr.open('PUT', uri); // the session URI itself authorizes the request
      xhr.setRequestHeader('Content-Range', `bytes ${offset}-${end}/${total}`);
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) ytUiProgress(offset + ev.loaded, total);
      };
      xhr.onload = () => {
        if (xhr.status === 200 || xhr.status === 201) {
          let data = null;
          try { data = JSON.parse(xhr.responseText); } catch (_) { /* ignore */ }
          ytUiProgress(total, total);
          if (data && data.id) resolve(data.id);
          else reject(new Error('Upload finished but YouTube did not return a video id.'));
        } else if (xhr.status === 308) {
          // Resume Incomplete — ask the server how much it already has
          let next = offset;
          try {
            const range = xhr.getResponseHeader('Range'); // e.g. "bytes=0-8388607"
            const m = range && /bytes=\d+-(\d+)/.exec(range);
            if (m) next = parseInt(m[1], 10) + 1;
          } catch (_) { /* ignore */ }
          ytUiProgress(next, total);
          putChunk(next, 0);
        } else if (xhr.status >= 500 && xhr.status < 600 && attempt < 5) {
          const wait = Math.pow(2, attempt) * 1000;
          $('#ytUploadStatus').textContent = `YouTube busy — retrying in ${wait / 1000}s…`;
          setTimeout(() => putChunk(offset, attempt + 1), wait);
        } else if (xhr.status === 403) {
          let msg = 'YouTube rejected the upload (HTTP 403).';
          try {
            const d = JSON.parse(xhr.responseText);
            const reason = d && d.error && d.error.errors && d.error.errors[0] && d.error.errors[0].reason;
            if (reason === 'quotaExceeded') msg = 'YouTube API daily limit sesh (~6 ta video/day) — kal abar try koro.';
            else if (reason === 'uploadLimitExceeded') msg = 'YouTube upload limit exceeded — kal abar try koro.';
            else if (d && d.error && d.error.message) msg = d.error.message;
          } catch (_) { /* ignore */ }
          reject(new Error(msg));
        } else {
          reject(new Error(`Upload failed (HTTP ${xhr.status}) — abar try koro.`));
        }
      };
      xhr.onerror = () => {
        if (attempt < 5) {
          const wait = Math.pow(2, attempt) * 1000;
          setTimeout(() => putChunk(offset, attempt + 1), wait);
        } else {
          reject(new Error('Network error during upload — connection check kore abar try koro.'));
        }
      };
      xhr.onabort = () => reject(new Error('cancelled'));
      xhr.send(chunk);
    };

    putChunk(0, 0);
  });
}

function ytCancelUpload() {
  if (ytUpload) {
    ytUpload.cancelled = true;
    if (ytUpload.xhr) { try { ytUpload.xhr.abort(); } catch (_) { /* ignore */ } }
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
      <td><div class="m-title">${esc(m.title)}</div>
        <div class="m-pills"><span class="pill cat">${esc(CATEGORY_LABELS[movieCategory(m)])}</span>${qualityList(m).map((q) => `<span class="pill">${esc(q)}</span>`).join('')}${Array.isArray(m.screenshots) && m.screenshots.length ? `<span class="pill">📷 ${m.screenshots.length}</span>` : ''}${Array.isArray(m.qualities) && m.qualities.length ? `<span class="pill">▶ ${m.qualities.length}Q</span>` : ''}</div>
        <div class="m-sub">${m.duration ? esc(m.duration) + ' • ' : ''}${m.rating != null ? '★ ' + esc(m.rating) : ''}${m.episode_info ? ' • ' + esc(m.episode_info) : ''}</div></td>
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
  $$('#fQuality input[type="checkbox"]').forEach((cb) => {
    cb.checked = !!(movie && Array.isArray(movie.quality) && movie.quality.includes(cb.value));
  });
  $('#fCategory').value = movie ? movieCategory(movie) : 'movie';
  $('#fLanguages').value = movie ? movie.languages || '' : '';
  $('#fEpisode').value = movie ? movie.episode_info || '' : '';
  $('#fImdb').value = movie ? movie.imdb_rating || '' : '';
  $('#fStars').value = movie ? movie.stars || '' : '';
  $('#fDirector').value = movie ? movie.director || '' : '';
  $('#fQualityInfo').value = movie ? movie.quality_info || '' : '';
  // screenshots + qualities working state
  formShots = movie && Array.isArray(movie.screenshots) ? [...movie.screenshots.filter(Boolean)] : [];
  pendingShotFiles = [];
  $('#fShotsFile').value = '';
  $('#fShotsUrl').value = '';
  renderShotsList();
  renderQualRows(movie && Array.isArray(movie.qualities) ? movie.qualities : []);
  $('#fPosterFile').value = '';
  $('#fBackdropFile').value = '';
  $('#fPosterUrl').value = movie ? movie.poster_url || '' : '';
  $('#fBackdropUrl').value = movie ? movie.backdrop_url || '' : '';
  $('#fVideoDirect').value = '';
  $('#fVideoYoutube').value = '';
  $('#fVideoEmbed').value = '';
  $('#fVideoDevice').value = '';
  $('#fVideoYtUpload').value = '';
  $('#fYtTitle').value = '';
  deviceResult = { url: '', type: '' };
  $('#deviceVideoDone').style.display = 'none';
  $('#ytVideoDone').style.display = 'none';
  $('#videoProgressWrap').classList.remove('show');
  $('#ytProgressWrap').classList.remove('show');
  setDest('youtube');
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

/* ---------------- Screenshots (form working state) ---------------- */
function renderShotsList() {
  const el = $('#fShotsList');
  if (!el) return;
  const items = [
    ...formShots.map((u, i) => ({ type: 'url', idx: i, src: u })),
    ...pendingShotFiles.map((f, i) => ({ type: 'file', idx: i, src: URL.createObjectURL(f) }))
  ];
  el.innerHTML = items.length ? items.map((it) => `
    <div class="shot-thumb">
      <img src="${esc(it.src)}" alt="Screenshot" loading="lazy" onerror="this.remove()">
      <button type="button" class="shot-x" data-shot-type="${it.type}" data-shot-idx="${it.idx}" title="Remove">✕</button>
    </div>`).join('')
    : '<div class="hint">No screenshots yet.</div>';
}

/* ---------------- Qualities rows (form working state) ---------------- */
function qualRowHTML(q) {
  q = q || {};
  const kind = q.kind || 'direct';
  return `<div class="qrow">
    <input type="text" class="qq-label" placeholder="480p" value="${esc(q.label || '')}">
    <input type="text" class="qq-size" placeholder="[520MB]" value="${esc(q.size || '')}">
    <input type="url" class="qq-url" placeholder="https://…" value="${esc(q.url || '')}">
    <select class="qq-kind">
      <option value="youtube"${kind === 'youtube' ? ' selected' : ''}>YouTube</option>
      <option value="direct"${kind === 'direct' ? ' selected' : ''}>Direct MP4</option>
      <option value="embed"${kind === 'embed' ? ' selected' : ''}>Embed</option>
    </select>
    <button type="button" class="btn-outline qrow-x" title="Remove row">✕</button>
  </div>`;
}
function renderQualRows(list) {
  const el = $('#fQualList');
  if (!el) return;
  el.innerHTML = (list && list.length ? list : [null]).map((q) => qualRowHTML(q)).join('');
}
function readQualRows() {
  const out = [];
  $$('#fQualList .qrow').forEach((r) => {
    const label = r.querySelector('.qq-label').value.trim();
    const url = r.querySelector('.qq-url').value.trim();
    if (!label || !url) return; // empty rows are ignored
    out.push({
      label,
      size: r.querySelector('.qq-size').value.trim(),
      url,
      kind: r.querySelector('.qq-kind').value || 'direct'
    });
  });
  return out;
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
    // "device" tab: YouTube destination → video_type 'youtube'; Cloudinary
    // destination → video_type 'direct'. (Video files can't live in the repo.)
    let video_url = '', video_type = activeVtab;
    if (activeVtab === 'device') {
      if (!deviceResult.url) throw new Error('Upload a video from your device first, or pick another tab.');
      video_url = deviceResult.url;
      video_type = deviceResult.type || 'direct';
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

    // ---- screenshots: upload newly picked files, keep existing URLs ----
    saveBtn.textContent = 'Uploading screenshots…';
    const newShotUrls = [];
    for (const f of pendingShotFiles) {
      newShotUrls.push(await uploadImage('screenshots', f));
    }
    const screenshots = [...formShots, ...newShotUrls];
    pendingShotFiles = [];

    // ---- per-quality watch/download rows ----
    const qualities = readQualRows();

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
      quality: $$('#fQuality input[type="checkbox"]:checked').map((cb) => cb.value),
      category: $('#fCategory').value || 'movie',
      languages: $('#fLanguages').value.trim(),
      episode_info: $('#fEpisode').value.trim(),
      imdb_rating: $('#fImdb').value.trim(),
      stars: $('#fStars').value.trim(),
      director: $('#fDirector').value.trim(),
      quality_info: $('#fQualityInfo').value.trim(),
      screenshots,
      qualities,
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

/* ---------------- Bulk import (CSV / JSON) ----------------
   Adds many movies at once from a CSV or JSON file. Parsed rows are
   previewed with validation, then appended through the same GitHub
   API PUT+SHA flow (saveMoviesJson). Single-movie add/edit untouched. */
let bulkRows = []; // [{ movie, errors:[], duplicate:false, rowNum }]

const BULK_CATEGORIES = ['movie', 'web-series', 'anime', 'ott'];
const BULK_KINDS = ['youtube', 'direct', 'embed'];

function parseYesNo(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === '1' || s === 'y';
}

function slugId(title) {
  const slug = String(title || 'movie')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'movie';
  return slug + '-' + Math.random().toString(36).slice(2, 8);
}

/* Robust vanilla CSV parser: quoted fields, commas/newlines inside
   quotes, "" escapes, CRLF. Returns array of rows (arrays of fields). */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip — \n handles the break */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (rows.length && rows[0].length && rows[0][0].charCodeAt(0) === 0xFEFF) {
    rows[0][0] = rows[0][0].slice(1); // strip BOM
  }
  return rows.filter((r) => r.some((f) => String(f).trim() !== ''));
}

function csvEsc(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function downloadCsvTemplate() {
  const header = ['title','year','genre','rating','duration','description','category','languages','episode_info','imdb_rating','stars','director','quality_info','quality','poster_url','backdrop_url','video_url','video_type','qualities','is_featured','is_trending','screenshots'];
  const rows = [
    ['Example Movie One','2026','Action, Drama','8.2','2h 15m','A short synopsis of the movie.','movie','Hindi, English','','7.9/10','Actor One, Actor Two','Director Name','WEB-DL 1080p | 720p | 480p','4K|HDR','https://example.com/poster1.jpg','https://example.com/backdrop1.jpg','https://www.youtube.com/watch?v=VIDEOID1','youtube','480p|[520MB]|https://example.com/movie-480p.mp4|direct;;720p|[1.2GB]|https://www.youtube.com/watch?v=VIDEOID1|youtube','yes','no','https://example.com/shot1.jpg|https://example.com/shot2.jpg'],
    ['Example Series Two','2025','Sci-Fi','8.7','45m','An example web series.','web-series','English','S01 EP04','8.2/10','Actor Three','Director Two','','FHD','https://example.com/poster2.jpg','','https://example.com/series-s01e04.mp4','direct','','no','yes','']
  ];
  const csv = [header.join(','), ...rows.map((r) => r.map(csvEsc).join(','))].join('\r\n') + '\r\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cineplay-bulk-template.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  toast('Template downloaded ✓');
}

/* lowercases + trims keys so CSV headers are case-insensitive */
function lowerKeys(obj) {
  const out = {};
  for (const k of Object.keys(obj || {})) out[String(k).toLowerCase().trim()] = obj[k];
  return out;
}
function str(v) { return v == null ? '' : String(v).trim(); }

function normalizeBulkMovie(raw) {
  const f = lowerKeys(raw);
  const errors = [];
  const title = str(f.title);
  if (!title) errors.push('missing title');

  const yearN = parseInt(str(f.year), 10);
  const ratingN = parseFloat(str(f.rating));
  let category = str(f.category).toLowerCase();
  if (!BULK_CATEGORIES.includes(category)) category = 'movie';

  const video_url = str(f.video_url);
  let video_type = str(f.video_type).toLowerCase();
  if (!BULK_KINDS.includes(video_type)) {
    video_type = /youtu(\.be|be\.com)/i.test(video_url) ? 'youtube' : 'direct';
  }

  const toStrArr = (v, sep) => {
    if (Array.isArray(v)) return v.map(str).filter(Boolean);
    return str(v).split(sep).map((s) => s.trim()).filter(Boolean);
  };

  let qualities = [];
  if (Array.isArray(f.qualities)) {
    qualities = f.qualities
      .filter((q) => q && (str(q.label) || str(q.url)))
      .map((q) => ({
        label: str(q.label),
        size: str(q.size),
        url: str(q.url),
        kind: BULK_KINDS.includes(str(q.kind).toLowerCase()) ? str(q.kind).toLowerCase() : 'direct'
      }))
      .filter((q) => q.label && q.url);
  } else {
    const qstr = str(f.qualities);
    if (qstr) {
      for (const g of qstr.split(';;')) {
        const parts = g.split('|').map((s) => s.trim());
        const label = parts[0] || '', size = parts[1] || '', url = parts[2] || '';
        let kind = (parts[3] || 'direct').toLowerCase();
        if (!BULK_KINDS.includes(kind)) kind = 'direct';
        if (label && url) qualities.push({ label, size, url, kind });
      }
    }
  }

  return {
    movie: {
      id: str(f.id) || slugId(title || 'movie'),
      title,
      description: str(f.description),
      year: Number.isFinite(yearN) ? yearN : null,
      genre: str(f.genre),
      rating: Number.isFinite(ratingN) ? Math.min(10, Math.max(0, ratingN)) : null,
      duration: str(f.duration),
      quality: toStrArr(f.quality, '|'),
      category,
      languages: str(f.languages),
      episode_info: str(f.episode_info),
      imdb_rating: str(f.imdb_rating),
      stars: str(f.stars),
      director: str(f.director),
      quality_info: str(f.quality_info),
      screenshots: toStrArr(f.screenshots, '|'),
      qualities,
      poster_url: str(f.poster_url),
      backdrop_url: str(f.backdrop_url),
      video_url,
      video_type,
      is_featured: parseYesNo(f.is_featured),
      is_trending: parseYesNo(f.is_trending),
      created_at: str(f.created_at) || new Date().toISOString()
    },
    errors
  };
}

function bulkDupKey(title, year) {
  return String(title).trim().toLowerCase() + '|' + (year == null ? '' : year);
}

function showBulkError(msg) {
  const e = $('#bulkError');
  e.textContent = msg || '';
  e.classList.toggle('show', !!msg);
}

function onBulkFilePicked(ev) {
  const file = ev.target.files && ev.target.files[0];
  showBulkError('');
  $('#bulkResult').style.display = 'none';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      parseBulkFile(file.name, String(reader.result || ''));
    } catch (e) {
      bulkRows = [];
      renderBulkPreview();
      showBulkError(e.message || String(e));
    }
    ev.target.value = ''; // allow re-picking the same file
  };
  reader.onerror = () => showBulkError('Could not read file.');
  reader.readAsText(file);
}

function parseBulkFile(name, text) {
  if (!text.trim()) throw new Error('File is empty.');
  let raws;
  if (/\.json$/i.test(name)) {
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { throw new Error('Invalid JSON: ' + e.message); }
    const arr = Array.isArray(parsed) ? parsed
      : (parsed && Array.isArray(parsed.movies) ? parsed.movies : null);
    if (!arr) throw new Error('JSON must be an array of movies or {"movies": [...]}.');
    raws = arr.map((o, i) => ({ obj: o && typeof o === 'object' ? o : {}, rowNum: i + 1 }));
  } else {
    const rows = parseCSV(text);
    if (!rows.length) throw new Error('No rows found in CSV.');
    const header = rows[0].map((h) => String(h).toLowerCase().trim());
    if (!header.includes('title')) throw new Error('Header row must contain a "title" column.');
    raws = rows.slice(1).map((r, i) => {
      const obj = {};
      header.forEach((h, ci) => { if (h) obj[h] = r[ci] != null ? r[ci] : ''; });
      return { obj, rowNum: i + 2 }; // +2: header is row 1
    });
  }
  if (!raws.length) throw new Error('No data rows found.');

  const seen = new Set(movies.map((m) => bulkDupKey(m.title, m.year)));
  bulkRows = raws.map(({ obj, rowNum }) => {
    const { movie, errors } = normalizeBulkMovie(obj);
    let duplicate = false;
    if (!errors.length) {
      const key = bulkDupKey(movie.title, movie.year);
      if (seen.has(key)) duplicate = true;
      else seen.add(key);
    }
    return { movie, errors, duplicate, rowNum };
  });
  renderBulkPreview();
}

function renderBulkPreview() {
  const wrap = $('#bulkPreview');
  if (!bulkRows.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  const valid = bulkRows.filter((r) => !r.errors.length && !r.duplicate).length;
  const dups = bulkRows.filter((r) => r.duplicate).length;
  const errs = bulkRows.filter((r) => r.errors.length).length;
  $('#bulkSummary').textContent =
    `${bulkRows.length} rows: ${valid} valid, ${dups} duplicate${dups === 1 ? '' : 's'} (skipped), ${errs} error${errs === 1 ? '' : 's'}.`;
  $('#bulkTbody').innerHTML = bulkRows.map((r) => {
    const m = r.movie;
    let status, color;
    if (r.errors.length) { status = '✗ ' + r.errors.join('; '); color = '#ff6b6b'; }
    else if (r.duplicate) { status = '⚠ duplicate (title+year already in catalog)'; color = '#f5a623'; }
    else { status = '✓ ready'; color = '#46d369'; }
    return `<tr>
      <td>${r.rowNum}</td>
      <td>${esc(m.title) || '<i style="color:#999">—</i>'}</td>
      <td>${m.year != null ? esc(m.year) : '—'}</td>
      <td>${esc(CATEGORY_LABELS[movieCategory(m)] || m.category)}</td>
      <td>${Array.isArray(m.qualities) ? m.qualities.length : 0}</td>
      <td>${esc(m.video_type || '—')}</td>
      <td style="color:${color};font-weight:700">${esc(status)}</td>
    </tr>`;
  }).join('');
  const btn = $('#bulkImportBtn');
  btn.textContent = `Import ${valid} movie${valid === 1 ? '' : 's'}`;
  btn.disabled = valid === 0;
}

function clearBulk() {
  bulkRows = [];
  $('#bulkPreview').style.display = 'none';
  $('#bulkResult').style.display = 'none';
  showBulkError('');
}

function showBulkResult(msg) {
  const el = $('#bulkResult');
  el.textContent = msg;
  el.style.display = 'block';
  $('#bulkPreview').style.display = 'none';
}

async function doBulkImport() {
  const valid = bulkRows.filter((r) => !r.errors.length && !r.duplicate);
  if (!valid.length) return;
  const btn = $('#bulkImportBtn');
  btn.disabled = true;
  btn.textContent = 'Importing…';
  const wrap = $('#bulkProgressWrap');
  wrap.classList.add('show');
  $('#bulkProgressBar').style.width = '25%';
  $('#bulkProgressLabel').textContent = 'Saving catalog…';
  try {
    const usedIds = new Set(movies.map((m) => m.id));
    const newMovies = valid.map((r) => {
      let id = r.movie.id;
      while (usedIds.has(id)) id = slugId(r.movie.title);
      usedIds.add(id);
      return { ...r.movie, id };
    });
    movies.unshift(...newMovies);
    $('#bulkProgressBar').style.width = '70%';
    await saveMoviesJson(`CinePlay: bulk import ${newMovies.length} movies`);
    $('#bulkProgressBar').style.width = '100%';
    $('#bulkProgressLabel').textContent = 'Done ✓';
    const dups = bulkRows.filter((r) => r.duplicate).length;
    const errs = bulkRows.filter((r) => r.errors.length).length;
    bulkRows = [];
    renderDashboard();
    showBulkResult(`${newMovies.length} added ✓, ${dups} skipped (duplicates), ${errs} errors. Site-e live hote ~1 min lagte pare.`);
    toast(`Bulk import done: ${newMovies.length} added ✓`);
  } catch (e) {
    showBulkError('Import failed: ' + (e.message || e));
  } finally {
    setTimeout(() => wrap.classList.remove('show'), 1600);
    btn.disabled = false;
    renderBulkPreview(); // refreshes button label / hides if empty
  }
}

function initBulkImport() {
  $('#bulkTemplateBtn').addEventListener('click', downloadCsvTemplate);
  $('#bulkFile').addEventListener('change', onBulkFilePicked);
  $('#bulkImportBtn').addEventListener('click', doBulkImport);
  $('#bulkClearBtn').addEventListener('click', clearBulk);
}

/* ---------------- Init ---------------- */
function init() {
  $('#loginForm').addEventListener('submit', (ev) => doConnect(ev, false));
  $('#logoutBtn').addEventListener('click', doDisconnect);
  $('#saveCloudBtn').addEventListener('click', saveCloudCfg);
  $('#fVideoDevice').addEventListener('change', onDeviceFilePicked);

  // YouTube direct upload
  $('#saveYtBtn').addEventListener('click', saveYtCfg);
  $('#ytConnectBtn').addEventListener('click', () => ytConnect());
  $('#ytDisconnectBtn').addEventListener('click', ytDisconnect);
  $('#ytUploadBtn').addEventListener('click', () => ytStartUpload());
  $('#ytCancelBtn').addEventListener('click', ytCancelUpload);
  $('#fVideoYtUpload').addEventListener('change', () => {
    const f = $('#fVideoYtUpload').files[0];
    if (f && !$('#fYtTitle').value.trim()) {
      $('#fYtTitle').value = $('#fTitle').value.trim() || f.name.replace(/\.[^.]+$/, '');
    }
    $('#ytVideoDone').style.display = 'none';
  });
  $$('.dest-btn').forEach((b) => b.addEventListener('click', () => setDest(b.dataset.dest)));
  loadYtCfg();
  handleYtCallback(); // completes OAuth after Google redirects back (async, self-contained)
  loadCloudCfg();
  initBulkImport();

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

  // screenshots: pick files / paste URL / remove
  $('#fShotsFile').addEventListener('change', (e) => {
    pendingShotFiles.push(...Array.from(e.target.files || []));
    e.target.value = '';
    renderShotsList();
  });
  $('#fShotsAdd').addEventListener('click', () => {
    const u = $('#fShotsUrl').value.trim();
    if (!u) return;
    formShots.push(u);
    $('#fShotsUrl').value = '';
    renderShotsList();
  });
  $('#fShotsList').addEventListener('click', (e) => {
    const x = e.target.closest('.shot-x');
    if (!x) return;
    if (x.dataset.shotType === 'url') formShots.splice(Number(x.dataset.shotIdx), 1);
    else pendingShotFiles.splice(Number(x.dataset.shotIdx), 1);
    renderShotsList();
  });

  // per-quality rows
  $('#fQualAdd').addEventListener('click', () => {
    $('#fQualList').insertAdjacentHTML('beforeend', qualRowHTML(null));
  });
  $('#fQualList').addEventListener('click', (e) => {
    const x = e.target.closest('.qrow-x');
    if (x) x.closest('.qrow').remove();
  });

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
