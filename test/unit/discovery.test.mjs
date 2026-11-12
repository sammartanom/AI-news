import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, addResource, client, loadHandler } from '../helpers/mocks.mjs';
import { groupFor, groupPerspectives } from '../../src/discovery/perspectives.mjs';
import { stageFor } from '../../src/discovery/paths.mjs';
import { labelNeighbor } from '../../src/discovery/related.mjs';
import { catchUp } from '../../src/discovery/catchup.mjs';

before(loadHandler);

test('perspectives group by editor-set metadata and never create pro/con groups', async () => {
  const env = await makeEnv();
  const c = client(env);
  const r = await c('/api/perspectives?q=' + encodeURIComponent('AI and student learning'));
  assert.equal(r.status, 200);
  const names = r.data.groups.map((g) => g.name);
  assert.ok(names.length >= 2);
  for (const n of names) assert.ok(!/\b(pro|con|for|against|support|oppos)/i.test(n.replace('Questions and concerns', '')), n);
  for (const g of r.data.groups) for (const x of g.resources) assert.ok(g.key === 'other' || groupFor(x) === g.key);
  // each resource appears once
  const ids = r.data.groups.flatMap((g) => g.resources.map((x) => x.id));
  assert.equal(new Set(ids).size, ids.length);
});

test('perspective assignment prefers resource type, then collection, else unassigned', () => {
  assert.equal(groupFor({ evidence_type: 'research', collections: ['inside-classroom'] }), 'research');
  assert.equal(groupFor({ evidence_type: null, collections: ['questions-concerns'] }), 'concerns');
  assert.equal(groupFor({ evidence_type: null, collections: ['start-here'] }), null);
  const groups = groupPerspectives([{ id: '1', evidence_type: null, collections: ['start-here'] }]);
  assert.deepEqual(groups.map((g) => g.key), ['other']);
});

test('learning paths contain only real resources and say when a step is empty', async () => {
  const env = await makeEnv({ seed: false });
  const a = await addResource(env, { title: 'AI literacy starter for principals', collections: ['start-here'], audiences: ['Administrators'] });
  const b = await addResource(env, { title: 'Classroom AI literacy lessons', collections: ['inside-classroom'], audiences: ['Teachers'] });
  const c = await addResource(env, { title: 'Research on AI literacy', evidence_type: 'research', audiences: ['Everyone'] });
  const d = await addResource(env, { title: 'Concerns about AI literacy programs', collections: ['questions-concerns'], audiences: ['Everyone'] });
  const r = await client(env)('/api/paths?q=' + encodeURIComponent("I'm an elementary principal and new to AI literacy"));
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.stages.map((s) => s.name), ['Understand', 'See examples', 'Examine evidence', 'Consider risks and questions', 'Act']);
  const placed = Object.fromEntries(r.data.stages.map((s) => [s.key, s.resources.map((x) => x.id)]));
  assert.deepEqual(placed.understand, [a]);
  assert.deepEqual(placed.examples, [b]);
  assert.deepEqual(placed.evidence, [c]);
  assert.deepEqual(placed.risks, [d]);
  assert.deepEqual(placed.act, []);
  assert.match(r.data.note, /no matching resource/i);
  assert.equal(r.data.audience, 'Administrators'); // inferred from "principal"
  const known = new Set([a, b, c, d]);
  for (const s of r.data.stages) for (const x of s.resources) assert.ok(known.has(x.id));
});

test('learning path with no matches returns nothing rather than inventing content', async () => {
  const env = await makeEnv({ seed: false });
  await addResource(env, { title: 'Unrelated topic', why: 'Nothing here.' });
  const r = await client(env)('/api/paths?q=quantum+basketweaving');
  assert.equal(r.data.count, 0);
  assert.equal(r.data.note, 'No matching resources yet.');
});

test('path stage assignment', () => {
  assert.equal(stageFor({ evidence_type: 'classroom_example', collections: ['questions-concerns'] }), 'examples');
  assert.equal(stageFor({ evidence_type: null, collections: ['policy-governance'] }), 'act');
  assert.equal(stageFor({ evidence_type: null, collections: [], format: 'Checklist' }), 'act');
  assert.equal(stageFor({ evidence_type: null, collections: [], format: 'Article' }), null);
});

test('presets are listed', async () => {
  const env = await makeEnv({ seed: false, semantic: false });
  const r = await client(env)('/api/paths/presets');
  assert.ok(r.data.presets.length >= 3);
});

test('related labels describe the neighbor itself and never imply disagreement', () => {
  const base = { published_at: '2024-01-01' };
  assert.equal(labelNeighbor(base, { published_at: '2025-01-01' }), 'Newer');
  assert.equal(labelNeighbor(base, { published_at: '2023-01-01', evidence_type: 'research' }), 'Research');
  assert.equal(labelNeighbor(base, { published_at: null, evidence_type: 'classroom_example' }), 'Practical example');
  assert.equal(labelNeighbor({ published_at: null }, { published_at: '2025-01-01' }), 'Related'); // unknown base date: no "newer" claim
  assert.equal(labelNeighbor(base, { published_at: null }), 'Related');
  for (const t of ['research', 'guidance', 'commentary', 'student_voice', null]) {
    assert.notEqual(labelNeighbor(base, { published_at: null, evidence_type: t }), 'Critical perspective');
  }
});

test('related resources combine curated links with similar resources and exclude the resource itself', async () => {
  const env = await makeEnv();
  const c = client(env);
  const r = (await c('/api/resources/1/related')).data;
  assert.equal(r.curated[0].label, 'Companion');
  assert.ok(r.similar.length > 0);
  assert.ok(r.similar.every((s) => s.resource.id !== '1'));
  assert.ok(r.similar.every((s) => !r.curated.some((x) => x.resource.id === s.resource.id)));
  assert.ok(r.similar.every((s) => ['Related', 'Newer', 'Research', 'Practical example'].includes(s.label)));
  // without Vectorize, keyword neighbors still work
  const keyword = (await client({ ...env, VECTORIZE: undefined })('/api/resources/1/related')).data;
  assert.ok(keyword.similar.every((s) => s.via === 'keyword'));
});

test('topic pages: sections from metadata and retrieval; undated items never appear under Latest', async () => {
  const env = await makeEnv({ seed: false });
  const dated = await addResource(env, { title: 'Writing with AI: new study', evidence_type: 'research', published_at: '2026-05-01', topics: ['writing'] });
  const undated = await addResource(env, { title: 'Writing with AI in the classroom', collections: ['inside-classroom', 'start-here'], topics: ['writing'] });
  const r = await client(env)('/api/topics/writing');
  assert.equal(r.status, 200);
  const sec = Object.fromEntries(r.data.sections.map((s) => [s.name, s.resources.map((x) => x.id)]));
  assert.deepEqual(sec['Latest'], [dated]);
  assert.deepEqual(sec['Research'], [dated]);
  assert.deepEqual(sec['Classroom'], [undated]);
  assert.deepEqual(sec['Start here'], [undated]);
  assert.equal((await client(env)('/api/topics/not-a-topic')).status, 404);
  const list = (await client(env)('/api/topics')).data.topics;
  assert.ok(list.some((t) => t.slug === 'ai-literacy'));
});

test('topic pins override generated order for editors', async () => {
  const env = await makeEnv({ seed: false, vars: { BOOTSTRAP_EDITOR_EMAILS: 'ed@school.org' } });
  const a = await addResource(env, { title: 'Writing with AI first', evidence_type: 'research', topics: ['writing'] });
  const b = await addResource(env, { title: 'Writing with AI second', evidence_type: 'research', topics: ['writing'] });
  const ed = client(env, 'ed@school.org');
  assert.equal((await ed('/api/editor/topics/writing/pins', { method: 'PUT', body: { section: 'research', resource_ids: [b] } })).status, 200);
  const r = (await client(env)('/api/topics/writing')).data;
  assert.equal(r.sections.find((s) => s.name === 'Research').resources[0].id, b);
  assert.ok(a);
  assert.equal((await ed('/api/editor/topics/writing/pins', { method: 'PUT', body: { section: 'nope', resource_ids: [] } })).status, 400);
});

test('catch me up: only items with a recorded date added to Signal, never publication date', async () => {
  const env = await makeEnv({ seed: false, semantic: false });
  const now = Date.parse('2026-10-26T12:00:00Z');
  const recentOldArticle = await addResource(env, { title: 'Old article added recently', published_at: '2019-01-01', added_at: '2026-10-20T10:00:00.000Z', audiences: ['Teachers'] });
  const recentUnknown = await addResource(env, { title: 'Undated added recently', published_at: null, added_at: '2026-10-25T10:00:00.000Z', audiences: ['Teachers'] });
  await addResource(env, { title: 'New article added long ago', published_at: '2026-10-01', added_at: '2026-01-01T00:00:00.000Z' });
  const noAdded = await addResource(env, { title: 'No added date' });
  await env.DB.prepare('UPDATE resources SET added_at = NULL WHERE id = ?').bind(noAdded).run();
  await addResource(env, { title: 'Families only item', audiences: ['Families'], added_at: '2026-10-24T10:00:00.000Z' });
  const out = await catchUp(env, { audience: 'Teachers', days: 30, now });
  const ids = out.groups.flatMap((g) => g.resources.map((r) => r.id));
  assert.deepEqual(ids, [recentUnknown, recentOldArticle]); // newest added first; Families-only item filtered out
  assert.deepEqual(out.groups.map((g) => g.date), ['2026-10-25', '2026-10-20']);
  const week = await catchUp(env, { audience: 'Everyone', days: 3, now });
  assert.equal(week.total, 2);
  const http = (await client(env)('/api/catch-up?audience=Wizards'));
  assert.equal(http.status, 400);
});

test('resource data keeps publication date and date added separate', async () => {
  const env = await makeEnv({ seed: false, semantic: false });
  const id = await addResource(env, { published_at: '2024-02', added_at: '2026-10-01T00:00:00.000Z' });
  const r = (await client(env)(`/api/resources/${id}`)).data.resource;
  assert.equal(r.published_at, '2024-02');
  assert.equal(r.added_at, '2026-10-01T00:00:00.000Z');
});

test('grid listing: sorts, filters, pagination and unknown dates last', async () => {
  const env = await makeEnv({ seed: false, semantic: false });
  await addResource(env, { title: 'B undated', publisher: 'Zeta', format: 'Report', published_at: null, added_at: '2026-10-03T00:00:00.000Z', audiences: ['Teachers'], collections: ['start-here'], grade_bands: ['K-2'], evidence_type: 'research' });
  await addResource(env, { title: 'A dated old', publisher: 'Alpha', format: 'Article', published_at: '2020-05-05', added_at: '2026-10-01T00:00:00.000Z', audiences: ['Families'] });
  await addResource(env, { title: 'C dated new', publisher: 'Mid', format: 'Article', published_at: '2025-05-05', added_at: '2026-10-02T00:00:00.000Z' });
  const c = client(env);
  const t = async (q) => (await c('/api/resources?' + q)).data.resources.map((r) => r.title);
  assert.deepEqual(await t('sort=newest'), ['C dated new', 'A dated old', 'B undated']);
  assert.deepEqual(await t('sort=added'), ['B undated', 'C dated new', 'A dated old']);
  assert.deepEqual(await t('sort=publisher'), ['A dated old', 'C dated new', 'B undated']);
  assert.deepEqual(await t('sort=format'), ['A dated old', 'C dated new', 'B undated']);
  assert.deepEqual(await t('format=Report'), ['B undated']);
  assert.deepEqual(await t('audience=Families'), ['C dated new', 'A dated old']); // "Everyone" items always match a lens
  assert.deepEqual(await t('collection=start-here'), ['B undated']);
  assert.deepEqual(await t('grade=K-2'), ['B undated']);
  assert.deepEqual(await t('evidence=research'), ['B undated']);
  assert.deepEqual(await t('publisher=alpha'), ['A dated old']);
  assert.deepEqual(await t('dated=1&sort=newest'), ['C dated new', 'A dated old']);
  const page = (await c('/api/resources?sort=title&limit=2&offset=2')).data;
  assert.equal(page.total, 3);
  assert.equal(page.resources.length, 1);
  assert.equal((await c('/api/resources?sort=banana')).status, 400);
  assert.equal((await c('/api/resources?collection=nope')).status, 400);
  assert.equal((await c('/api/resources?limit=9999')).data.limit, 50);
  const f = (await c('/api/facets')).data;
  assert.equal(f.total, 3);
  assert.deepEqual(f.formats.map((x) => x.value).sort(), ['Article', 'Report']);
});

test('reading paths use resources a person chose: editor-reviewed first, then hand-picked; feed items never', async () => {
  const env = await makeEnv({ seed: false });
  const picked = await addResource(env, { title: 'AI literacy framework for teachers', collections: ['ai-literacy'], evidence_type: 'framework' });
  const fed = await addResource(env, { title: 'AI literacy lesson ideas for teachers', collections: ['ai-literacy'], evidence_type: 'framework' });
  await env.DB.prepare("UPDATE resources SET auto_published = 1, source_id = NULL WHERE id = ?").bind(picked).run();
  await env.DB.prepare("UPDATE resources SET auto_published = 1, source_id = 'some-feed' WHERE id = ?").bind(fed).run();
  const r = (await client(env)('/api/paths?preset=teacher-start')).data;
  const ids = r.stages.flatMap((s) => s.resources.map((x) => x.id));
  assert.ok(ids.includes(picked), 'hand-picked resource appears');
  assert.ok(!ids.includes(fed), 'feed item does not');
  assert.equal(r.preset.id, 'teacher-start');
  assert.equal((await client(env)('/api/paths?preset=nope')).status, 400); // falls back to ?q=, which is missing
  for (const old of ['new-principal', 'district-policy', 'leader', 'family']) assert.equal((await client(env)('/api/paths?preset=' + old)).data.preset.id, 'teacher-start', 'old links open the teacher path');
});
