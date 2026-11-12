import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, addResource, client, loadHandler } from '../helpers/mocks.mjs';
import { validateDigest, extractiveDigest, MAX_PICKS, buildDigest, ensureDigest, weekItems, pickForPrompt } from '../../src/discovery/digest.mjs';
import { runScheduled, CRON_DAILY } from '../../src/jobs.mjs';

before(loadHandler);

const NOW = Date.parse('2026-10-28T12:00:00.000Z');
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();

async function week(env) {
  await addResource(env, { title: 'AI tutors in math class', publisher: 'A', added_at: daysAgo(1), published_at: '2026-10-27', collections: ['inside-classroom'] });
  await addResource(env, { title: 'State guidance on generative AI', publisher: 'B', added_at: daysAgo(2), published_at: '2026-10-25', collections: ['policy-governance'] });
  await addResource(env, { title: 'Chatbots and student writing', publisher: 'C', added_at: daysAgo(3), published_at: '2026-10-21', collections: ['inside-classroom'] }); // exactly a week ago: in
  await addResource(env, { title: 'AI safety newsletter roundup', publisher: 'D', added_at: daysAgo(4), published_at: '2026-10-24', collections: ['ai-beyond-education', 'policy-governance'] });
  await addResource(env, { title: 'Old archive post about AI', publisher: 'E', added_at: daysAgo(1), published_at: '2023-03-01' }); // back catalogue: left out
  await addResource(env, { title: 'Last month on AI', publisher: 'F', added_at: daysAgo(20), published_at: '2026-10-08' }); // added before the week
  // Added this week but not published this week: all left out.
  await addResource(env, { title: 'Evergreen guide with no date', publisher: 'G', added_at: daysAgo(1) });
  await addResource(env, { title: 'Report dated only to the month', publisher: 'H', added_at: daysAgo(1), published_at: '2026-10' });
  await addResource(env, { title: 'Ten days old', publisher: 'I', added_at: daysAgo(1), published_at: '2026-10-18' });
  await addResource(env, { title: 'Dated in the future', publisher: 'J', added_at: daysAgo(1), published_at: '2026-11-02' });
}

test('week items: only resources published in the last seven days; undated, partly dated, older and future ones are left out', async () => {
  const env = await makeEnv({ seed: false, semantic: false });
  await week(env);
  const { rows } = await weekItems(env, { now: NOW });
  assert.deepEqual(rows.map((r) => r.title).sort(), ['AI safety newsletter roundup', 'AI tutors in math class', 'Chatbots and student writing', 'State guidance on generative AI']);
  const many = Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, publisher: i < 8 ? 'Busy' : `P${i}` }));
  assert.deepEqual(pickForPrompt(many, { perPublisher: 2 }).map((r) => r.id), ['x0', 'x1', 'x8', 'x9']);
});

test('validateDigest keeps at most five real picks, two overview paragraphs, and strips links', () => {
  const items = Array.from({ length: 8 }, (_, i) => ({ id: `r${i + 1}` }));
  const v = validateDigest({
    headline: 'A week of tutors', overview: ['Pieces on tutors. See https://evil.example.net/', 'Second paragraph.', 'Third is dropped.'],
    picks: [{ item: 1, why: 'On tutors.' }, { item: 1, why: 'dup' }, { item: 99, why: 'ghost' }, { item: 2 }, 3, { item: 4 }, { item: 5 }, { item: 6 }, { item: 7 }]
  }, items);
  assert.deepEqual(v.overview, ['Pieces on tutors. See', 'Second paragraph.']);
  assert.deepEqual(v.picks.map((p) => p.id), ['r1', 'r2', 'r3', 'r4', 'r5']);
  assert.equal(v.picks[0].why, 'On tutors.');
  assert.equal(validateDigest({ overview: 'One\n\nTwo', picks: [{ item: 1 }, { item: 2 }, { item: 3 }] }, items).overview.length, 2);
  assert.equal(validateDigest({ overview: 'x', picks: [{ item: 1 }] }, items), null); // too few picks
  assert.equal(validateDigest(null, items), null);
  assert.equal(extractiveDigest([]).picks.length, 0);
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, publisher: `P${i}`, collections: '["inside-classroom"]' }));
  assert.equal(extractiveDigest(many).picks.length, MAX_PICKS);
});

test('digest: the model writes it from the week\'s titles; without a model it is a roundup', async () => {
  const env = await makeEnv({ seed: false, vars: { DIGEST_MODEL: '@cf/test/digest' } });
  await week(env);
  let prompt = '';
  env.AI.chatResponse = (input) => {
    prompt = input.messages.at(-1).content;
    return { response: JSON.stringify({ headline: 'Tutors and guidance', overview: ['This week brought pieces on tutoring and policy.', 'Safety also came up.'], picks: [1, 2, 3, 4, 1].map((item) => ({ item, why: 'A piece on this.' })) }) };
  };
  const d = await buildDigest(env, { now: NOW });
  assert.equal(d.mode, 'model');
  assert.ok(!prompt.includes('Old archive post'));
  assert.ok(!prompt.includes('Evergreen guide'));
  assert.match(prompt, /^Resources published this week:/);
  const api = client(env);
  const res = await api('/api/digest');
  assert.equal(res.status, 200);
  assert.equal(res.data.digest.generated, true);
  assert.equal(res.data.digest.overview.length, 2);
  assert.equal(res.data.digest.picks.length, 4);
  assert.ok(res.data.digest.picks.every((i) => i.title && i.url && i.why));

  const plain = await makeEnv({ seed: false, semantic: false });
  await week(plain);
  const p = await buildDigest(plain, { now: NOW });
  assert.equal(p.mode, 'extractive');
  assert.equal(p.content.picks.length, 4);
  assert.match(p.content.overview[0], /^4 resources were published this week/);
});

test('digest: a broken model reply falls back to the roundup; ensureDigest builds weekly, not on every call', async () => {
  const env = await makeEnv({ seed: false, vars: { DIGEST_MODEL: '@cf/test/digest' } });
  await week(env);
  env.AI.chatResponse = { response: 'not json' };
  const first = await ensureDigest(env, { now: NOW });
  assert.equal(first.built, true);
  assert.equal(first.mode, 'extractive');
  assert.equal((await ensureDigest(env, { now: NOW + 3 * 86400000 })).built, false);
  assert.equal((await ensureDigest(env, { now: Date.now() + 8 * 86400000 })).built, true);
  // A digest in the old themed format is rebuilt, and reads as at most five picks until then.
  await env.DB.prepare('UPDATE digests SET content = ?').bind(JSON.stringify({ headline: 'Old', overview: 'Old overview.', themes: [{ title: 'T', summary: 's', items: (await weekItems(env, { now: NOW })).rows.map((r) => r.id) }], notable: [] })).run();
  const old = (await client(env)('/api/digest?id=' + first.id)).data.digest;
  assert.deepEqual(old.overview, ['Old overview.']);
  assert.ok(old.picks.length <= 5);
  assert.equal((await ensureDigest(env, { now: Date.now() + 8 * 86400000 + 1000 })).built, true);
  // A digest built under the old rule (added this week, not published this week) is rebuilt at once.
  const fresh = await ensureDigest(env, { now: NOW });
  const row = await env.DB.prepare('SELECT content FROM digests WHERE id = ?').bind(fresh.id ?? (await env.DB.prepare('SELECT id FROM digests ORDER BY created_at DESC LIMIT 1').first()).id).first();
  const c = JSON.parse(row.content); delete c.rule;
  await env.DB.prepare('UPDATE digests SET content = ?').bind(JSON.stringify(c)).run();
  assert.equal((await ensureDigest(env, { now: NOW })).built, true);
  assert.equal((await ensureDigest(env, { now: NOW })).built, false);
});

test('feed.xml lists digests as RSS with escaped content; the daily job builds the digest', async () => {
  const env = await makeEnv({ seed: false, semantic: false });
  const today = new Date().toISOString().slice(0, 10);
  await addResource(env, { title: 'AI & <script>alert(1)</script> in schools', publisher: 'A', added_at: new Date().toISOString(), published_at: today });
  await addResource(env, { title: 'Second AI piece', publisher: 'B', added_at: new Date().toISOString(), published_at: today, collections: ['policy-governance'] });
  const out = await runScheduled(env, CRON_DAILY);
  assert.equal(out.digest.built, true);
  const res = await client(env)('/feed.xml');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /rss\+xml/);
  assert.match(res.data, /<rss version="2.0"/);
  assert.ok(!res.data.includes('<script>'));
  assert.match(res.data, /&amp;lt;script&amp;gt;/); // escaped once for HTML, once for XML
  assert.equal((await client(env)('/api/digest?id=nope')).status, 404);
});
