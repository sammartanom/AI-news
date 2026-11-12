import { HttpError, timingSafeEqual } from '../lib/http.mjs';
import { newId, nowIso } from '../lib/ids.mjs';
import { accessConfigured, verifyAccessJwt, tokenFromRequest, teamOrigin } from './access.mjs';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const normalizeEmail = (e) => String(e ?? '').trim().toLowerCase();
export const validEmail = (e) => EMAIL_RE.test(e) && e.length <= 254;

const bootstrapEditors = (env) => new Set(String(env.BOOTSTRAP_EDITOR_EMAILS ?? '').split(',').map(normalizeEmail).filter(Boolean));

const isLocalHost = (url) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);

export const accountsEnabled = (env) => accessConfigured(env) || Boolean(env.DEV_USER_EMAIL);

export async function upsertUser(env, email) {
  const now = nowIso();
  let user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  const promote = bootstrapEditors(env).has(email);
  if (!user) {
    const id = newId();
    await env.DB.prepare('INSERT INTO users(id, email, role, created_at, last_seen_at) VALUES (?,?,?,?,?)').bind(id, email, promote ? 'editor' : 'user', now, now).run();
    user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  } else {
    const role = promote && user.role === 'user' ? 'editor' : user.role;
    // Avoid a D1 write on every request: refresh last_seen hourly, or when the role changes.
    const stale = !user.last_seen_at || Date.parse(user.last_seen_at) < Date.now() - 3600_000;
    if (stale || role !== user.role) {
      await env.DB.prepare('UPDATE users SET last_seen_at = ?, role = ? WHERE id = ?').bind(now, role, user.id).run();
      user = { ...user, role, last_seen_at: now };
    }
  }
  return user;
}

/**
 * Resolves the signed-in user for a request, or null for an anonymous visitor.
 *  - Access: a verified Cloudflare Access JWT.
 *  - Local development only: DEV_USER_EMAIL, honored solely when the request host is localhost.
 */
export async function currentUser(req, env, { now } = {}) {
  if (env.DEV_USER_EMAIL && isLocalHost(req.url)) {
    const email = normalizeEmail(env.DEV_USER_EMAIL);
    return validEmail(email) ? upsertUser(env, email) : null;
  }
  if (!accessConfigured(env)) return null;
  const token = tokenFromRequest(req);
  if (!token) return null;
  const claims = await verifyAccessJwt(token, env, { now });
  return claims ? upsertUser(env, claims.email) : null;
}

export async function requireUser(c) {
  if (!c.user) throw new HttpError(401, 'Sign-in required');
  return c.user;
}

const isEditorRole = (u) => u && (u.role === 'editor' || u.role === 'admin');

// Editors sign in through Access like everyone else. ADMIN_TOKEN is an optional bearer secret for
// automation (scheduled ingestion triggers, reindex scripts); it is compared in constant time.
export function requireEditor(c) {
  const header = c.req.headers.get('authorization') || '';
  // A short token is too easy to guess, so ADMIN_TOKEN is ignored unless it is at least 24 characters.
  if (c.env.ADMIN_TOKEN && c.env.ADMIN_TOKEN.length >= 24 && header.startsWith('Bearer ') && timingSafeEqual(header.slice(7), c.env.ADMIN_TOKEN)) {
    return { actor: 'automation', user: null };
  }
  // A browser that signed in with the token and chose to stay signed in (see device.mjs).
  if (c.device && !isEditorRole(c.user)) return { actor: c.user?.email ?? 'editor', user: c.user ?? null };
  if (!c.user) throw new HttpError(401, 'Sign-in required');
  if (!isEditorRole(c.user)) throw new HttpError(403, 'Editor access required');
  return { actor: c.user.email, user: c.user };
}

export const logoutUrl = (env) => (teamOrigin(env) ? `${teamOrigin(env)}/cdn-cgi/access/logout` : null);
