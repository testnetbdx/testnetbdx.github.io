# CinePlay Admin Setup — GitHub token

CinePlay-r admin panel chole GitHub diye — kono backend/server bill nai, **100% free forever**. Movie list thake repo-r `cineplay/data/movies.json` file-e; admin panel theke Save korle GitHub API diye file-ta auto-update hoye jay.

## Step 1 — Token banao (ekbar-e korte hobe)

1. GitHub-e login koro (jei account-e `testnetbdx/testnetbdx.github.io` repo ache).
2. Upor-dan dike profile photo → **Settings**.
3. Ekdom niche **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
4. **Token name**: `cineplay-admin` (ja khushi dite paro).
5. **Expiration**: tomar iccha (expire hoye gele abar notun token banate hobe).
6. **Repository access** → **Only select repositories** → **Select repositories** → `testnetbdx/testnetbdx.github.io` select koro.
7. **Permissions** → **Repository permissions** → **Contents** → **Read and write** select koro.
8. Niche **Generate token** → token-ta **ekhoni copy koro** (page charle ar kokhono dekhabe na!).

## Step 2 — Admin panel-e connect koro

1. Khulo: https://testnetbdx.github.io/cineplay/admin.html
2. Token-ta paste koro → **Connect**.
3. Done! Ekhon **+ Add Movie** diye movie add/edit/delete korte parba.

## Cloudinary setup (phone gallery theke video upload)

Admin panel-e **"Upload from device"** tab diye phone gallery theke sorasori video upload kora jay — Cloudinary-r free plan diye, kono server lage na.

1. **Free signup**: cloudinary.com-e giye free account khulo (credit card lage na).
2. Login-er por **Dashboard**-e **Cloud name** copy koro.
3. Bam pashe gear icon (**Settings**) → **Upload** tab → niche **Upload presets** → **Add upload preset**.
4. **Preset name**: `cineplay-video` (ja khushi) → **Signing Mode**: **Unsigned** select koro → **Save**.
5. Admin panel-er **Cloudinary settings** card-e Cloud name + preset name bosiye **Save settings** daw.

**Shotyi kotha (limit):** free plan-e total 25GB storage/bandwidth (shared), ar **ekta video sorbochcho 100MB**. 100MB-r boro file-e upload-er somoy error dekhabe. Full-length movie sadharonoto 100MB-r onek beshi hoy — tai boro file-r jonno:
- video-ta compress koro (CapCut / HandBrake / phone-er gallery app diye), **othoba**
- YouTube-e **Unlisted** hishebe upload kore link-ta **YouTube URL** tab-e paste koro — unlimited, free, ar quality-o valo thake.

Cloudinary-r Cloud name + preset public-safe (unsigned preset evabei kaj korar jonno), tobuo egulo repo-te rakha hoy na — shudhu tomar browser-er localStorage-e thake.

## YouTube direct upload setup (Google Cloud) — 3-10GB movie-r jonno

Admin panel thekei phone gallery-r boro video file (3-10GB porjonto) **sorasori YouTube-e upload** kora jay — YouTube app-er dorkar nai. Nicher setup ekbar korlei hobe:

### A. Google Cloud project + API enable
1. Jao: **console.cloud.google.com** → Google account diye login.
2. Uporer project dropdown → **New project** → name daw `cineplay-uploader` → **Create**. Project select hoyeche kina dekho.
3. Bam menu → **APIs & Services** → **Library**.
4. Search koro **"YouTube Data API v3"** → select kore **Enable** chap dao.

### B. OAuth consent screen
1. **APIs & Services** → **OAuth consent screen** → **Get started**.
2. **App name**: `CinePlay Uploader` → **Support email**: tomar Gmail select koro → **Next**.
3. **Audience**: **External** select → **Next**.
4. **Contact info**: tomar email → **Next** → **Save**.
5. Ekhon **Audience** tab-e giye **Test users**-er niche **Add users** → **tomar nijer Gmail** add koro → **Save**. (Ei step chara Google tomake login korte dibe na.)
6. **Data Access** tab → **Add or remove scopes** → search/filter-e `youtube.upload` likho → **`https://www.googleapis.com/auth/youtube.upload`** tick dao → **Update** → **Save**.

### C. OAuth Client ID banao (ei step-e vul hole connect hobe na)
1. **APIs & Services** → **Clients** (ba **Credentials** → **Create Credentials** → **OAuth client ID**).
2. **Application type**: **Web application** → name: `CinePlay admin`.
3. **Authorized JavaScript origins** → **Add URI**: `https://testnetbdx.github.io`
4. **Authorized redirect URIs** → **Add URI**: EXACT `https://testnetbdx.github.io/cineplay/admin.html` (kono trailing `/` diba na — ekta character-o edik-odik hole connect fail korbe).
5. **Create** → **Client ID** ar **Client secret** copy koro (secret-ta pore ar dekhabe na!).

### D. Admin panel-e connect
1. Khulo: https://testnetbdx.github.io/cineplay/admin.html → GitHub token diye login.
2. Dashboard-er **▶ YouTube upload settings** card-e Client ID + Client secret bosiye **Save settings**.
3. **Connect YouTube** chap dao → tomar Google account select koro → **Continue** → warning ashle **Advanced** → **Go to CinePlay Uploader** → **Allow**.
4. Admin-e fire eshe status **✓ Connected to YouTube** dekhabe. Done!

### E. Movie upload
**+ Add Movie** → **📱 Upload from device** tab → destination **▶ YouTube** (default) → gallery theke video select → title/privacy (default **Unlisted**) → **⬆ Upload to YouTube**. Progress bar-e % + MB dekhabe; cancel korte chaile **Cancel** chap dao. Upload sesh hole link auto-boshe jabe → baki info diye **Save Movie**.

### Shotyi kotha (limit) ⚠️
- **YouTube API free quota ≈ 10,000 units/day, ekta upload ≈ 1,600 units → dine ~6 ta video** upload kora jay. Limit sesh hole porer din try koro.
- Consent screen **Testing** mode-e thakle Google ~7 din por por abar login chaite pare (refresh token expire hoye jay) — tokhon shudhu **Connect YouTube** abar chap dilei hobe.
- Upload default **Unlisted** thake — shudhu link jana manush dekhte pabe. Chaile Private/Public-o kora jay.
- Boro file (3-10GB) upload-e somoy lagbe — majhkhane tab/browser bondho koro na. Net chole gele auto-retry hobe (5 bar porjonto).
- YouTube upload scan kore (Content ID) — onner copyrighted full movie hole block/claim hote pare. Eta YouTube-er rule.

### Troubleshooting
- **redirect_uri_mismatch** → Google Cloud-er Authorized redirect URIs-te EXACT `https://testnetbdx.github.io/cineplay/admin.html` ache kina check koro (http/https, slash — shob milte hobe).
- **access_denied** → nijeke **Test users**-e add korecho kina dekho (Step B-5).
- **"YouTube API daily limit sesh"** → quota sesh, kal try koro.
- **"Session expired — abar Connect koro"** → Connect YouTube abar chap dao.

## Kichu kotha

- **Save korle site-e live hote ~1 min lagte pare** (GitHub Pages rebuild hote somoy ney).
- **Video file repo-te rakha jay na** — video-r jonno YouTube link use koro (Unlisted rakhle shudhu link jana manush dekhte pabe) ba direct MP4 link.
- Poster/backdrop image chaile **upload** korte parba — ogulo repo-r `cineplay/posters/` ar `cineplay/backdrops/` folder-e save hobe. Chaile image URL paste-o korte parba.
- **Token kauke diben na**, kothao post korben na.
- Token code-e ba repo-te **save hoy na** — shudhu tomar browser-er session-e thake. Tab/browser bondho korle muche jay, tokhon abar paste korte hobe.
- Token revoke korte chaile: GitHub → Settings → Developer settings → Personal access tokens → token-tar pashe **Delete**.
