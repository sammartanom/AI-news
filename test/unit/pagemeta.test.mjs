import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { parsePageMeta, cleanTitle } from '../../src/ingest/pagemeta.mjs';
import { makeEnv, addResource, client, loadHandler } from '../helpers/mocks.mjs';

before(loadHandler);

const PAGE = `<!doctype html><html><head><title>AI Literacy Lessons | Example Org</title>
<meta property="og:title" content="AI Literacy Lessons for Grades 6&ndash;8 | Example Org">
<meta property="og:site_name" content="Example Org">
<meta property="article:published_time" content="2025-03-04T10:00:00+00:00">
<meta name="description" content="Five lessons &amp; slides.">
<script type="application/ld+json">{"datePublished":"2020-01-01"}</script></head><body></body></html>`;

test('page metadata: only what the page states; site suffix removed', () => {
  assert.deepEqual(parsePageMeta(PAGE, 'https://example.org/lessons'), {
    title: 'AI Literacy Lessons for Grades 6–8', publisher: 'Example Org', published_at: '2025-03-04', description: 'Five lessons & slides.', format: null
  });
  const bare = parsePageMeta('<html><head><title>Teachable Machine</title></head></html>', 'https://teachablemachine.withgoogle.com/');
  assert.deepEqual([bare.title, bare.publisher, bare.published_at], ['Teachable Machine', null, null]);
  assert.equal(parsePageMeta('<title>Intro to AI - YouTube</title>', 'https://www.youtube.com/watch?v=x').format, 'Video');
  assert.equal(parsePageMeta('<script type="application/ld+json">{"datePublished":"2024-05"}</script>', 'https://a.example.org/').published_at, '2024-05');
});

test('titles keep dashes that are part of the title', () => {
  assert.equal(cleanTitle('Teaching with AI - Part 2', null, 'example.org'), 'Teaching with AI - Part 2');
  assert.equal(cleanTitle('Guide to AI | Common Sense Education', 'Common Sense Education', 'commonsense.org'), 'Guide to AI');
  assert.equal(cleanTitle('Guide to AI – Edutopia', null, 'www.edutopia.org'), 'Guide to AI');
});

test('lookup: editors only; reads the page; reports a link already in the collection', async () => {
  const env = await makeEnv({ seed: false, semantic: false, vars: { ADMIN_TOKEN: 'x'.repeat(32) } });
  env.__fetch = async () => new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  const anon = client(env);
  const ed = (body) => anon('/api/editor/lookup', { method: 'POST', body, headers: { authorization: `Bearer ${'x'.repeat(32)}` } });
  assert.equal((await anon('/api/editor/lookup', { method: 'POST', body: { url: 'https://example.org/lessons' } })).status, 401);
  const d = (await ed({ url: 'https://example.org/lessons?utm_source=x' })).data;
  assert.equal(d.title, 'AI Literacy Lessons for Grades 6–8');
  assert.equal(d.url, 'https://example.org/lessons');
  await addResource(env, { url: 'https://example.org/known', title: 'Known' });
  assert.equal((await ed({ url: 'https://example.org/known' })).data.existing.title, 'Known');
  assert.equal((await ed({ url: 'not a link' })).status, 400);
  env.__fetch = async () => new Response('nope', { status: 403, headers: { 'content-type': 'text/html' } });
  assert.match((await ed({ url: 'https://example.org/blocked' })).data.unreadable, /Fill in the details yourself/);
});
