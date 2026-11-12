import { route } from '../router.mjs';
import { json, readJson, HttpError, assertSameOrigin, timingSafeEqual } from '../lib/http.mjs';
import { nowIso } from '../lib/ids.mjs';

// Encrypted saves, no accounts. Each blob lives under an id the browser derives from a secret key
// (a passkey or a private link) and is guarded by a second value derived from the same key. The
// server only ever sees ciphertext, the id and a hash of the guard. Unknown ids and wrong guards
// get the same 404, so the endpoint does not reveal which ids exist.
const HEX64 = /^[0-9a-f]{64}$/;
const DATA = /^[A-Za-z0-9_-]{24,}$/;
const MAX_DATA = 96 * 1024;
const NOT_FOUND = () => new HttpError(404, 'Not found');

const sha256 = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

function guardOf(c) {
  if (!HEX64.test(c.params.id)) throw NOT_FOUND();
  const header = c.req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!HEX64.test(token)) throw new HttpError(401, 'Missing key');
  return token;
}

async function load(c, token) {
  const row = await c.env.DB.prepare('SELECT * FROM vault_blobs WHERE id = ?').bind(c.params.id).first();
  if (!row || !timingSafeEqual(row.token_hash, await sha256(token))) return null;
  return row;
}

const noStore = { 'Cache-Control': 'no-store' };

route('GET', '/api/vault/:id', async (c) => {
  const row = await load(c, guardOf(c));
  if (!row) throw NOT_FOUND();
  return json({ data: row.data, version: row.version }, 200, noStore);
});

// Writes are compare-and-swap on version: 0 creates, otherwise it must match the stored version.
// A mismatch returns the current blob so the browser can merge and try again.
route('PUT', '/api/vault/:id', async (c) => {
  assertSameOrigin(c.req);
  const token = guardOf(c);
  const body = await readJson(c.req, MAX_DATA + 1024);
  const data = String(body.data ?? '');
  const version = Number(body.version);
  if (!DATA.test(data) || data.length > MAX_DATA) throw new HttpError(400, 'Invalid data');
  if (!Number.isInteger(version) || version < 0) throw new HttpError(400, 'Invalid version');
  const now = nowIso();
  if (version === 0) {
    const r = await c.env.DB.prepare('INSERT INTO vault_blobs(id, token_hash, data, version, created_at, updated_at) VALUES (?,?,?,1,?,?) ON CONFLICT(id) DO NOTHING')
      .bind(c.params.id, await sha256(token), data, now, now).run();
    if (r.meta?.changes) return json({ version: 1 }, 201, noStore);
  }
  const row = await load(c, token);
  if (!row) throw NOT_FOUND();
  if (row.version !== version) throw new HttpError(409, 'Changed elsewhere', { data: row.data, version: row.version });
  const r = await c.env.DB.prepare('UPDATE vault_blobs SET data = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?').bind(data, now, row.id, version).run();
  if (!r.meta?.changes) throw new HttpError(409, 'Changed elsewhere', { retry: true });
  return json({ version: version + 1 }, 200, noStore);
});

route('DELETE', '/api/vault/:id', async (c) => {
  assertSameOrigin(c.req);
  const row = await load(c, guardOf(c));
  if (!row) throw NOT_FOUND();
  await c.env.DB.prepare('DELETE FROM vault_blobs WHERE id = ?').bind(row.id).run();
  return json({ ok: true }, 200, noStore);
});
