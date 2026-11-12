import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, addResource, loadHandler } from '../helpers/mocks.mjs';
import { hybridSearch } from '../../src/search/hybrid.mjs';
import { validateUnderstanding } from '../../src/search/understand.mjs';

before(loadHandler);

const ai = { SEARCH_MODEL: '@cf/test/understand', RERANK_MODEL: '@cf/test/rerank' };
const titles = (r) => r.results.map((x) => x.title);

// The mock answers the understanding prompt with fixed JSON and scores reranking by word overlap.
function mockModels(env, understanding) {
  env.AI.chatResponse = (input) => {
    if (input.contexts) {
      const q = new Set(input.query.toLowerCase().split(/\W+/));
      return { response: input.contexts.map((c, id) => ({ id, score: c.text.toLowerCase().split(/\W+/).filter((w) => q.has(w)).length / 10 })) };
    }
    return { response: JSON.stringify(understanding) };
  };
}

test('validateUnderstanding: cleans phrases, drops repeats and unknown hints', () => {
  const u = validateUnderstanding({ rewrite: 'large language models', expansions: ['LLM', 'llm', '<b>chatbots</b>', 'large language models', 'x'], audience: 'Wizards', kind: 'courses', recent: 'yes' }, 'LLMs');
  assert.equal(u.rewrite, 'large language models');
  assert.deepEqual(u.expansions, ['LLM', 'b chatbots b']);
  assert.equal(u.audience, null);
  assert.equal(u.kind, 'courses');
  assert.equal(u.recent, false);
  assert.equal(validateUnderstanding(null, 'q'), null);
  assert.equal(validateUnderstanding({ rewrite: 'Same' }, 'same').rewrite, null);
});

test('AI search: the rewrite finds what the typed words miss, and the reranker orders by relevance', async () => {
  const env = await makeEnv({ seed: false, vars: ai });
  await addResource(env, { title: 'Large language models in the classroom', publisher: 'A' });
  await addResource(env, { title: 'Grading essays with rubrics', publisher: 'B' });
  mockModels(env, { rewrite: 'large language models classroom', expansions: ['chatbots in class'], audience: 'Teachers', kind: null, recent: false });
  const r = await hybridSearch(env, { q: 'LLMz for teachrs' });
  assert.equal(r.mode, 'ai');
  assert.equal(r.ai.reranked, true);
  assert.equal(r.ai.understood.rewrite, 'large language models classroom');
  assert.equal(titles(r)[0], 'Large language models in the classroom');
});

test('AI search: model failures and the rate limit fall back to keyword and vector search', async () => {
  const env = await makeEnv({ seed: false, vars: ai });
  await addResource(env, { title: 'Privacy checklist for AI tools', publisher: 'A' });
  env.AI.chatResponse = () => { throw new Error('model down'); };
  const r = await hybridSearch(env, { q: 'privacy' });
  assert.equal(r.ai.understood, null);
  assert.equal(r.ai.reranked, false);
  assert.equal(titles(r)[0], 'Privacy checklist for AI tools');
  const limited = await hybridSearch(env, { q: 'privacy', allowSemantic: false });
  assert.equal(limited.mode, 'keyword');
  assert.equal(limited.total, 1);
});

test('keyword search matches partly typed words', async () => {
  const env = await makeEnv({ seed: false, semantic: false });
  await addResource(env, { title: 'Assessments and generative tools' });
  assert.equal((await hybridSearch(env, { q: 'assess' })).total, 1);
});
