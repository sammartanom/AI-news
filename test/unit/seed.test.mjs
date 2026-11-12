import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from '../helpers/d1.mjs';
import { seedStatements, sourceStatements, toSqlFile } from '../../scripts/lib/seed.mjs';
import { readFileSync } from 'node:fs';
import { seedData } from '../helpers/mocks.mjs';
import { canonicalizeUrl } from '../../src/lib/url.mjs';

const apply = async (db, stmts) => { for (const s of stmts) await db.prepare(s.sql).bind(...s.params).run(); };

test('seed data: 30 resources, no invented dates, summaries or topics', () => {
  const data = seedData();
  assert.equal(data.length, 30);
  assert.equal(new Set(data.map((r) => r.id)).size, 30);
  for (const r of data) {
    assert.equal(r.published_at, null, r.id);
    assert.equal(r.summary, null, r.id);
    assert.ok(r.why && r.audiences.length && r.collections.length, r.id);
    assert.equal(new URL(r.url).protocol, 'https:');
    assert.equal(canonicalizeUrl(r.url).replace(/\/$/, ''), r.url.replace(/\/$/, ''), `${r.id} URL is already canonical`);
  }
  assert.equal(data.filter((r) => r.featured).length, 8);
  const ids = new Set(data.map((r) => r.id));
  for (const r of data) for (const rel of r.read_with) assert.ok(ids.has(rel.id), `${r.id} -> ${rel.id}`);
});

test('seeding is idempotent and never overwrites editor changes', async () => {
  const db = freshDb();
  const stmts = seedStatements(seedData(), { now: '2026-10-20T00:00:00.000Z' });
  await apply(db, stmts);
  const n = await db.prepare('SELECT count(*) AS n FROM resources').first('n');
  assert.equal(n, 30);
  await db.prepare(`UPDATE resources SET why = 'Edited by an editor', featured = 0 WHERE id = '1'`).run();
  await apply(db, seedStatements(seedData(), { now: '2026-11-01T00:00:00.000Z' }));
  const r = await db.prepare(`SELECT why, featured, added_at FROM resources WHERE id = '1'`).first();
  assert.equal(r.why, 'Edited by an editor');
  assert.equal(r.featured, 0);
  assert.equal(r.added_at, '2026-10-20T00:00:00.000Z');
  assert.equal(await db.prepare('SELECT count(*) AS n FROM resources').first('n'), 30);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM resource_relations').first('n'), 30);
});

test('seeding repairs legacy URLs that carried page-state parameters, only when unchanged', async () => {
  const db = freshDb();
  const data = seedData();
  const fixed = data.find((r) => r.legacy_urls);
  await apply(db, seedStatements(data));
  await db.prepare('UPDATE resources SET url = ?, canonical_url = NULL WHERE id = ?').bind(fixed.legacy_urls[0], fixed.id).run();
  await apply(db, seedStatements(data));
  assert.equal(await db.prepare('SELECT url FROM resources WHERE id = ?').bind(fixed.id).first('url'), fixed.url);
  await db.prepare('UPDATE resources SET url = ? WHERE id = ?').bind('https://editor.changed/url', fixed.id).run();
  await apply(db, seedStatements(data));
  assert.equal(await db.prepare('SELECT url FROM resources WHERE id = ?').bind(fixed.id).first('url'), 'https://editor.changed/url');
});

test('the generated SQL file loads into a migrated database', async () => {
  const db = freshDb();
  db.raw.exec(toSqlFile(seedStatements(seedData())));
  assert.equal(await db.prepare('SELECT count(*) AS n FROM resources').first('n'), 30);
  assert.equal(await db.prepare(`SELECT count(*) AS n FROM resources WHERE status = 'published'`).first('n'), 30);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM resources_fts').first('n'), 30);
  const tricky = toSqlFile([{ sql: 'INSERT INTO t VALUES (?, ?, ?)', params: ["O'Brien", null, 3] }]);
  assert.equal(tricky.trim(), "INSERT INTO t VALUES ('O''Brien', NULL, 3);");
});

test('candidate sources are inserted unreviewed and switched off, and every feed URL is https on its own allowed host', async () => {
  const db = freshDb();
  const sources = JSON.parse(readFileSync(new URL('../../data/sources.seed.json', import.meta.url), 'utf8'));
  await apply(db, sourceStatements(sources));
  await apply(db, sourceStatements(sources)); // idempotent
  const rows = (await db.prepare('SELECT * FROM sources').all()).results;
  assert.equal(rows.length, sources.length);
  for (const r of rows) {
    assert.equal(r.enabled, 0);
    assert.equal(r.review_status, 'unreviewed');
    const host = new URL(r.feed_url).hostname;
    assert.equal(new URL(r.feed_url).protocol, 'https:');
    assert.ok(JSON.parse(r.allowed_hosts).some((h) => host === h || host.endsWith('.' + h)), `${r.id}: feed host is on the allowlist`);
    assert.ok(r.notes && /Checked 2026-1(0-2[68]|1-02)/.test(r.notes), 'notes say what was actually checked');
  }
  assert.equal(await db.prepare('SELECT count(*) AS n FROM sources WHERE enabled = 1').first('n'), 0);
});
