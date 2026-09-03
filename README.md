# To Do List

A single-page to-do list that works offline and can sync across devices. Tasks have tags (`#work`, `#fam`, `#house`), an urgent flag, notes, and drag-to-reorder (drag the ⠿ handle; tap a title to edit it and reveal the note/tag controls). Installs to a phone home screen as an app.

No build step and no dependencies — plain HTML/CSS/JS.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell and styles |
| `app.js` | The app. Saves to `localStorage` on every change; drives sync. |
| `sync.js` | GitHub Gist client and the merge rule used by sync |
| `sw.js` | Service worker that caches the app so it opens with no connection |
| `manifest.json`, `icons/` | Home-screen install metadata |

The repo contains **no task data**. A deployed site is a public URL, so data must never be committed here.

## Deploy (GitHub Pages)

1. Repo **Settings → Pages**.
2. Under **Build and deployment**, set *Source* to **Deploy from a branch**, pick the branch, folder `/ (root)`, and save.
3. After a minute the site is live at `https://<user>.github.io/to-do-list/`.

Every push to that branch redeploys. The service worker picks up a new version on the next launch after it's published. (GitHub Pages on a *private* repo needs a paid GitHub plan; on a free plan the repo must be public — fine, since it holds only code.)

## Install on iPhone

Open the site in Safari → Share → **Add to Home Screen**. Open it from the home-screen icon from then on: that gives it a full-screen app window and, importantly, exempts its saved data from Safari's 7-day storage cleanup that applies to plain browser tabs.

## Sync across devices

Sync keeps every device's copy identical through a **secret gist** on your GitHub account (secret gists are unlisted and only reachable by URL or by your token). Setup, once per device:

1. Create a token at <https://github.com/settings/tokens/new>: *classic* token, tick **only** the `gist` scope, set *No expiration* (or you'll be re-entering it). Copy it.
2. In the app, tap **Set up sync** at the bottom, paste the token, **Connect**.

The first device to connect creates the gist and uploads its list. Later devices find the same gist and pull it. After that, every change syncs about a second after you make it; the app also syncs when opened, when brought to the foreground, and when the network comes back. The status in the header shows *synced Xm ago*, *syncing…*, or *offline · saved on this device*.

How conflicts resolve: each task carries an `updatedAt` timestamp and the newer copy of a task wins; deletions are kept as tombstones for 90 days so they propagate. Editing the *same* task on two offline devices keeps whichever edit was made later.

The token is stored only in that device's browser storage, never in the repo. **Disconnect** in the sync panel forgets it (the local list stays).

## Backups

At the bottom of the list, **Export backup** downloads a `to-do-list-YYYY-MM-DD.json` file with every task, and **Import backup** restores one — replacing the list on that device (and, if sync is on, everywhere). Worth doing occasionally even with sync on.
