import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { D1Shim, applyMigrations, migrationFiles, freshDb } from '../helpers/d1.mjs';

const ORIGINAL_SEED_ROW = (id, extra = {}) => ({
  id, url: `https://example.org/${id}`, title: `Legacy ${id}`, publisher: 'Legacy Publisher', format: 'Article', audience: 'Teachers', collection_name: 'Classroom',
  why: 'Why', best_for: 'Best', tags: '[]', status: 'published', verification: 'Publisher page opened', ...extra
});

async function legacyDb() {
  const db = new D1Shim();
  applyMigrations(db, { upTo: '0001_init.sql' });
  for (const r of [ORIGINAL_SEED_ROW('1'), ORIGINAL_SEED_ROW('2', { collection_name: 'Questions & risks', audience: 'Everyone', verification: 'Linked from opened publisher page; destination not individually reviewed' }), ORIGINAL_SEED_ROW('3', { status: 'indexed', collection_name: 'Other' })]) {
    await db.prepare('INSERT INTO resources(id,url,title,publisher,format,audience,collection_name,why,best_for,tags,status,verification) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(r.id, r.url, r.title, r.publisher, r.format, r.audience, r.collection_name, r.why, r.best_for, r.tags, r.status, r.verification).run();
  }
  return db;
}

test('migrations are numbered, ordered and 0001 is untouched', () => {
  const files = migrationFiles().map((m) => m.name);
  assert.deepEqual(files, files.slice().sort());
  assert.match(files[0], /^0001_init\.sql$/);
  files.forEach((f, i) => assert.equal(f.slice(0, 4), String(i + 1).padStart(4, '0')));
});

test('migrations apply cleanly to an empty database', async () => {
  const db = freshDb();
  const tables = (await db.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'resources_fts_%'`).all()).results.map((r) => r.name);
  for (const t of ['resources', 'sources', 'users', 'boards', 'board_members', 'board_items', 'ingestion_log', 'collections', 'topics', 'resource_relations', 'topic_pins', 'user_resource_state', 'audit_log', 'resources_fts']) {
    assert.ok(tables.includes(t), t);
  }
});

test('migrations upgrade a database that already holds the first schema and its data', async () => {
  const db = await legacyDb();
  for (const m of migrationFiles().slice(1)) db.raw.exec(m.sql);
  const rows = (await db.prepare('SELECT * FROM resources ORDER BY id').all()).results;
  assert.equal(rows.length, 3);
  assert.equal(rows[0].audiences, '["Teachers"]');
  assert.equal(rows[0].collections, '["inside-classroom"]');
  assert.equal(rows[1].collections, '["questions-concerns"]');
  assert.equal(rows[2].collections, '[]'); // unknown legacy collection is not guessed
  assert.equal(rows[0].verification_status, 'checked');
  assert.equal(rows[1].verification_status, 'unverified');
  assert.equal(rows[0].added_at, rows[0].discovered_at); // published rows get an added date from their recorded discovery time
  assert.equal(rows[2].added_at, null);
  assert.match(rows[0].discovered_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal(rows[0].link_status, 'unchecked');
  assert.equal(rows[0].published_at, null);
  const fts = (await db.prepare('SELECT id FROM resources_fts ORDER BY id').all()).results.map((r) => r.id);
  assert.deepEqual(fts, ['1', '2']); // only published rows are keyword-searchable
});

test('0001 can be re-run on a migrated database (databases set up with "d1 execute" have no migration history)', async () => {
  const db = freshDb();
  db.raw.exec(readFileSync(new URL('../../migrations/0001_init.sql', import.meta.url), 'utf8'));
  assert.ok(db);
});

test('FTS index follows publish, edit, unpublish and delete', async () => {
  const db = freshDb();
  const ins = (id, status) => db.prepare(`INSERT INTO resources(id,url,title,publisher,status) VALUES (?,?,?,?,?)`).bind(id, `https://e.org/${id}`, `Title ${id} zebra`, 'Pub', status).run();
  const count = async (q) => (await db.prepare('SELECT count(*) AS n FROM resources_fts WHERE resources_fts MATCH ?').bind(q).first('n'));
  await ins('a', 'indexed');
  assert.equal(await count('zebra'), 0);
  await db.prepare(`UPDATE resources SET status='published' WHERE id='a'`).run();
  assert.equal(await count('zebra'), 1);
  await db.prepare(`UPDATE resources SET title='Title a giraffe' WHERE id='a'`).run();
  assert.equal(await count('zebra'), 0);
  assert.equal(await count('giraffe'), 1);
  await db.prepare(`UPDATE resources SET summary='Hidden okapi text', summary_approved=0 WHERE id='a'`).run();
  assert.equal(await count('okapi'), 0);
  await db.prepare(`UPDATE resources SET summary_approved=1 WHERE id='a'`).run();
  assert.equal(await count('okapi'), 1);
  await db.prepare(`UPDATE resources SET status='rejected' WHERE id='a'`).run();
  assert.equal(await count('giraffe'), 0);
  await db.prepare(`UPDATE resources SET status='published' WHERE id='a'`).run();
  await db.prepare(`DELETE FROM resources WHERE id='a'`).run();
  assert.equal(await count('giraffe'), 0);
});

test('constraints reject invalid values', async () => {
  const db = freshDb();
  const run = (sql, ...b) => db.prepare(sql).bind(...b).run();
  await run(`INSERT INTO resources(id,url,title,publisher) VALUES ('x','https://e.org/x','T','P')`);
  await assert.rejects(run(`UPDATE resources SET status='live' WHERE id='x'`));
  await assert.rejects(run(`UPDATE resources SET editorial_priority=9 WHERE id='x'`));
  await assert.rejects(run(`UPDATE resources SET link_status='great' WHERE id='x'`));
  await assert.rejects(run(`UPDATE resources SET verification_status='sure' WHERE id='x'`));
  await assert.rejects(run(`INSERT INTO resource_relations(id,from_id,to_id,relation,created_at) VALUES ('r','x','x','companion','now')`));
  await assert.rejects(run(`INSERT INTO resources(id,url,title,publisher) VALUES ('y','https://e.org/x','T','P')`)); // url unique
  await run(`UPDATE resources SET canonical_url='https://e.org/c' WHERE id='x'`);
  await run(`INSERT INTO resources(id,url,title,publisher) VALUES ('z','https://e.org/z','T','P')`);
  await assert.rejects(run(`UPDATE resources SET canonical_url='https://e.org/c' WHERE id='z'`)); // canonical unique
  await assert.rejects(run(`INSERT INTO board_items(board_id,resource_id) VALUES ('nope','x')`)); // foreign keys enforced
});
