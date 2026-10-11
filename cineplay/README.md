# 🎬 CinePlay

Netflix-style movie watching website with a full admin panel.
Dark UI, red accent, original "CinePlay" branding.

**Live:** https://testnetbdx.github.io/cineplay/
**Admin:** https://testnetbdx.github.io/cineplay/admin.html

## Architecture — GitHub-as-database (100% free forever)

No backend server, no database bill, no API keys in public code.

- `cineplay/data/movies.json` — the entire movie catalog (a JSON array).
  Public pages load it with a plain `fetch()`.
- Poster/backdrop images uploaded from the admin panel land in
  `cineplay/posters/` and `cineplay/backdrops/` in the repo, served by
  GitHub Pages.
- The admin panel (`admin.html`) reads/writes `movies.json` through the
  GitHub Contents API using a personal access token that the admin pastes
  in — stored only in the browser's `sessionStorage`, never in code.
- Saving takes ~1 min to go live (GitHub Pages rebuild).
- Video files can't live in the repo — use YouTube (unlisted works) or
  direct MP4 links.

## Structure

```
cineplay/                        # deployed to testnetbdx.github.io/cineplay/
├── index.html                   # public site — hero, rows, search, My List
├── watch.html                   # player page (?id=<movie-id>)
├── admin.html                   # admin panel (token connect + dashboard)
├── ADMIN_SETUP.md               # how to create the GitHub token (user guide)
├── data/
│   └── movies.json              # the catalog (JSON array)
├── posters/                     # uploaded poster images (created by admin)
├── backdrops/                   # uploaded backdrop images (created by admin)
├── css/style.css
└── js/
    ├── app.js                   # public site logic (fetch-only)
    ├── watch.js                 # player logic
    └── admin.js                 # GitHub API CMS logic

~/workspace/movie-site/          # source of truth (same tree + README.md)
```

First-time admin setup: see `ADMIN_SETUP.md` — create a fine-grained PAT
with Contents: Read and write on the repo, then Connect in the admin panel.

## Video sources

`video_type` decides the player:
- `direct` → HTML5 `<video>` player (direct MP4 URL)
- `youtube` → YouTube embed (any URL form: `watch?v=`, `youtu.be`, `/embed/`, `/shorts/`)
- `embed` → raw iframe embed URL

**Direct YouTube upload (admin panel):** `admin.html` can upload 3–10GB movie
files straight to YouTube (Unlisted by default) — no backend. It uses
YouTube Data API v3 with OAuth 2.0 PKCE (`youtube.upload` scope) and chunked
resumable uploads (8MB chunks, auto-resume on 308, exponential backoff on
5xx, cancel support). The admin's Google OAuth Client ID/secret and tokens
live only in that browser's `localStorage` — never in the repo. First-time
setup (Google Cloud project, API enable, consent screen, OAuth client with
exact redirect URI `https://testnetbdx.github.io/cineplay/admin.html`) is
documented click-by-click in `ADMIN_SETUP.md`. Honest limits: ~6 uploads/day
(API quota), testing-mode refresh tokens expire after ~7 days.

## Movie object shape

```json
{
  "id": "m_abc123",
  "title": "Example Movie",
  "description": "Synopsis…",
  "year": 2026,
  "genre": "Action, Sci-Fi",
  "rating": 8.5,
  "duration": "2h 15m",
  "poster_url": "https://…/cineplay/posters/….jpg",
  "backdrop_url": "https://…/cineplay/backdrops/….jpg",
  "video_url": "https://www.youtube.com/watch?v=…",
  "video_type": "youtube",
  "is_featured": true,
  "is_trending": false,
  "created_at": "2026-10-11T…"
}
```

## Local preview

```bash
cd ~/workspace/movie-site
python3 -m http.server 8080
# open http://localhost:8080/
```

## Deploy

Sync the source tree into the repo clone (posters/ and backdrops/ hold
user uploads — never delete them):

```bash
cd <testnetbdx.github.io clone>
rsync -av --delete --exclude 'posters/' --exclude 'backdrops/' \
  ~/workspace/movie-site/ cineplay/
git add cineplay
git commit -m "…"
git push
```

No secrets are ever committed — the admin token lives only in the
admin's browser session.
