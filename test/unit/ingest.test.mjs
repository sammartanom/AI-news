import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, FeedError, journalDate } from '../../src/ingest/feed.mjs';
import { safeFetch, FetchError } from '../../src/ingest/safe-fetch.mjs';
import { ingestSource, runIngestion, AUTO_DISABLE_AFTER, MAX_NEW_PER_RUN } from '../../src/ingest/pipeline.mjs';
import { createSource, updateSource, getSource } from '../../src/repo/sources.mjs';
import { relevance } from '../../src/ingest/classify.mjs';
import { makeEnv, addResource } from '../helpers/mocks.mjs';

const NOW = Date.parse('2026-10-26T12:00:00Z');

const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Feed</title>
<item><title>AI literacy in elementary schools</title><link>https://news.example.org/a?utm_source=rss</link><pubDate>Tue, 14 Oct 2025 08:00:00 GMT</pubDate><description>&lt;p&gt;An excerpt about AI.&lt;/p&gt;</description><guid>g1</guid></item>
<item><title>Bus schedules</title><link>https://news.example.org/b</link></item>
<item><title>No link here</title></item>
<item><title>Generative AI and student writing</title><link>https://news.example.org/c</link><dc:date>2025-09-30T10:00:00Z</dc:date></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title>
<entry><title type="html">&lt;b&gt;ChatGPT&lt;/b&gt; in the classroom</title><link rel="alternate" href="https://news.example.org/atom-1"/><link rel="self" href="https://news.example.org/feed"/>
<published>2025-05-01T12:00:00Z</published><updated>2026-01-15T12:00:00Z</updated><id>tag:1</id></entry>
<entry><title>Only updated</title><link href="https://news.example.org/atom-2"/><updated>2026-02-01T00:00:00Z</updated></entry></feed>`;

test('parseFeed: valid RSS', () => {
  const f = parseFeed(RSS, { now: NOW });
  assert.equal(f.kind, 'rss');
  assert.equal(f.items.length, 3);
  assert.equal(f.skipped, 1);
  assert.equal(f.items[0].title, 'AI literacy in elementary schools');
  assert.equal(f.items[0].published_at, '2025-10-14');
  assert.equal(f.items[0].excerpt, 'An excerpt about AI.');
  assert.equal(f.items[1].published_at, null); // no date in the feed: stays unknown
  assert.equal(f.items[2].published_at, '2025-09-30'); // dc:date
});

test('parseFeed: valid Atom; only "published" counts as a publication date', () => {
  const f = parseFeed(ATOM, { now: NOW });
  assert.equal(f.kind, 'atom');
  assert.equal(f.items.length, 2);
  assert.equal(f.items[0].title, 'ChatGPT in the classroom');
  assert.equal(f.items[0].link, 'https://news.example.org/atom-1');
  assert.equal(f.items[0].published_at, '2025-05-01');
  assert.equal(f.items[1].published_at, null); // "updated" is a modification time, not publication
});

test('parseFeed: RSS 1.0 (RDF)', () => {
  const rdf = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/"><item><title>AI policy</title><link>https://news.example.org/r</link><dc:date>2024-01-02</dc:date></item></rdf:RDF>`;
  const f = parseFeed(rdf, { now: NOW });
  assert.equal(f.items[0].published_at, '2024-01-02');
});

test('parseFeed: malformed XML is rejected', () => {
  for (const bad of ['', 'not xml', '<rss><channel><item></channel></rss>', '<html><body>hi</body></html>', '<rss><channel>']) {
    assert.throws(() => parseFeed(bad), FeedError, bad);
  }
});

test('parseFeed: DTDs and entity declarations are rejected (XXE / entity expansion)', () => {
  const xxe = '<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss><channel><item><title>&x;</title><link>https://a.example.org/</link></item></channel></rss>';
  assert.throws(() => parseFeed(xxe), /DTD/);
  const bomb = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><rss><channel/></rss>';
  assert.throws(() => parseFeed(bomb), /DTD/);
  assert.throws(() => parseFeed('<rss><!ENTITY a "b"><channel/></rss>'), FeedError);
});

test('parseFeed: oversized feeds are rejected and item count is capped', () => {
  assert.throws(() => parseFeed('<rss>' + 'x'.repeat(2000) + '</rss>', { maxBytes: 1000 }), /too large/);
  const many = '<rss><channel>' + Array.from({ length: 300 }, (_, i) => `<item><title>AI ${i}</title><link>https://a.example.org/${i}</link></item>`).join('') + '</channel></rss>';
  assert.equal(parseFeed(many, { maxItems: 100 }).items.length, 100);
});

test('parseFeed: markup in titles is stripped, never kept', () => {
  const f = parseFeed('<rss><channel><item><title>&lt;img src=x onerror=alert(1)&gt;Safe AI title</title><link>https://a.example.org/x</link></item></channel></rss>');
  assert.equal(f.items[0].title, 'Safe AI title');
});

// ---------- safeFetch ----------
const body = (text, headers = {}, status = 200) => new Response(text, { status, headers: { 'content-type': 'application/rss+xml', ...headers } });

test('safeFetch: refuses unsafe URLs before any request is made', async () => {
  let called = 0;
  const fetchImpl = async () => { called++; return body('x'); };
  for (const u of ['http://news.example.org/f', 'https://127.0.0.1/f', 'https://user:p@news.example.org/f']) {
    await assert.rejects(safeFetch(u, { fetchImpl }), (e) => e.code === 'unsafe_url');
  }
  assert.equal(called, 0);
});

test('safeFetch: enforces the host allowlist, including after redirects', async () => {
  const fetchImpl = async (u) => (u.includes('start')
    ? new Response(null, { status: 302, headers: { location: 'https://evil.example.net/f' } })
    : body('<rss/>'));
  await assert.rejects(safeFetch('https://other.example.org/f', { fetchImpl, allowedHosts: ['news.example.org'] }), (e) => e.code === 'host_not_allowed');
  await assert.rejects(safeFetch('https://news.example.org/start', { fetchImpl, allowedHosts: ['news.example.org'] }), (e) => e.code === 'redirect_refused');
});

test('safeFetch: follows allowed redirects and refuses downgrade or loops', async () => {
  const hops = { '/a': '/b', '/b': 'https://news.example.org/c' };
  const fetchImpl = async (u) => {
    const path = new URL(u).pathname;
    return hops[path] ? new Response(null, { status: 301, headers: { location: hops[path] } }) : body('done');
  };
  const ok = await safeFetch('https://news.example.org/a', { fetchImpl, allowedHosts: ['news.example.org'] });
  assert.equal(ok.text, 'done');
  assert.equal(ok.finalUrl, 'https://news.example.org/c');
  const down = async () => new Response(null, { status: 302, headers: { location: 'http://news.example.org/x' } });
  await assert.rejects(safeFetch('https://news.example.org/a', { fetchImpl: down }), (e) => e.code === 'unsafe_url');
  const loop = async () => new Response(null, { status: 302, headers: { location: '/again' } });
  await assert.rejects(safeFetch('https://news.example.org/a', { fetchImpl: loop }), (e) => e.code === 'too_many_redirects');
});

test('safeFetch: rejects oversized responses, declared or streamed', async () => {
  await assert.rejects(safeFetch('https://a.example.org/f', { maxBytes: 100, fetchImpl: async () => body('x', { 'content-length': '5000' }) }), (e) => e.code === 'too_large');
  const stream = () => new Response(new ReadableStream({ start(c) { for (let i = 0; i < 10; i++) c.enqueue(new Uint8Array(50)); c.close(); } }), { headers: { 'content-type': 'text/xml' } });
  await assert.rejects(safeFetch('https://a.example.org/f', { maxBytes: 200, fetchImpl: async () => stream() }), (e) => e.code === 'too_large');
});

test('safeFetch: validates content type, status and timeouts', async () => {
  await assert.rejects(safeFetch('https://a.example.org/f', { allowedTypes: [/xml/], fetchImpl: async () => body('<html/>', { 'content-type': 'text/html' }) }), (e) => e.code === 'bad_content_type');
  await assert.rejects(safeFetch('https://a.example.org/f', { fetchImpl: async () => body('no', {}, 500) }), (e) => e.code === 'http_error' && e.status === 500);
  const hang = (_u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('t'), { name: 'TimeoutError' }))));
  const keepAlive = setTimeout(() => {}, 1000); // Node unrefs AbortSignal.timeout timers; keep the loop running for this test
  await assert.rejects(safeFetch('https://a.example.org/f', { timeoutMs: 20, fetchImpl: hang }), (e) => e.code === 'timeout');
  clearTimeout(keepAlive);
});

// ---------- pipeline ----------
async function setup({ feed = RSS, sourceOpts = {}, defaults = {} } = {}) {
  const env = await makeEnv({ seed: false, semantic: false });
  const calls = [];
  env.__fetch = async (url, init) => {
    calls.push({ url, init });
    return typeof feed === 'function' ? feed(url, init) : body(feed, { etag: '"v1"', 'last-modified': 'Mon, 26 Oct 2026 10:00:00 GMT' });
  };
  await createSource(env, { id: 'test-source', name: 'Test source', publisher: 'Example News', feed_url: 'https://news.example.org/feed', default_metadata: { format: 'Article', ...defaults }, ...sourceOpts });
  await updateSource(env, 'test-source', { review_status: 'verified', enabled: true });
  return { env, calls };
}

test('pipeline: new items are queued as "indexed" and never public', async () => {
  const { env } = await setup();
  const [report] = await runIngestion(env, { now: NOW, force: true });
  assert.equal(report.status, 'ok');
  assert.equal(report.new, 2); // the AI items; "Bus schedules" fails the relevance filter
  assert.equal(report.filtered, 1);
  const rows = (await env.DB.prepare('SELECT * FROM resources ORDER BY title').all()).results;
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(r.status, 'indexed');
    assert.equal(r.verification_status, 'unverified');
    assert.equal(r.added_at, null);
    assert.equal(r.source_id, 'test-source');
    assert.ok(JSON.parse(r.source_provenance).matched_terms.length > 0);
  }
  assert.equal(rows[0].canonical_url, 'https://news.example.org/a'); // tracking parameter removed
  const fts = await env.DB.prepare('SELECT count(*) AS n FROM resources_fts').first('n');
  assert.equal(fts, 0);
});

test('pipeline: dates come from the feed only; unknown stays unknown', async () => {
  const { env } = await setup({ feed: `<rss><channel>
    <item><title>AI note one</title><link>https://news.example.org/2026/09/09/ai-note</link></item>
    <item><title>AI note two</title><link>https://news.example.org/p/2</link><pubDate>Mon, 01 Sep 2025 00:00:00 GMT</pubDate></item></channel></rss>` });
  await runIngestion(env, { now: NOW, force: true });
  const one = await env.DB.prepare(`SELECT published_at FROM resources WHERE url LIKE '%ai-note'`).first();
  const two = await env.DB.prepare(`SELECT published_at FROM resources WHERE url LIKE '%/p/2'`).first();
  assert.equal(one.published_at, null); // the URL path contains 2026/09/09 but it is never parsed
  assert.equal(two.published_at, '2025-09-01');
});

test('pipeline: running twice does not duplicate (exact canonical URL)', async () => {
  const { env } = await setup();
  await runIngestion(env, { now: NOW, force: true });
  const [second] = await runIngestion(env, { now: NOW, force: true });
  assert.equal(second.new, 0);
  assert.equal(second.duplicates, 2);
  assert.equal(await env.DB.prepare('SELECT count(*) AS n FROM resources').first('n'), 2);
});

test('pipeline: an item already in Signal under a tracking-parameter variant is an exact duplicate', async () => {
  const { env } = await setup();
  await addResource(env, { url: 'https://news.example.org/a', title: 'Existing curated piece', status: 'published', index: false });
  const [r] = await runIngestion(env, { now: NOW, force: true });
  assert.equal(r.duplicates, 1);
  assert.equal(await env.DB.prepare(`SELECT count(*) AS n FROM resources WHERE url LIKE '%/a'`).first('n'), 1);
});

test('pipeline: rejected items are not queued again', async () => {
  const { env } = await setup();
  await addResource(env, { url: 'https://news.example.org/a', title: 'Rejected before', status: 'rejected', index: false });
  const [r] = await runIngestion(env, { now: NOW, force: true });
  assert.equal(r.duplicates, 1);
  assert.equal(await env.DB.prepare(`SELECT status FROM resources WHERE canonical_url = 'https://news.example.org/a'`).first('status'), 'rejected');
});

test('pipeline: same title at another URL is flagged for review, not merged or dropped', async () => {
  const { env } = await setup();
  const orig = await addResource(env, { url: 'https://syndicator.example.com/x', title: 'AI literacy in elementary schools', publisher: 'Syndicator' });
  await env.DB.prepare('UPDATE resources SET dup_key = ? WHERE id = ?').bind('ai literacy in elementary schools', orig).run();
  const [r] = await runIngestion(env, { now: NOW, force: true });
  assert.equal(r.flagged, 1);
  const row = await env.DB.prepare(`SELECT * FROM resources WHERE canonical_url = 'https://news.example.org/a'`).first();
  assert.equal(row.status, 'indexed');
  assert.equal(row.duplicate_of, orig);
  assert.match(row.duplicate_reason, /Same title/);
});

test('pipeline: a DOI match is flagged', async () => {
  const feed = `<rss><channel><item><title>A different headline about AI</title><link>https://doi.org/10.1234/abc.5</link></item></channel></rss>`;
  const { env } = await setup({ feed, sourceOpts: { allowed_hosts: ['news.example.org', 'doi.org'] } });
  const existing = await addResource(env, { url: 'https://publisher.example.org/paper', title: 'The paper', publisher: 'Journal' });
  await env.DB.prepare('UPDATE resources SET doi = ? WHERE id = ?').bind('10.1234/abc.5', existing).run();
  const [r] = await runIngestion(env, { now: NOW, force: true });
  assert.equal(r.flagged, 1);
  assert.match((await env.DB.prepare('SELECT duplicate_reason FROM resources WHERE status = ?').bind('indexed').first()).duplicate_reason, /Same DOI/);
});

test('pipeline: very similar titles are flagged; different titles are not', async () => {
  const feed = `<rss><channel>
    <item><title>Generative AI literacy toolkit for families</title><link>https://news.example.org/n1</link></item>
    <item><title>Student privacy rules for chatbots in districts</title><link>https://news.example.org/n2</link></item></channel></rss>`;
  const { env } = await setup({ feed });
  const e = await addResource(env, { url: 'https://other.example.org/e', title: 'Generative AI literacy toolkit for families', publisher: 'Other' });
  await env.DB.prepare('UPDATE resources SET dup_key = ? WHERE id = ?').bind('generative ai literacy toolkit families', e).run();
  const [r] = await runIngestion(env, { now: NOW, force: true });
  assert.equal(r.flagged, 1);
  assert.equal(r.new, 1);
});

test('pipeline: unsafe or off-site item links are not queued', async () => {
  const feed = `<rss><channel>
    <item><title>AI http link</title><link>http://news.example.org/plain</link></item>
    <item><title>AI js link</title><link>javascript:alert(1)</link></item>
    <item><title>AI local link</title><link>https://localhost/x</link></item>
    <item><title>AI offsite link</title><link>https://elsewhere.example.net/x</link></item>
    <item><title>AI fine link</title><link>https://news.example.org/fine</link></item></channel></rss>`;
  const { env } = await setup({ feed });
  const [r] = await runIngestion(env, { now: NOW, force: true });
  assert.equal(r.new, 1);
  assert.equal(r.invalid + r.filtered, 4);
  assert.equal(await env.DB.prepare('SELECT count(*) AS n FROM resources').first('n'), 1);
});

test('pipeline: a redirecting feed URL is followed only within the allowlist', async () => {
  const feed = (url) => (url === 'https://news.example.org/feed'
    ? new Response(null, { status: 301, headers: { location: 'https://news.example.org/feed.xml' } })
    : body(RSS));
  const { env } = await setup({ feed });
  const [ok] = await runIngestion(env, { now: NOW, force: true });
  assert.equal(ok.status, 'ok');
  const { env: env2 } = await setup({ feed: () => new Response(null, { status: 302, headers: { location: 'https://evil.example.net/feed' } }) });
  const [bad] = await runIngestion(env2, { now: NOW, force: true });
  assert.equal(bad.status, 'error');
  assert.match(bad.error, /redirect_refused/);
});

test('pipeline: conditional requests use the stored ETag; 304 is not an error', async () => {
  const { env, calls } = await setup();
  await runIngestion(env, { now: NOW, force: true });
  assert.equal((await getSource(env, 'test-source')).etag, '"v1"');
  env.__fetch = async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 304 }); };
  const [r] = await runIngestion(env, { now: NOW, force: true });
  assert.equal(r.status, 'not_modified');
  assert.equal(calls.at(-1).init.headers['If-None-Match'], '"v1"');
  assert.equal((await getSource(env, 'test-source')).last_error, null);
});

test('pipeline: source failures are logged, counted, and eventually disable the source', async () => {
  const { env } = await setup({ feed: () => body('boom', {}, 500) });
  const [r] = await runIngestion(env, { now: NOW, force: true });
  assert.equal(r.status, 'error');
  let s = await getSource(env, 'test-source');
  assert.match(s.last_error, /http_error: HTTP 500/);
  assert.equal(s.consecutive_failures, 1);
  assert.equal(s.enabled, 1);
  assert.ok(s.last_error_at);
  const log = await env.DB.prepare('SELECT * FROM ingestion_log').first();
  assert.equal(log.status, 'error');
  assert.equal(log.http_status, 500);
  for (let i = 1; i < AUTO_DISABLE_AFTER; i++) await runIngestion(env, { now: NOW, force: true });
  s = await getSource(env, 'test-source');
  assert.equal(s.enabled, 0);
  assert.equal(s.consecutive_failures, AUTO_DISABLE_AFTER);
  assert.deepEqual(await runIngestion(env, { now: NOW, force: true }), []); // disabled sources are skipped
});

test('pipeline: malformed, oversized and wrong-type feeds fail cleanly without queuing anything', async () => {
  for (const [feed, pattern] of [
    [() => body('<rss><channel><item>'), /Malformed/],
    [() => body('<!DOCTYPE x [<!ENTITY a "b">]><rss/>'), /DTD/],
    [() => body('x', { 'content-length': '99999999' }), /too_large/],
    [() => body('<html/>', { 'content-type': 'text/html' }), /bad_content_type/]
  ]) {
    const { env } = await setup({ feed });
    const [r] = await runIngestion(env, { now: NOW, force: true });
    assert.equal(r.status, 'error');
    assert.match(r.error, pattern);
    assert.equal(await env.DB.prepare('SELECT count(*) AS n FROM resources').first('n'), 0);
  }
});

test('pipeline: per-run cap bounds how many items one run can queue', async () => {
  const items = Array.from({ length: MAX_NEW_PER_RUN + 20 }, (_, i) => `<item><title>AI story number ${i} with unique words ${i * 7919}</title><link>https://news.example.org/s/${i}</link></item>`).join('');
  const { env } = await setup({ feed: `<rss><channel>${items}</channel></rss>` });
  const [r] = await runIngestion(env, { now: NOW, force: true });
  assert.equal(r.new + r.flagged, MAX_NEW_PER_RUN);
});

test('pipeline: sources must be verified before they can be enabled; unsupported types cannot run', async () => {
  const env = await makeEnv({ seed: false, semantic: false });
  await createSource(env, { id: 'unreviewed-src', name: 'S', publisher: 'P', feed_url: 'https://news.example.org/feed' });
  await assert.rejects(updateSource(env, 'unreviewed-src', { enabled: true }), /verified/);
  await createSource(env, { id: 'sitemap-src', name: 'S2', publisher: 'P', feed_url: 'https://news.example.org/sitemap.xml', source_type: 'sitemap' });
  await updateSource(env, 'sitemap-src', { review_status: 'verified' });
  await assert.rejects(updateSource(env, 'sitemap-src', { enabled: true }), /not supported/);
  await assert.rejects(createSource(env, { id: 'bad', name: 'x', publisher: 'p', feed_url: 'http://news.example.org/feed' }), /HTTPS/);
  await assert.rejects(createSource(env, { id: 'bad2', name: 'x', publisher: 'p', feed_url: 'https://192.168.1.1/feed' }));
  // Un-verifying a running source turns it off.
  await createSource(env, { id: 'ok-src', name: 'S3', publisher: 'P', feed_url: 'https://news.example.org/f2' });
  await updateSource(env, 'ok-src', { review_status: 'verified', enabled: true });
  await updateSource(env, 'ok-src', { review_status: 'unreviewed' });
  assert.equal((await getSource(env, 'ok-src')).enabled, 0);
});

test('pipeline: recently checked sources are not fetched again by the scheduler', async () => {
  const { env, calls } = await setup();
  await runIngestion(env, { now: Date.now() });
  const n = calls.length;
  await runIngestion(env, { now: Date.now() });
  assert.equal(calls.length, n);
});

test('classify: AI relevance is explainable and conservative', () => {
  assert.ok(relevance({ title: 'ChatGPT in the classroom', excerpt: '' }).relevant);
  assert.ok(relevance({ title: 'New guidance on generative AI', excerpt: '' }).relevant);
  assert.ok(!relevance({ title: 'Bus schedules', excerpt: 'Routes change in the fall' }).relevant);
  assert.ok(!relevance({ title: 'Said the principal', excerpt: 'maintain a plan' }).relevant);
});

test('pipeline: a 100-item feed works within D1’s 100-parameter limit, and known items are recognised', async () => {
  const items = Array.from({ length: 100 }, (_, i) => `<item><title>AI in schools, part ${i}</title><link>https://news.example.org/p/${i}</link></item>`).join('');
  const feed = `<?xml version="1.0"?><rss version="2.0"><channel><title>Big</title>${items}</channel></rss>`;
  const { env } = await setup({ feed });
  await addResource(env, { title: 'Already here', url: 'https://news.example.org/p/7' });
  const [report] = await runIngestion(env, { now: NOW, force: true });
  assert.equal(report.status, 'ok', report.error);
  assert.equal(report.duplicates, 1);
  assert.equal(report.new + report.flagged, MAX_NEW_PER_RUN); // similar titles are flagged as possible duplicates
});

test('journal feeds: the publication date comes from the description when the item has none', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  assert.equal(journalDate('<p>Publication date: Available online 22 October 2026</p><p><b>Source:</b> Journal</p>', now), '2026-10-22');
  assert.equal(journalDate('<p>Publication date: June 2026</p>', now), '2026-06');
  assert.equal(journalDate('<p>Publication date: December 2026</p>', now), '2026', 'a later issue this year gives only the year');
  assert.equal(journalDate('<p>Publication date: February 2027</p>', now), null);
  assert.equal(journalDate('No date here', now), null);
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>J</title>
<item><title>LLMs do not grade essays like humans</title><link>https://www.sciencedirect.com/science/article/pii/S1</link><description><![CDATA[<p>Publication date: Available online 3 October 2026</p>]]></description></item>
<item><title>Dated</title><link>https://www.sciencedirect.com/science/article/pii/S2</link><pubDate>Tue, 14 Oct 2025 08:00:00 GMT</pubDate><description>Publication date: June 2026</description></item>
</channel></rss>`;
  const { items } = parseFeed(xml, { now });
  assert.deepEqual(items.map((i) => i.published_at), ['2026-10-03', '2025-10-14']); // a real pubDate always wins
});
