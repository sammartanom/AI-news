import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, addResource, client, loadHandler } from '../helpers/mocks.mjs';
import { hybridSearch } from '../../src/search/hybrid.mjs';
import { synonymsFor } from '../../src/search/synonyms.mjs';
import { nearbyTopics } from '../../src/search/fallback.mjs';
import { inferTopics, inferCollection, TOPIC_RULES, TOPIC_SLUGS, TOPIC_COLLECTION } from '../../src/lib/autotopics.mjs';
import { inFocus } from '../../src/ingest/focus.mjs';
import { ruleGate } from '../../src/ingest/triage.mjs';
import { tagUntagged, retagResource } from '../../src/discovery/tagging.mjs';
import { TOPICS } from '../../src/lib/taxonomy.mjs';

before(loadHandler);

// A small evaluation set: questions people ask, and a resource from the seed data that a good
// search should put in the top three. Keyword mode only, so it measures the parts we control
// (synonyms, field weights, editorial signals) without the AI steps.
const GOLDEN = [
  ['plagiarism', '19'],
  ['what should parents know about AI', '1'],
  ['ELL reading', '11'],
  ['kids development', '17'],
  ['PD', '22'],
  ['grading with AI', '21'],
  ['math', '12'],
  ['hallucinations', '26'],
  ['what students think', '16'],
  ['readiness checklist for districts', '29']
];

test('search evaluation: each golden question finds its resource in the top three', async () => {
  const env = await makeEnv({ semantic: false });
  const misses = [];
  for (const [q, id] of GOLDEN) {
    const r = await hybridSearch(env, { q, limit: 3 });
    if (!r.results.some((x) => x.id === id)) misses.push(`${q} -> ${r.results.map((x) => x.id).join(', ') || 'nothing'}`);
  }
  assert.deepEqual(misses, []);
});

test('synonyms widen a search with the words resources use, without repeats', () => {
  assert.deepEqual(synonymsFor('AI cheating'), ['academic integrity', 'plagiarism']);
  assert.ok(synonymsFor('help for an IEP').includes('special education'));
  assert.ok(synonymsFor('mental health and chatbots').includes('wellbeing'));
  assert.deepEqual(synonymsFor('plagiarism and academic integrity'), ['cheating']); // words already typed are not added
  assert.ok(synonymsFor('parents kids teens policy laws grading tutors jobs math').length <= 8);
  assert.deepEqual(synonymsFor(''), []);
});

test('topic rules: titles map to topics in the topic list, title matches first', () => {
  assert.deepEqual(Object.keys(TOPIC_RULES).sort(), [...TOPIC_SLUGS].sort());
  assert.deepEqual(TOPIC_SLUGS, TOPICS.map((t) => t.slug));
  assert.deepEqual(inferTopics({ title: 'AI detectors do not work: what to do about cheating instead' }), ['academic-integrity', 'ai-detection']);
  assert.ok(inferTopics({ title: 'Oregon SB 1546 (2026): AI companions' }).includes('safety-wellbeing'));
  assert.ok(inferTopics({ title: 'Teens and AI companions', collections: ['privacy-security'] })[0] === 'privacy'); // an editor's collection comes first
  assert.deepEqual(inferTopics({ title: 'Introducing Gemini 3.7 Flash' }), []);
  assert.ok(inferTopics({ title: 'A new course', text: 'A course on AI literacy for middle school teachers.' }).includes('ai-literacy'));
  assert.ok(!inferTopics({ title: 'AI risk assessment for frontier models' }).includes('assessment'));
  assert.ok(inferTopics({ title: 'x '.repeat(5), text: 'privacy assessment writing essays tutoring policy safety equity jobs coding' }).length <= 4);
  assert.equal(inferCollection(['academic-integrity']), 'assessment-integrity');
  assert.equal(inferCollection(['future-of-work']), null);
  assert.equal(inferCollection(['assessment']), 'assessment-integrity');
  assert.equal(inferCollection(['policy-guidance']), 'policy-governance');
  assert.equal(inferCollection(['writing']), 'learning-thinking');
  assert.equal(inferCollection(['safety-wellbeing']), 'questions-concerns');
  for (const [t, c] of Object.entries(TOPIC_COLLECTION)) assert.equal(typeof c, 'string', t);
});

test('focus rules keep useful general AI news and drop launches, digests and industry news', () => {
  for (const t of ['Are you using AI to study? Here’s how to do it well', 'FTC Launches Inquiry into AI Chatbots Acting as Companions', 'The UAE embraces AI for kindergartners']) assert.ok(inFocus(t), t);
  for (const t of ['Introducing Gemini 3.7 Flash', 'Import AI 460: Reward hacking society', 'The new economics of enterprise AI', 'Google launches Gemini 4 Carbon with a ‘significant leap’ in cybersecurity', 'How OpenAI Used Its Own LLMs to Design Its Jalapeño Chip']) assert.ok(!inFocus(t), t);
  // Strict sources (lab blogs) need an education or public-interest angle.
  assert.ok(!inFocus('Teaching AI to read a map', { strict: true }));
  assert.ok(inFocus('Enabling teachers to create learning interactives', { strict: true }));
  assert.ok(!inFocus('WeatherNext: AI model achieves breakthrough in forecasting cyclones', { strict: true }));
  // The triage gate applies the rules only to general AI news sources.
  const row = { title: 'Introducing a faster AI model for enterprise', duplicate_of: null };
  assert.deepEqual(ruleGate(row), []);
  assert.deepEqual(ruleGate(row, { collections: ['ai-beyond-education'] }), ['General AI news outside the library focus']);
});

test('tagging: untagged resources get rule topics and a collection; editors’ topics are kept', async () => {
  const env = await makeEnv({ seed: false, semantic: false });
  const a = await addResource(env, { title: 'Academic integrity and AI detectors', collections: [] });
  const b = await addResource(env, { title: 'Privacy notes', topics: ['writing'] });
  const c = await addResource(env, { title: 'Untaggable note' });
  assert.deepEqual(await tagUntagged(env), { tagged: 2 }); // b already has an editor's topic
  const row = (id) => env.DB.prepare('SELECT tags, collections, topics_auto FROM resources WHERE id = ?').bind(id).first();
  assert.deepEqual(JSON.parse((await row(a)).tags), ['academic-integrity', 'ai-detection']);
  assert.deepEqual(JSON.parse((await row(a)).collections), ['assessment-integrity']);
  assert.equal((await row(c)).topics_auto, 1, 'tried once, even with nothing found');
  assert.deepEqual(await tagUntagged(env), { tagged: 0 });
  assert.equal(await retagResource(env, b), false);
  assert.deepEqual(JSON.parse((await row(b)).tags), ['writing']);
  // A brief or other text improves rule topics later.
  await env.DB.prepare(`UPDATE resources SET ai_brief = 'A guide to student data privacy.' WHERE id = ?`).bind(c).run();
  assert.equal(await retagResource(env, c), true);
  assert.deepEqual(JSON.parse((await row(c)).tags), ['privacy']);
});

test('ranking: editors’ picks lead, general AI news yields; browse sorts picks first', async () => {
  const env = await makeEnv({ seed: false, semantic: false });
  await env.DB.prepare(`INSERT INTO sources(id, name, feed_url, publisher, created_at) VALUES ('feed', 'Feed', 'https://f.example.org/rss', 'Feed', '2026-01-01')`).run();
  const feed = await addResource(env, { title: 'AI tutoring in schools', published_at: '2026-10-01' });
  const news = await addResource(env, { title: 'AI tutoring startup raises money', published_at: '2026-10-02', collections: ['ai-beyond-education'] });
  const pick = await addResource(env, { title: 'AI tutoring: a guide for schools', published_at: '2024-01-01' });
  await env.DB.prepare(`UPDATE resources SET source_id = 'feed', auto_published = 1 WHERE id IN (?, ?)`).bind(feed, news).run();
  const r = await hybridSearch(env, { q: 'AI tutoring', limit: 3 });
  assert.equal(r.results[0].id, pick);
  assert.equal(r.results.at(-1).id, news);
  assert.equal(r.results[0].pick, true);
  const api = client(env);
  assert.equal((await api('/api/resources?sort=recommended')).data.resources[0].id, pick);
  assert.equal((await api('/api/resources?sort=newest')).data.resources[0].id, news);
});

test('a search with no results offers nearby topics and editors’ picks', async () => {
  const env = await makeEnv({ semantic: false });
  const api = client(env);
  const empty = (await api('/api/search?q=qqqzzzxxx')).data;
  assert.equal(empty.total, 0);
  assert.ok(Array.isArray(empty.fallback.topics));
  assert.equal(empty.fallback.picks.length, 5);
  const found = (await api('/api/search?q=literacy')).data;
  assert.equal(found.fallback, undefined);
  assert.deepEqual(nearbyTopics('help with cheating').map((t) => t.slug), ['academic-integrity']);
  assert.ok(nearbyTopics('privacy rules').some((t) => t.slug === 'privacy'));
});

test('facets offer only listed topics, by name', async () => {
  const env = await makeEnv({ seed: false, semantic: false });
  await addResource(env, { title: 'One', topics: ['privacy', 'made-up tag'] });
  const f = (await client(env)('/api/facets')).data;
  assert.deepEqual(f.topics, [{ value: 'privacy', n: 1, label: 'Privacy and data' }]);
});
