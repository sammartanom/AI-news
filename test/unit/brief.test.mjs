import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, addResource, client, loadHandler } from '../helpers/mocks.mjs';
import { mainText, validateBrief, ensureBrief, backfillBriefs } from '../../src/discovery/brief.mjs';
import { runScheduled, CRON_BRIEFS, CRON_INGEST } from '../../src/jobs.mjs';

before(loadHandler);

const PAGE = `<html><head><title>x</title><script>alert(1)</script></head><body><nav>Home About Donate</nav>
<article><h1>Grading with AI</h1><p>${'A district guide to using AI feedback tools on student essays, with rubrics and privacy steps. '.repeat(8)}</p></article>
<footer>Copyright</footer></body></html>`;

function page(env, html = PAGE, status = 200) {
  const seen = [];
  env.__fetch = async (url) => { seen.push(url); return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } }); };
  return seen;
}

test('mainText keeps the article and drops navigation, footers and scripts', () => {
  const t = mainText(PAGE);
  assert.match(t, /^Grading with AI A district guide/);
  assert.doesNotMatch(t, /Donate|Copyright|alert/);
});

test('validateBrief keeps plain descriptions and rejects refusals, links and fragments', () => {
  assert.equal(validateBrief('"A district guide to AI feedback on essays, with rubrics and privacy steps"'), 'A district guide to AI feedback on essays, with rubrics and privacy steps.');
  assert.equal(validateBrief('Description: A short course on prompt writing for teachers, in five lessons.'), 'A short course on prompt writing for teachers, in five lessons.');
  assert.equal(validateBrief('I cannot read this page, sorry about that, please try again later.'), null);
  assert.equal(validateBrief('Too short.'), null);
  assert.doesNotMatch(validateBrief('A guide to AI tutors for schools. More at https://evil.example.net/x today.'), /https?:/);
});

test('brief: written once from the page, stored, and returned with the resource', async () => {
  const env = await makeEnv({ seed: false, semantic: true, vars: { BRIEF_MODEL: '@cf/test/brief' } });
  await addResource(env, { id: 'b1', title: 'Grading with AI' });
  const seen = page(env);
  let prompt = '';
  env.AI.chatResponse = (input) => { prompt = input.messages.at(-1).content; return { response: 'A district guide to using AI feedback tools on student essays, with rubrics and privacy steps.' }; };
  const api = client(env);
  const res = await api('/api/resources/b1/brief');
  assert.equal(res.status, 200);
  assert.equal(res.data.basis, 'page');
  assert.match(res.data.brief, /^A district guide/);
  assert.match(prompt, /Start of the page:\nGrading with AI/);
  assert.equal(seen.length, 1);
  await api('/api/resources/b1/brief');
  assert.equal(seen.length, 1, 'not written twice');
  const r = (await api('/api/resources/b1')).data.resource;
  assert.equal(r.brief_basis, 'page');
  assert.match(r.brief, /^A district guide/);
  assert.equal((await api('/api/resources/nope/brief')).status, 404);
});

test('brief: an unreadable page falls back to the listing; failures are not retried at once', async () => {
  const env = await makeEnv({ seed: false, semantic: true, vars: { BRIEF_MODEL: '@cf/test/brief' } });
  await addResource(env, { id: 'b2', title: 'AI and the reading brain' });
  page(env, 'Forbidden', 403);
  env.AI.chatResponse = { response: 'A news article on research into how AI tools affect reading habits in schools.' };
  assert.equal((await ensureBrief(env, 'b2')).basis, 'listing');

  await addResource(env, { id: 'b3', title: 'Broken' });
  env.AI.chatResponse = { response: 'Sorry' };
  assert.equal((await ensureBrief(env, 'b3')).brief, null);
  let calls = 0;
  env.AI.chatResponse = () => { calls++; return { response: 'A guide.' }; };
  await ensureBrief(env, 'b3');
  assert.equal(calls, 0, 'a recent failure waits before trying again');
});

test('the scheduled run writes briefs for new resources; without a model nothing is fetched', async () => {
  const env = await makeEnv({ seed: false, semantic: true, vars: { BRIEF_MODEL: '@cf/test/brief' } });
  await addResource(env, { id: 'b4' });
  await addResource(env, { id: 'b5' });
  page(env);
  env.AI.chatResponse = { response: 'A district guide to using AI feedback tools on student essays, with rubrics.' };
  const out = await runScheduled(env, CRON_BRIEFS);
  assert.equal(out.briefs.written, 2);
  assert.equal(out.ingest, undefined, 'the brief run does nothing else that fetches');
  assert.equal((await runScheduled(env, CRON_INGEST)).briefs, undefined);
  const none = await makeEnv({ seed: false, semantic: false });
  const seen = page(none);
  assert.deepEqual(await backfillBriefs(none), { skipped: 'no model' });
  assert.equal(seen.length, 0);
});
