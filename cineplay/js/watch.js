/* ============================================================
   CinePlay — watch page (GitHub-as-database edition)
   Movie data comes from data/movies.json — no backend, no keys.
   Plays a movie based on its video_type:
     direct  -> HTML5 <video>
     youtube -> YouTube embed (any URL form)
     embed   -> raw iframe URL
   ============================================================ */
const $ = (s) => document.querySelector(s);

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Accepts watch?v=, youtu.be/, /embed/, /shorts/, /v/ and bare IDs */
function extractYouTubeId(url) {
  if (!url) return null;
  url = String(url).trim();
  const m = url.match(/(?:youtube\.com\/(?:watch\?[^#]*v=|embed\/|shorts\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(url)) return url;
  return null;
}

function playerError(msg) {
  $('#playerLoading').innerHTML = `<div style="text-align:center;padding:20px">${esc(msg)}</div>`;
}

function renderPlayer(movie) {
  const player = $('#player');
  const type = movie.video_type || 'direct';
  const url = (movie.video_url || '').trim();
  $('#playerLoading').remove();

  if (!url) { playerError('No video source set for this title yet.'); return; }

  if (type === 'youtube') {
    const vid = extractYouTubeId(url);
    if (!vid) { playerError('This YouTube link could not be understood.'); return; }
    player.innerHTML = `<iframe src="https://www.youtube.com/embed/${vid}?autoplay=1&rel=0"
      title="${esc(movie.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowfullscreen></iframe>`;
  } else if (type === 'embed') {
    player.innerHTML = `<iframe src="${esc(url)}" title="${esc(movie.title)}"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowfullscreen></iframe>`;
  } else {
    // 'direct' (or legacy 'upload') — plain MP4-style file
    const v = document.createElement('video');
    v.src = url;
    v.controls = true;
    v.autoplay = true;
    v.playsInline = true;
    v.setAttribute('controlsList', 'nodownload');
    player.appendChild(v);
    v.addEventListener('error', () => playerError('Could not load this video file.'));
  }
}

function renderInfo(movie) {
  document.title = movie.title + ' — CinePlay';
  $('#watchTitle').textContent = movie.title;
  const parts = [];
  if (movie.rating != null) parts.push(`<span class="match">${Math.round(Number(movie.rating) * 10)}% Match</span>`);
  if (movie.year) parts.push(esc(movie.year));
  if (movie.duration) parts.push(esc(movie.duration));
  if (movie.genre) parts.push(esc(movie.genre));
  $('#watchMeta').innerHTML = parts.join(' &nbsp;•&nbsp; ');
  $('#watchDesc').textContent = movie.description || '';
  $('#watchInfo').style.display = 'block';
}

async function init() {
  $('#backBtn').addEventListener('click', () => {
    if (window.history.length > 1) window.history.back();
    else window.location.href = 'index.html';
  });

  const id = new URLSearchParams(window.location.search).get('id');
  if (!id) {
    $('#playerLoading').remove();
    $('#watchError').style.display = 'block';
    return;
  }

  try {
    const res = await fetch('data/movies.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const list = await res.json();
    const movie = Array.isArray(list) ? list.find((m) => String(m.id) === String(id)) : null;
    if (!movie) {
      $('#playerLoading').remove();
      $('#watchError').style.display = 'block';
      return;
    }
    renderPlayer(movie);
    renderInfo(movie);
  } catch (e) {
    console.warn('CinePlay watch: load failed', e);
    const pl = $('#playerLoading');
    if (pl) pl.remove();
    $('#watchErrorMsg').textContent = 'Could not load this title. Please check your connection and try again.';
    $('#watchError').style.display = 'block';
  }
}

document.addEventListener('DOMContentLoaded', init);
