import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeEnv, addResource, client, loadHandler } from '../helpers/mocks.mjs';
import { PAGE_HEADERS, renderPage, pageMeta } from '../../src/routes/pages.mjs';

before(loadHandler);

const shell = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
async function envWithShell() {
  const env = await makeEnv({ seed: false, semantic: false });
  env.ASSETS = { fetch: async () => new Response(shell, { headers: { 'content-type': 'text/html' } }) };
  return env;
}
const meta = (html, prop) => html.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`))?.[1];
const tag = (html, re) => html.match(re)?.[1];

test('pages: a shared resource link carries its own title, description, canonical URL, card and JSON-LD', async () => {
  const env = await envWithShell();
  await addResource(env, { id: 'r-lit', title: 'AI Literacy <Framework> & Guide', publisher: 'Digital Promise', format: 'Framework', why: 'A clear framework for what students should understand about AI, with classroom examples.', published_at: '2024-06-01', topics: ['ai-literacy'] });
  const { status, data: html, headers } = await client(env)('/?r=r-lit');
  assert.equal(status, 200);
  assert.match(headers.get('content-type'), /text\/html/);
  assert.equal(tag(html, /<title>([^<]*)<\/title>/), 'AI Literacy &lt;Framework&gt; &amp; Guide · AI for teachers');
  assert.equal(meta(html, 'og:title'), 'AI Literacy &lt;Framework&gt; &amp; Guide · AI for teachers');
  assert.match(meta(html, 'description'), /^A clear framework/);
  assert.equal(meta(html, 'og:type'), 'article');
  assert.equal(meta(html, 'og:url'), 'http://localhost/?r=r-lit');
  assert.equal(meta(html, 'og:image'), 'http://localhost/og.png');
  assert.equal(meta(html, 'twitter:card'), 'summary_large_image');
  assert.equal(meta(html, 'article:published_time'), '2024-06-01');
  assert.match(html, /<link rel="canonical" href="http:\/\/localhost\/\?r=r-lit">/);
  const ld = JSON.parse(tag(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/));
  assert.equal(ld.name, 'AI Literacy <Framework> & Guide');
  assert.equal(ld.publisher.name, 'Digital Promise');
  assert.match(ld.sameAs, /^https:\/\/example\.org\/r\//);
  assert.ok(!html.includes('<Framework>'), 'the raw title never reaches the markup unescaped');
  assert.match(html, /<noscript><div class="page"><h1>AI Literacy &lt;Framework&gt; &amp; Guide<\/h1>/);
  assert.equal(headers.get('content-security-policy'), PAGE_HEADERS['Content-Security-Policy']);
  assert.equal((html.match(/<title>/g) ?? []).length, 1, 'one title');
  assert.equal((html.match(/name="description"/g) ?? []).length, 1, 'one description');
});

test('pages: home has the WebSite search action; unknown resources and saved lists are not indexed', async () => {
  const env = await envWithShell();
  const call = client(env);
  const home = (await call('/')).data;
  assert.equal(tag(home, /<title>([^<]*)<\/title>/), 'Pleasantville UFSD · AI for teachers');
  const ld = JSON.parse(tag(home, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/));
  assert.equal(ld['@type'], 'WebSite');
  assert.equal(ld.publisher.name, 'Pleasantville Union Free School District');
  assert.equal(ld.audience.educationalRole, 'teacher');
  assert.equal(ld.potentialAction.target.urlTemplate, 'http://localhost/grid?q={search_term_string}');
  assert.match(meta(home, 'robots'), /^index/);

  const head = await call('/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.match(head.headers.get('content-type'), /text\/html/);
  assert.equal(head.data, '');

  const missing = await call('/?r=nope');
  assert.equal(missing.status, 200);
  assert.match(meta(missing.data, 'robots'), /noindex/);
  const saved = await call('/saved');
  assert.match(meta(saved.data, 'robots'), /noindex/);
  assert.equal(saved.headers.get('x-robots-tag'), 'noindex');
  const search = await call('/grid?q=chatbots');
  assert.match(meta(search.data, 'robots'), /noindex/);
  assert.match(search.data, /<link rel="canonical" href="http:\/\/localhost\/grid">/);
  const kind = await call('/grid?kind=courses');
  assert.equal(tag(kind.data, /<title>([^<]*)<\/title>/), 'Courses · AI for teachers');
  assert.match(kind.data, /<link rel="canonical" href="http:\/\/localhost\/grid\?kind=courses">/);
  const path = await call('/?path=new-principal'); // an old link to a merged path
  assert.match(tag(path.data, /<title>([^<]*)<\/title>/), /^Teacher starting with AI literacy/);
  assert.match(path.data, /<link rel="canonical" href="http:\/\/localhost\/\?path=teacher-start">/);
});

test('pages: robots.txt points to the sitemap; the sitemap lists pages and published resources only', async () => {
  const env = await envWithShell();
  await addResource(env, { id: 'pub-1' });
  await addResource(env, { id: 'held-1', status: 'rejected' });
  const call = client(env);
  const robots = await call('/robots.txt');
  assert.match(robots.data, /^User-agent: \*/);
  assert.match(robots.data, /Disallow: \/editor\//);
  assert.match(robots.data, /Disallow: \/api\//);
  assert.match(robots.data, /Sitemap: http:\/\/localhost\/sitemap\.xml/);
  const map = await call('/sitemap.xml');
  assert.match(map.headers.get('content-type'), /application\/xml/);
  assert.match(map.data, /<loc>http:\/\/localhost\/<\/loc>/);
  assert.match(map.data, /<loc>http:\/\/localhost\/grid\?kind=courses<\/loc>/);
  assert.match(map.data, /<loc>http:\/\/localhost\/\?path=teacher-start<\/loc>/);
  assert.match(map.data, /<loc>http:\/\/localhost\/\?r=pub-1<\/loc><lastmod>2026-10-20<\/lastmod>/);
  assert.doesNotMatch(map.data, /held-1/);
});

test('pages: the Worker sets the same site-wide headers as public/_headers', () => {
  const file = readFileSync(new URL('../../public/_headers', import.meta.url), 'utf8');
  const block = file.split(/\n(?=\S)/).find((b) => b.startsWith('/*\n'));
  const fromFile = Object.fromEntries(block.split('\n').slice(1).filter((l) => l.trim()).map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]));
  assert.deepEqual(fromFile, PAGE_HEADERS);
});

test('pages: the shell has one marked head block and a noscript fallback to replace', async () => {
  assert.equal((shell.match(/<!--meta-->/g) ?? []).length, 1);
  assert.equal((shell.match(/<noscript>/g) ?? []).length, 1);
  const out = renderPage(shell, await pageMeta({ DB: null }, new URL('https://x.test/?about')), 'https://x.test');
  assert.match(out, /<title>About · AI for teachers<\/title>/);
  assert.match(out, /<link rel="canonical" href="https:\/\/x\.test\/\?about">/);
});
