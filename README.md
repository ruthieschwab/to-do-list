# To Do List

A single-page to-do list that works offline. Tasks have tags (`#work`, `#fam`, `#house`), an urgent flag, notes, and drag-to-reorder. Installs to a phone home screen as an app.

No build step and no dependencies — plain HTML/CSS/JS.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell and styles |
| `app.js` | The app. State is saved to `localStorage` on every change. |
| `sw.js` | Service worker that caches the app so it opens with no connection |
| `manifest.json`, `icons/` | Home-screen install metadata |

The repo contains **no task data**. A deployed site is a public URL, so data must never be committed here; it lives only on each device (see below).

## Deploy (GitHub Pages)

1. Repo **Settings → Pages**.
2. Under **Build and deployment**, set *Source* to **Deploy from a branch**, pick the branch, folder `/ (root)`, and save.
3. After a minute the site is live at `https://<user>.github.io/to-do-list/`.

Every push to that branch redeploys. The service worker picks up a new version on the next launch after it's published. (GitHub Pages on a *private* repo needs a paid GitHub plan; on a free plan the repo must be public — which is fine, since it holds only code.)

## Install on iPhone

Open the site in Safari → Share → **Add to Home Screen**. Open it from the home-screen icon from then on: that gives it a full-screen app window and, importantly, exempts its saved data from Safari's 7-day storage cleanup that applies to plain browser tabs.

## Data, backups, moving between devices

Each device keeps its own copy in `localStorage`. Changes on one device do not appear on another.

At the bottom of the list:

- **Export backup** downloads a `to-do-list-YYYY-MM-DD.json` file with every task.
- **Import backup** loads such a file, replacing the tasks on that device.

To get an existing list onto a new device: export on the old one, get the file to the new one (AirDrop, Files, email), import. Clearing the site's data in the browser erases the list on that device, so export now and then.
