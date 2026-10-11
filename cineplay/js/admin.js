/* ============================================================
   CinePlay — admin panel
   Login via Supabase Auth, gated on the movie_admins table.
   Full movie CRUD with poster/backdrop/video uploads to the
   cineplay-media storage bucket.
   ============================================================ */
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const BUCKET = 'cineplay-media';

let movies = [];
let activeVtab = 'upload';
let verifying = false;

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
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
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

/* ---------------- Auth ---------------- */
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

async function verifyAdmin() {
  if (verifying) return;
  verifying = true;
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { showLogin(); return; }
    const { data, error } = await sb.from('movie_admins')
      .select('user_id').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    if (!data) {
      await sb.auth.signOut();
      showLogin();
      showLoginError('This account is not an admin. Ask the site owner to add you via SUPABASE_SETUP.md step 3.');
      return;
    }
    $('#loginError').classList.remove('show');
    showDashboard();
    loadMovies();
  } catch (e) {
    console.warn('admin verify failed', e);
    await sb.auth.signOut();
    showLogin();
    showLoginError('Could not verify admin status: ' + (e.message || e));
  } finally {
    verifying = false;
  }
}

async function doLogin(ev) {
  ev.preventDefault();
  const email = $('#loginEmail').value.trim();
  const password = $('#loginPass').value;
  const btn = $('#loginBtn');
  $('#loginError').classList.remove('show');
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await verifyAdmin();
  } catch (e) {
    showLoginError(e.message || 'Sign in failed.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
}

/* ---------------- Dashboard ---------------- */
async function loadMovies() {
  const tbody = $('#moviesTbody');
  tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Loading…</td></tr>';
  try {
    const { data, error } = await sb.from('movies').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    movies = data || [];
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">Could not load movies: ${esc(e.message || e)}<br><br>Did you run <b>supabase/schema.sql</b> yet? See SUPABASE_SETUP.md.</td></tr>`;
    return;
  }

  $('#statTotal').textContent = movies.length;
  $('#statFeatured').textContent = movies.filter((m) => m.is_featured).length;
  $('#statTrending').textContent = movies.filter((m) => m.is_trending).length;

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

async function deleteMovie(id) {
  const m = movies.find((x) => x.id === id);
  if (!m) return;
  if (!confirm(`Delete "${m.title}"?\n\nThis removes it from the site immediately. This cannot be undone.`)) return;
  try {
    const { error } = await sb.from('movies').delete().eq('id', id);
    if (error) throw error;
    toast('Movie deleted');
    loadMovies();
  } catch (e) {
    toast('Delete failed: ' + (e.message || e));
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
  $('#fVideoFile').value = '';
  $('#fPosterUrl').value = movie ? movie.poster_url || '' : '';
  $('#fBackdropUrl').value = movie ? movie.backdrop_url || '' : '';
  $('#fVideoDirect').value = '';
  $('#fVideoYoutube').value = '';
  $('#fVideoEmbed').value = '';
  $('#fFeatured').checked = !!(movie && movie.is_featured);
  $('#fTrending').checked = !!(movie && movie.is_trending);
  $('#uploadProgressWrap').classList.remove('show');

  // restore the right video tab for edits
  const vt = movie ? (movie.video_type || 'direct') : 'upload';
  setVtab(['upload', 'direct', 'youtube', 'embed'].includes(vt) ? vt : 'direct');
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
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

async function uploadFile(folder, file, onProgress) {
  const path = `${folder}/${Date.now()}_${sanitizedName(file.name)}`;
  const wrap = $('#uploadProgressWrap');
  const bar = $('#uploadProgressBar');
  const label = $('#uploadStatus');
  wrap.classList.add('show');
  bar.style.width = '4%';
  label.textContent = 'Uploading… 0%';
  try {
    const { error } = await sb.storage.from(BUCKET).upload(path, file, {
      upsert: false,
      onUploadProgress: (ev) => {
        if (ev && ev.total) {
          const pct = Math.round((ev.loaded / ev.total) * 100);
          bar.style.width = pct + '%';
          label.textContent = `Uploading… ${pct}%`;
          if (onProgress) onProgress(pct);
        }
      }
    });
    if (error) throw error;
    bar.style.width = '100%';
    label.textContent = 'Upload complete ✓';
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
  } finally {
    setTimeout(() => wrap.classList.remove('show'), 1200);
  }
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
    let video_url = '', video_type = 'direct';
    if (activeVtab === 'upload') {
      const f = $('#fVideoFile').files[0];
      if (f) {
        video_url = await uploadFile('videos', f);
        video_type = 'upload';
      } else if (existing && existing.video_type === 'upload' && existing.video_url) {
        video_url = existing.video_url; video_type = 'upload';
      } else {
        throw new Error('Choose a video file to upload, or pick a different video source tab.');
      }
    } else if (activeVtab === 'direct') {
      video_url = $('#fVideoDirect').value.trim(); video_type = 'direct';
      if (!video_url) throw new Error('Paste a direct MP4 URL.');
    } else if (activeVtab === 'youtube') {
      video_url = $('#fVideoYoutube').value.trim(); video_type = 'youtube';
      if (!video_url) throw new Error('Paste a YouTube URL.');
    } else {
      video_url = $('#fVideoEmbed').value.trim(); video_type = 'embed';
      if (!video_url) throw new Error('Paste an embed URL.');
    }

    // ---- poster / backdrop (file upload wins, else URL field, else existing) ----
    let poster_url = $('#fPosterUrl').value.trim() || (existing ? existing.poster_url || '' : '');
    const pf = $('#fPosterFile').files[0];
    if (pf) poster_url = await uploadFile('posters', pf);

    let backdrop_url = $('#fBackdropUrl').value.trim() || (existing ? existing.backdrop_url || '' : '');
    const bf = $('#fBackdropFile').files[0];
    if (bf) backdrop_url = await uploadFile('backdrops', bf);

    const yearVal = parseInt($('#fYear').value, 10);
    const ratingVal = parseFloat($('#fRating').value);

    const row = {
      title,
      description: $('#fDesc').value.trim(),
      year: Number.isFinite(yearVal) ? yearVal : null,
      genre: $('#fGenre').value.trim(),
      rating: Number.isFinite(ratingVal) ? Math.min(10, Math.max(0, ratingVal)) : null,
      duration: $('#fDuration').value.trim(),
      poster_url, backdrop_url, video_url, video_type,
      is_featured: $('#fFeatured').checked,
      is_trending: $('#fTrending').checked
    };

    let error;
    if (editingId) {
      ({ error } = await sb.from('movies').update(row).eq('id', editingId));
    } else {
      ({ error } = await sb.from('movies').insert(row));
    }
    if (error) throw error;

    toast(editingId ? 'Movie updated ✓' : 'Movie added ✓');
    closeForm();
    loadMovies();
  } catch (e) {
    showFormError(e.message || String(e));
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Movie';
  }
}

/* ---------------- Init ---------------- */
function init() {
  $('#loginForm').addEventListener('submit', doLogin);
  $('#logoutBtn').addEventListener('click', async () => { await sb.auth.signOut(); });

  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') showLogin();
  });

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

  // resume session if already signed in
  sb.auth.getSession().then(({ data: { session } }) => {
    if (session) verifyAdmin();
    else showLogin();
  });
}

document.addEventListener('DOMContentLoaded', init);
