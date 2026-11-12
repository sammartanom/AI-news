// "Stay signed in on this device" for the editor token. Pasting ADMIN_TOKEN once sets an HttpOnly
// cookie holding an expiry and an HMAC of it, keyed by the token itself. Page scripts cannot read
// it, other sites cannot send it (SameSite=Strict, plus the same-origin check on writes), and
// replacing ADMIN_TOKEN signs every device out at once. No database rows, no extra secret.
import { timingSafeEqual } from '../lib/http.mjs';

export const EDITOR_COOKIE = 'signal-editor';
export const DEVICE_DAYS = 90;

const tokenUsable = (env) => typeof env.ADMIN_TOKEN === 'string' && env.ADMIN_TOKEN.length >= 24;

async function sign(env, expires) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.ADMIN_TOKEN), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`signal-editor-device:${expires}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** True when the request carries a valid, unexpired device cookie. */
export async function editorDevice(req, env, { now = Date.now() } = {}) {
  if (!tokenUsable(env)) return false;
  const m = (req.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${EDITOR_COOKIE}=(\\d{10,13})\\.([0-9a-f]{64})(?:;|$)`));
  if (!m) return false;
  const expires = Number(m[1]);
  if (!(expires > now)) return false;
  return timingSafeEqual(m[2], await sign(env, expires));
}

const secure = (req) => new URL(req.url).protocol === 'https:';

export async function deviceCookie(req, env, { now = Date.now() } = {}) {
  const expires = now + DEVICE_DAYS * 86400_000;
  return `${EDITOR_COOKIE}=${expires}.${await sign(env, expires)}; Path=/; Max-Age=${DEVICE_DAYS * 86400}; HttpOnly; SameSite=Strict${secure(req) ? '; Secure' : ''}`;
}

export const clearDeviceCookie = (req) => `${EDITOR_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure(req) ? '; Secure' : ''}`;

export const tokenMatches = (env, value) => tokenUsable(env) && typeof value === 'string' && timingSafeEqual(value, env.ADMIN_TOKEN);
