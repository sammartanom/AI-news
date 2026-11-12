# AI for teachers · Pleasantville UFSD

A curated, searchable library of resources on AI in the classroom for Pleasantville Union Free School District teachers, plus a wider shelf of general AI news, research and policy. Search is the main way in.

It holds articles, research, lessons, videos, podcasts, guidance and classroom examples, gathered from vetted sources. It is built for teachers first: the home page leads with resources for teachers, the reading paths are for teachers (Start here, Classroom, Integrity), and the AI-written briefs and weekly digest are written for classroom teachers.

**Privacy.** The site collects and keeps no personal information. There are no accounts, no tracking, no analytics and no Cloudflare request logs. Saved resources stay in the visitor's browser (or, only if they choose, sync as end-to-end encrypted data the server cannot read). See [docs/PRIVACY.md](docs/PRIVACY.md).

It is a copy of [Signal](https://github.com/mikesammartano/signal) with the district's font (Figtree), colours and teacher focus. It runs as one Cloudflare Worker with static assets, a D1 database, a Vectorize index and Workers AI.

## What it does

- **Search.** Keyword search (SQLite FTS5, with prefix matching) and semantic search (Vectorize) are combined with reciprocal rank fusion. A small Workers AI model reads each search, fixes typos, expands acronyms and suggests other phrasings, which widen the search; a reranker then reorders the top matches by relevance. Editorial signals, the audience lens, question wording and source diversity adjust the order. Results can explain why they matched. If any AI step is slow or unavailable, keyword and vector results still return.
- **In brief.** Each resource opens with two or three AI-written sentences on what it is and covers, written once by a small Workers AI model from the start of the publisher's page (or its listing when the page cannot be read), stored, and labelled as AI-written.
- **Weekly digest.** A button on the home page opens a summary of what was added in the last seven days, as a two-paragraph overview and up to five picks worth reading. A Workers AI model writes it from titles and publishers only; without a model it is a plain roundup. Readers subscribe through an RSS feed at `/feed.xml`, or email a digest to colleagues from their own mail app.
- **About.** A short note about the site, in the menu. Edit it in `public/js/about.js`.
- **Ask Signal.** An optional short orientation, written only from the resources that search retrieved, with citations. Off by default. It never blocks search.
- **Curation.** Three levels: indexed (found automatically from a source you trust, public but labelled as not reviewed), curated (an editor published it) and featured (a small set for the home page). Each curated resource has a one-sentence reason it was included, a best-for line, an optional editor's note, and hand-picked "read with this" links.
- **Dates.** Original publication date and the date added to the library are separate fields. Unknown publication dates stay unknown. Nothing is inferred from URLs.
- **Browse.** A home page where resource cards circle the search, and the complete collection as a list or a card grid, with sorting and filters. Editors' picks come first by default. Topics (17, assigned by rules in `src/lib/autotopics.mjs` and never overriding an editor's) are a filter and link from each resource. Under the search, Start here, Classroom or Integrity opens a reading path for teachers, and a Browse button opens the whole collection: up to five steps, from understanding to action, built only from resources a person chose (reviewed by an editor or added by hand), never from feed items. The API still serves topics, perspectives and catch-up.
- **Saves without accounts.** Visitors save resources and write private notes with no sign-up. Saves can sync across devices through a passkey (WebAuthn PRF) or a private link and QR code; the browser encrypts everything with AES-GCM before it leaves, so the server stores only ciphertext. No likes, follows or public profiles. A saved list can be shared as a link (optionally with notes); the list travels inside the link after the `#`, so the server never stores it, and whoever opens it can save it all.
- **Ingestion.** A source registry, feed checks every two hours, back-catalogue reading for WordPress, Blogger and Substack sources, de-duplication and an incoming queue. Sources you mark "publish automatically" go public after automatic checks, labelled as not reviewed, and are never featured or used in reading paths. Everything else waits for an editor.
- **Editor console.** `/editor/`: a review view that shows only what needs a person (flagged, held back, spot checks), metadata editing, publish and reject, duplicate warnings, link checks, source health, and a one-click backup download of the catalogue on the Activity tab.

## Repository layout

```
src/                  Worker
  index.mjs             router entry and scheduled handler
  routes/               public, me (editor sign-in), vault (encrypted saves), editor endpoints
  search/               FTS keyword search, Vectorize, rank fusion, intent, embeddings
  discovery/            answers, related, perspectives, paths, topics, catch-up
  ingest/               safe fetch, feed parser, pipeline, archives, de-duplication, link checks
  curation/             publish, reject, edit, relations
  auth/                 Cloudflare Access JWT verification, users, roles
  repo/ lib/            queries, validation, URL and text helpers, vocabularies
public/               static site (no build step)
  js/ styles.css        interface
  editor/               editor console
  fonts/                Figtree, self-hosted
  _headers              security headers for static pages
migrations/           D1 schema, additive and numbered
data/                 seed resources and candidate sources
scripts/              seed generator, repository checks
test/                 unit, integration and browser tests; local harness
docs/                 architecture, configuration, deployment, privacy, API, audit
```

## Run it locally

Requires Node 22.13 or newer.

```sh
npm install
npm run dev
```

This starts `http://localhost:8787` using the real Worker code with an in-memory SQLite database, a seeded catalog, and mock Workers AI and Vectorize. You are signed in as `editor@signal.test`, who is an editor. Set `DEV_USER_EMAIL=` (empty) to browse anonymously, or `ANSWERS=1` to try Ask Signal with a stand-in model.

The mock embedding is a toy hashing model. It exercises the pipeline but says nothing about real search quality. To use the real bindings:

```sh
npm run db:migrate:local
npm run db:seed:local
npm run dev:cloudflare      # wrangler dev; AI and Vectorize bindings use your Cloudflare account
```

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | Unit and integration tests (real SQL, mock bindings) |
| `npm run test:e2e` | Browser tests against the local harness. Needs Playwright with Chromium |
| `npm run check` | Syntax, committed-secret scan, copy rules, migration safety |
| `npm run build:dry` | Bundles the Worker and validates `wrangler.jsonc` without deploying |
| `npm run ci` | `check`, `test` and `build:dry`. Use this as the Workers Builds build command |
| `npm run db:migrate:remote` | Applies pending migrations to the production D1 database |
| `npm run db:seed:remote` | Loads the seed catalog and candidate sources (idempotent) |

Browser tests need `npm install --no-save playwright` and `npx playwright install chromium`, or an existing Playwright installation.

## How search works

1. The query is cleaned and split into terms. Question words are dropped. Each term is quoted so search syntax in user text has no effect.
2. **Keyword:** FTS5 with Porter stemming, ranked by BM25 with higher weight on title, topics and the editor's reason. A short list of education synonyms widens it ("cheating" also finds "academic integrity"; `src/search/synonyms.mjs`). Only published resources are in the index.
3. **Semantic:** the query is embedded with `@cf/baai/bge-base-en-v1.5` (mean pooling, 768 dimensions) and sent to Vectorize. Matches below a similarity floor are dropped. Candidates are re-checked against D1, so an unpublished record can never be returned even if its vector is stale.
4. **Fusion:** reciprocal rank fusion, `score = sum of 1 / (60 + rank)` over both lists.
5. **Signals**, added to the normalized score: featured, editors' picks (chosen by hand or reviewed) and editor priority (small), a small step down for general AI news outside education, audience lens and audience words in the question, collection and resource-type hints from the question, grade band, and freshness. Freshness applies only when the question asks for recent material and only to resources with a known publication date.
6. **Diversity:** a publisher that already appears higher on the page is discounted by 15% per repeat.

All weights are in `src/search/rank.mjs`. Editorial priority is separate from evidence type. There is no quality score. A search that finds nothing returns nearby topics and a few editors' picks instead of an empty page. `test/unit/discoverability.test.mjs` holds a small evaluation set of real questions and the resource each should find.

Indexing and querying use one definition of the embedding model, pooling and text, in `src/search/embedding.mjs`. D1 stores the model, a version string and a hash of the embedded text for every record. Changing the strategy means bumping the version; the backfill then re-embeds everything.

## Curation and ingestion

```
discover -> normalize -> de-duplicate -> classify -> incoming queue -> editor review -> publish -> embed
```

- Sources live in the `sources` table. A source must be marked verified by an editor before it can be switched on. Feed URLs are never guessed.
- Fetching is HTTPS-only, to public hosts on the source's allowlist, with redirect limits, a timeout, a content-type check, a 2 MB cap enforced while streaming, and rejection of any XML DTD or entity declaration.
- Exact duplicates (same canonical URL) are skipped. Same DOI, same title, or a very similar title are queued with a warning. Nothing is merged automatically.
- Feed items are queued as metadata only. Full articles are not stored.
- Only Atom `published` and RSS `pubDate` or `dc:date` count as publication dates.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

## Saves and editor sign-in

Visitors have no accounts. Saves and notes live in the browser (`public/js/library.js`). To sync, the browser holds a random 32-byte secret and derives from it, with HKDF, a blob id, a guard and an AES-GCM key (`public/js/vault.js`). The Worker (`src/routes/vault.mjs`) stores the ciphertext under the id, keeps only a SHA-256 hash of the guard, answers unknown ids and wrong guards with the same 404, and accepts writes only as compare-and-swap on a version number. Devices merge by timestamp per item, so offline changes on two devices combine.

The secret reaches another device in one of two ways. A passkey made with the WebAuthn PRF extension yields a value only that passkey can produce; it opens a second small blob holding the secret. Passkeys sync through Apple, Google or Microsoft, so a visitor's other devices open the saves with Face ID or a fingerprint. Browsers without PRF use a private link or QR code that carries the secret after `#`, which browsers never send to servers. Deleting everywhere removes the blob; other devices clear their copy at their next sync.

Editors sign in with the `ADMIN_TOKEN` secret, or optionally through Cloudflare Access. The Worker verifies the signed Access JWT (header or `CF_Authorization` cookie) against your team's public keys and checks issuer, audience and expiry. It does not trust the plain `Cf-Access-Authenticated-User-Email` header. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the Access setup.

## Documentation

- [SETUP.md](SETUP.md): what you still need to do by hand
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Cloudflare and GitHub workflow, migrations, Access
- [docs/CONFIGURATION.md](docs/CONFIGURATION.md): bindings, variables, secrets
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): design, data model, ranking
- [docs/API.md](docs/API.md): endpoints
- [docs/PRIVACY.md](docs/PRIVACY.md): what is collected, sent to AI, stored, and deleted
- [docs/CURATION.md](docs/CURATION.md): editorial guidelines
- [docs/AUDIT.md](docs/AUDIT.md): what was in the original project and what happened to it
- [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)
- [CHANGELOG.md](CHANGELOG.md)

## Known limits

- Not yet deployed or exercised against a live Cloudflare account. Everything that touches Workers AI, Vectorize and Access was tested with doubles, and the Cloudflare configuration was only validated by `wrangler deploy --dry-run` and by applying the migrations to Wrangler's local D1.
- The similarity thresholds (`SEMANTIC_MIN_SCORE` 0.5, `RELATED_MIN_SCORE` 0.6) are starting values. Tune them against the real model.
- Source types `sitemap` and `api` can be registered but the ingester only runs `feed` sources.
- Interface accessibility was checked with automated tests and contrast calculations. It has not been audited with assistive technology, so the site does not claim WCAG conformance.
- Core Web Vitals have not been measured on a deployed site. The HTML, CSS and JavaScript are about 85 KB uncompressed (about 22 KB gzipped), plus a 100 KB font; see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#performance).
- A private link is a bearer secret: whoever has it can read and change those saves. Passkey sync needs a browser with the WebAuthn PRF extension (recent Chrome, Edge, Safari and Firefox); others fall back to the link.
