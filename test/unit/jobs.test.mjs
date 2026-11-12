import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, addResource } from '../helpers/mocks.mjs';
import { runScheduled, CRON_INGEST, CRON_DAILY, CRON_BRIEFS } from '../../src/jobs.mjs';
import { createSource, updateSource } from '../../src/repo/sources.mjs';
import { classifyStatus, checkLink, runLinkChecks } from '../../src/ingest/linkcheck.mjs';
import worker from '../../src/index.mjs';
import { readFileSync } from 'node:fs';

test('link status classification: refusals are "blocked", not "broken"', () => {
  assert.equal(classifyStatus(200), 'ok');
  assert.equal(classifyStatus(404), 'broken');
  assert.equal(classifyStatus(410), 'broken');
  for (const s of [401, 403, 429]) assert.equal(classifyStatus(s), 'blocked');
  assert.equal(classifyStatus(500), 'error');
  assert.equal(classifyStatus(503), 'error');
});

test('checkLink: ok, redirected, broken, HEAD-not-allowed fallback, network failure, unsafe URL', async () => {
  const env = {};
  const mk = (fn) => ({ __fetch: fn });
  assert.equal((await checkLink(mk(async () => new Response('', { status: 200 })), 'https://a.example.org/x')).link_status, 'ok');
  const redirecting = async (u) => (u.endsWith('/old') ? new Response(null, { status: 301, headers: { location: 'https://a.example.org/new' } }) : new Response('', { status: 200 }));
  assert.equal((await checkLink(mk(redirecting), 'https://a.example.org/old')).link_status, 'redirected');
  const trailing = async (u) => (u.endsWith('/x/') ? new Response('', { status: 200 }) : new Response(null, { status: 301, headers: { location: 'https://a.example.org/x/' } }));
  assert.equal((await checkLink(mk(trailing), 'https://a.example.org/x')).link_status, 'ok'); // same canonical URL: not a real move
  assert.equal((await checkLink(mk(async () => new Response('', { status: 404 })), 'https://a.example.org/x')).link_status, 'broken');
  assert.equal((await checkLink(mk(async () => new Response('', { status: 403 })), 'https://a.example.org/x')).link_status, 'blocked');
  const methods = [];
  const noHead = async (u, init) => { methods.push(init.method); return new Response('', { status: init.method === 'HEAD' ? 405 : 206 }); };
  assert.equal((await checkLink(mk(noHead), 'https://a.example.org/x')).link_status, 'ok'); // 206 from the ranged GET
  assert.deepEqual(methods, ['HEAD', 'GET']);
  assert.equal((await checkLink(mk(async () => { throw new Error('dns'); }), 'https://a.example.org/x')).link_status, 'error');
  assert.equal((await checkLink(mk(async () => { throw new Error('should not be called'); }), 'https://127.0.0.1/x')).link_status, 'error');
  assert.ok(env);
});

test('runLinkChecks updates status and last check time, oldest first', async () => {
  const env = await makeEnv({ seed: false, semantic: false });
  const a = await addResource(env, { url: 'https://a.example.org/ok' });
  const b = await addResource(env, { url: 'https://a.example.org/gone' });
  await env.DB.prepare(`UPDATE resources SET last_link_check = '2026-01-01T00:00:00.000Z' WHERE id = ?`).bind(a).run();
  env.__fetch = async (u) => new Response('', { status: u.endsWith('/gone') ? 404 : 200 });
  const out = await runLinkChecks(env, { limit: 1 });
  assert.equal(out.checked, 1);
  const rb = await env.DB.prepare('SELECT link_status, last_link_check, link_http_status FROM resources WHERE id = ?').bind(b).first();
  assert.equal(rb.link_status, 'broken'); // never-checked resources go first
  assert.equal(rb.link_http_status, 404);
  assert.ok(rb.last_link_check);
  await runLinkChecks(env, { limit: 5 });
  assert.equal(await env.DB.prepare('SELECT link_status FROM resources WHERE id = ?').bind(a).first('link_status'), 'ok');
});

test('scheduled run: ingests, queues, never publishes, and isolates failures', async () => {
  const env = await makeEnv({ seed: false });
  env.__fetch = async (url) => (url.includes('feed')
    ? new Response('<rss><channel><item><title>AI tutors in schools</title><link>https://news.example.org/t</link></item></channel></rss>', { headers: { 'content-type': 'application/rss+xml' } })
    : new Response('', { status: 200 }));
  await createSource(env, { id: 'src-one', name: 'One', publisher: 'News', feed_url: 'https://news.example.org/feed' });
  await updateSource(env, 'src-one', { review_status: 'verified', enabled: true });
  const out = await runScheduled(env, CRON_INGEST);
  assert.equal(out.ingest[0].new, 1);
  assert.equal(out.links, undefined); // link checks run on the daily schedule
  assert.equal(await env.DB.prepare(`SELECT count(*) AS n FROM resources WHERE status = 'published'`).first('n'), 0);
  assert.equal(env.VECTORIZE.vectors.size, 0); // queued items are not embedded

  await addResource(env, { url: 'https://news.example.org/pub' });
  const daily = await runScheduled(env, CRON_DAILY);
  assert.equal(daily.ingest, undefined);
  assert.equal(daily.links.checked, 1);

  env.VECTORIZE.fail = true;
  await env.DB.prepare(`UPDATE resources SET embedding_hash = NULL WHERE status = 'published'`).run();
  const failing = await runScheduled(env, CRON_INGEST);
  assert.ok(failing.backfill.error); // a failing step is reported...
  assert.ok(failing.ingest); // ...and does not stop the others
});

test('the Worker exports fetch and scheduled handlers', async () => {
  assert.equal(typeof worker.fetch, 'function');
  assert.equal(typeof worker.scheduled, 'function');
  let ran;
  const env = await makeEnv({ seed: false, semantic: false });
  await worker.scheduled({ cron: CRON_DAILY }, env, { waitUntil: (p) => { ran = p; } });
  await ran;
  assert.ok(ran);
});

test('wrangler cron triggers match the schedules the code knows about', () => {
  const cfg = readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
  assert.ok(cfg.includes(`"${CRON_INGEST}"`));
  assert.ok(cfg.includes(`"${CRON_DAILY}"`));
  assert.ok(cfg.includes(`"${CRON_BRIEFS}"`));
});
