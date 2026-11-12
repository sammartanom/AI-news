# Release checklist

Before merging to `main`:

- [ ] `npm run ci` passes locally
- [ ] `npm run test:e2e` passes locally, or the `test` job in GitHub Actions is green
- [ ] No secret in the diff. `npm run check` passes
- [ ] Any new migration is additive, numbered next, and `0001_init.sql` is untouched
- [ ] `CHANGELOG.md` describes material changes
- [ ] `SETUP.md` lists any new manual step, and nothing that is already done
- [ ] Documentation matches behavior (README, `docs/`)
- [ ] New interface copy is plain. No hype words, no emoji. `npm run check` enforces the list

Before deploying a release with a schema change:

- [ ] Run **Apply D1 migrations** with `list`, read the pending list
- [ ] Note the current time for D1 Time Travel
- [ ] Apply migrations, then deploy

After deploying:

- [ ] `GET /api/health` shows `database`, `vectorize`, `ai` true
- [ ] Home page loads, search returns results, a resource dialog opens
- [ ] Sign-in works, `/api/me` shows the user, saving a resource works
- [ ] `/editor/` loads for an editor and not for anyone else
- [ ] Editor Feeds, Run scheduled jobs now: **Update search** reports nothing remaining
- [ ] A rejected or unpublished resource no longer appears in search
- [ ] Cloudflare shows the cron triggers, and the next run completes (Feeds, Activity)

Do not mark a release done on the basis of a deploy command. Check the Cloudflare deployment status and the items above.
