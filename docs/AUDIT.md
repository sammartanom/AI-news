# Audit of the original project

The project arrived as `Signal_Fullstack_Source_Project_v2_1.zip`: 16 files, about 118 KB. This records what was in it, what state each part was in, and what was done with it.

## Inventory and status

| Part | Original state | What was done |
| --- | --- | --- |
| Visual direction (`public/styles.css`, `index.html`) | Working. Inter, white and near-black, one blue accent, a large central search, audience lenses, floating resource cards, hairline borders, dark mode | **Kept and refined.** Same layout and palette. See "Interface" below for what changed |
| Front-end logic (`public/app.js`) | Partial. 30 resources bundled into the script via a JSON import. Keyword scoring in the browser, then a second search path layered on top that took over if `/api/health` answered. Account UI could only list and create boards | **Replaced.** Same product, rebuilt as small modules that read from the API |
| Worker (`worker/index.mjs`) | Partial. One 11 KB file written as dense one-liners. Routes for health, resources, search, ask, me, boards, admin | **Replaced** by modules under `src/`, keeping the routes' intent. Several defects below |
| D1 schema (`migrations/0001_init.sql`) | Sound. Resources, sources, users, boards, members, items, ingestion log. Idempotent (`IF NOT EXISTS`) | **Kept unchanged.** All later changes are new migrations |
| Existing data (`resources.json`) | 30 curated records. All publication dates null, no summaries. Editorial `why` and `best_for` present. One companion link per record | **Kept**, converted to `data/resources.seed.json`. No data was invented. See "Data" below |
| Vectorize use | Sound. `@cf/baai/bge-base-en-v1.5`, mean pooling, upsert on publish and reindex, delete on reject | **Kept** (same model, pooling and dimensions). Added version, hash and state tracking, and failure handling |
| Workers AI answers | Partial. A prompt over titles and notes, `ENABLE_AI_ANSWERS` off by default, no output validation | **Rebuilt** with citation validation and a fallback. Still off by default |
| Ingestion | Partial. RSS and Atom parsing, ETag, a cron trigger. Defects below | **Rebuilt** |
| Authentication | Partial and unsafe as written. Trusted a request header | **Replaced** with JWT verification. See below |
| Saved lists | Partial. Tables fine, API created boards and added items. No rename, delete, remove member, read state, private notes or export | **Completed** |
| Cloudflare config (`wrangler.jsonc`) | Placeholder `REPLACE_WITH_D1_DATABASE_ID`. Rate-limit syntax valid | **Filled in** with the D1 id you gave. Syntax checked against current docs |
| Tests (`tests.mjs`) | Three parser tests | **Replaced** by the suites under `test/` |
| Docs | `README.md` described the Worker accurately but disclaimed testing. `DEPLOYMENT.md` described a Pages upload of a kit that was not in the ZIP. `DEPLOYMENT_FULLSTACK.md` repeated the README | **Rewritten.** The obsolete one is removed |
| `scripts/seed.sql`, `scripts/seed.mjs` | Generated SQL committed beside its generator | SQL file removed; generator rewritten |

## Duplicated and dead

- `resources.json` existed three times, byte for byte (`public/`, `scripts/`, `src/`). One copy remains.
- `src/resources.json` was not imported by anything.
- `DEPLOYMENT.md` referred to `Signal_Deployment_Kit/Signal_Deploy.zip`, which was not in the ZIP.
- Boards had `visibility` and `share_token` columns that no code used. The columns remain in the table (SQLite cannot drop them without a rewrite). `visibility` is now set when a list has members. `share_token` is never set.
- `board_items.note` was a note shared by everyone with access to the list. It is no longer read or written. Notes are per user in `user_resource_state`.

## Defects found in the Worker

1. **Spoofable identity.** `TRUST_ACCESS_HEADER=true` made the Worker trust `Cf-Access-Authenticated-User-Email`. Any client can send that header unless every route to the Worker passes through Access, and the original code could not tell. Replaced by verification of the signed Access JWT.
2. **The share route rejected every email address.** Its validation was written with doubled backslashes inside a regular expression literal (`/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/`). In a literal that means "a backslash" where a dot and whitespace were intended, so the pattern requires a backslash in the address. `teacher@school.org` fails it. Sharing could not have worked.
3. **Semantic matches could return empty records.** Vector matches were looked up in the list of published rows with a spread (`...by.get(id)`). A match for a record that was no longer published produced an object with only a score.
4. **Search loaded the table.** Every search and every browse read up to 500 rows and scored them in JavaScript. It would not scale to the stated goal of thousands of records.
5. **Publication date could come from the wrong field.** Atom `updated` was used when `published` was missing. That is a modification time. Now only publication fields count.
6. **Feed fetch.** The response body was read in full before the 2 MB check. Any redirect was an error, so a feed that moved to `https://www.` failed. No content-type check. No source host allowlist, so a feed could queue links to any site.
7. **No duplicate handling beyond a unique URL.** Tracking parameters were removed for `utm_*`, `fbclid` and `gclid` only. No DOI or title checks.
8. **Everything in a feed was queued,** whether or not it was about AI.
9. **Review endpoint.** One shared bearer token compared with `!==`, so no editor identity, no audit trail, and a timing difference. It set status first and embedded afterwards, so an embedding failure left a record published but not searchable by meaning, with a 500 and no retry.
10. **Ask.** No check that the answer was grounded or cited anything real, and no fallback shape on failure.
11. **Sources.** No review status. A source could be enabled with no record of anyone verifying the URL.
12. **Date formats.** `CURRENT_TIMESTAMP` defaults write `YYYY-MM-DD HH:MM:SS`. Mixed with ISO strings, ordering is wrong within a day. Normalized by migration 0002 and always written as ISO by the Worker.

## Interface

Kept: the layout, the palette, Inter, the wordmark, the hero, the lenses, the thin-bordered cards, the dark mode.

Changed:

- Inter now loads from the site itself. The original imported a stylesheet from a third-party host. The self-hosted file is the `inter-ui` build, which contains the `cv11` single-storey `a`. The Fontsource build of Inter does not, so it was not used. `font-feature-settings: "cv11"` is applied to the body and inherited by every control and the dialog, and a browser test checks it.
- Text sizes of 8 to 11 px became 11 to 14 px.
- Pill-shaped controls became 8 to 12 px radii, and the audience lenses became text with an underline.
- The glyph buttons (a half-circle for the theme, arrows on links and the search button, a multiplication sign to close) became words.
- The backdrop blur on the dialog and the shadow on the search field were removed.
- **Motion.** The original card animation set `translate` and `rotate` in a keyframe that also fought an inline `rotate`, moved 15 px over 15 s, and was easy to miss. Positions and drift now come from per-card custom properties. Cards move 16 to 26 px and tilt under 1 degree over 44 to 58 seconds, which a browser test measures as visible but slow. Hover and keyboard focus pause the drift, straighten and enlarge the card, and dim the rest. `prefers-reduced-motion` stops the drift.
- The mobile layout is its own composition rather than the desktop one shrunk.

## Data

The 30 records keep their ids, titles, URLs, publishers, formats, audiences, collections (mapped to the new names), reasons, best-for lines, verification notes and companion links. The eight cards that sat around the original home search are marked featured.

Not added: no dates, topics, summaries, authors, grade bands or resource types. None of those were in the source and none were guessed. No review timestamps were invented. The "Added to Signal" date is the time the row was first written to D1, which is a recorded fact.

Changed: three URLs carried page-state parameters (`?open=comments-sidebar`) or a browser text-fragment (`#:~:text=...`). Those were removed. Seeding fixes an existing row only if it still has the original URL.

### Needs an editor

These are the previous editor's choices, so they were left alone:

- Record 10 lists the publisher as "Digital Promise resource listing" but links to `engageai.org`. Confirm the publisher name.
- Formats are inconsistent: "Briefs", "Templates" and "Template", "Research listing", "Report listing", "Research coverage", "Recommendations", "Document". Records 4, 9 and 12 link to collection or listing pages rather than individual resources.
- 26 of the 30 carry the note "Linked from opened publisher page; destination not individually reviewed". They are marked unverified. Four say "Publisher page opened" and are marked checked.
- Several URLs contain dates in their paths (records 14 through 22). Signal does not read them. Add publication dates after opening each original.
- Some reasons are generic ("Use this for a family-focused starting point."). They remain until an editor rewrites them.

## Tested before and after

Before: three parser tests. After: unit, integration and browser tests described in the README, including tests that caught mistakes in this rebuild (the saved theme was not restored on reload, the mobile layout scrolled sideways, the first Tab on a fresh page skipped the skip link, and Ask Signal citation buttons had no usable size).
