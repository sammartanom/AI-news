import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, addResource, client, loadHandler, mockVector } from '../helpers/mocks.mjs';
import { backfill, embeddingText, EMBEDDING, reconcileRemovals } from '../../src/search/embedding.mjs';
import { backfillKeys } from '../../src/repo/maintenance.mjs';

before(loadHandler);

async function setup() {
  const env = await makeEnv({ seed: false, vars: { BOOTSTRAP_EDITOR_EMAILS: 'ed@school.org' } });
  const ed = client(env, 'ed@school.org');
  const anon = client(env);
  const queued = await addResource(env, { title: 'Queued chatbot guide', status: 'indexed', why: null, audiences: [], index: false, published_at: null });
  return { env, ed, anon, queued };
}
const row = (env, id) => env.DB.prepare('SELECT * FROM resources WHERE id = ?').bind(id).first();
const fill = { why: 'A direct reason it was included.', audiences: ['Teachers'] };

test('an indexed item is hidden from every public surface', async () => {
  const { env, anon, queued } = await setup();
  assert.equal((await anon(`/api/resources/${queued}`)).status, 404);
  assert.equal((await anon(`/api/resources/${queued}/related`)).status, 404);
  assert.equal((await anon('/api/resources')).data.total, 0);
  assert.equal((await anon('/api/search?q=chatbot')).data.total, 0);
  assert.equal((await anon('/api/facets')).data.total, 0);
  assert.equal((await anon('/api/catch-up')).data.total, 0);
  assert.equal((await anon('/api/topics/ai-literacy')).data.total, 0);
  assert.equal((await anon('/api/paths?q=chatbot')).data.count, 0);
  assert.equal(await env.DB.prepare('SELECT count(*) AS n FROM resources_fts').first('n'), 0);
  assert.equal(env.VECTORIZE.vectors.size, 0);
});

test('publishing requires a reason and an audience', async () => {
  const { ed, queued } = await setup();
  const r = await ed(`/api/editor/resources/${queued}/publish`, { method: 'POST' });
  assert.equal(r.status, 422);
  assert.match(r.data.error, /why included/);
  assert.match(r.data.error, /audience/);
});

test('publishing makes the item public, searchable and embedded', async () => {
  const { env, ed, anon, queued } = await setup();
  assert.equal((await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: fill })).status, 200);
  const pub = await ed(`/api/editor/resources/${queued}/publish`, { method: 'POST' });
  assert.equal(pub.status, 200);
  assert.deepEqual(pub.data.indexing, { ok: true });
  const r = await row(env, queued);
  assert.equal(r.status, 'published');
  assert.ok(r.added_at, 'date added to Signal is recorded');
  assert.equal(r.reviewed_by, 'ed@school.org');
  assert.equal(r.embedding_model, EMBEDDING.model);
  assert.equal(r.embedding_version, EMBEDDING.version);
  assert.ok(r.embedding_hash && r.embedded_at);
  assert.ok(env.VECTORIZE.vectors.has(queued));
  assert.equal((await anon(`/api/resources/${queued}`)).status, 200);
  assert.equal((await anon('/api/search?q=chatbot')).data.results[0].id, queued);
  assert.equal(await env.DB.prepare('SELECT count(*) AS n FROM resources_fts').first('n'), 1);
  const audit = await ed('/api/editor/audit');
  assert.ok(audit.data.entries.some((e) => e.action === 'publish' && e.entity_id === queued));
});

test('unknown publication dates stay unknown through ingestion, review and publishing', async () => {
  const { env, ed, anon, queued } = await setup();
  await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: fill });
  await ed(`/api/editor/resources/${queued}/publish`, { method: 'POST' });
  const r = (await anon(`/api/resources/${queued}`)).data.resource;
  assert.equal(r.published_at, null);
  assert.ok(r.added_at);
  assert.equal((await row(env, queued)).published_at, null);
  // An editor may set a verified date; partial dates are allowed, future and nonsense are not.
  assert.equal((await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: { published_at: '2025-03' } })).status, 200);
  assert.equal((await anon(`/api/resources/${queued}`)).data.resource.published_at, '2025-03');
  for (const bad of ['2031-01-01', 'yesterday', '2025-13', '1850']) assert.equal((await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: { published_at: bad } })).status, 400, bad);
  assert.equal((await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: { published_at: null } })).status, 200);
  assert.equal((await anon(`/api/resources/${queued}`)).data.resource.published_at, null);
});

test('rejecting removes public and vector access', async () => {
  const { env, ed, anon, queued } = await setup();
  await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: fill });
  await ed(`/api/editor/resources/${queued}/publish`, { method: 'POST' });
  await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: { featured: true } });
  const rej = await ed(`/api/editor/resources/${queued}/reject`, { method: 'POST', body: { reason: 'Off topic' } });
  assert.equal(rej.status, 200);
  assert.deepEqual(rej.data.indexing, { ok: true });
  assert.equal(env.VECTORIZE.vectors.has(queued), false);
  const r = await row(env, queued);
  assert.equal(r.status, 'rejected');
  assert.equal(r.featured, 0);
  assert.equal(r.rejected_reason, 'Off topic');
  assert.equal(r.embedded_at, null);
  assert.equal((await anon(`/api/resources/${queued}`)).status, 404);
  assert.equal((await anon('/api/search?q=chatbot')).data.total, 0);
  assert.equal(await env.DB.prepare('SELECT count(*) AS n FROM resources_fts').first('n'), 0);
});

test('unpublishing returns the item to the queue and removes it from the index', async () => {
  const { env, ed, anon, queued } = await setup();
  await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: fill });
  await ed(`/api/editor/resources/${queued}/publish`, { method: 'POST' });
  await ed(`/api/editor/resources/${queued}/unpublish`, { method: 'POST' });
  assert.equal((await row(env, queued)).status, 'indexed');
  assert.equal(env.VECTORIZE.vectors.size, 0);
  assert.equal((await anon(`/api/resources/${queued}`)).status, 404);
});

test('a failed vector deletion is retried and the stale vector is never served in the meantime', async () => {
  const { env, ed, anon, queued } = await setup();
  await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: fill });
  await ed(`/api/editor/resources/${queued}/publish`, { method: 'POST' });
  env.VECTORIZE.fail = true;
  const rej = await ed(`/api/editor/resources/${queued}/reject`, { method: 'POST' });
  assert.equal(rej.status, 200);
  assert.equal(rej.data.indexing.ok, false);
  env.VECTORIZE.fail = false;
  assert.ok(env.VECTORIZE.vectors.has(queued)); // vector still there...
  assert.equal((await anon('/api/search?q=chatbot+guide')).data.total, 0); // ...but D1 is authoritative
  assert.equal((await reconcileRemovals(env)).removed, 1);
  assert.equal(env.VECTORIZE.vectors.has(queued), false);
});

test('a failed embedding does not block publishing; backfill indexes it later', async () => {
  const { env, ed, anon, queued } = await setup();
  await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: fill });
  env.AI.fail = true;
  const pub = await ed(`/api/editor/resources/${queued}/publish`, { method: 'POST' });
  assert.equal(pub.status, 200);
  assert.equal(pub.data.indexing.ok, false);
  assert.equal((await anon('/api/search?q=chatbot')).data.results[0].id, queued); // keyword search still finds it
  assert.equal((await ed('/api/editor/summary')).data.counts.awaiting_vector_index, 1);
  env.AI.fail = false;
  const out = await ed('/api/editor/reindex', { method: 'POST' });
  assert.equal(out.data.indexed, 1);
  assert.equal(out.data.remaining, 0);
  assert.ok(env.VECTORIZE.vectors.has(queued));
});

test('editing a published resource re-embeds it; unrelated edits do not', async () => {
  const { env, ed, queued } = await setup();
  await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: fill });
  await ed(`/api/editor/resources/${queued}/publish`, { method: 'POST' });
  const before = (await row(env, queued)).embedding_hash;
  const calls = env.AI.calls.length;
  await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: { link_status: 'ok' } });
  assert.equal(env.AI.calls.length, calls);
  await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: { editorial_note: 'A new editorial note about student writing.' } });
  assert.ok(env.AI.calls.length > calls);
  assert.notEqual((await row(env, queued)).embedding_hash, before);
});

test('a published resource cannot be edited into an unpublishable state', async () => {
  const { ed, queued } = await setup();
  await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: fill });
  await ed(`/api/editor/resources/${queued}/publish`, { method: 'POST' });
  assert.equal((await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: { why: null } })).status, 422);
  assert.equal((await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: { audiences: [] } })).status, 422);
});

test('featured: only published resources can be featured; featuring is separate from ranking quality', async () => {
  const { ed, anon, queued } = await setup();
  assert.equal((await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: { featured: true } })).status, 422);
  await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: fill });
  await ed(`/api/editor/resources/${queued}/publish`, { method: 'POST' });
  assert.equal((await anon('/api/featured')).data.resources.length, 0);
  await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: { featured: true } });
  const f = (await anon('/api/featured')).data.resources;
  assert.equal(f.length, 1);
  assert.equal(f[0].curation, 'featured');
  assert.equal((await anon(`/api/resources/${queued}`)).data.resource.curation, 'featured');
});

test('summaries: shown, indexed and embedded only after approval; edits need approving again', async () => {
  const { env, ed, anon, queued } = await setup();
  await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: { ...fill, summary: 'Mentions xylophone pedagogy.', summary_generated: true } });
  await ed(`/api/editor/resources/${queued}/publish`, { method: 'POST' });
  const pub = () => anon(`/api/resources/${queued}`).then((r) => r.data.resource);
  assert.equal((await pub()).summary, null);
  assert.equal((await anon('/api/search?q=xylophone')).data.total, 0);
  assert.ok(!embeddingText(await row(env, queued)).includes('xylophone'));
  assert.equal((await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: { summary_approved: true } })).status, 200);
  const approved = await pub();
  assert.equal(approved.summary, 'Mentions xylophone pedagogy.');
  assert.equal(approved.summary_generated, true); // generated summaries stay marked
  assert.equal((await anon('/api/search?q=xylophone')).data.total, 1);
  assert.ok(embeddingText(await row(env, queued)).includes('xylophone'));
  await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: { summary: 'Edited text about marimbas.' } });
  assert.equal((await pub()).summary, null);
  assert.equal((await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: { summary: null, summary_approved: true } })).status, 422);
});

test('embedding text uses whitelisted fields only and never private data', async () => {
  const { env, ed, queued } = await setup();
  await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: { ...fill, topics: ['writing'], grade_bands: ['K-2'], evidence_type: 'guidance' } });
  const me = client(env, 'reader@school.org');
  await ed(`/api/editor/resources/${queued}/publish`, { method: 'POST' });
  await me(`/api/state/${queued}`, { method: 'PUT', body: { note: 'PRIVATE-NOTE-ABOUT-STUDENT' } });
  await env.DB.prepare(`UPDATE resources SET source_provenance = '{"secret":"PROVENANCE-SECRET"}', reviewed_by = 'REVIEWER-NAME' WHERE id = ?`).bind(queued).run();
  const text = embeddingText(await row(env, queued));
  for (const bad of ['PRIVATE-NOTE', 'PROVENANCE-SECRET', 'REVIEWER-NAME', 'reader@school.org']) assert.ok(!text.includes(bad), bad);
  for (const good of ['Queued chatbot guide', 'Example Publisher', 'A direct reason', 'Teachers', 'writing', 'K-2', 'Guidance']) assert.ok(text.includes(good), good);
  // FTS content has no private data either
  const fts = JSON.stringify(await env.DB.prepare('SELECT * FROM resources_fts').all());
  assert.ok(!fts.includes('PRIVATE-NOTE'));
});

test('embedding strategy changes are detected: a new version re-embeds everything once', async () => {
  const { env, ed, queued } = await setup();
  await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: fill });
  await ed(`/api/editor/resources/${queued}/publish`, { method: 'POST' });
  assert.equal((await backfill(env)).indexed, 0);
  await env.DB.prepare(`UPDATE resources SET embedding_version = 'older-strategy' WHERE id = ?`).bind(queued).run();
  assert.equal((await backfill(env)).indexed, 1);
  assert.equal((await row(env, queued)).embedding_version, EMBEDDING.version);
  assert.equal((await backfill(env)).indexed, 0);
});

test('embedding model and pooling are identical at index and query time', async () => {
  const { env, ed, queued, anon } = await setup();
  await ed(`/api/editor/resources/${queued}`, { method: 'PATCH', body: fill });
  await ed(`/api/editor/resources/${queued}/publish`, { method: 'POST' });
  await anon('/api/search?q=chatbot');
  const embedCalls = env.AI.calls.filter((c) => c.model === EMBEDDING.model);
  assert.ok(embedCalls.length >= 2);
  assert.ok(embedCalls.every((c) => c.input.pooling === EMBEDDING.pooling));
});

test('manual add: validates, canonicalizes, and refuses exact duplicates', async () => {
  const { ed, env } = await setup();
  const body = { url: 'https://example.org/new?utm_source=x#frag', title: 'Manually added', publisher: 'Example', audiences: ['Teachers'] };
  const ok = await ed('/api/editor/resources', { method: 'POST', body });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.resource.status, 'indexed');
  assert.equal(ok.data.resource.canonical_url, 'https://example.org/new');
  assert.equal(ok.data.resource.published_at, null);
  const dup = await ed('/api/editor/resources', { method: 'POST', body: { ...body, url: 'https://example.org/new/' } });
  assert.equal(dup.status, 409);
  assert.equal(dup.data.existing_id, ok.data.resource.id);
  assert.equal((await ed('/api/editor/resources', { method: 'POST', body: { ...body, url: 'http://example.org/other' } })).status, 400);
  assert.equal((await ed('/api/editor/resources', { method: 'POST', body: { url: 'https://example.org/x' } })).status, 400);
  const flagged = await ed('/api/editor/resources', { method: 'POST', body: { ...body, url: 'https://mirror.example.net/new' } });
  assert.equal(flagged.status, 201);
  assert.equal(flagged.data.resource.duplicate_of, ok.data.resource.id);
  assert.equal((await ed('/api/editor/queue?flagged=1')).data.total, 1);
  // dismissing the warning is an editor decision
  await ed(`/api/editor/resources/${flagged.data.resource.id}`, { method: 'PATCH', body: { duplicate_dismissed: true } });
  assert.equal((await ed('/api/editor/queue?flagged=1')).data.total, 0);
  assert.ok(env);
});

test('changing a URL checks for clashes and resets link status', async () => {
  const { env, ed } = await setup();
  const a = await addResource(env, { url: 'https://example.org/a' });
  const b = await addResource(env, { url: 'https://example.org/b' });
  assert.equal((await ed(`/api/editor/resources/${a}`, { method: 'PATCH', body: { url: 'https://example.org/b?utm_source=z' } })).status, 409);
  await env.DB.prepare(`UPDATE resources SET link_status = 'broken' WHERE id = ?`).bind(b).run();
  assert.equal((await ed(`/api/editor/resources/${b}`, { method: 'PATCH', body: { url: 'https://example.org/b2' } })).status, 200);
  assert.equal((await row(env, b)).link_status, 'unchecked');
});

test('relations: editor-selected, labelled, and shown on the resource', async () => {
  const { env, ed, anon } = await setup();
  const a = await addResource(env, { title: 'Policy template', evidence_type: 'policy_template' });
  const b = await addResource(env, { title: 'A study of tutoring' });
  const c = await addResource(env, { title: 'Skeptical essay' });
  assert.equal((await ed(`/api/editor/resources/${a}/relations`, { method: 'POST', body: { to_id: b, relation: 'research', note: 'Evidence behind the template' } })).status, 201);
  assert.equal((await ed(`/api/editor/resources/${a}/relations`, { method: 'POST', body: { to_id: c, relation: 'critical_perspective' } })).status, 201);
  assert.equal((await ed(`/api/editor/resources/${a}/relations`, { method: 'POST', body: { to_id: a, relation: 'companion' } })).status, 400);
  assert.equal((await ed(`/api/editor/resources/${a}/relations`, { method: 'POST', body: { to_id: b, relation: 'agrees_with' } })).status, 400);
  assert.equal((await ed(`/api/editor/resources/${a}/relations`, { method: 'POST', body: { to_id: 'missing', relation: 'companion' } })).status, 404);
  const rel = (await anon(`/api/resources/${a}/related`)).data;
  assert.deepEqual(rel.curated.map((r) => [r.label, r.resource.title, r.note]), [['Research', 'A study of tutoring', 'Evidence behind the template'], ['Critical perspective', 'Skeptical essay', null]]);
  // companion links read both ways; other relations do not imply the reverse
  await ed(`/api/editor/resources/${b}/relations`, { method: 'POST', body: { to_id: c, relation: 'companion' } });
  assert.equal((await anon(`/api/resources/${c}/related`)).data.curated.some((r) => r.resource.id === b && r.label === 'Companion'), true);
  assert.equal((await anon(`/api/resources/${b}/related`)).data.curated.some((r) => r.resource.id === a), false);
  // an unpublished target disappears from public view
  await env.DB.prepare(`UPDATE resources SET status = 'indexed' WHERE id = ?`).bind(b).run();
  assert.equal((await anon(`/api/resources/${a}/related`)).data.curated.some((r) => r.resource.id === b), false);
  const listed = (await ed(`/api/editor/resources/${a}`)).data.relations;
  assert.equal(listed.length, 2);
  assert.equal((await ed(`/api/editor/resources/${a}/relations/${listed[0].id}`, { method: 'DELETE' })).status, 200);
});

test('queue, summary and source health views for editors', async () => {
  const { env, ed } = await setup();
  await addResource(env, { status: 'published' });
  await env.DB.prepare(`UPDATE resources SET link_status = 'broken' WHERE status = 'published'`).run();
  const sum = (await ed('/api/editor/summary')).data;
  assert.equal(sum.counts.indexed, 1);
  assert.equal(sum.counts.published, 1);
  assert.equal(sum.counts.broken_links, 1);
  assert.equal((await ed('/api/editor/queue?status=published&broken=1')).data.total, 1);
  assert.equal((await ed('/api/editor/queue?status=bogus')).status, 400);
  const q = (await ed('/api/editor/queue?q=chatbot')).data;
  assert.equal(q.items[0].title, 'Queued chatbot guide');
});

test('backfillKeys fills canonical URL, title key and DOI for older rows and flags collisions', async () => {
  const { env } = await setup();
  const a = await addResource(env, { url: 'https://example.org/p?utm_source=a', title: 'The Same Page', canonical_url: null });
  const b = await addResource(env, { url: 'https://example.org/p/', title: 'The Same Page Again', canonical_url: null });
  await env.DB.prepare('UPDATE resources SET canonical_url = NULL, dup_key = NULL WHERE id IN (?, ?)').bind(a, b).run();
  const out = await backfillKeys(env);
  assert.equal(out.flagged, 1);
  const ra = await row(env, a);
  assert.equal(ra.canonical_url, 'https://example.org/p');
  assert.equal(ra.dup_key, 'same page');
  const rb = await row(env, b);
  assert.equal(rb.canonical_url, null);
  assert.equal(rb.duplicate_of, a);
});

test('mock sanity: identical text gives identical vectors', () => {
  assert.deepEqual(mockVector('abc def'), mockVector('abc def'));
});

test('editor backup: pages through catalogue tables only, editors only', async () => {
  const env = await makeEnv({ vars: { BOOTSTRAP_EDITOR_EMAILS: 'ed@school.org' } });
  const anon = client(env);
  assert.ok([401, 403].includes((await anon('/api/editor/export?table=resources')).status));
  const ed = client(env, 'ed@school.org');
  const first = await ed('/api/editor/export?table=resources&limit=10');
  assert.equal(first.status, 200);
  assert.equal(first.data.rows.length, 10);
  assert.equal(first.data.next, 10);
  assert.ok(first.data.tables.includes('resource_relations'));
  assert.ok(!first.data.tables.includes('vault_blobs'));
  assert.equal((await ed('/api/editor/export?table=vault_blobs')).status, 400);
});
