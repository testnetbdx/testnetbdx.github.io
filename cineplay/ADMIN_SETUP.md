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

## Kichu kotha

- **Save korle site-e live hote ~1 min lagte pare** (GitHub Pages rebuild hote somoy ney).
- **Video file repo-te rakha jay na** — video-r jonno YouTube link use koro (Unlisted rakhle shudhu link jana manush dekhte pabe) ba direct MP4 link.
- Poster/backdrop image chaile **upload** korte parba — ogulo repo-r `cineplay/posters/` ar `cineplay/backdrops/` folder-e save hobe. Chaile image URL paste-o korte parba.
- **Token kauke diben na**, kothao post korben na.
- Token code-e ba repo-te **save hoy na** — shudhu tomar browser-er session-e thake. Tab/browser bondho korle muche jay, tokhon abar paste korte hobe.
- Token revoke korte chaile: GitHub → Settings → Developer settings → Personal access tokens → token-tar pashe **Delete**.
