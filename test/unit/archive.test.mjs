import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveUrl, parseSubstackArchive, runArchive } from '../../src/ingest/archive.mjs';
import { createSource, updateSource, getSource } from '../../src/repo/sources.mjs';
import { makeEnv } from '../helpers/mocks.mjs';

const rss = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>F</title>${items.map(([t, l]) => `<item><title>${t}</title><link>${l}</link><pubDate>Tue, 14 Oct 2025 08:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
const xml = (text, status = 200) => new Response(text, { status, headers: { 'content-type': 'application/rss+xml' } });
const jsonRes = (data) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json; charset=utf-8' } });

async function setup(kind, respond, extra = {}) {
  const env = await makeEnv({ seed: false, semantic: false });
  const calls = [];
  env.__fetch = async (url) => { calls.push(url); return respond(new URL(url)); };
  await createSource(env, { id: 'src', name: 'Source', publisher: 'Example', feed_url: 'https://news.example.org/feed/', default_metadata: { format: 'Article', archive: kind, ...extra } });
  await updateSource(env, 'src', { review_status: 'verified', enabled: true });
  const rows = () => env.DB.prepare(`SELECT title, url, status, published_at, source_provenance FROM resources ORDER BY title`).all().then((r) => r.results);
  return { env, calls, rows };
}

test('archive urls: WordPress pages, Blogger offsets, Substack listing', () => {
  assert.equal(archiveUrl('wordpress', 'https://a.example.org/feed/', 0), 'https://a.example.org/feed/?paged=2');
  assert.equal(archiveUrl('wordpress', 'https://a.example.org/tag/ai/feed/?x=1', 3), 'https://a.example.org/tag/ai/feed/?x=1&paged=5');
  assert.equal(archiveUrl('blogger', 'https://b.example.org/feeds/posts/default', 1), 'https://b.example.org/feeds/posts/default?start-index=51&max-results=25');
  assert.equal(archiveUrl('substack', 'https://c.example.org/feed', 2), 'https://c.example.org/api/v1/archive?sort=new&offset=60&limit=20');
});

test('substack listing: free posts only, dates kept, no invented fields', () => {
  const { items, skipped } = parseSubstackArchive(JSON.stringify([
    { id: 1, title: 'AI and grading', canonical_url: 'https://c.example.org/p/ai-grading', post_date: '2025-03-04T10:00:00.000Z', subtitle: '<b>Notes</b> from a pilot', audience: 'everyone' },
    { id: 2, title: 'Paid post on AI', canonical_url: 'https://c.example.org/p/paid', post_date: '2025-03-01T10:00:00.000Z', audience: 'only_paid' },
    { id: 3, title: '', canonical_url: 'https://c.example.org/p/x' },
    { id: 4, title: 'No date about AI', canonical_url: 'https://c.example.org/p/nodate' }
  ]));
  assert.equal(skipped, 2);
  assert.deepEqual(items.map((i) => [i.title, i.published_at, i.excerpt]), [['AI and grading', '2025-03-04', 'Notes from a pilot'], ['No date about AI', null, null]]);
  assert.throws(() => parseSubstackArchive('<html>'), /JSON/);
});

test('archive: walks WordPress pages, queues only AI titles on the allowlisted site, stops at 404', async () => {
  const pages = {
    2: rss([['Generative AI in class', 'https://news.example.org/a'], ['Bus schedules', 'https://news.example.org/b'], ['AI tools offsite', 'https://evil.example.net/c']]),
    3: rss([['ChatGPT and homework', 'https://news.example.org/d'], ['Generative AI in class', 'https://news.example.org/a']])
  };
  const { env, calls, rows } = await setup('wordpress', (u) => (pages[u.searchParams.get('paged')] ? xml(pages[u.searchParams.get('paged')]) : xml('<rss/>', 404)));
  const [first] = await runArchive(env);
  assert.deepEqual([first.page, first.new, first.filtered, first.done], [0, 1, 2, false]);
  const [second] = await runArchive(env);
  assert.deepEqual([second.page, second.new, second.duplicates], [1, 1, 1]);
  const [third] = await runArchive(env);
  assert.equal(third.done, true); // 404 past the end is the end, not an error
  assert.equal(third.status, 'ok');
  assert.deepEqual(await runArchive(env), []); // finished sources are not read again
  assert.equal(calls.length, 3);
  const r = await rows();
  assert.deepEqual(r.map((x) => [x.title, x.status]), [['ChatGPT and homework', 'indexed'], ['Generative AI in class', 'indexed']]);
  assert.equal(JSON.parse(r[0].source_provenance).method, 'archive');
  assert.ok((await getSource(env, 'src')).archive_done_at);
});

test('archive: Substack listing until an empty page; the page cap is respected', async () => {
  const listing = (offset) => (offset === 20 ? [{ id: 1, title: 'What AI tutors get wrong', canonical_url: 'https://news.example.org/p/one', post_date: '2024-01-02T00:00:00Z', audience: 'everyone' }] : []);
  const { env, calls, rows } = await setup('substack', (u) => jsonRes(listing(Number(u.searchParams.get('offset')))));
  await runArchive(env);
  const [end] = await runArchive(env);
  assert.equal(end.done, true);
  assert.match(calls[0], /\/api\/v1\/archive\?sort=new&offset=20&limit=20$/);
  assert.deepEqual((await rows()).map((x) => [x.title, x.published_at]), [['What AI tutors get wrong', '2024-01-02']]);

  const capped = await setup('wordpress', () => xml(rss([['AI item', `https://news.example.org/${Math.random()}`]])), { archive_pages: 2 });
  await runArchive(capped.env);
  const [last] = await runArchive(capped.env);
  assert.equal(last.done, true);
});

test('archive: errors are retried, never disable the source; sources without an archive are skipped', async () => {
  let fail = true;
  const { env } = await setup('wordpress', () => (fail ? new Response('nope', { status: 500, headers: { 'content-type': 'text/html' } }) : xml(rss([]))));
  const [r] = await runArchive(env);
  assert.equal(r.status, 'error');
  const s = await getSource(env, 'src');
  assert.equal(s.enabled, 1);
  assert.equal(s.archive_page, 0); // the same page is tried again...
  fail = false;
  assert.deepEqual(await runArchive(env), [], '...but not until the source has rested for a day');
  const DAY_LATER = Date.now() + 25 * 3600 * 1000;
  assert.equal((await runArchive(env, { now: DAY_LATER }))[0].done, true);

  // A page that is not a valid feed is skipped rather than retried for ever.
  const bad = await setup('wordpress', (u) => (u.searchParams.get('paged') === '2' ? xml('<!DOCTYPE x><rss/>') : xml(rss([['AI after the bad page', 'https://news.example.org/after']]))), { archive_pages: 2 });
  const [skipped] = await runArchive(bad.env);
  assert.equal(skipped.status, 'error');
  assert.equal((await getSource(bad.env, 'src')).archive_page, 1);
  assert.equal((await runArchive(bad.env, { now: DAY_LATER }))[0].new, 1);

  const plain = await makeEnv({ seed: false, semantic: false });
  plain.__fetch = async () => { throw new Error('should not fetch'); };
  await createSource(plain, { id: 'plain', name: 'P', publisher: 'P', feed_url: 'https://news.example.org/feed' });
  await updateSource(plain, 'plain', { review_status: 'verified', enabled: true });
  assert.deepEqual(await runArchive(plain), []);
});

test('archive: least recently tried sources go first, so a failing source cannot take every slot', async () => {
  const { env } = await setup('wordpress', () => new Response('slow down', { status: 429, headers: { 'content-type': 'text/html' } }));
  await createSource(env, { id: 'other', name: 'Other', publisher: 'O', feed_url: 'https://news.example.org/other/feed', default_metadata: { archive: 'wordpress' } });
  await updateSource(env, 'other', { review_status: 'verified', enabled: true });
  const first = await runArchive(env, { pages: 1 });
  const second = await runArchive(env, { pages: 1 });
  assert.notEqual(first[0].source, second[0].source);
  assert.deepEqual(await runArchive(env, { pages: 2 }), [], 'both failed recently, so both rest');
});

test('title_only sources take only items whose title mentions AI, even if the description does', async () => {
  const { runIngestion } = await import('../../src/ingest/pipeline.mjs');
  const feed = `<?xml version="1.0"?><rss version="2.0"><channel><title>P</title>
<item><title>Episode 12: Classroom routines</title><link>https://news.example.org/e12</link><description>We also talk about AI.</description></item>
<item><title>Episode 13: AI feedback on essays</title><link>https://news.example.org/e13</link></item></channel></rss>`;
  const env = await makeEnv({ seed: false, semantic: false });
  env.__fetch = async () => xml(feed);
  await createSource(env, { id: 'podcast', name: 'Pod', publisher: 'Pod', feed_url: 'https://news.example.org/feed', default_metadata: { format: 'Podcast', title_only: true } });
  await updateSource(env, 'podcast', { review_status: 'verified', enabled: true });
  const [r] = await runIngestion(env, { force: true });
  assert.deepEqual([r.new, r.filtered], [1, 1]);
  assert.equal((await getSource(env, 'podcast')).default_metadata.includes('title_only'), true);
});
