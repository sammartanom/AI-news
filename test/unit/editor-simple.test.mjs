import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, addResource, client, loadHandler } from '../helpers/mocks.mjs';
import { findFeed, sourceIdFrom } from '../../src/ingest/discover.mjs';

before(loadHandler);

const RSS = (title, items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title>${items.map(([t, l]) => `<item><title>${t}</title><link>${l}</link></item>`).join('')}</channel></rss>`;
const xml = (body) => new Response(body, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
const html = (body) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const FEED = RSS('Example Teaching Blog', [['AI tutors in the classroom', 'https://blog.example.org/a'], ['Snow day schedule', 'https://blog.example.org/b'], ['Teaching with ChatGPT', 'https://blog.example.org/c']]);

function site(env) {
  env.__fetch = async (u) => {
    const url = new URL(u);
    if (url.pathname === '/blog/feed.xml') return xml(FEED);
    if (url.pathname === '/') return html('<html><head><link rel="alternate" type="application/rss+xml" href="/comments/feed"><link rel="alternate" type="application/rss+xml" title="Posts" href="/blog/feed.xml"></head></html>');
    if (url.pathname === '/plain') return html('<html><head><title>No feed</title></head></html>');
    return new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } });
  };
}

test('feeds: any page on a site finds its feed, skipping comment feeds', async () => {
  const env = await makeEnv({ seed: false, semantic: false });
  site(env);
  const f = await findFeed(env, 'https://blog.example.org/');
  assert.equal(f.feed_url, 'https://blog.example.org/blog/feed.xml');
  assert.equal(f.title, 'Example Teaching Blog');
  assert.equal(f.items, 3);
  assert.equal(f.ai_items, 2);
  assert.deepEqual((await findFeed(env, 'https://blog.example.org/blog/feed.xml')).feed_url, 'https://blog.example.org/blog/feed.xml');
  await assert.rejects(findFeed(env, 'https://other.example.org/plain'), /No feed was found/);
  assert.equal(sourceIdFrom('KQED MindShift!'), 'kqed-mindshift');
});

test('feeds: add in one step, it starts collecting, and it can be removed', async () => {
  const env = await makeEnv({ seed: false, semantic: false, vars: { BOOTSTRAP_EDITOR_EMAILS: 'ed@school.org' } });
  site(env);
  const ed = client(env, 'ed@school.org');
  const found = (await ed('/api/editor/feeds/find', { method: 'POST', body: { url: 'https://blog.example.org/' } })).data;
  assert.equal(found.existing, null);
  const added = await ed('/api/editor/feeds', { method: 'POST', body: { feed_url: found.feed_url, site_url: found.site_url, name: found.title } });
  assert.equal(added.status, 201);
  assert.equal(added.data.source.id, 'example-teaching-blog');
  assert.equal(added.data.source.enabled, true);
  assert.equal(added.data.source.auto_publish, true);
  assert.equal(added.data.report.new, 2, 'the two AI posts; the snow day is filtered');
  assert.equal((await ed('/api/editor/feeds/find', { method: 'POST', body: { url: 'https://blog.example.org/' } })).data.existing.id, 'example-teaching-blog');
  const again = await ed('/api/editor/feeds', { method: 'POST', body: { feed_url: 'https://blog.example.org/blog/feed.xml?x=1', name: found.title } });
  assert.equal(again.data.source.id, 'example-teaching-blog-2', 'ids never collide');
  assert.equal((await ed('/api/editor/feeds/find', { method: 'POST', body: { url: 'https://other.example.org/plain' } })).status, 422);
  assert.equal((await ed('/api/editor/sources/example-teaching-blog', { method: 'DELETE' })).status, 200);
  assert.equal((await ed('/api/editor/sources/example-teaching-blog', { method: 'DELETE' })).status, 404);
  assert.equal((await client(env)('/api/editor/feeds', { method: 'POST', body: { feed_url: found.feed_url, name: 'x' } })).status, 401);
});

test('articles: remove takes one off the site, and undo puts it back exactly as it was', async () => {
  const env = await makeEnv({ seed: false, semantic: false, vars: { BOOTSTRAP_EDITOR_EMAILS: 'ed@school.org' } });
  const ed = client(env, 'ed@school.org');
  const anon = client(env);
  const id = await addResource(env, { title: 'AI literacy guide' });
  await env.DB.prepare("UPDATE resources SET auto_published = 1, why = NULL WHERE id = ?").bind(id).run();
  await ed(`/api/editor/resources/${id}/reject`, { method: 'POST', body: { reason: 'Removed by an editor' } });
  assert.equal((await anon(`/api/resources/${id}`)).status, 404);
  const back = await ed(`/api/editor/resources/${id}/restore`, { method: 'POST', body: { to: 'published' } });
  assert.equal(back.data.resource.status, 'published');
  assert.equal(back.data.resource.auto_published, true, 'still labelled as not reviewed');
  assert.equal((await anon(`/api/resources/${id}`)).status, 200);
});
