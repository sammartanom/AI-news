import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, addResource, client, loadHandler } from '../helpers/mocks.mjs';
import { hybridSearch } from '../../src/search/hybrid.mjs';
import { buildMatch } from '../../src/search/keyword.mjs';

before(loadHandler);

const search = (env, q, opts = {}) => hybridSearch(env, { q, ...opts });
const titles = (r) => r.results.map((x) => x.title);

test('keyword: exact term in the title is found first', async () => {
  const env = await makeEnv({ seed: false, semantic: false });
  await addResource(env, { title: 'Privacy checklist for classroom tools' });
  await addResource(env, { title: 'A guide to lesson planning' });
  const r = await search(env, 'privacy');
  assert.equal(r.mode, 'keyword');
  assert.deepEqual(titles(r), ['Privacy checklist for classroom tools']);
});

test('keyword: stemming and question-style queries match', async () => {
  const env = await makeEnv({ seed: false, semantic: false });
  await addResource(env, { title: 'Teaching students about detectors' });
  const r = await search(env, 'How should teachers teach about detection?');
  assert.equal(r.total, 1);
});

test('keyword: query text cannot inject FTS operators', async () => {
  // Every term is a quoted literal, so operators and column filters in user text are inert.
  const m = buildMatch('literacy" OR title:secret NEAR( ) *');
  assert.ok(/^("[^"]*"\*?( OR )?)+$/.test(m), m); // quoted literals, optionally as a prefix
  assert.ok(!/title:/.test(m.replace(/"[^"]*"/g, '')), 'column filter must stay inside quotes');
  const env = await makeEnv({ seed: false, semantic: false });
  await addResource(env, { title: 'Literacy basics' });
  await assert.doesNotReject(search(env, 'literacy" OR title:secret NEAR( ) *'));
  await assert.doesNotReject(search(env, 'AND OR NOT ( ) "'));
});

test('semantic: finds a related resource that shares no keyword with the query', async () => {
  const env = await makeEnv({ seed: false });
  const id = await addResource(env, { title: 'Academic integrity and plagiarism policies', why: 'Explains integrity expectations.' });
  await addResource(env, { title: 'Field trip permission forms', why: 'Paperwork.' });
  const r = await search(env, 'cheating', { explain: true });
  assert.equal(r.mode, 'hybrid');
  assert.equal(r.results[0].id, id);
  assert.ok(r.results[0].why_matched.some((w) => w.type === 'semantic'));
  assert.ok(!r.results[0].why_matched.some((w) => w.type === 'keyword'));
});

test('hybrid: an item found by both retrievers outranks items found by one', async () => {
  const env = await makeEnv({ seed: false });
  const both = await addResource(env, { title: 'Tutoring with AI assistants', why: 'On tutoring.' });
  const kwOnly = await addResource(env, { title: 'Tutoring schedules', why: 'Schedules for tutoring rooms.', index: false });
  const semOnly = await addResource(env, { title: 'Guide for a tutor session', why: 'How a tutor helps.' });
  const r = await search(env, 'tutoring', { explain: true });
  assert.equal(r.results[0].id, both);
  const ids = r.results.map((x) => x.id);
  assert.ok(ids.includes(kwOnly) && ids.includes(semOnly));
});

test('zero results: gibberish returns an empty list, not the nearest vectors', async () => {
  const env = await makeEnv({ seed: false });
  env.SEMANTIC_MIN_SCORE = '0.5';
  await addResource(env, { title: 'Privacy checklist' });
  const r = await search(env, 'qzxv wplk');
  assert.equal(r.total, 0);
  assert.deepEqual(r.results, []);
});

test('audience weighting: the same query ranks differently for different lenses', async () => {
  const env = await makeEnv({ seed: false, semantic: false });
  const fam = await addResource(env, { title: 'Talking about chatbots at home', audiences: ['Families'], why: 'Chatbots for families.' });
  const adm = await addResource(env, { title: 'Chatbots in district procurement', audiences: ['Administrators'], why: 'Chatbots for district leaders.' });
  const every = await addResource(env, { title: 'What chatbots are', audiences: ['Everyone'], publisher: 'Other Publisher', why: 'Chatbots explained.' });
  const asFamilies = await search(env, 'chatbots', { audience: 'Families' });
  const asAdmins = await search(env, 'chatbots', { audience: 'Administrators' });
  assert.equal(asFamilies.results[0].id, fam);
  assert.equal(asFamilies.results.at(-1).id, adm);
  assert.equal(asAdmins.results[0].id, adm);
  assert.equal(asAdmins.results.at(-1).id, fam);
  assert.ok(every);
});

test('audience weighting: question wording (parents) also steers ranking', async () => {
  const env = await makeEnv({ seed: false, semantic: false });
  const fam = await addResource(env, { title: 'Chatbots and kids', audiences: ['Families'], why: 'Chatbots.' });
  const adm = await addResource(env, { title: 'Chatbots and kids policy', audiences: ['Administrators'], why: 'Chatbots.' });
  const r = await search(env, 'what should parents know about chatbots and kids');
  assert.equal(r.results[0].id, fam);
  assert.notEqual(r.results[0].id, adm);
});

test('source diversity: one publisher cannot fill every top slot', async () => {
  const env = await makeEnv({ seed: false, semantic: false });
  for (let i = 0; i < 4; i++) await addResource(env, { title: `Assessment guide part ${i}`, publisher: 'Big Publisher', why: 'Assessment.' });
  await addResource(env, { title: 'Assessment guide from elsewhere', publisher: 'Small Publisher', why: 'Assessment.' });
  const r = await search(env, 'assessment guide');
  const pubs = r.results.slice(0, 3).map((x) => x.publisher);
  assert.ok(pubs.includes('Small Publisher'), `top three: ${pubs}`);
});

test('unpublished items never appear, even with a stale vector or matching text', async () => {
  const env = await makeEnv({ seed: false });
  const queued = await addResource(env, { title: 'Chatbot rubric draft', status: 'indexed', index: false });
  const rejected = await addResource(env, { title: 'Chatbot rejected piece', status: 'rejected', index: false });
  const stale = await addResource(env, { title: 'Chatbot stale vector', status: 'indexed', index: false });
  const { mockVector } = await import('../helpers/mocks.mjs');
  await env.VECTORIZE.upsert([{ id: stale, values: mockVector('Chatbot stale vector') }]);
  const live = await addResource(env, { title: 'Chatbot published piece' });
  const r = await search(env, 'chatbot');
  assert.deepEqual(r.results.map((x) => x.id), [live]);
  for (const id of [queued, rejected, stale]) assert.ok(!r.results.some((x) => x.id === id));
});

test('degraded modes: vector failure, missing bindings and rate limiting still return keyword results', async () => {
  const env = await makeEnv({ seed: false });
  await addResource(env, { title: 'Privacy checklist' });
  env.VECTORIZE.fail = true;
  let r = await search(env, 'privacy');
  assert.equal(r.mode, 'keyword');
  assert.equal(r.degraded, 'semantic_failed');
  assert.equal(r.total, 1);
  env.VECTORIZE.fail = false;
  r = await search(env, 'privacy', { allowSemantic: false });
  assert.equal(r.degraded, 'semantic_skipped');
  assert.equal(r.total, 1);
  r = await search({ ...env, AI: undefined }, 'privacy');
  assert.equal(r.degraded, 'semantic_unavailable');
});

test('filters apply to keyword and semantic candidates alike', async () => {
  const env = await makeEnv({ seed: false });
  const a = await addResource(env, { title: 'Writing feedback tools', format: 'Report' });
  await addResource(env, { title: 'Writing feedback lessons', format: 'Lessons' });
  const r = await search(env, 'writing feedback', { filters: { format: 'Report' } });
  assert.deepEqual(r.results.map((x) => x.id), [a]);
});

test('explanations are returned only when requested', async () => {
  const env = await makeEnv({ seed: false, semantic: false });
  await addResource(env, { title: 'Privacy checklist' });
  assert.equal((await search(env, 'privacy')).results[0].why_matched, undefined);
  assert.ok((await search(env, 'privacy', { explain: true })).results[0].why_matched.length > 0);
});

test('HTTP: /api/search validates input and never needs the answer layer', async () => {
  const env = await makeEnv({ seed: true });
  const c = client(env);
  assert.equal((await c('/api/search')).status, 400);
  assert.equal((await c('/api/search?q=' + 'x'.repeat(400))).status, 400);
  assert.equal((await c('/api/search?q=literacy&audience=Wizards')).status, 400);
  const ok = await c('/api/search?q=' + encodeURIComponent('What does AI literacy look like in elementary school?'));
  assert.equal(ok.status, 200);
  assert.ok(ok.data.results.length > 0);
  assert.equal(ok.data.results[0].source_provenance, undefined); // internal fields are not public
});

test('HTTP: the example questions each return results from the seeded catalog', async () => {
  const env = await makeEnv({ seed: true });
  const c = client(env);
  const questions = [
    'What does AI literacy look like in elementary school?',
    'How should a district approach student AI use?',
    'What should parents know about AI and children?',
    'Show me research about AI tutoring',
    'How is AI changing assessment?',
    'What are the strongest concerns about AI detection?',
    'Give me classroom examples without product marketing',
    'What should a superintendent read first?',
    'What are students saying about AI?',
    'Show resources skeptical of AI use in schools'
  ];
  for (const q of questions) {
    const r = await c('/api/search?q=' + encodeURIComponent(q));
    assert.equal(r.status, 200, q);
    assert.ok(r.data.results.length > 0, `no results for: ${q}`);
  }
});
