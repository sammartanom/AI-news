import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, client, loadHandler } from '../helpers/mocks.mjs';

before(loadHandler);

const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const blob = () => Buffer.from(crypto.getRandomValues(new Uint8Array(64))).toString('base64url');

async function setup() {
  const env = await makeEnv({ seed: false, semantic: false });
  const anon = client(env);
  const id = hex(32);
  const token = hex(32);
  const as = (t) => (method = 'GET', body, headers = {}) => anon(`/api/vault/${id}`, { method, body, headers: { authorization: `Bearer ${t}`, ...headers } });
  return { env, anon, id, token, me: as(token), other: as(hex(32)) };
}

test('vault: create, read, update with compare-and-swap, delete', async () => {
  const { env, me, id } = await setup();
  assert.equal((await me()).status, 404);
  const first = blob();
  const created = await me('PUT', { data: first, version: 0 });
  assert.equal(created.status, 201);
  assert.equal(created.data.version, 1);
  const read = await me();
  assert.deepEqual(read.data, { data: first, version: 1 });
  assert.equal(read.headers.get('cache-control'), 'no-store');

  const second = blob();
  assert.equal((await me('PUT', { data: second, version: 1 })).data.version, 2);
  // A stale writer gets the current blob back so it can merge.
  const stale = await me('PUT', { data: blob(), version: 1 });
  assert.equal(stale.status, 409);
  assert.deepEqual([stale.data.data, stale.data.version], [second, 2]);
  // Creating again with the right key behaves like a stale write.
  assert.equal((await me('PUT', { data: blob(), version: 0 })).status, 409);

  // Only a hash of the guard is stored, never the guard itself.
  const row = await env.DB.prepare('SELECT * FROM vault_blobs WHERE id = ?').bind(id).first();
  assert.match(row.token_hash, /^[0-9a-f]{64}$/);
  assert.equal((await me('DELETE')).status, 200);
  assert.equal((await me()).status, 404);
});

test('vault: a wrong guard looks the same as a missing blob and cannot overwrite', async () => {
  const { me, other } = await setup();
  const data = blob();
  await me('PUT', { data, version: 0 });
  assert.equal((await other()).status, 404);
  assert.equal((await other('PUT', { data: blob(), version: 1 })).status, 404);
  assert.equal((await other('PUT', { data: blob(), version: 0 })).status, 404);
  assert.equal((await other('DELETE')).status, 404);
  assert.equal((await me()).data.data, data);
});

test('vault: ids, guards, data and origin are validated', async () => {
  const { anon, me, id, token } = await setup();
  assert.equal((await anon(`/api/vault/${id}`)).status, 401);
  assert.equal((await anon('/api/vault/not-hex', { headers: { authorization: `Bearer ${token}` } })).status, 404);
  assert.equal((await anon(`/api/vault/${id}`, { headers: { authorization: 'Bearer short' } })).status, 401);
  assert.equal((await me('PUT', { data: 'has spaces and <html>', version: 0 })).status, 400);
  assert.ok([400, 413].includes((await me('PUT', { data: 'A'.repeat(100 * 1024), version: 0 })).status));
  assert.equal((await me('PUT', { data: blob(), version: -1 })).status, 400);
  assert.equal((await me('PUT', { data: blob(), version: 0 }, { origin: 'https://evil.example.net' })).status, 403);
});
