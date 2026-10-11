/* ============================================================
   CinePlay — movie detail page
   Reads ?id= (and optional ?q= via watch.html), renders the
   full detail page from data/movies.json. All content comes
   from the admin panel — no backend, no keys.
   ============================================================ */
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

const CATEGORY_LABELS = { 'movie': 'Movies', 'web-series': 'Web Series', 'anime': 'Anime', 'ott': 'OTT' };
function movieCategory(m) {
  const c = String((m && m.category) || 'movie').toLowerCase().trim();
  return CATEGORY_LABELS[c] ? c : 'movie';
}
function qualityList(m) {
  return m && Array.isArray(m.quality) ? m.quality.filter(Boolean) : [];
}
const QB_CLASS = { '4K': 'qb-4k', 'FHD': 'qb-fhd', 'HD': 'qb-hd', 'BD': 'qb-bd', 'HDR': 'qb-hdr', 'DV': 'qb-dv', '10BIT': 'qb-10bit', 'SDR': 'qb-sdr' };
function qbClass(q) { return QB_CLASS[String(q).toUpperCase()] || ''; }
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ---------- quality info header line ---------- */
function qualityLine(m) {
  if (m.quality_info && String(m.quality_info).trim()) return esc(m.quality_info);
  const bits = [];
  const langs = String(m.languages || '').trim();
  if (langs) bits.push(langs);
  const q = qualityList(m);
  if (q.length) bits.push(q.join(' '));
  if (m.episode_info) bits.push(String(m.episode_info));
  return bits.length ? esc(bits.join(' • ')) : '';
}

/* ---------- info block ---------- */
function infoRows(m) {
  const q = qualityList(m);
  const rows = [
    ['IMDb Rating', m.imdb_rating ? esc(m.imdb_rating) : '—'],
    ['Genre', m.genre ? esc(m.genre) : '—'],
    ['Stars', m.stars ? esc(m.stars) : '—'],
    ['Director', m.director ? esc(m.director) : '—'],
    ['Language', m.languages ? esc(m.languages) : '—'],
    ['Quality', m.quality_info ? esc(m.quality_info) : (q.length ? q.map((x) => `<span class="qb ${qbClass(x)}">${esc(x)}</span>`).join(' ') : '—')]
  ];
  return rows.map(([k, v]) =>
    `<div class="irow"><span class="ilabel">${k}:</span><span>${v}</span></div>`).join('');
}

/* ---------- watch / download rows ---------- */
function watchRows(m) {
  const qs = Array.isArray(m.qualities) ? m.qualities.filter((x) => x && x.url) : [];
  const rows = qs.length ? qs.map((q, i) => ({
    label: q.label || ('Part ' + (i + 1)),
    size: q.size || '',
    qi: i,
    url: q.url,
    kind: q.kind || 'direct'
  })) : [{
    label: 'Watch Now',
    size: '',
    qi: null,
    url: m.video_url || '',
    kind: m.video_type || 'direct'
  }];

  return rows.map((r) => {
    const watchUrl = r.qi == null
      ? 'watch.html?id=' + encodeURIComponent(m.id)
      : 'watch.html?id=' + encodeURIComponent(m.id) + '&q=' + r.qi;
    const canDl = r.url && r.kind !== 'youtube';
    return `
    <div class="qrow">
      <span class="qlabel">${esc(r.label)}</span>
      ${r.size ? `<span class="qsize">${esc(r.size)}</span>` : ''}
      <span class="spacer"></span>
      ${r.url
        ? `<a class="btn-watch" href="${watchUrl}">▶ Watch</a>
           ${canDl
             ? `<a class="btn-dl" href="${esc(r.url)}" download target="_blank" rel="noopener">⬇ Download</a>`
             : `<a class="btn-dl" href="${esc(r.url)}" target="_blank" rel="noopener">⬇ Open</a>`}`
        : '<span class="qsize">No link yet</span>'}
    </div>`;
  }).join('');
}

/* ---------- reactions (per-device localStorage) ---------- */
const REACTS = [
  ['excellent', 'Excellent'], ['loved', 'Loved'], ['thanks', 'Thanks'],
  ['wow', 'Wow'], ['sad', 'Sad']
];
function reactKey(id) { return 'cineplay_react_' + id; }
function getReacts(id) {
  try {
    const v = JSON.parse(localStorage.getItem(reactKey(id)) || '{}');
    return { choice: v.choice || null, counts: v.counts || {} };
  } catch { return { choice: null, counts: {} }; }
}
function renderReacts(id) {
  const r = getReacts(id);
  $('#dReact').innerHTML = REACTS.map(([k, label]) => `
    <button class="react-btn${r.choice === k ? ' active' : ''}" data-react="${k}">
      ${label}<span class="cnt">${r.counts[k] || 0}</span>
    </button>`).join('');
  $$('#dReact .react-btn').forEach((b) => b.addEventListener('click', () => {
    const cur = getReacts(id);
    const k = b.dataset.react;
    if (cur.choice === k) {
      cur.counts[k] = Math.max(0, (cur.counts[k] || 0) - 1);
      cur.choice = null;
    } else {
      if (cur.choice) cur.counts[cur.choice] = Math.max(0, (cur.counts[cur.choice] || 0) - 1);
      cur.counts[k] = (cur.counts[k] || 0) + 1;
      cur.choice = k;
    }
    localStorage.setItem(reactKey(id), JSON.stringify(cur));
    renderReacts(id);
  }));
}

/* ---------- more like this ---------- */
function similarMovies(m, all) {
  const g0 = String(m.genre || '').split(',')[0].trim().toLowerCase();
  const cat = movieCategory(m);
  return all
    .filter((x) => x.id !== m.id &&
      (movieCategory(x) === cat ||
        (g0 && String(x.genre || '').toLowerCase().split(',').map((s) => s.trim()).includes(g0))))
    .slice(0, 12);
}
function cardHTML(m) {
  const q = qualityList(m);
  return `
    <a class="card" href="movie.html?id=${encodeURIComponent(m.id)}">
      ${m.poster_url ? `<img src="${esc(m.poster_url)}" alt="${esc(m.title)}" loading="lazy" onerror="this.style.visibility='hidden'">` : ''}
      ${q.length ? `<div class="qbadges">${q.map((x) => `<span class="qb ${qbClass(x)}">${esc(x)}</span>`).join('')}</div>` : ''}
      <div class="card-title">${esc(m.title)}</div>
      ${m.year ? `<div class="card-meta">${esc(m.year)}</div>` : ''}
    </a>`;
}

/* ---------- lightbox ---------- */
function initLightbox() {
  const lb = $('#lightbox'), img = $('#lightboxImg');
  lb.addEventListener('click', () => lb.classList.remove('show'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') lb.classList.remove('show');
  });
  $$('#dShots img').forEach((im) => im.addEventListener('click', () => {
    img.src = im.src;
    lb.classList.add('show');
  }));
}

/* ---------- main render ---------- */
function render(movie, all) {
  document.title = movie.title + (movie.year ? ' (' + movie.year + ')' : '') + ' — CinePlay';

  if (movie.backdrop_url) {
    $('#detailBg').style.backgroundImage = `url("${movie.backdrop_url}")`;
  }

  $('#dTitle').innerHTML = esc(movie.title) +
    (movie.year ? ` <span class="d-year">(${esc(movie.year)})</span>` : '');
  const ql = qualityLine(movie);
  $('#dQualityLine').innerHTML = ql || '&nbsp;';

  const pills = [];
  const added = fmtDate(movie.created_at);
  if (added) pills.push(`<span class="htag">📅 ${esc(added)}</span>`);
  if (movie.genre) pills.push(`<span class="htag">${esc(movie.genre)}</span>`);
  pills.push(`<span class="htag">${esc(CATEGORY_LABELS[movieCategory(movie)])}</span>`);
  if (movie.languages) pills.push(`<span class="htag">${esc(movie.languages)}</span>`);
  $('#dPills').innerHTML = pills.join('');

  const poster = $('#dPoster');
  if (movie.poster_url) {
    poster.src = movie.poster_url;
    poster.alt = movie.title;
    poster.onerror = () => { poster.closest('.d-poster').style.display = 'none'; };
  } else {
    poster.closest('.d-poster').style.display = 'none';
  }

  $('#dInfo').innerHTML = infoRows(movie);

  const shots = Array.isArray(movie.screenshots) ? movie.screenshots.filter(Boolean) : [];
  if (shots.length) {
    $('#dShotsWrap').style.display = '';
    $('#dShots').innerHTML = shots.map((u) =>
      `<img src="${esc(u)}" alt="Screenshot" loading="lazy" onerror="this.remove()">`).join('');
  }

  $('#dWatch').innerHTML = watchRows(movie);

  if (movie.description && String(movie.description).trim()) {
    $('#dStoryWrap').style.display = '';
    $('#dStory').textContent = movie.description;
  }

  renderReacts(movie.id);

  const sim = similarMovies(movie, all);
  if (sim.length) {
    $('#dMltWrap').style.display = '';
    $('#dMlt').innerHTML = sim.map(cardHTML).join('');
  }

  initLightbox();
  $('#detailLoading').style.display = 'none';
  $('#detailContent').style.display = '';
}

async function init() {
  const id = new URLSearchParams(window.location.search).get('id');
  if (!id) {
    $('#detailLoading').style.display = 'none';
    $('#detailError').style.display = 'block';
    return;
  }
  try {
    const res = await fetch('data/movies.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const all = Array.isArray(data) ? data : [];
    const movie = all.find((m) => String(m.id) === String(id));
    if (!movie) throw new Error('not found');
    render(movie, all);
  } catch (e) {
    console.warn('CinePlay detail: load failed', e);
    $('#detailLoading').style.display = 'none';
    $('#detailError').style.display = 'block';
  }

  const nav = $('#navbar');
  window.addEventListener('scroll', () => nav.classList.toggle('scrolled', window.scrollY > 10), { passive: true });
}

document.addEventListener('DOMContentLoaded', init);
