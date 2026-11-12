import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, addResource, client, loadHandler } from '../helpers/mocks.mjs';
import { KINDS, kindOfFormat } from '../../src/lib/taxonomy.mjs';

before(loadHandler);

test('kinds group formats; articles also take formats no other kind claims', () => {
  assert.equal(kindOfFormat('Video'), 'videos');
  assert.equal(kindOfFormat('toolkit'), 'guides');
  assert.equal(kindOfFormat('Research paper'), 'research');
  assert.equal(kindOfFormat('Webinar'), 'articles');
  const all = KINDS.flatMap((k) => k.formats.map((f) => f.toLowerCase()));
  assert.equal(new Set(all).size, all.length, 'no format belongs to two kinds');
});

test('?kind= filters browsing and rejects unknown kinds', async () => {
  const env = await makeEnv({ seed: false, semantic: false });
  for (const [title, format] of [['A video', 'Video'], ['A course', 'Course'], ['A guide', 'Toolkit'], ['Some lessons', 'Lessons'], ['An article', 'Article'], ['A webinar', 'Webinar'], ['A podcast', 'podcast']]) {
    await addResource(env, { title, format });
  }
  const get = client(env);
  const titles = async (kind) => (await get(`/api/resources?kind=${kind}`)).data.resources.map((r) => r.title).sort();
  assert.deepEqual(await titles('videos'), ['A video']);
  assert.deepEqual(await titles('guides'), ['A guide']);
  assert.deepEqual(await titles('podcasts'), ['A podcast']); // case does not matter
  assert.deepEqual(await titles('articles'), ['A webinar', 'An article']);
  assert.equal((await get('/api/resources?kind=memes')).status, 400);
  assert.ok((await get('/api/config')).data.kinds.some((k) => k.slug === 'courses'));
});
