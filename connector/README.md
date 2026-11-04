# To Do List connector

A small server that lets Claude read and change this to-do list. It runs on Cloudflare Workers and speaks MCP, the protocol Claude's custom connectors use.

It works on the same sync gist as the app (`to-do-list.json`), writing tasks in exactly the app's format and stamping each change with `updatedAt`. The app's merge rule (newest copy of a task wins) then treats a change from Claude like a change from any other device. **The app itself doesn't change.** A task Claude adds shows up when the app next syncs: when you open it or bring it to the front.

## What Claude can do

| Tool | What it does |
|---|---|
| `list_tasks` | Lists open, done or all tasks. Filters by tag (work, family, house, punch list), untagged, urgent, or text. |
| `add_task` | Adds a task at the top of the open list, with optional note, tags and urgent flag. With no tags given, it suggests them using the app's own `tags.js`. |
| `update_task` | Changes a task's title, note, tags or urgent flag. |
| `set_task_done` | Checks a task off, or reopens it. |

There's no delete. Checked-off tasks stay in the app's Done list as usual.

## How it stays private

- **Sign in with GitHub.** Adding the connector in Claude opens a GitHub sign-in that asks for the `gist` permission. Only the account in `ALLOWED_GITHUB_LOGIN` (`wrangler.jsonc`) is let in; anyone else is turned away before any access is granted.
- **No token to copy.** GitHub hands the connector a token during sign-in. It's stored encrypted inside the connector's own sign-in record and is never shown to Claude or written to this repo.
- **One file.** GitHub's gist permission covers all your gists, but the connector only reads and writes the gist that holds `to-do-list.json`.
- **No secrets in the repo.** The GitHub app's client ID and secret live in Cloudflare as Worker secrets. `.dev.vars` (local testing) is git-ignored.

## Set it up (once)

You need Node 20 or later and the Cloudflare account that hosts your other workers.dev site. Commands run in this `connector` folder.

**1. Create a GitHub sign-in app.** On GitHub, go to Settings → Developer settings → OAuth Apps → **New OAuth App**:

- Application name: `To Do List connector`
- Homepage URL: `https://todo-connector.ruthieschwab.workers.dev`
- Authorization callback URL: `https://todo-connector.ruthieschwab.workers.dev/callback`

Register it, copy the **Client ID**, then **Generate a new client secret** and copy that too.

**2. Install and sign in to Cloudflare.**

```
npm install
npx wrangler login
```

**3. Create the storage for sign-ins.**

```
npx wrangler kv namespace create OAUTH_KV
```

Copy the `id` it prints into `wrangler.jsonc`, in place of the `<KV namespace id ...>` placeholder.

**4. Add the secrets.** Each command asks you to paste a value. If it asks whether to create a new Worker, answer yes.

```
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put COOKIE_ENCRYPTION_KEY
```

For `COOKIE_ENCRYPTION_KEY`, paste any long random string, for example the output of `openssl rand -hex 32`.

**5. Deploy.**

```
npx wrangler deploy
```

It should print `https://todo-connector.ruthieschwab.workers.dev`. If your workers.dev subdomain is different, change the three addresses (step 1, and `MCP_RESOURCE` in `wrangler.jsonc`) to match and deploy again.

**6. Add it to Claude.** In Claude, go to Customize → Connectors → **Add custom connector**. Name it `To Do List`, paste `https://todo-connector.ruthieschwab.workers.dev/mcp`, and continue. Approve the connector's page, then sign in with GitHub and allow access.

## Develop and test

```
npm test            # task rules and gist read/write, no network
npm run type-check
```

To run it locally, copy `.dev.vars.example` to `.dev.vars`, fill it in (a second GitHub OAuth app with callback `http://localhost:8788/callback`), then `npm run dev`.

After changing `wrangler.jsonc`, run `npx wrangler types` to refresh `worker-configuration.d.ts`.

## Files

| File | Purpose |
|---|---|
| `src/index.ts` | The MCP tools and the sign-in wiring |
| `src/todo.js` | Task rules: list, add, update, check off. Same task shape as `app.js`; tags from `../tags.js` |
| `src/gist.js` | Reads and writes the sync gist; merges with `../sync.js` before saving |
| `src/github-handler.ts` | GitHub sign-in, limited to `ALLOWED_GITHUB_LOGIN` |
| `src/utils.ts`, `src/workers-oauth-utils.ts` | Sign-in helpers from Cloudflare's MIT-licensed `remote-mcp-github-oauth` demo |
| `test/todo.test.js` | Tests |

These files sit outside the app's service worker list, so the app doesn't load them and `sw.js` needs no cache bump.
