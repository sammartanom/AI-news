# Changelog

## 1.0.0 (2026-11-12)

First release for Pleasantville UFSD teachers, copied from Signal.

- **Look.** Figtree font and the district palette (Ink, Slate, Silver, Cloud, Forrest, Leaf, Lime, Citrus, Hunter). Green accents in light mode, a deep green dark mode, new share image and app icons.
- **For teachers.** "AI for teachers." heading; reading paths for teachers (Start here, Classroom, Integrity) replace Teacher, Leader and Parent, and old path links open the teacher path. The home page leads with resources for teachers. Example searches, AI briefs, the weekly digest and the optional answer are written for classroom teachers.
- **Browse.** A "Browse all resources" button on the home page, for anyone who misses the menu.
- **Privacy.** No accounts, no Cloudflare request logs, no donate link, no third-party frames. A test fails the build if any of these is switched back on.
- **Feeds.** Five more vetted feeds from Signal: AI4K12, FutureEd, KQED MindShift, Internet Matters and MIT Sloan Teaching & Learning Technologies.
- **Import a backup.** Editor → Activity → **Import a backup** adds everything from a backup file (this site's or Signal's) that is not here yet, a few rows at a time, without changing what is here. Search vectors are rebuilt rather than copied.
- **Select all** above the Review and Library lists in the editor, with "Select all N" when more items wait than are shown.
- **Any Cloudflare account.** No database id in the config: the first deploy creates the database in the connected account and the Worker creates its own tables on first use.
- **No Vectorize index needed.** Search runs on keyword search, the AI search helper and the reranker; search by meaning can be added later.
- **Fix.** A picked-up home card now stays clear of the menu button at its full lifted size.
