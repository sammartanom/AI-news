# Setup: what is left for you to do

Everything here happens in the Cloudflare dashboard and the site's own editor. No command line.

## Already done

- **Database.** Nothing to create. The first deploy creates a D1 database named `ai-news` in whichever Cloudflare account you connect, and the site creates its tables the first time it runs.
- **Privacy settings.** No accounts, Cloudflare request logs off, no donate link. See [docs/PRIVACY.md](docs/PRIVACY.md).
- **Search** works without a Vectorize index (keyword search, the AI search helper and the AI reranker). Search by meaning is off because an index can only be created from the command line; see `wrangler.jsonc` to add it later.

## 1. Create the Worker from GitHub

1. Go to https://dash.cloudflare.com and sign in to the account you want the site in.
2. If you can see more than one account, pick the right one first (account menu, top left).
3. In the left sidebar choose **Compute (Workers)** → **Workers & Pages**.
4. Click **Create application** (top right).
5. Choose **Import a repository** (or **Continue with GitHub**).
6. If GitHub is not connected, or `AI-news` is not listed: choose **Add account** / **Connect GitHub**, pick the **sammartanom** account, and allow access to the **AI-news** repository.
7. Select **AI-news**.
8. Fill in:
   - **Project name:** `ai-news` (must match exactly)
   - **Build command:** `npm ci && npm run ci`
   - **Deploy command:** `npx wrangler deploy`
   - Leave the root directory empty.
9. Click **Create and deploy** (or **Deploy**). The first build takes 2 to 4 minutes. It turns green when done.

Every change merged to `main` deploys the same way from now on.

## 2. Set the editor password

1. Open the new **ai-news** Worker → **Settings** → **Variables and Secrets** → **Add**.
2. **Type:** Secret. **Variable name:** `ADMIN_TOKEN`. **Value:** a long random password (at least 24 characters). Keep it somewhere safe: anyone with it can edit the library.
3. Click **Deploy** (or **Save**).

## 3. Open the site

On the Worker's **Overview** (or **Settings** → **Domains & Routes**) you will see the address, `https://ai-news.<your-subdomain>.workers.dev`.

## 4. Copy Signal's library across

1. On Signal, open `/editor/` → **Activity** → **Download a backup**. Wait until it says "Backup downloaded".
2. On the new site, open `/editor/`, paste the `ADMIN_TOKEN`, then **Activity** → **Import a backup** → choose the file you just downloaded.
3. Leave the tab open until it says "Imported: …" (a few minutes for a few thousand resources). If it stops, run it again: nothing is added twice, and nothing already here is changed.

Resources, their AI briefs, feeds, links between resources, topic pins and past digests all come across. Resources Signal removed come across as removed, so the feeds do not add them again.

## Optional

- **A district web address.** Worker → **Settings** → **Domains & Routes** → **Add** → **Custom domain** (the domain must be on Cloudflare).
- **Logs.** Worker → **Settings** → **Observability**: leave Workers Logs off so no request data is kept. `wrangler.jsonc` keeps them off on every deploy.
- **Feeds.** Pause or remove any source in `/editor/` → **Feeds**.

## Backups

`/editor/` → **Activity** → **Download a backup**. Cloudflare also keeps 7 days of database history (Time Travel).
