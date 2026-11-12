# Deployment

Signal is a Worker with static assets. Dashboard drag-and-drop Pages upload does not provide D1, Vectorize, Workers AI, cron triggers or Access, so it cannot run this project.

## One-time setup

The exact steps are in [SETUP.md](../SETUP.md). In short: make sure the D1 database and Vectorize index exist in the target account, apply migrations, seed, set the editor secret, configure Access, connect the repository.

## Connecting GitHub

Use one of these. Do not enable both.

### A. Workers Builds (recommended)

In the Cloudflare dashboard, open the Worker, then Settings, Builds, and connect the GitHub repository. Use:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Build command | `npm ci && npm run ci` |
| Deploy command | `npx wrangler deploy` |

`npm run ci` runs the repository checks, the unit and integration tests, and a dry-run bundle that validates `wrangler.jsonc`. A failure stops the build, so nothing deploys. The Worker name in `wrangler.jsonc` (`ai-news`) must match the Worker you connect.

The browser tests need Chromium, so they run in GitHub Actions (`.github/workflows/ci.yml`) rather than in the build. To make them block production too, protect `main` in GitHub: require pull requests and require the `test` check to pass before merging. Then only a green commit reaches `main`, and only `main` deploys.

The deploy command deliberately does not apply migrations.

### B. GitHub Actions

`ci.yml` has a `deploy` job that runs only on `main`, only after every test job passes, and only if the repository variable `DEPLOY_WITH_GITHUB_ACTIONS` is `true`. It needs the secrets `CLOUDFLARE_API_TOKEN` (permission to edit Workers) and `CLOUDFLARE_ACCOUNT_ID`. Create a GitHub environment named `production` to add required reviewers if you want a human gate.

## Migrations

Migrations are numbered SQL files in `migrations/`. Rules:

- **Additive only.** New tables, new columns with defaults, new indexes, data backfills. `npm run check` fails on `DROP`, `DELETE FROM`, `TRUNCATE` or `RENAME` in a migration unless the file carries a `-- allow-destructive: <reason>` comment, so a destructive change needs a deliberate, reviewable choice.
- **Never edit an applied migration.** Add a new one. `0001_init.sql` in particular is shared with databases created by the original project.
- **Expand and contract** for anything that would break running code: add the new shape, deploy code that writes both, backfill, deploy code that reads the new shape, and only later remove the old shape in its own reviewed migration.

Applying:

```sh
npx wrangler d1 migrations list DB --remote     # what is pending
npm run db:migrate:remote                       # apply
```

or run the **Apply D1 migrations** workflow in GitHub (manual, with a list step and a confirm step).

If the database was created by the original project with `wrangler d1 execute --file=migrations/0001_init.sql`, it has the tables but no migration history. `0001` uses `CREATE TABLE IF NOT EXISTS`, so applying all migrations is safe: `0001` is a no-op and `0002` onward add to it. The upgrade was tested on a database holding the original schema and the 30 original rows.

Back up first with D1 Time Travel. Note that `wrangler d1 export` may not support databases that contain FTS5 virtual tables; check the current D1 documentation.

## Seeding

```sh
npm run db:seed:remote
```

Inserts the 30 original resources (as published, with their relations) and three candidate sources (unreviewed, switched off). It uses `INSERT OR IGNORE`, so it never overwrites an editor's changes and is safe to run again. It also repairs three original URLs that carried page-state parameters or a text fragment, but only if the row still has the original URL.

## Cloudflare Access

Access provides identity. Signal verifies the Access JWT itself. It never trusts the `Cf-Access-Authenticated-User-Email` header, because a client can send that header to any hostname not covered by Access.

Recommended layout, with a custom domain or the `workers.dev` hostname:

1. Create **one** self-hosted Access application with these destinations on the Worker's hostname:
   - `/login`
   - `/editor*`
   Add more paths only if you want them to require sign-in.
2. Add an Allow policy for the people who may sign in: your school or district identity provider, an email domain, or One-time PIN.
3. Under the application's cookie settings:
   - Turn **Cookie Path Attribute** off. When it is on, the `CF_Authorization` cookie is scoped to the application's path, and the browser would not send it to `/api/editor`, so the editor console would not see the sign-in.
   - Leave **Binding Cookie** off.
4. Copy the application's **Audience tag** into `ACCESS_AUD` and your team domain into `ACCESS_TEAM_DOMAIN`, then redeploy.

How it works: an editor who follows **Sign in with Cloudflare Access** in the editor console goes to `/login`. Access authenticates them and sets `CF_Authorization` for the hostname. `/login` then sends them back to the page they came from. Later calls to `/api/me` and the editor APIs carry the cookie, and the Worker verifies the JWT in it against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, with issuer, audience and expiry checks. Everything public stays reachable without signing in. Editor access is enforced by the Worker through `users.role` in addition to whatever Access policy you put on `/editor*`.

If you want the entire site private (for example a staging copy), put Access on the whole hostname and leave the Worker as is; the same verification applies.

Before relying on this, check in your own account that `/login` shows the Access prompt, that `/api/me` returns your email afterwards, and that `/editor/` loads only for allowed people. Test with a private window to confirm anonymous visitors still see public search.

## After a deploy

1. `GET /api/health`: `database` is true, and `vectorize` and `ai` are true.
2. Sign in, open `/editor/`, Feeds, **Run scheduled jobs now**, **Update search**. Repeat until nothing remains.
3. Search a few questions you know the answers to. Adjust `SEMANTIC_MIN_SCORE` if results include unrelated resources or miss obvious ones.
4. Open Feeds and review the candidate feeds.

## Rollback

Workers keep previous versions. Roll back from the dashboard (Deployments) or `npx wrangler rollback`. Migrations are additive, so older code keeps working with a newer schema. Restoring data is a D1 Time Travel operation.
