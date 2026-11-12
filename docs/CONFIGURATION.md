# Configuration

Everything is in `wrangler.jsonc`, except secrets. No secret is stored in the repository. `npm run check` fails if one looks committed.

## Bindings

| Binding | Resource | Notes |
| --- | --- | --- |
| `DB` | D1 `signal`, id `1213afdb-ba22-419e-add1-f2f7b2834b92` | The id is an identifier, not a secret. Migrations in `migrations/` |
| `VECTORIZE` | Vectorize index `signal-resources` | 768 dimensions, cosine |
| `AI` | Workers AI | Embeddings always. Chat model only if answers are enabled |
| `ASSETS` | Static files in `public/` | `run_worker_first` is `["/api/*", "/login"]` |
| `AI_LIMITER` | Rate limit, 10 per 60 s per client | Protects Ask Signal |
| `SEARCH_LIMITER` | Rate limit, 60 per 60 s per client | Past the limit, search still works but skips semantic retrieval |

`namespace_id` for a rate limiter is an integer you choose, unique within the account. `1107` came with the original project and `1108` was added. Change them if either is already used in your account.

## Variables (`vars`)

These are not secret.

| Name | Default | Meaning |
| --- | --- | --- |
| `ENABLE_AI_ANSWERS` | `"false"` | Turns Ask Signal on. Also needs `CHAT_MODEL` |
| `TRIAGE_MODEL` | `""` | Optional Workers AI text model used to tag newly found items from automatic sources. Empty means rules only, and the model is not used. Falls back to nothing for publishing; `CHAT_MODEL` is used only for "Draft with model" |
| `TRIAGE_MIN_CONFIDENCE` | `"0.7"` | Minimum model confidence for automatic publishing |
| `QUEUE_EXPIRE_DAYS` | `"30"` | Reject untouched queued items from automatic sources after this many days. `0` turns it off |
| `SEARCH_MODEL` | `"@cf/meta/llama-3.1-8b-instruct-fast"` | Text model that rewrites searches and suggests alternative phrasings. Empty turns it off |
| `RERANK_MODEL` | `"@cf/baai/bge-reranker-base"` | Reranker that reorders the top 40 matches by relevance. Empty turns it off |
| `DIGEST_MODEL` | `"@cf/meta/llama-3.3-70b-instruct-fp8-fast"` | Text model that writes the weekly digest. Empty means a plain roundup without generated text |
| `BRIEF_MODEL` | `"@cf/meta/llama-3.1-8b-instruct-fast"` | Text model that writes the short "In brief" description of each resource from the start of its page. Written once per resource (8 per scheduled ingest run, or on first view) and stored. Empty turns it off |
| `CHAT_MODEL` | `""` | A Workers AI text-generation model id from the current catalog. Empty means answers are off |
| `ACCESS_TEAM_DOMAIN` | `""` | Your Access team domain, `your-team.cloudflareaccess.com` |
| `ACCESS_AUD` | `""` | Audience tag of the Access application. Several tags may be listed, separated by commas |
| `SHARE_ALLOWED_DOMAINS` | `""` | Comma-separated email domains lists can be shared with. Empty means any |
| `SEMANTIC_MIN_SCORE` | `"0.5"` | Cosine similarity floor for semantic matches. A starting value; tune it |
| `RELATED_MIN_SCORE` | not set (code default 0.6) | Similarity floor for the Related list |
| `BOT_CONTACT` | `""` | Optional contact URL or email added to the `User-Agent` of feed and link requests |

Editor sign-in through Access is enabled when both `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are set. Visitors never sign in.

## Secrets

Set with `npx wrangler secret put NAME`, or in the dashboard under the Worker's settings. For local `wrangler dev`, put them in `.dev.vars` (git-ignored; see `.dev.vars.example`).

| Name | Required | Meaning |
| --- | --- | --- |
| `BOOTSTRAP_EDITOR_EMAILS` | Yes, for the first editor | Comma-separated emails that become editors when they first sign in. After that, roles live in the `users` table |
| `ADMIN_TOKEN` | Yes, if you do not use Access | Random token of at least 24 characters (shorter is ignored). Signs editors in to `/editor/` without Access, and can call `/api/editor/*` for automation. Compared in constant time. It grants catalog editing only |
| `DEV_USER_EMAIL` | Never in production | Local only. Honored only when the request host is `localhost` |

## Cron triggers

| Schedule | Runs |
| --- | --- |
| `17 */2 * * *` | Key backfill, feed ingestion (eight sources), one archive page for each of six sources, triage, vector removal retry, vector backfill |
| `43 3 * * *` | Key backfill, link checks (40 resources), queue expiry, vector removal retry, vector backfill, weekly digest |
| `47 1-23/2 * * *` | AI briefs (18 resources, editors' picks first), then rule-based topics for untagged resources |

Every run except the brief run also tags untagged resources with topics. `src/jobs.mjs` holds the same three strings. A test fails if `wrangler.jsonc` and the code disagree.

## Security headers

Static pages get their headers from `public/_headers`: a strict content security policy (no inline script or style, same-origin only), `X-Frame-Options: DENY`, no referrer, and a restrictive permissions policy. Workers static assets do not apply `_headers` to responses produced by the Worker, so API responses set `Cache-Control`, `X-Content-Type-Options` and `Referrer-Policy` themselves.
