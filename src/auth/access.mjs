// Cloudflare Access identity. The Worker never trusts the plain Cf-Access-Authenticated-User-Email
// header, because any client can send it to a hostname that is not behind Access. Instead it
// verifies the signed Access JWT (Cf-Access-Jwt-Assertion header or CF_Authorization cookie)
// against the team's published keys, and checks issuer, audience and expiry.
// https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/

const KEY_TTL_MS = 60 * 60 * 1000;
const REFETCH_MIN_MS = 60 * 1000;
const cache = new Map(); // team -> { keys: Map(kid -> CryptoKey), fetchedAt }

export function teamOrigin(env) {
  const raw = String(env.ACCESS_TEAM_DOMAIN ?? '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return /^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(raw) ? `https://${raw.toLowerCase()}` : null;
}

// ACCESS_AUD holds one Access application audience tag, or several separated by commas.
const audiences = (env) => String(env.ACCESS_AUD ?? '').split(',').map((a) => a.trim()).filter(Boolean);

export const accessConfigured = (env) => Boolean(teamOrigin(env) && audiences(env).length);

const b64urlToBytes = (s) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const decodeJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function loadKeys(env, origin, fetchImpl, now) {
  let body;
  try {
    const res = await fetchImpl(`${origin}/cdn-cgi/access/certs`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = await res.json();
  } catch (e) {
    console.error('could not load Access signing keys:', e.message); // misconfiguration or outage: worth a log line
    throw e;
  }
  const keys = new Map();
  for (const jwk of body.keys ?? []) {
    if (jwk.kty !== 'RSA' || !jwk.kid) continue;
    keys.set(jwk.kid, await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  const entry = { keys, fetchedAt: now };
  cache.set(origin, entry);
  return entry;
}

async function keyFor(env, origin, kid, fetchImpl, now) {
  let entry = cache.get(origin);
  if (!entry || now - entry.fetchedAt > KEY_TTL_MS) entry = await loadKeys(env, origin, fetchImpl, now);
  if (!entry.keys.has(kid) && now - entry.fetchedAt > REFETCH_MIN_MS) entry = await loadKeys(env, origin, fetchImpl, now);
  return entry.keys.get(kid) ?? null;
}

export function clearKeyCache() {
  cache.clear();
}

/** Returns the verified claims, or null. Never throws for bad tokens. */
export async function verifyAccessJwt(token, env, { now = Date.now(), fetchImpl = env.__fetch ?? globalThis.fetch } = {}) {
  try {
    const origin = teamOrigin(env);
    const expected = audiences(env);
    if (!origin || !expected.length || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = decodeJson(parts[0]);
    if (header.alg !== 'RS256' || !header.kid) return null;
    const key = await keyFor(env, origin, header.kid, fetchImpl, now);
    if (!key) return null;
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const claims = decodeJson(parts[1]);
    const nowS = Math.floor(now / 1000);
    if (claims.iss !== origin) return null;
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.some((a) => expected.includes(a))) return null;
    if (typeof claims.exp !== 'number' || claims.exp < nowS - 30) return null;
    if (typeof claims.nbf === 'number' && claims.nbf > nowS + 30) return null;
    if (typeof claims.email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(claims.email)) return null; // service tokens have no email
    return { email: claims.email.toLowerCase(), sub: claims.sub ?? null };
  } catch {
    return null; // malformed tokens are routine noise; key-loading failures are logged above
  }
}

export function tokenFromRequest(req) {
  const header = req.headers.get('cf-access-jwt-assertion');
  if (header) return header;
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return m ? m[1] : null;
}
