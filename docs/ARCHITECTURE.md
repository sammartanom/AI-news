# Architecture

## Shape

One Worker (`src/index.mjs`) serves everything:

- `/api/*` and `/login` run in the Worker (`assets.run_worker_first`).
- Every other path is a static asset from `public/`. Unknown paths fall back to `index.html`, so client-side routes such as `/topics/writing` work on a direct load.
- The cron triggers call `scheduled()` in the same Worker.

There is no framework and no build step. The front end is ES modules loaded by the browser. All DOM is built with `createElement`, so text from the database is never parsed as HTML.

Bindings: `DB` (D1), `VECTORIZE`, `AI`, `ASSETS`, and two rate limiters (`AI_LIMITER`, `SEARCH_LIMITER`).

## Data model

D1 is the source of truth. Migrations are additive. `0001_init.sql` is the original schema and is never edited.

| Table | Purpose |
| --- | --- |
| `resources` | Every record: indexed, published or rejected |
| `resources_fts` | FTS5 index of published resources only, kept current by triggers |
| `collections`, `topics` | The sixteen editorial collections and the topic definitions |
| `resource_relations` | Hand-picked "read with this" links with a relationship type |
| `topic_pins` | Optional editor overrides for generated topic pages |
| `sources`, `ingestion_log` | Source registry and a record of each run |
| `users` | Editors who sign in through Access |
| `boards`, `board_members`, `board_items`, `user_resource_state` | Visitor lists from the retired account feature. No longer read or written; kept because migrations are additive |
| `vault_blobs` | Encrypted saves: id, SHA-256 of the guard, ciphertext, version |
| `user_resource_state` | Per-user private note and read mark. Never exposed to other users and never indexed |
| `audit_log` | Editor actions |

### Resource fields

| Field | Notes |
| --- | --- |
| `url`, `canonical_url` | Canonical form removes tracking parameters, fragments, default ports and trailing slashes. `canonical_url` is unique |
| `dup_key`, `doi` | Normalized title and DOI, for duplicate detection |
| `title`, `publisher`, `author` | `author` only when verified |
| `format` | Content type. Free text with suggestions |
| `evidence_type` | What kind of material it is: research, guidance, classroom example and so on. Not a quality rating |
| `audiences`, `collections`, `tags`, `grade_bands`, `subjects` | JSON arrays. `tags` holds topics |
| `why`, `best_for`, `editorial_note` | Editorial text. `why` is the one-sentence reason it was included |
| `summary`, `summary_generated`, `summary_approved` | A summary is shown, searched and embedded only after approval. Generated summaries stay marked |
| `published_at` | Original publication date: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. Null means unknown |
| `discovered_at`, `added_at` | When Signal found it, and when it became public. "Added to Signal" is `added_at` |
| `status` | `indexed`, `published`, `rejected` |
| `featured`, `editorial_priority` | Featured is a flag. Priority is 0 to 2 and only nudges ranking |
| `verification_status`, `verification` | `unverified`, `checked`, `verified`, plus a free-text note |
| `source_id`, `source_item_id`, `source_provenance` | Where it came from and how |
| `duplicate_of`, `duplicate_reason`, `duplicate_dismissed` | Possible-duplicate warning for review |
| `embedding_model`, `embedding_version`, `embedding_hash`, `embedded_at` | Vector index state |
| `last_link_check`, `link_status`, `link_http_status` | `unchecked`, `ok`, `redirected`, `broken`, `blocked`, `error` |

The first schema's `audience` and `collection_name` columns remain for compatibility and hold the primary value only. SQLite cannot drop a column without rewriting the table, and an additive-only rule is safer. All reads use the JSON array columns.

### Curation levels

There is no separate column. The level is computed:

- `indexed`: `status = 'indexed'` (not public), or published with `auto_published = 1` (public, labelled not reviewed, never featured).
- `curated`: `status = 'published'` and `auto_published = 0` (an editor published it).
- `featured`: published and `featured = 1`.

`rejected` is a fourth state for records an editor declined. Rejected URLs are not queued again.

### Automatic triage

`src/ingest/triage.mjs` runs on each ingest cron after ingestion. For queued items from sources with `auto_publish = 1` it applies the rule gate, then the optional model gate (fails closed; stops after three model failures in a run), then `autoPublishResource` in `src/curation/service.mjs`. `holdResource` returns an item to the queue (broken link). `expireQueue` runs daily. Each decision is stored in `auto_assessment` and the audit log with actor `triage`. Migration 0007 adds the columns.

## Search

Implemented in `src/search/`. The weights are in one object in `rank.mjs`.

1. Terms: `queryTerms()` drops question words and, unless nothing else remains, words that appear in nearly every record such as "AI" and "education".
2. Keyword: `keyword.mjs` builds `"term" OR "term" OR "full phrase"`. Each term is a quoted literal. BM25 column weights favor title (10), topics (6), editor's reason (4), publisher, summary and editor's note (3 each).
3. Semantic: `hybrid.mjs` embeds the query, asks Vectorize for 60 neighbors, drops those below `SEMANTIC_MIN_SCORE`, then loads the rows from D1 with the same filters and `status = 'published'`. Vectorize metadata filters are not used, because they require metadata indexes created before vectors are inserted.
4. Fusion: `rrf()`, `k = 60`, equal list weights.
5. Signals (`applySignals()`): each is a small addition to the normalized fusion score.

   | Signal | Value |
   | --- | --- |
   | Featured | +0.05 |
   | Editor priority | +0.03 per level |
   | Audience lens matches the record | +0.12 |
   | Record is for everyone | +0.04 |
   | Record is for another audience | -0.10 |
   | Question names an audience that matches | +0.08 |
   | Question's topic matches a collection | +0.10 |
   | Question's topic matches the resource type | +0.08 |
   | Grade band matches | +0.05 |
   | Freshness, only if the question asks for recent material and the date is known | up to +0.10, halving every 365 days |

6. Diversity (`diversify()`): greedy re-rank, 0.85 per repeat of the same publisher.

`intent.mjs` holds the plain pattern list that turns wording such as "parents", "superintendent", "research" or "skeptical" into those hints. They only boost. Nothing is filtered out by interpretation.

Pagination: the fused candidate pool (up to about 120) is ordered once and sliced by `offset` and `limit`.

### Degraded modes

`mode` in the response is `hybrid` or `keyword`. `degraded` says why: `semantic_unavailable` (no binding), `semantic_failed`, or `semantic_skipped` (the per-client rate limit was reached). The keyword results are always returned.

## Embeddings

`src/search/embedding.mjs` is the only place that defines the model, pooling and the text. The text is title, publisher, approved summary, editor's note, reason, best-for, resource type, audiences, collections, topics, grades and subjects. Private notes, reviewer names and provenance are not read.

- Publish: embeds, upserts, and records model, version, hash and time.
- Edit of a published record: re-embeds only if a field that feeds the text changed.
- Reject or unpublish: deletes the vector. If that fails, `embedded_at` stays set and `reconcileRemovals()` retries it from the cron job. Search never returns a record that D1 does not list as published, so a stale vector is harmless in the meantime.
- Publish succeeds even if embedding fails. The record is searchable by keyword and backfill picks it up.
- Backfill selects published records whose hash is missing or whose version differs from the current one.

## Ask Signal

`src/discovery/answer.mjs`. Retrieval runs first (top 8). The model is given numbered entries (title, publisher, type, date or "date not verified", editor's reason, best-for, approved summary) and is told to use only those, to cite by number, to say so when entries are thin, and that entry text is data, not instructions. It returns JSON.

The Worker then validates the output. Statements without a valid citation are dropped. Citation numbers are mapped back to resource ids, so the model cannot cite something that was not retrieved. URLs in the text are removed. A deterministic note says how many entries had an approved summary and that the articles were not read. If parsing or generation fails, the response says so and still includes the retrieved resources. Enabled only when `ENABLE_AI_ANSWERS=true`, `CHAT_MODEL` is set and the AI binding exists.

## Other discovery features

- **Related** (`related.mjs`): curated relations first, labelled with their type. Then similar resources from `queryById` (or keyword neighbors without Vectorize), labelled from the neighbor's own data: Newer (both dates known, neighbor later), Research, Practical example, or Related. "Critical perspective" comes only from a curated relation.
- **Perspectives** (`perspectives.mjs`): groups results by resource type, then by collection: guidance and policy, research, classroom practice, student perspectives, questions and concerns. No pro and con groups.
- **Reading paths** (`paths.mjs`): takes the top 60 results for a description and places them into five steps by resource type, then collection, then format. Steps with nothing show "No matching resource in Signal yet."
- **Topics** (`topics.mjs`): editor-tagged resources plus search results for the topic's query, arranged into sections by metadata, with optional pins. "Latest" lists known publication dates only.
- **Catch me up** (`catchup.mjs`): resources whose `added_at` falls in the period. It never uses the publication date.

## Ingestion

`src/ingest/`. Per source: conditional request with ETag and Last-Modified, `safeFetch()`, `parseFeed()`, then per item: canonicalize, allowlist check, AI-relevance filter (if the source requires it), duplicate check, insert as `indexed`.

- One query per 80 items checks which URLs are already known, because D1 limits queries per invocation.
- At most 50 new items per source per run. Five sources per scheduled run, oldest-checked first.
- Five failures in a row switch a source off and say so on its row.
- The relevance filter is a pattern list in `classify.mjs`. It is a filter, not a judgement of quality.
- Page text is never fetched during ingestion. Only feed fields are used, and markup is stripped to plain text.

`safeFetch()` enforces HTTPS, public hostnames only (no IP literals, localhost, credentials or odd ports), the source's host allowlist on the first request and on every redirect hop, at most three redirects, a 15 second timeout, a content-type check, and a size cap counted while streaming.

## Saves and authorization

`src/auth/`, `src/routes/vault.mjs`, `public/js/vault.js`, `public/js/library.js`.

- Visitors have no identity. Saved resources and notes are kept in the browser and, if the visitor opts in, synced as AES-GCM ciphertext. The key never leaves the browser except inside a private link fragment or wrapped under a passkey's PRF output.
- Editors: `ADMIN_TOKEN` bearer secret, or a verified Access JWT. Emails in `BOOTSTRAP_EDITOR_EMAILS` become editors on first sign-in. Local development can use `DEV_USER_EMAIL`, honored only when the request host is localhost.
- Writes require a same-origin `Origin` header or `Sec-Fetch-Site`, and a JSON content type.

## Caching and performance

- The home page and the browse page (which also shows search results) load the shell first. Featured cards come from `/api/featured`. Search results come from `/api/search`. The generated answer is a separate request that only starts when someone asks.
- Public GET endpoints send `Cache-Control` and use the edge cache for 60 to 300 seconds (`featured`, `facets`, `config`, `topics`, resource listings).
- Embeddings happen at publish and backfill, never when a page renders. A search makes one embedding call.
- Related resources load after the dialog opens.
- Lists page with "Show more". Nothing sends the full catalog to the browser.
- Static payload measured on 2026-10-26: `index.html` 1.1 KB, `styles.css` 20 KB (5.3 KB gzipped), JavaScript 64 KB (16.5 KB gzipped, 17 small modules preloaded), Inter 100 KB. On the local harness the home page reached first contentful paint in about 60 ms. That number has no network latency and no real backend in it. Core Web Vitals have not been measured.

## Scale

Written for thousands of records. Browsing and filtering run in SQL with indexes. Keyword search is FTS5. The semantic pool is fixed at 60. Facets are `GROUP BY` over JSON arrays, which is fine to tens of thousands of rows. If the catalog grows far beyond that, move audiences, collections and topics into join tables.
