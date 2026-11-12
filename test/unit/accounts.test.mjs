import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, addResource, client, loadHandler, req } from '../helpers/mocks.mjs';
import { verifyAccessJwt, clearKeyCache, teamOrigin } from '../../src/auth/access.mjs';
import { handle } from '../../src/index.mjs';

before(loadHandler);

const call = (env, email) => client(env, email);

async function seededEnv(vars = {}) {
  const env = await makeEnv({ seed: false, semantic: false, vars });
  env.r1 = await addResource(env, { title: 'First resource', why: 'Because.' });
  env.r2 = await addResource(env, { title: 'Second resource', why: 'Because two.' });
  env.hidden = await addResource(env, { title: 'Queued resource', status: 'indexed' });
  return env;
}

// ---------- Access JWT ----------
const TEAM = 'example-team.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const b64u = (buf) => Buffer.from(buf).toString('base64url');

async function jwtKit() {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const sign = async (claims, { kid = 'k1', alg = 'RS256', key = pair.privateKey } = {}) => {
    const h = b64u(JSON.stringify({ alg, kid, typ: 'JWT' }));
    const p = b64u(JSON.stringify(claims));
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${b64u(sig)}`;
  };
  const fetchImpl = async (url) => {
    assert.equal(url, `https://${TEAM}/cdn-cgi/access/certs`);
    return Response.json({ keys: [jwk] });
  };
  return { sign, fetchImpl, pair };
}
const claims = (o = {}) => ({ iss: `https://${TEAM}`, aud: [AUD], email: 'Teacher@School.org', sub: 'u1', exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000), ...o });

test('access: a valid Access JWT identifies the user', async () => {
  clearKeyCache();
  const { sign, fetchImpl } = await jwtKit();
  const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
  const user = await verifyAccessJwt(await sign(claims()), env, { fetchImpl });
  assert.equal(user.email, 'teacher@school.org');
});

test('access: tokens that are expired, for another audience/issuer, unsigned or forged are refused', async () => {
  clearKeyCache();
  const { sign, fetchImpl } = await jwtKit();
  const other = await jwtKit(); // different key, same kid
  const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
  const v = (t) => verifyAccessJwt(t, env, { fetchImpl });
  assert.equal(await v(await sign(claims({ exp: Math.floor(Date.now() / 1000) - 3600 }))), null);
  assert.equal(await v(await sign(claims({ aud: ['someone-else'] }))), null);
  assert.equal(await v(await sign(claims({ iss: 'https://evil.cloudflareaccess.com' }))), null);
  assert.equal(await v(await sign(claims({ nbf: Math.floor(Date.now() / 1000) + 3600 }))), null);
  assert.equal(await v(await sign(claims({ email: undefined }))), null); // service tokens have no email
  assert.equal(await v(await other.sign(claims())), null); // signed by a key Access does not publish
  assert.equal(await v(await sign(claims(), { kid: 'unknown' })), null);
  assert.equal(await v(`${b64u(JSON.stringify({ alg: 'none', kid: 'k1' }))}.${b64u(JSON.stringify(claims()))}.`), null);
  assert.equal(await v('garbage'), null);
  const good = await sign(claims());
  const [h, , s] = good.split('.');
  assert.equal(await v(`${h}.${b64u(JSON.stringify(claims({ email: 'admin@school.org' })))}.${s}`), null); // payload swapped
  assert.equal(await verifyAccessJwt(good, { ACCESS_TEAM_DOMAIN: TEAM }, { fetchImpl }), null); // no audience configured
});

test('access: several audience tags may be configured', async () => {
  clearKeyCache();
  const { sign, fetchImpl } = await jwtKit();
  const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: 'first-app, second-app' };
  assert.equal((await verifyAccessJwt(await sign(claims({ aud: ['second-app'] })), env, { fetchImpl })).email, 'teacher@school.org');
  assert.equal(await verifyAccessJwt(await sign(claims({ aud: ['third-app'] })), env, { fetchImpl }), null);
});

test('access: team domain must be a cloudflareaccess.com host', () => {
  assert.equal(teamOrigin({ ACCESS_TEAM_DOMAIN: 'https://acme.cloudflareaccess.com/' }), 'https://acme.cloudflareaccess.com');
  assert.equal(teamOrigin({ ACCESS_TEAM_DOMAIN: 'evil.example.com' }), null);
  assert.equal(teamOrigin({}), null);
});

test('access: the plain identity header is never trusted, even when Access is configured', async () => {
  clearKeyCache();
  const { fetchImpl } = await jwtKit();
  const env = await seededEnv({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, __fetch: fetchImpl });
  for (const headers of [
    { 'cf-access-authenticated-user-email': 'boss@school.org' },
    { 'cf-access-jwt-assertion': 'a.b.c' },
    { cookie: 'CF_Authorization=forged.token.value' }
  ]) {
    const r = await handle(req('/api/me', { headers }), env, {});
    assert.equal((await r.json()).user, null);
    assert.equal((await handle(req('/api/editor/queue', { headers }), env, {})).status, 401);
  }
});

test('access: signed JWT in header or cookie signs the user in end to end', async () => {
  clearKeyCache();
  const { sign, fetchImpl } = await jwtKit();
  const env = await seededEnv({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, __fetch: fetchImpl });
  const token = await sign(claims({ email: 'new.user@school.org' }));
  for (const headers of [{ 'cf-access-jwt-assertion': token }, { cookie: `a=b; CF_Authorization=${token}` }]) {
    const me = await (await handle(req('/api/me', { headers }), env, {})).json();
    assert.equal(me.user.email, 'new.user@school.org');
    assert.equal(me.user.role, 'user');
    assert.equal((await handle(req('/api/editor/queue', { headers }), env, {})).status, 403);
  }
});

test('dev sign-in is honored only on localhost', async () => {
  const env = await seededEnv({ DEV_USER_EMAIL: 'dev@school.org' });
  const local = await handle(req('/api/me', { origin: 'http://localhost' }), env, {});
  assert.equal((await local.json()).user.email, 'dev@school.org');
  const prod = await handle(req('/api/me', { origin: 'https://signal.example.org' }), env, {});
  assert.equal((await prod.json()).user, null);
});

test('/login redirects only to same-origin paths', async () => {
  const env = await seededEnv();
  const anon = await handle(req('/login'), env, {});
  assert.equal(anon.status, 401);
  const asUser = call(env, 'a@school.org');
  const ok = await asUser('/login?next=/saved');
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.get('location'), '/saved');
  for (const next of ['https://evil.example.net', '//evil.example.net', '/\\evil.example.net']) {
    assert.equal((await asUser('/login?next=' + encodeURIComponent(next))).headers.get('location'), '/');
  }
});

// ---------- anonymous access ----------
test('anonymous visitors can browse and search public resources', async () => {
  const env = await seededEnv();
  const anon = call(env);
  for (const p of ['/api/health', '/api/config', '/api/resources', '/api/facets', '/api/featured', '/api/search?q=resource', `/api/resources/${env.r1}`, `/api/resources/${env.r1}/related`, '/api/topics', '/api/catch-up']) {
    assert.equal((await anon(p)).status, 200, p);
  }
  assert.equal((await anon('/api/me')).data.user, null);
});

test('anonymous visitors cannot reach editor routes, and visitor accounts no longer exist', async () => {
  const env = await seededEnv();
  const anon = call(env);
  const user = call(env, 'plain@school.org');
  for (const p of ['/api/lists', '/api/lists/default', `/api/state/${env.r1}`, '/api/me/export']) assert.equal((await user(p)).status, 404, p);
  assert.equal((await user('/api/me', { method: 'DELETE', body: { confirm: 'delete my account' } })).status, 405);
  for (const p of ['/api/editor/queue', '/api/editor/summary', '/api/editor/sources', '/api/editor/audit']) assert.equal((await anon(p)).status, 401, p);
  assert.equal((await anon('/api/editor/resources/' + env.hidden + '/publish', { method: 'POST' })).status, 401);
});

test('editor permissions', async () => {
  const env = await seededEnv({ BOOTSTRAP_EDITOR_EMAILS: 'ed@school.org', ADMIN_TOKEN: 'secret-token-value-0123456789abcdef' });
  const ed = call(env, 'ed@school.org');
  const user = call(env, 'plain@school.org');
  const anon = call(env);
  assert.equal((await user('/api/editor/queue')).status, 403);
  assert.equal((await user(`/api/editor/resources/${env.hidden}/publish`, { method: 'POST' })).status, 403);
  assert.equal((await anon('/api/editor/queue')).status, 401);
  assert.equal((await ed('/api/me')).data.user.role, 'editor');
  assert.equal((await ed('/api/editor/queue')).status, 200);
  // automation token
  const bearer = (t) => anon('/api/editor/summary', { headers: { authorization: `Bearer ${t}` } });
  assert.equal((await bearer('secret-token-value-0123456789abcdef')).status, 200);
  assert.equal((await bearer('wrong')).status, 401);
  assert.equal((await bearer('')).status, 401);
  const noToken = await makeEnv({ seed: false, semantic: false });
  assert.equal((await call(noToken)('/api/editor/summary', { headers: { authorization: 'Bearer ' } })).status, 401);
  // editor writes still require same-origin
  assert.equal((await ed(`/api/editor/resources/${env.hidden}/reject`, { method: 'POST', headers: { origin: 'https://evil.example.net' } })).status, 403);
});

test('editor token: usable without Access, but only if long enough, and only for the editor', async () => {
  const long = 'x'.repeat(32);
  const env = await makeEnv({ seed: false, semantic: false, vars: { ADMIN_TOKEN: long } });
  const anon = call(env);
  const bearer = (t, path = '/api/editor/summary') => anon(path, { headers: { authorization: `Bearer ${t}` } });
  assert.equal((await bearer(long)).status, 200);
  assert.equal((await bearer(long + 'y')).status, 401);
  const short = await makeEnv({ seed: false, semantic: false, vars: { ADMIN_TOKEN: 'short-token' } });
  assert.equal((await call(short)('/api/editor/summary', { headers: { authorization: 'Bearer short-token' } })).status, 401);
});

test('editor token, once per device: an HttpOnly cookie keeps the browser signed in, safely', async () => {
  const long = 'x'.repeat(32);
  const env = await makeEnv({ seed: false, semantic: false, vars: { ADMIN_TOKEN: long } });
  const anon = call(env);
  assert.equal((await anon('/api/editor/session', { method: 'POST', body: { token: 'wrong' } })).status, 401);
  assert.equal((await anon('/api/editor/session', { method: 'POST', body: { token: long }, headers: { origin: 'https://evil.example.net' } })).status, 403);
  const res = await anon('/api/editor/session', { method: 'POST', body: { token: long } });
  assert.equal(res.status, 200);
  const set = res.headers.get('set-cookie');
  assert.match(set, /^signal-editor=\d+\.[0-9a-f]{64}; Path=\/; Max-Age=7776000; HttpOnly; SameSite=Strict/);
  const cookie = set.split(';')[0];
  const withCookie = (c, path = '/api/editor/summary', opts = {}) => anon(path, { ...opts, headers: { cookie: c, ...(opts.headers ?? {}) } });
  assert.equal((await withCookie(cookie)).status, 200);
  assert.equal((await anon('/api/editor/summary')).status, 401);
  // Tampered, expired, or signed with an old token: refused.
  const [name, value] = cookie.split('=');
  const [exp, sig] = value.split('.');
  assert.equal((await withCookie(`${name}=${Number(exp) + 1}.${sig}`)).status, 401);
  assert.equal((await withCookie(`${name}=${exp}.${'0'.repeat(64)}`)).status, 401);
  const rotated = { ...env, ADMIN_TOKEN: 'y'.repeat(32) };
  assert.equal((await call(rotated)('/api/editor/summary', { headers: { cookie } })).status, 401, 'replacing the token signs every device out');
  // Cookie-authenticated writes still need the same origin.
  const id = await addResource(env, { status: 'indexed', title: 'AI queue item' });
  assert.equal((await withCookie(cookie, `/api/editor/resources/${id}/reject`, { method: 'POST', body: { reason: 'x' }, headers: { origin: 'https://evil.example.net' } })).status, 403);
  // Signing out clears the cookie.
  const out = await withCookie(cookie, '/api/editor/session', { method: 'DELETE' });
  assert.match(out.headers.get('set-cookie'), /^signal-editor=; Path=\/; Max-Age=0/);
});

test('editor device cookie expires', async () => {
  const { editorDevice, deviceCookie } = await import('../../src/auth/device.mjs');
  const env = { ADMIN_TOKEN: 'z'.repeat(32) };
  const r = new Request('https://signal.test/');
  const cookie = (await deviceCookie(r, env, { now: 0 })).split(';')[0];
  assert.match(await deviceCookie(r, env), /; Secure$/);
  const at = (now) => editorDevice(new Request('https://signal.test/', { headers: { cookie } }), env, { now });
  assert.equal(await at(1000), true);
  assert.equal(await at(91 * 86400_000), false);
});
