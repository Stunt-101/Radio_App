# Car Radio

A car-first free radio website for iPhone and iPad: two taps from opening to live audio. Plain HTML, CSS and JavaScript with no build step, hosted free on GitHub Pages. The station list comes from the free [Radio Browser](https://www.radio-browser.info) directory.

## What's where

| File | What it does |
|---|---|
| `index.html`, `css/app.css` | The page and its look |
| `js/app.js` | Screens: Home, Sub-genre, Now Playing, Menu, Search, Favorites |
| `js/player.js` | Playback, auto-skip of dead or stalled streams, lock-screen controls |
| `js/directory.js` | Station lists: built-in snapshot plus daily live refresh from Radio Browser |
| `js/store.js` | Favorites, recents, hidden stations, export/import (saved on the device) |
| `genres.json` | **The genre map.** Which directory tags belong to each sub-genre, plus pinned stations. Edit freely. |
| `stations.json` | Snapshot of stations tested by the audit. The site plays these first. |
| `tools/audit.mjs` | Re-tests stations and rebuilds `stations.json` and `audit/report.md` |
| `CHECKLIST.md` | The 5-minute phone test |

## Publish on GitHub Pages (one time, about 10 minutes)

You need a free GitHub account and the free GitHub Desktop app. No Terminal needed.

1. **Make a GitHub account.** Go to github.com and sign up (free plan).
2. **Install GitHub Desktop** from desktop.github.com. Open it and sign in with your GitHub account. If it asks for your name and email for commits, accept its suggestion; it offers a private "noreply" address.
3. **Add this folder.** In GitHub Desktop choose **File → Add Local Repository…**, pick the `Radio_App` folder, and click **Add Repository**. You'll see one commit already made, "Car Radio Phase 1".
4. **Publish.** Click **Publish repository** (top bar). Name it `car-radio`. **Untick "Keep this code private"**, because free GitHub Pages only works on public repositories. Click **Publish Repository**.
   - Public means anyone can see the code and station lists. Your design doc is excluded and stays on your Mac only.
5. **Turn on Pages.** In GitHub Desktop choose **Repository → View on GitHub**. On the GitHub page click **Settings** (top right of the repo), then **Pages** in the left column. Under **Build and deployment → Source**, choose **Deploy from a branch**. Set **Branch** to `main` and folder to `/ (root)`, then click **Save**.
6. **Wait 1–2 minutes**, then refresh that Settings → Pages screen. It shows "Your site is live at **https://YOUR-NAME.github.io/car-radio/**".
7. **On your iPhone**, open that address in **Safari**. Tap the Share button, then **Add Bookmark** (or **Add to Favorites**). **Don't use "Add to Home Screen"**: a Home Screen web app stops the audio when you switch apps.

### Updating the site later

When files change on the Mac, open GitHub Desktop. Type a short summary bottom-left, click **Commit to main**, then **Push origin**. The site updates within about a minute.

### Refreshing the tested station list (optional, every month or two)

In Terminal, in this folder, run `node tools/audit.mjs`. It takes about 5 minutes, rewrites `stations.json` and `audit/report.md`, and then you commit and push as above. The site also refreshes each sub-genre from the live directory once a day on its own, so this is only needed to re-test streams.

## "Hey Siri, car radio"

1. Open the **Shortcuts** app on the iPhone, then tap **+**.
2. **Add Action**, search "Open URLs", and add it. Type your site address as the URL.
3. Name the shortcut **Car Radio** (tap the name at the top).
4. Say "Hey Siri, Car Radio". Safari opens the site; tap **Resume** or a favorite to start the sound (Safari always needs one tap).

## Notes

- Favorites live only on each device. **Menu → Export** saves a backup file, and **Menu → Import** loads it on the iPad.
- If Safari clears website data (it can after weeks without visits), import your last export.
- Radio Browser currently lists only one API server. If it is down, the site still plays from its built-in snapshot.
