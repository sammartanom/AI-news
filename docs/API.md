# API

JSON over HTTPS. Errors are `{ "error": "message" }` with an HTTP status. Fields not listed here are internal.

**Auth.** Public endpoints need none. Endpoints marked *signed in* need a verified Access session. Endpoints marked *editor* need the editor or admin role, or the `ADMIN_TOKEN` bearer token. Writes from a browser must send a same-origin `Origin` header and `Content-Type: application/json`. A caller without access to a list gets 404.

## Public

| Method and path | Notes |
| --- | --- |
| `GET /api/health` | `ok`, `database`, `vectorize`, `ai`, `semantic_search`, `answers`, `accounts`, `embedding` |
| `GET /api/config` | Vocabularies and feature flags the interface needs. Cached |
| `GET /api/search?q=` | Hybrid search. `audience` (lens, affects ranking), `collection`, `format`, `kind` (`articles`, `guides`, `lessons`, `courses`, `tools`, `videos`, `podcasts`, `research`), `evidence`, `grade`, `topic`, `limit` (max 50), `offset`, `explain=1`. Returns `mode` (`hybrid` or `keyword`), `degraded`, `total`, `results[]`, each with `score` and, with `explain`, `why_matched[]`. When nothing matches, `fallback` holds nearby `topics[]` and five editors' `picks[]` |
| `POST /api/ask` | `{ q, audience }`. Grounded orientation. 503 unless enabled, 429 when rate limited. `status` is `ok`, `no_results` or `generation_failed`. With `ok`: `orientation`, `considerations[]`, `uncertainty[]`, `start_with[]`, `evidence`, `basis`, `sources[]` |
| `GET /api/perspectives?q=` | Search results grouped by resource type and collection |
| `GET /api/paths?q=`, `GET /api/paths?preset=` and `GET /api/paths/presets` | Five-step reading path built from resources a person chose (reviewed or hand-picked). Presets: `teacher-start`, `leader`, `family` (cached; the older `new-principal` and `district-policy` open `leader`) |
| `GET /api/resources` | Grid. `sort` is `recommended` (editors' picks first), `newest` (default), `added`, `publisher`, `format` or `title`. `reviewed=1` keeps editors' picks only (chosen by hand or reviewed). Filters as search, plus `publisher`, `subject`, `dated=1`. `audience` filters here. `limit` (max 50), `offset`. Returns `total` |
| `GET /api/resources/:id` | One published resource |
| `GET /api/resources/:id/brief` | `brief` (2 or 3 AI-written sentences, or null) and `basis` (`page` or `listing`). Written on first request if the scheduled job has not reached it; rate limited per visitor. The resource itself also carries `brief` and `brief_basis` once written |
| `GET /api/resources/:id/related` | `curated[]` (with relationship label and note) and `similar[]` (with label) |
| `GET /api/resources/batch?ids=a,b` | Up to 50 published resources, in order |
| `GET /api/featured` | Featured resources for the home page |
| `GET /api/facets` | Counts for filters |
| `GET /api/topics`, `GET /api/topics/:slug` | Topic list and generated topic page |
| `GET /api/digest` | Latest weekly digest (built if the last one is a week old), or `?id=` for one digest. `headline`, `overview`, `overview[]` (paragraphs), `picks[]` (at most five, each with a one-line `why`), `generated` |
| `GET /feed.xml` | RSS 2.0 feed of the last 12 weekly digests |
| `GET /robots.txt` | Crawler rules (API, editor and Saved are not crawled) and the sitemap's address |
| `GET /sitemap.xml` | Home, Browse and each type, the reading paths, About, and every published resource (`/?r=<id>`) with the date it last changed |
| `GET /`, `/grid`, `/saved` | The app's page, with the title, description, canonical URL, Open Graph and X card tags and JSON-LD written for the URL (a resource, path, digest, type or search). See `src/routes/pages.mjs` |
| `POST /api/editor/digest` | Editor: build a fresh digest now |
| `GET /api/editor/export?table=&offset=&limit=` | Editor: one page (up to 250 rows) of a catalogue table for backups: `resources`, `sources`, `resource_relations`, `topic_pins`, `digests`. Returns `rows` and `next` |
| `GET /api/catch-up` | `audience`, `days` (1 to 180). Resources by date added to Signal |

A public resource has `published_at` (original publication date: `YYYY`, `YYYY-MM`, `YYYY-MM-DD` or `null` for unknown) and `added_at` (date added to Signal). `curation` is `curated` or `featured`. `summary` is present only if an editor approved it, and `summary_generated` says whether it was AI-written.

## Encrypted saves

There are no visitor accounts. These endpoints store opaque ciphertext made in the browser (see the README). `:id` and the bearer guard are 64 hex characters derived from the visitor's secret; an unknown id and a wrong guard both return 404.

| Method and path | Notes |
| --- | --- |
| `GET /api/vault/:id` | `Authorization: Bearer <guard>`. Returns `{ data, version }`. `no-store` |
| `PUT /api/vault/:id` | `{ data, version }`. `data` is base64url, at most 96 KB. `version: 0` creates; otherwise it must equal the stored version, else 409 with the current `{ data, version }`. Same origin only |
| `DELETE /api/vault/:id` | Deletes the blob. Same origin only |
| `GET /api/me` | Editor sign-in state for the editor console. Returns `user` or `null` |
| `GET /login?next=/path` | Editor sign-in through Access, if you use it |

## Editor

| Method and path | Notes |
| --- | --- |
| `POST /api/editor/session` | Body `{ "token": "…" }` with the `ADMIN_TOKEN`. Sets an HttpOnly, SameSite=Strict cookie that keeps this browser signed in as an editor for 90 days (an expiry plus an HMAC of it, keyed by the token; replacing the token invalidates every cookie). Same-origin only. 401 for a wrong token |
| `DELETE /api/editor/session` | Clears that cookie (sign out on this device) |
| `GET /api/editor/summary` | Counts and source health |
| `GET /api/editor/queue` | `status` (`indexed`, `published`, `rejected`), `source`, `flagged=1`, `broken=1`, `auto=1` (published automatically), `spot=1` (automatic, not yet spot-checked), `held=1` (pulled back automatically), `attention=1` (needs a person), `q`, `limit`, `offset` |
| `GET /api/editor/resources/:id` | Full record, relations, duplicate candidate |
| `POST /api/editor/resources` | Add by hand: `url`, `title`, `publisher` plus optional metadata. Queued as incoming. 409 if the URL exists |
| `PATCH /api/editor/resources/:id` | Edit metadata. Validated. Re-embeds if text fields change |
| `POST /api/editor/resources/:id/publish` | Needs a reason and an audience. Returns `indexing: { ok }` |
| `POST /api/editor/resources/:id/unpublish`, `.../reject` | Remove from the public site and the vector index. `reject` takes `{ reason }` |
| `POST /api/editor/resources/:id/spot-check` | Marks an automatic item as looked at |
| `POST /api/editor/resources/:id/suggest` | Model draft of empty fields. Nothing is saved. 503 if no model is set |
| `POST /api/editor/triage` | Run triage and queue expiry now |
| `POST /api/editor/resources/:id/check-link` | Checks the link now |
| `POST /api/editor/resources/:id/relations`, `DELETE .../relations/:rid` | `{ to_id, relation, note }`. Relations: `companion`, `practical_example`, `research`, `policy_context`, `newer`, `background`, `critical_perspective` |
| `GET /api/editor/sources`, `POST` | Registry. New sources start unreviewed and off |
| `PATCH /api/editor/sources/:id` | `review_status`, `enabled` (only if verified), `auto_publish` (only if verified and enabled), metadata |
| `POST /api/editor/sources/:id/run` | Run one source now |
| `DELETE /api/editor/sources/:id` | Remove a feed. Items it already added stay |
| `POST /api/editor/feeds/find` | Body `{ "url" }`: any page on a site, or a feed. Finds the feed (`<link rel=alternate>`, then common paths) and returns `feed_url`, `title`, item and AI-item counts, a sample of titles, and `existing` if it is already added. 422 when there is none |
| `POST /api/editor/feeds` | Body `{ "feed_url", "name", "publisher"?, "site_url"?, "ai_only"?, "review_first"? }`. Adds the feed in one step (id from the name, verified, on, publishing automatically unless `review_first`) and reads it once; returns the source and the run report |
| `POST /api/editor/resources/:id/restore` | Body `{ "to": "published" | "indexed" }`. Undoes a removal, keeping how the item was published |
| `POST /api/editor/ingest?force=1` | Run due sources (or all with `force`) |
| `POST /api/editor/reindex?limit=` | Embed published records that are missing or stale; retry vector deletions |
| `POST /api/editor/maintenance` | Fill missing keys and check links |
| `GET /api/editor/ingestion`, `GET /api/editor/audit` | Recent runs, recent editor actions |
| `PUT /api/editor/topics/:slug/pins` | `{ section, resource_ids[] }` |

Automation with the bearer token:

```sh
curl -X POST https://your-site.example/api/editor/reindex -H "Authorization: Bearer $ADMIN_TOKEN"
```
