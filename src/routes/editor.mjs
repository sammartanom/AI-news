import { route } from '../router.mjs';
import { json, readJson, assertSameOrigin, HttpError, intParam } from '../lib/http.mjs';
import { requireEditor } from '../auth/session.mjs';
import { deviceCookie, clearDeviceCookie, tokenMatches, DEVICE_DAYS } from '../auth/device.mjs';
import { getRow, toEditor } from '../repo/resources.mjs';
import { listSources, createSource, updateSource, getSource, sourceView } from '../repo/sources.mjs';
import { audit } from '../repo/audit.mjs';
import * as S from '../curation/service.mjs';
import { ingestSource, runIngestion } from '../ingest/pipeline.mjs';
import { runArchive } from '../ingest/archive.mjs';
import { readPageMeta } from '../ingest/pagemeta.mjs';
import { findDuplicates } from '../ingest/dedupe.mjs';
import { canonicalizeUrl } from '../lib/url.mjs';
import { FetchError } from '../ingest/safe-fetch.mjs';
import { findFeed, sourceIdFrom } from '../ingest/discover.mjs';
import { checkAndStore, runLinkChecks } from '../ingest/linkcheck.mjs';
import { backfill, reconcileRemovals, EMBEDDING } from '../search/embedding.mjs';
import { runTriage, expireQueue, askModel, suggestModel, triageModel } from '../ingest/triage.mjs';
import { backfillKeys } from '../repo/maintenance.mjs';
import { STATUSES } from '../lib/taxonomy.mjs';
import { buildDigest } from '../discovery/digest.mjs';

// Every editor route: editor identity (or automation token) and, for writes, same-origin.
const guard = (c) => {
  const who = requireEditor(c);
  if (c.req.method !== 'GET' && !(who.actor === 'automation')) assertSameOrigin(c.req);
  return who;
};

// Paste the editor token once; this browser then stays signed in (an HttpOnly cookie) for 90 days.
route('POST', '/api/editor/session', async (c) => {
  assertSameOrigin(c.req);
  const body = await readJson(c.req);
  if (!tokenMatches(c.env, body.token)) throw new HttpError(401, 'That token was not accepted');
  await audit(c.env, 'editor', 'sign_in', 'device', null, { days: DEVICE_DAYS });
  return json({ ok: true, days: DEVICE_DAYS }, 200, { 'Set-Cookie': await deviceCookie(c.req, c.env) });
});

route('DELETE', '/api/editor/session', async (c) => {
  assertSameOrigin(c.req);
  return json({ ok: true }, 200, { 'Set-Cookie': clearDeviceCookie(c.req) });
});

route('GET', '/api/editor/summary', async (c) => {
  guard(c);
  const q = (sql, ...b) => c.env.DB.prepare(sql).bind(...b).first('n');
  const [indexed, published, rejected, flagged, broken, blocked, unembedded, featured, autoPub, spot, held, attention] = await Promise.all([
    q(`SELECT count(*) AS n FROM resources WHERE status = 'indexed'`),
    q(`SELECT count(*) AS n FROM resources WHERE status = 'published'`),
    q(`SELECT count(*) AS n FROM resources WHERE status = 'rejected'`),
    q(`SELECT count(*) AS n FROM resources WHERE status = 'indexed' AND duplicate_of IS NOT NULL AND duplicate_dismissed = 0`),
    q(`SELECT count(*) AS n FROM resources WHERE status = 'published' AND link_status = 'broken'`),
    q(`SELECT count(*) AS n FROM resources WHERE status = 'published' AND link_status = 'blocked'`),
    q(`SELECT count(*) AS n FROM resources WHERE status = 'published' AND (embedding_hash IS NULL OR embedding_version IS NOT ?)`, EMBEDDING.version),
    q(`SELECT count(*) AS n FROM resources WHERE status = 'published' AND featured = 1`),
    q(`SELECT count(*) AS n FROM resources WHERE status = 'published' AND auto_published = 1`),
    q(`SELECT count(*) AS n FROM resources WHERE status = 'published' AND auto_published = 1 AND spot_checked_at IS NULL`),
    q(`SELECT count(*) AS n FROM resources WHERE status = 'indexed' AND auto_hold IS NOT NULL`),
    q(`SELECT count(*) AS n FROM resources WHERE status = 'indexed' AND source_id IN (SELECT id FROM sources WHERE auto_publish = 1) AND auto_hold IS NULL AND auto_assessment IS NOT NULL`)
  ]);
  const sources = await listSources(c.env);
  return json({
    counts: { indexed, published, rejected, flagged_duplicates: flagged, broken_links: broken, blocked_links: blocked, awaiting_vector_index: unembedded, featured, auto_published: autoPub, to_spot_check: spot, held_back: held, needs_attention: attention },
    triage: { model: Boolean(triageModel(c.env)) },
    sources: { total: sources.length, enabled: sources.filter((s) => s.enabled).length, failing: sources.filter((s) => s.consecutive_failures > 0).length },
    embedding: EMBEDDING
  });
});

route('GET', '/api/editor/queue', async (c) => {
  guard(c);
  const p = c.url.searchParams;
  const status = p.get('status') || 'indexed';
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Unknown status');
  const where = ['status = ?'];
  const binds = [status];
  if (p.get('source')) { where.push('source_id = ?'); binds.push(p.get('source')); }
  if (p.get('flagged') === '1') where.push('duplicate_of IS NOT NULL AND duplicate_dismissed = 0');
  if (p.get('auto') === '1') where.push('auto_published = 1');
  if (p.get('spot') === '1') where.push('auto_published = 1 AND spot_checked_at IS NULL');
  if (p.get('held') === '1') where.push('auto_hold IS NOT NULL');
  if (p.get('attention') === '1') where.push("auto_assessment IS NOT NULL AND source_id IN (SELECT id FROM sources WHERE auto_publish = 1)");
  if (p.get('broken') === '1') where.push(`link_status IN ('broken','blocked','error')`);
  if (p.get('q')) { where.push('(title LIKE ? OR publisher LIKE ?)'); const like = `%${p.get('q').slice(0, 100).replace(/[%_]/g, '')}%`; binds.push(like, like); }
  const limit = intParam(p.get('limit'), { min: 1, max: 100, fallback: 30 });
  const offset = intParam(p.get('offset'), { min: 0, max: 10000, fallback: 0 });
  const order = status === 'published' ? 'updated_at DESC' : 'discovered_at DESC';
  const rows = (await c.env.DB.prepare(
    `SELECT id, title, publisher, format, url, status, source_id, discovered_at, published_at, added_at, duplicate_of, duplicate_reason, duplicate_dismissed,
            link_status, featured, verification_status, why IS NOT NULL AS has_why, auto_published, auto_hold, spot_checked_at, auto_assessment
     FROM resources WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`
  ).bind(...binds, limit, offset).all()).results;
  const total = await c.env.DB.prepare(`SELECT count(*) AS n FROM resources WHERE ${where.join(' AND ')}`).bind(...binds).first('n');
  return json({ total, limit, offset, items: rows.map((r) => ({ ...r, featured: r.featured === 1, duplicate_dismissed: r.duplicate_dismissed === 1, has_why: r.has_why === 1, auto_published: r.auto_published === 1, auto_assessment: r.auto_assessment ? JSON.parse(r.auto_assessment) : null })) });
});

route('GET', '/api/editor/resources/:id', async (c) => {
  guard(c);
  const row = await getRow(c.env, c.params.id);
  if (!row) throw new HttpError(404, 'Resource not found');
  let duplicate = null;
  if (row.duplicate_of) {
    const d = await getRow(c.env, row.duplicate_of);
    if (d) duplicate = { id: d.id, title: d.title, publisher: d.publisher, url: d.url, status: d.status };
  }
  return json({ resource: toEditor(row), relations: await S.listRelations(c.env, row.id), duplicate });
});

// Reads a page so an editor can add it as a static link: title, publisher and date as the page
// states them, plus any existing copy in the collection.
route('POST', '/api/editor/lookup', async (c) => {
  guard(c);
  const { url } = await readJson(c.req, 4096);
  let canonical;
  try { canonical = canonicalizeUrl(String(url ?? '').trim()); } catch { throw new HttpError(400, 'Enter a full https:// link', { field: 'url' }); }
  const { exact } = await findDuplicates(c.env, { canonical, rawUrl: canonical, title: '' });
  if (exact) {
    const row = await c.env.DB.prepare('SELECT id, title, status FROM resources WHERE id = ?').bind(exact.id).first();
    return json({ url: canonical, existing: row });
  }
  try {
    const meta = await readPageMeta(c.env, canonical);
    return json({ ...meta, url: canonicalizeUrl(meta.url), existing: null });
  } catch (e) {
    if (e instanceof FetchError) return json({ url: canonical, existing: null, unreadable: `${e.message}. Fill in the details yourself.` });
    throw e;
  }
});

route('POST', '/api/editor/resources', async (c) => {
  const who = guard(c);
  return json({ resource: await S.createManual(c.env, await readJson(c.req), who.actor) }, 201);
});

route('PATCH', '/api/editor/resources/:id', async (c) => {
  const who = guard(c);
  return json(await S.updateResource(c.env, c.params.id, await readJson(c.req), who.actor));
});

route('POST', '/api/editor/resources/:id/publish', async (c) => json(await S.publishResource(c.env, c.params.id, guard(c).actor)));
route('POST', '/api/editor/resources/:id/unpublish', async (c) => json(await S.unpublishResource(c.env, c.params.id, guard(c).actor)));
route('POST', '/api/editor/resources/:id/reject', async (c) => {
  const who = guard(c);
  const body = c.req.headers.get('content-length') === '0' ? {} : await readJson(c.req, 2048).catch(() => ({}));
  return json(await S.rejectResource(c.env, c.params.id, who.actor, body.reason));
});

route('POST', '/api/editor/resources/:id/restore', async (c) => {
  const who = guard(c);
  const body = await readJson(c.req, 512).catch(() => ({}));
  return json(await S.restoreResource(c.env, c.params.id, who.actor, body.to));
});

route('POST', '/api/editor/resources/:id/spot-check', async (c) => {
  const who = guard(c);
  await S.spotCheckResource(c.env, c.params.id, who.actor);
  return json({ ok: true });
});

// A model's draft of metadata for the editor to correct. Nothing is saved.
route('POST', '/api/editor/resources/:id/suggest', async (c) => {
  guard(c);
  const model = suggestModel(c.env);
  if (!model) throw new HttpError(503, 'No model is configured. Set TRIAGE_MODEL or CHAT_MODEL.');
  const row = await getRow(c.env, c.params.id);
  if (!row) throw new HttpError(404, 'Resource not found');
  const out = await askModel(c.env, model, row, row.source_id).catch(() => null);
  if (!out) throw new HttpError(502, 'The model did not return a usable suggestion.');
  return json({ suggestion: out, note: 'Drafted by a model from the title and publisher only. Check it against the original.' });
});

route('POST', '/api/editor/triage', async (c) => {
  const who = guard(c);
  const out = { triage: await runTriage(c.env), expired: await expireQueue(c.env) };
  await audit(c.env, who.actor, 'triage', 'system', null, out);
  return json(out);
});

route('POST', '/api/editor/resources/:id/check-link', async (c) => {
  guard(c);
  const row = await getRow(c.env, c.params.id);
  if (!row) throw new HttpError(404, 'Resource not found');
  return json(await checkAndStore(c.env, row));
});

route('POST', '/api/editor/resources/:id/relations', async (c) => {
  const who = guard(c);
  await S.addRelation(c.env, c.params.id, await readJson(c.req, 2048), who.actor);
  return json({ relations: await S.listRelations(c.env, c.params.id) }, 201);
});

route('DELETE', '/api/editor/resources/:id/relations/:rid', async (c) => {
  const who = guard(c);
  await S.removeRelation(c.env, c.params.id, c.params.rid, who.actor);
  return json({ relations: await S.listRelations(c.env, c.params.id) });
});

route('GET', '/api/editor/sources', async (c) => {
  guard(c);
  return json({ sources: await listSources(c.env) });
});

route('POST', '/api/editor/sources', async (c) => {
  const who = guard(c);
  const row = await createSource(c.env, await readJson(c.req));
  await audit(c.env, who.actor, 'create', 'source', row.id);
  return json({ source: sourceView(row) }, 201);
});

// Paste a site or feed address: finds the feed and says what it carries, before anything is added.
route('POST', '/api/editor/feeds/find', async (c) => {
  guard(c);
  const { url } = await readJson(c.req, 4096);
  try {
    const found = await findFeed(c.env, url);
    const existing = await c.env.DB.prepare('SELECT id, name FROM sources WHERE feed_url = ?').bind(found.feed_url).first();
    return json({ ...found, existing });
  } catch (e) {
    if (e instanceof FetchError) throw new HttpError(422, `${e.message}.`);
    throw e;
  }
});

// Adds a feed in one step: verified, switched on, publishing what passes the checks, and read once now.
route('POST', '/api/editor/feeds', async (c) => {
  const who = guard(c);
  const body = await readJson(c.req, 4096);
  const name = String(body.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Give the feed a name', { field: 'name' });
  let id = sourceIdFrom(name);
  if (id.length < 3) id = `${id}-feed`;
  for (let n = 2; await c.env.DB.prepare('SELECT 1 FROM sources WHERE id = ?').bind(id).first(); n++) id = `${sourceIdFrom(name).slice(0, 46)}-${n}`;
  await createSource(c.env, { id, name, publisher: String(body.publisher ?? '').trim() || name, feed_url: body.feed_url, site_url: body.site_url || undefined, require_match: body.ai_only !== false });
  await updateSource(c.env, id, { review_status: 'verified', enabled: true, auto_publish: body.review_first !== true });
  await audit(c.env, who.actor, 'create', 'source', id, { quick: true });
  const report = await ingestSource(c.env, await getSource(c.env, id));
  return json({ source: sourceView(await getSource(c.env, id)), report }, 201);
});

route('DELETE', '/api/editor/sources/:id', async (c) => {
  const who = guard(c);
  if (!(await getSource(c.env, c.params.id))) throw new HttpError(404, 'Source not found');
  await c.env.DB.prepare('DELETE FROM sources WHERE id = ?').bind(c.params.id).run();
  await audit(c.env, who.actor, 'delete', 'source', c.params.id);
  return json({ ok: true });
});

route('PATCH', '/api/editor/sources/:id', async (c) => {
  const who = guard(c);
  const row = await updateSource(c.env, c.params.id, await readJson(c.req));
  await audit(c.env, who.actor, 'update', 'source', row.id);
  return json({ source: sourceView(row) });
});

route('POST', '/api/editor/sources/:id/run', async (c) => {
  const who = guard(c);
  const source = await getSource(c.env, c.params.id);
  if (!source) throw new HttpError(404, 'Source not found');
  if (source.review_status !== 'verified') throw new HttpError(422, 'Mark the source verified before running it');
  const report = await ingestSource(c.env, source);
  await audit(c.env, who.actor, 'ingest', 'source', source.id, report);
  return json({ report });
});

route('POST', '/api/editor/ingest', async (c) => {
  const who = guard(c);
  const reports = await runIngestion(c.env, { force: c.url.searchParams.get('force') === '1', limit: 10 });
  await audit(c.env, who.actor, 'ingest', 'all', null, { sources: reports.length });
  return json({ reports });
});

// Reads the next page of back catalogue for sources that have one (see ingest/archive.mjs).
route('POST', '/api/editor/archive', async (c) => {
  const who = guard(c);
  const reports = await runArchive(c.env, { pages: intParam(c.url.searchParams.get('pages'), { min: 1, max: 12, fallback: 8 }), maxNew: 80, sourceId: c.url.searchParams.get('source') || null });
  await audit(c.env, who.actor, 'archive', 'all', null, { pages: reports.length, new: reports.reduce((n, r) => n + r.new, 0) });
  return json({ reports });
});

// Vector index backfill: embeds published records that are missing or stale. Safe to repeat.
route('POST', '/api/editor/reindex', async (c) => {
  const who = guard(c);
  const limit = intParam(c.url.searchParams.get('limit'), { min: 1, max: 100, fallback: 50 });
  const out = await backfill(c.env, { limit });
  const removed = await reconcileRemovals(c.env);
  await audit(c.env, who.actor, 'reindex', 'vectors', null, { ...out, removed: removed.removed });
  return json({ ...out, removed: removed.removed, embedding: EMBEDDING });
});

route('POST', '/api/editor/maintenance', async (c) => {
  const who = guard(c);
  const keys = await backfillKeys(c.env);
  const links = await runLinkChecks(c.env, { limit: intParam(c.url.searchParams.get('links'), { min: 0, max: 50, fallback: 25 }) });
  await audit(c.env, who.actor, 'maintenance', 'system', null, { keys, links });
  return json({ keys, links });
});

route('GET', '/api/editor/ingestion', async (c) => {
  guard(c);
  const rows = (await c.env.DB.prepare(
    `SELECT l.started_at, l.finished_at, l.status, l.new_count, l.duplicate_count, l.flagged_count, l.filtered_count, l.http_status, l.error, s.name AS source
     FROM ingestion_log l LEFT JOIN sources s ON s.id = l.source_id ORDER BY l.started_at DESC LIMIT 50`
  ).all()).results;
  return json({ runs: rows });
});

route('GET', '/api/editor/audit', async (c) => {
  guard(c);
  const limit = intParam(c.url.searchParams.get('limit'), { min: 1, max: 200, fallback: 50 });
  const rows = (await c.env.DB.prepare('SELECT at, actor, action, entity, entity_id, detail FROM audit_log ORDER BY at DESC LIMIT ?').bind(limit).all()).results;
  return json({ entries: rows });
});

route('PUT', '/api/editor/topics/:slug/pins', async (c) => {
  const who = guard(c);
  const body = await readJson(c.req, 8192);
  const sections = ['start', 'latest', 'classroom', 'research', 'leadership', 'students', 'concerns'];
  if (!sections.includes(body.section)) throw new HttpError(400, 'Unknown section');
  const ids = Array.isArray(body.resource_ids) ? body.resource_ids.slice(0, 20).map(String) : [];
  const topic = await c.env.DB.prepare('SELECT slug FROM topics WHERE slug = ?').bind(c.params.slug).first();
  if (!topic) throw new HttpError(404, 'Topic not found');
  const stmts = [c.env.DB.prepare('DELETE FROM topic_pins WHERE topic_slug = ? AND section = ?').bind(topic.slug, body.section)];
  ids.forEach((id, i) => stmts.push(c.env.DB.prepare('INSERT INTO topic_pins(topic_slug, section, resource_id, position) VALUES (?,?,?,?)').bind(topic.slug, body.section, id, i)));
  await c.env.DB.batch(stmts);
  await audit(c.env, who.actor, 'pin', 'topic', topic.slug, { section: body.section, count: ids.length });
  return json({ ok: true });
});

// Builds a fresh weekly digest now (for example after a large import or a model change).
// Backup: the catalogue's tables, a page at a time, so an editor can download everything from the
// browser. Visitors' encrypted vaults and sign-in data are not included.
const EXPORT_TABLES = ['resources', 'sources', 'resource_relations', 'topic_pins', 'digests'];
route('GET', '/api/editor/export', async (c) => {
  guard(c);
  const table = c.url.searchParams.get('table');
  if (!EXPORT_TABLES.includes(table)) throw new HttpError(400, 'Unknown table', { tables: EXPORT_TABLES });
  const offset = intParam(c.url.searchParams.get('offset'), { min: 0, max: 1_000_000, fallback: 0 });
  const limit = intParam(c.url.searchParams.get('limit'), { min: 1, max: 250, fallback: 200 });
  const rows = (await c.env.DB.prepare(`SELECT * FROM ${table} ORDER BY rowid LIMIT ? OFFSET ?`).bind(limit, offset).all()).results;
  return json({ table, tables: EXPORT_TABLES, offset, rows, next: rows.length === limit ? offset + limit : null }, 200, { 'Cache-Control': 'no-store' });
});

// Restore: the other half of the backup. The editor page reads a backup file in the browser and
// sends it here a few rows at a time (small requests stay well inside the Worker's limits). Rows
// are added with INSERT OR IGNORE, so anything already here is kept and running it twice is safe.
// Only columns this database has are written. Search vectors are not in a backup, so imported
// resources are marked for "Update search" to embed again.
const IMPORT_TABLES = ['sources', 'resources', 'resource_relations', 'topic_pins', 'digests'];
const IMPORT_MAX = 50;
const columnCache = new Map();
async function tableColumns(env, table) {
  if (!columnCache.has(table)) columnCache.set(table, (await env.DB.prepare(`SELECT name FROM pragma_table_info('${table}')`).all()).results.map((r) => r.name));
  return columnCache.get(table);
}
const NOT_IMPORTED = { resources: ['embedding_model', 'embedding_version', 'embedding_hash', 'embedded_at'] };
route('POST', '/api/editor/import', async (c) => {
  const who = guard(c);
  const body = await readJson(c.req, 2_000_000);
  const table = body?.table;
  if (!IMPORT_TABLES.includes(table)) throw new HttpError(400, 'Unknown table', { tables: IMPORT_TABLES });
  const rows = Array.isArray(body.rows) ? body.rows : null;
  if (!rows || rows.length > IMPORT_MAX) throw new HttpError(400, `Send between 0 and ${IMPORT_MAX} rows at a time`);
  const known = (await tableColumns(c.env, table)).filter((k) => !(NOT_IMPORTED[table] ?? []).includes(k));
  const stmts = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const cols = known.filter((k) => k in row && (row[k] === null || ['string', 'number'].includes(typeof row[k])));
    if (!cols.length) continue;
    stmts.push(c.env.DB.prepare(`INSERT OR IGNORE INTO ${table}(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).bind(...cols.map((k) => row[k])));
  }
  let added = 0;
  if (stmts.length) added = (await c.env.DB.batch(stmts)).reduce((n, r) => n + (r.meta?.changes ? 1 : 0), 0);
  if (rows.length && table === 'resources') await audit(c.env, who.actor, 'import', 'resource', null, { rows: rows.length, added });
  return json({ table, received: rows.length, added, skipped: rows.length - added });
});

route('POST', '/api/editor/digest', async (c) => {
  const who = guard(c);
  const d = await buildDigest(c.env);
  await audit(c.env, who.actor, 'build', 'digest', d.id, { mode: d.mode, items: d.item_count });
  return json({ id: d.id, mode: d.mode, items: d.item_count });
});
