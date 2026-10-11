/* ============================================================
   CinePlay — public site logic
   Fetches movies from data/movies.json (GitHub-as-database —
   no backend, no keys) and renders the Netflix-style UI.
   My List is stored in localStorage (per-device).
   ============================================================ */

let allMovies = [];
let dbError = false;
let heroList = [];
let heroIndex = 0;
let heroTimer = null;

const MYLIST_KEY = 'cineplay_mylist';

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

/* ---------------- My List (localStorage) ---------------- */
function getMyList() {
  try { return JSON.parse(localStorage.getItem(MYLIST_KEY) || '[]'); }
  catch { return []; }
}
function saveMyList(list) {
  localStorage.setItem(MYLIST_KEY, JSON.stringify(list));
}
function inMyList(id) { return getMyList().includes(id); }
function toggleMyList(id) {
  let list = getMyList();
  if (list.includes(id)) {
    list = list.filter((x) => x !== id);
    toast('Removed from My List');
  } else {
    list.unshift(id);
    toast('Added to My List');
  }
  saveMyList(list);
  renderRows(); // refresh the My List row
}

/* ---------------- Data ---------------- */
function byRatingDesc(a, b) {
  return (b.rating == null ? -1 : b.rating) - (a.rating == null ? -1 : a.rating);
}
function matchPct(m) {
  return m.rating != null ? Math.round(Number(m.rating) * 10) + '% Match' : null;
}
function primaryGenre(m) {
  return String(m.genre || '').split(',')[0].trim();
}
/* ---- quality badges + categories (backward compatible: missing fields render fine) ---- */
const CATEGORY_LABELS = { 'movie': 'Movies', 'web-series': 'Web Series', 'anime': 'Anime', 'ott': 'OTT' };
function movieCategory(m) {
  const c = String((m && m.category) || 'movie').toLowerCase().trim();
  return CATEGORY_LABELS[c] ? c : 'movie';
}
function qualityList(m) {
  return m && Array.isArray(m.quality) ? m.quality.filter(Boolean) : [];
}
function languageList(m) {
  return String((m && m.languages) || '').split(',').map((s) => s.trim()).filter(Boolean);
}
const QB_CLASS = { '4K': 'qb-4k', 'FHD': 'qb-fhd', 'HD': 'qb-hd', 'BD': 'qb-bd', 'HDR': 'qb-hdr', 'DV': 'qb-dv', '10BIT': 'qb-10bit', 'SDR': 'qb-sdr' };
function qbClass(q) { return QB_CLASS[String(q).toUpperCase()] || ''; }
function qualityBadges(m) {
  const q = qualityList(m);
  if (!q.length) return '';
  return `<div class="qbadges">${q.map((x) => `<span class="qb ${qbClass(x)}">${esc(x)}</span>`).join('')}</div>`;
}
function qualityBadgesInline(m) {
  const q = qualityList(m);
  if (!q.length) return '';
  return q.map((x) => `<span class="qb ${qbClass(x)}">${esc(x)}</span>`).join(' ');
}
function hoverTags(m) {
  const tags = [];
  String(m.genre || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((g) => tags.push(g));
  languageList(m).forEach((l) => tags.push(l));
  qualityList(m).forEach((q) => tags.push(q));
  if (!tags.length) return '';
  return `<div class="card-hover">${tags.map((t) => `<span class="htag">${esc(t)}</span>`).join('')}</div>`;
}
function heroImage(m) { return m.backdrop_url || m.poster_url || ''; }

async function fetchMovies() {
  const res = await fetch('data/movies.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const list = Array.isArray(data) ? data : [];
  // newest first
  list.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return list;
}

/* ---------------- Billboard hero ---------------- */
function renderHero() {
  const featured = allMovies.filter((m) => m.is_featured);
  heroList = featured.length ? featured : [...allMovies].sort(byRatingDesc).slice(0, 5);
  const content = $('#billboardContent');
  const dots = $('#heroDots');
  clearInterval(heroTimer);

  if (!heroList.length) {
    $('#billboardBg').style.backgroundImage = 'none';
    dots.innerHTML = '';
    content.innerHTML = `
      <div class="billboard-empty">
        <h1>Welcome to CinePlay</h1>
        <p>${dbError
          ? 'Could not load the movie catalog. Please check your connection and try again.'
          : 'No movies here yet — check back soon, new titles are on the way.'}</p>
      </div>`;
    return;
  }
  dots.innerHTML = heroList.map((_, i) =>
    `<button data-i="${i}" aria-label="Featured ${i + 1}"></button>`).join('');
  dots.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => { showHero(Number(b.dataset.i)); restartHeroTimer(); }));
  showHero(0);
  if (heroList.length > 1) restartHeroTimer();
}

function restartHeroTimer() {
  clearInterval(heroTimer);
  heroTimer = setInterval(() => showHero((heroIndex + 1) % heroList.length), 8000);
}

function showHero(i) {
  heroIndex = i;
  const m = heroList[i];
  const bg = $('#billboardBg');
  const img = heroImage(m);
  bg.style.opacity = '0';
  setTimeout(() => {
    bg.style.backgroundImage = img ? `url("${img}")` : 'none';
    bg.style.opacity = '1';
  }, 120);

  const match = matchPct(m);
  const meta = [
    match ? `<span class="match">${match}</span>` : '',
    m.year ? esc(m.year) : '',
    m.duration ? esc(m.duration) : '',
    primaryGenre(m) ? `<span class="tag">${esc(primaryGenre(m))}</span>` : '',
    qualityBadgesInline(m)
  ].filter(Boolean).join(' &nbsp;•&nbsp; ');

  $('#billboardContent').innerHTML = `
    ${m.is_featured ? '<div class="billboard-kicker">★ Featured</div>' : ''}
    <h1 class="billboard-title">${esc(m.title)}</h1>
    <div class="billboard-meta">${meta}</div>
    <p class="billboard-desc">${esc(m.description || '')}</p>
    <div class="billboard-actions">
      <button class="btn btn-play" data-play="${esc(m.id)}">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Play
      </button>
      <button class="btn btn-info" data-info="${esc(m.id)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg> More Info
      </button>
    </div>`;
  $$('#heroDots button').forEach((b, bi) => b.classList.toggle('active', bi === i));
}

/* ---------------- Rows ---------------- */
function cardHTML(m) {
  const metaBits = [m.year ? esc(m.year) : '', m.episode_info ? esc(m.episode_info) : '']
    .filter(Boolean).join(' &nbsp;•&nbsp; ');
  return `
    <div class="card" data-id="${esc(m.id)}">
      ${m.poster_url ? `<img src="${esc(m.poster_url)}" alt="${esc(m.title)}" loading="lazy" onerror="this.style.visibility='hidden'">` : '<img alt="" onerror="this.style.visibility=\'hidden\'">'}
      ${qualityBadges(m)}
      ${hoverTags(m)}
      <div class="card-title">${esc(m.title)}</div>
      ${metaBits ? `<div class="card-meta">${metaBits}</div>` : ''}
    </div>`;
}

function top10CardHTML(m, rank) {
  const img = m.poster_url || m.backdrop_url || '';
  return `
    <div class="top10-card" data-id="${esc(m.id)}" title="${esc(m.title)}">
      <span class="top10-num">${rank}</span>
      ${img ? `<img src="${esc(img)}" alt="${esc(m.title)}" loading="lazy" onerror="this.style.visibility='hidden'">` : ''}
    </div>`;
}

function makeRow(title, innerHTML, rowId) {
  return `
    <div class="row"${rowId ? ` id="${rowId}"` : ''}>
      <h2 class="row-title">${esc(title)}</h2>
      <button class="row-btn left" aria-label="Scroll left">‹</button>
      <div class="row-scroller">${innerHTML}</div>
      <button class="row-btn right" aria-label="Scroll right">›</button>
    </div>`;
}

function renderSkeletons() {
  $('#rows').innerHTML = [1, 2, 3].map(() => `
    <div class="skel-row">
      <div class="skel-title shimmer"></div>
      <div class="skel-cards">${'<div class="skel-card shimmer"></div>'.repeat(6)}</div>
    </div>`).join('');
}

function renderRows() {
  const rowsEl = $('#rows');

  if (!allMovies.length) {
    rowsEl.innerHTML = `
      <div class="empty-state">
        <div class="big">🎬</div>
        <h2>${dbError ? 'Could not load movies' : 'No movies yet'}</h2>
        <p>${dbError
          ? 'The movie catalog could not be loaded. Please check your connection and try again.'
          : 'New titles are coming soon. Check back later!'}</p>
      </div>`;
    return;
  }

  let html = '';
  const trending = allMovies.filter((m) => m.is_trending);
  if (trending.length) html += makeRow('Trending Now', trending.map(cardHTML).join(''));

  const top10 = [...allMovies].sort(byRatingDesc).slice(0, 10);
  if (top10.length) html += makeRow('Top 10', top10.map(top10CardHTML).join(''));

  const myIds = getMyList();
  const myMovies = myIds.map((id) => allMovies.find((m) => m.id === id)).filter(Boolean);
  if (myMovies.length) html += makeRow('My List', myMovies.map(cardHTML).join(''), 'row-mylist');

  // Per-genre rows (from comma-separated genre tokens), most common first
  const genreCount = {};
  allMovies.forEach((m) => {
    String(m.genre || '').split(',').map((g) => g.trim()).filter(Boolean)
      .forEach((g) => { genreCount[g] = (genreCount[g] || 0) + 1; });
  });
  Object.entries(genreCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .forEach(([g]) => {
      const list = allMovies.filter((m) =>
        String(m.genre || '').split(',').map((x) => x.trim()).includes(g));
      if (list.length) html += makeRow(g + ' Movies', list.map(cardHTML).join(''));
    });

  rowsEl.innerHTML = html;

  // wire up cards + scroll buttons
  $$('#rows .card, #rows .top10-card, #rows .search-card').forEach((el) =>
    el.addEventListener('click', () => openModal(el.dataset.id)));
  $$('#rows .row').forEach((row) => {
    const scroller = row.querySelector('.row-scroller');
    row.querySelector('.row-btn.left').addEventListener('click', () =>
      scroller.scrollBy({ left: -scroller.clientWidth * 0.9 }));
    row.querySelector('.row-btn.right').addEventListener('click', () =>
      scroller.scrollBy({ left: scroller.clientWidth * 0.9 }));
  });
}

/* ---------------- Category browse ---------------- */
let activeCategory = null;

function setActiveNav(key) {
  $$('.nav-links a').forEach((a) => {
    a.classList.toggle('active', (a.dataset.cat || a.dataset.scroll) === key);
  });
  $$('#catbar button').forEach((b) => {
    b.classList.toggle('active', (b.dataset.cat || b.dataset.scroll) === key);
  });
}

function showCategory(cat) {
  activeCategory = cat;
  closeModal();
  $('#searchOverlay').classList.remove('show');
  $('#billboard').style.display = 'none';
  $('#rows').style.display = 'none';
  $('#browseView').style.display = 'block';
  const label = CATEGORY_LABELS[cat] || 'Browse';
  $('#browseTitle').textContent = 'Browse: ' + label;
  const list = allMovies.filter((m) => movieCategory(m) === cat);
  $('#browseGrid').innerHTML = list.length ? list.map(cardHTML).join('')
    : `<div class="empty-state" style="grid-column:1/-1">
         <div class="big">🎬</div>
         <h2>No titles here yet</h2>
         <p>New ${esc(label.toLowerCase())} titles are coming soon. Check back later!</p>
       </div>`;
  $$('#browseGrid .card').forEach((el) => el.addEventListener('click', () => openModal(el.dataset.id)));
  setActiveNav(cat);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showHome() {
  activeCategory = null;
  $('#billboard').style.display = '';
  $('#rows').style.display = '';
  $('#browseView').style.display = 'none';
  setActiveNav('top');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------------- Detail modal ---------------- */
function openModal(id) {
  const m = allMovies.find((x) => x.id === id);
  if (!m) return;
  const img = heroImage(m);
  const match = matchPct(m);
  const g = primaryGenre(m);
  const similar = allMovies
    .filter((x) => x.id !== m.id && g && primaryGenre(x) === g)
    .slice(0, 6);
  const listed = inMyList(m.id);

  $('#modalCard').innerHTML = `
    <button class="modal-close" id="modalClose">✕</button>
    <div class="modal-hero">
      ${img ? `<img src="${esc(img)}" alt="${esc(m.title)}" onerror="this.remove()">` : ''}
      <div class="shade"></div>
      <div class="modal-hero-content">
        <h2>${esc(m.title)}</h2>
        <div class="modal-actions">
          <button class="btn btn-play" data-play="${esc(m.id)}">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Play
          </button>
          <button class="btn-circle${listed ? ' active' : ''}" id="mylistBtn" title="${listed ? 'Remove from My List' : 'Add to My List'}">${listed ? '✓' : '+'}</button>
        </div>
      </div>
    </div>
    <div class="modal-body">
      <div class="modal-main">
        <div class="modal-meta">
          ${match ? `<span class="match">${match}</span>` : ''}
          ${m.year ? `<span>${esc(m.year)}</span>` : ''}
          ${m.episode_info ? `<span>${esc(m.episode_info)}</span>` : ''}
          ${m.duration ? `<span>${esc(m.duration)}</span>` : ''}
          ${m.genre ? `<span class="tag">${esc(m.genre)}</span>` : ''}
          ${qualityBadgesInline(m)}
        </div>
        <p class="modal-desc">${esc(m.description || 'No description available.')}</p>
        ${similar.length ? `
        <div class="mlt">
          <h3>More Like This</h3>
          <div class="mlt-grid">
            ${similar.map((s) => `
              <div class="mlt-card" data-id="${esc(s.id)}">
                ${s.backdrop_url || s.poster_url ? `<img src="${esc(s.backdrop_url || s.poster_url)}" alt="${esc(s.title)}" loading="lazy" onerror="this.remove()">` : ''}
                <div class="mlt-info">
                  <div class="mlt-meta">
                    ${matchPct(s) ? `<span class="match">${matchPct(s)}</span>` : ''}
                    ${s.year ? `<span>${esc(s.year)}</span>` : ''}
                  </div>
                  <h4>${esc(s.title)}</h4>
                  <p>${esc(s.description || '')}</p>
                </div>
              </div>`).join('')}
          </div>
        </div>` : ''}
      </div>
      <div class="modal-side">
        <p><b>Genre:</b> ${esc(m.genre || '—')}</p>
        <p style="margin-top:8px"><b>Rating:</b> ${m.rating != null ? esc(m.rating) + ' / 10' : '—'}</p>
        <p style="margin-top:8px"><b>Category:</b> ${esc(CATEGORY_LABELS[movieCategory(m)])}</p>
        ${m.languages ? `<p style="margin-top:8px"><b>Languages:</b> ${esc(m.languages)}</p>` : ''}
      </div>
    </div>`;

  $('#modal').classList.add('show');
  document.body.style.overflow = 'hidden';
  $('#modalClose').addEventListener('click', closeModal);
  $('#mylistBtn').addEventListener('click', () => {
    toggleMyList(m.id);
    const now = inMyList(m.id);
    const btn = $('#mylistBtn');
    btn.classList.toggle('active', now);
    btn.textContent = now ? '✓' : '+';
  });
  $$('#modalCard [data-play]').forEach((b) =>
    b.addEventListener('click', () => { window.location.href = 'watch.html?id=' + encodeURIComponent(b.dataset.play); }));
  $$('#modalCard .mlt-card').forEach((c) =>
    c.addEventListener('click', () => openModal(c.dataset.id)));
}

function closeModal() {
  $('#modal').classList.remove('show');
  document.body.style.overflow = '';
}

/* ---------------- Search ---------------- */
function doSearch(q) {
  const overlay = $('#searchOverlay');
  q = q.trim().toLowerCase();
  if (q.length < 2) { overlay.classList.remove('show'); return; }
  const hits = allMovies.filter((m) =>
    String(m.title || '').toLowerCase().includes(q) ||
    String(m.genre || '').toLowerCase().includes(q) ||
    String(m.languages || '').toLowerCase().includes(q) ||
    qualityList(m).join(' ').toLowerCase().includes(q));
  $('#searchLabel').textContent = hits.length
    ? `${hits.length} result${hits.length > 1 ? 's' : ''} for "${q}"`
    : `No results for "${q}"`;
  $('#searchResults').innerHTML = hits.length ? hits.map((m) => `
    <div class="search-card" data-id="${esc(m.id)}">
      ${m.poster_url ? `<img src="${esc(m.poster_url)}" alt="${esc(m.title)}" loading="lazy" onerror="this.style.visibility='hidden'">` : ''}
      ${qualityBadges(m)}
      <p>${esc(m.title)}</p>
    </div>`).join('')
    : '<div class="no-results">Try a different title or genre.</div>';
  overlay.classList.add('show');
  $$('#searchResults .search-card').forEach((c) =>
    c.addEventListener('click', () => {
      overlay.classList.remove('show');
      $('#searchInput').value = '';
      $('#searchBox').classList.remove('open');
      openModal(c.dataset.id);
    }));
}

/* ---------------- Init ---------------- */
async function init() {
  renderSkeletons();

  try {
    allMovies = await fetchMovies();
  } catch (e) {
    console.warn('CinePlay: could not load movies', e);
    dbError = true;
    allMovies = [];
  }

  renderHero();
  renderRows();

  // navbar scroll effect
  const nav = $('#navbar');
  window.addEventListener('scroll', () => nav.classList.toggle('scrolled', window.scrollY > 10), { passive: true });

  // nav links (desktop nav, mobile catbar, footer)
  $$('[data-scroll]').forEach((a) => a.addEventListener('click', (ev) => {
    ev.preventDefault();
    const where = a.dataset.scroll;
    if (where === 'top') showHome();
    else if (where === 'rows') { showHome(); setTimeout(() => $('#rows').scrollIntoView({ behavior: 'smooth' }), 80); }
    else if (where === 'mylist') {
      const go = () => {
        const el = $('#row-mylist');
        if (el) el.scrollIntoView({ behavior: 'smooth' });
        else toast('Your list is empty — tap + on any title to save it here.');
      };
      if (activeCategory) { showHome(); setTimeout(go, 120); }
      else go();
    }
  }));
  $$('[data-cat]').forEach((a) => a.addEventListener('click', (ev) => {
    ev.preventDefault();
    showCategory(a.dataset.cat);
  }));
  $('#browseClear').addEventListener('click', showHome);

  // search
  const box = $('#searchBox'), input = $('#searchInput');
  $('#searchToggle').addEventListener('click', () => {
    box.classList.toggle('open');
    if (box.classList.contains('open')) input.focus();
    else { input.value = ''; $('#searchOverlay').classList.remove('show'); }
  });
  input.addEventListener('input', () => doSearch(input.value));

  // modal close: backdrop click + Esc
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('#modal').classList.contains('show')) closeModal();
      $('#searchOverlay').classList.remove('show');
    }
  });

  // hero buttons (delegated, content re-renders)
  $('#billboardContent').addEventListener('click', (e) => {
    const play = e.target.closest('[data-play]');
    const info = e.target.closest('[data-info]');
    if (play) window.location.href = 'watch.html?id=' + encodeURIComponent(play.dataset.play);
    else if (info) openModal(info.dataset.info);
  });
}

document.addEventListener('DOMContentLoaded', init);
