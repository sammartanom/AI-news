# Setup: what is left for you to do

Only steps that need your Cloudflare or GitHub account, all in the dashboards. Everything else is in the repository.

## Already done

- **Database.** The D1 database `ai-news` (id `23ed53a8-9711-4938-a7fb-b4d78214425a`) exists in the Cloudflare account, with every migration applied. It holds the 30 starter resources and 123 vetted feeds. The feeds are switched on and publish automatically, so the library fills itself over the first days.
- **Privacy settings.** No accounts, Cloudflare request logs off, no donate link. See [docs/PRIVACY.md](docs/PRIVACY.md).

## 1. Create the search index

Cloudflare dashboard → **Storage & databases** → **Vectorize** → **Create index**:

- Name: `ai-news-resources`
- Dimensions: `768`
- Metric: `cosine`

Do this before step 2: the first deploy fails if the index does not exist.

## 2. Create the Worker from GitHub

Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository** → **GitHub**. If `sammartanom/AI-news` is not listed, choose to add a GitHub account and give the Cloudflare app access to that repository.

- Project name: `ai-news` (it must match `name` in `wrangler.jsonc`)
- Production branch: `main`
- Build command: `npm ci && npm run ci`
- Deploy command: `npx wrangler deploy`

Every merge to `main` then deploys automatically. The site appears at `https://ai-news.<your-subdomain>.workers.dev`.

## 3. Set the editor password

Open the Worker → **Settings** → **Variables and Secrets** → **Add** → type **Secret**, name `ADMIN_TOKEN`, with a long random value (at least 24 characters). Keep it private: anyone who has it can edit the library. Replacing it signs every device out.

## 4. Check that logs are off

Open the Worker → **Settings** → **Observability**. Workers Logs should be off; `wrangler.jsonc` turns them off on every deploy. Leave them off so no request data is kept.

## 5. Build the search index

Open `/editor/` on the site, paste the `ADMIN_TOKEN`, then **Feeds** → **Run scheduled jobs now** → **Update search**. Repeat until it reports nothing remaining. Feeds are read every two hours from then on; new items are added to search automatically.

## 6. Optional

- **A district web address.** Worker → **Settings** → **Domains & Routes** → **Add** → **Custom domain** (the domain must be on Cloudflare).
- **Protect `main`.** In GitHub, require pull requests and the `test` check before merging.
- **Feeds.** Pause or remove any source in `/editor/` → **Feeds**. Read each publisher's terms of use.
- **Ask.** The optional AI answer is off. To turn it on, set `CHAT_MODEL` and `ENABLE_AI_ANSWERS` in `wrangler.jsonc` after a privacy review.

## Backups

In `/editor/` → **Activity** → **Download a backup**. Cloudflare also keeps 7 days of database history (Time Travel).
