export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...BASE_HEADERS, ...headers }
  });
}

export function text(body, status = 200, type = 'text/plain; charset=utf-8', headers = {}) {
  return new Response(body, { status, headers: { 'Content-Type': type, 'Cache-Control': 'no-store', ...BASE_HEADERS, ...headers } });
}

export const publicCache = (seconds = 60) => ({
  'Cache-Control': `public, max-age=${Math.min(seconds, 60)}, s-maxage=${seconds}, stale-while-revalidate=${seconds * 5}`
});

// Reads a JSON body with a hard size limit, counting bytes as they stream in.
export async function readJson(req, maxBytes = 65536) {
  const type = req.headers.get('content-type') || '';
  if (!/^application\/json\b/i.test(type)) throw new HttpError(415, 'Content-Type must be application/json');
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new HttpError(413, 'Request body too large');
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, 'Request body required');
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, 'Request body too large');
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(buf));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

// Cookie-authenticated writes must come from this origin. Browsers always send Origin on
// cross-origin POST/PUT/PATCH/DELETE; Sec-Fetch-Site covers the rest.
export function assertSameOrigin(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const origin = req.headers.get('origin');
  const host = new URL(req.url).host;
  if (origin) {
    let ok = false;
    try { ok = new URL(origin).host === host; } catch { /* invalid origin */ }
    if (!ok) throw new HttpError(403, 'Cross-origin request refused');
    return;
  }
  const site = req.headers.get('sec-fetch-site');
  if (site && !['same-origin', 'none'].includes(site)) throw new HttpError(403, 'Cross-origin request refused');
}

export function intParam(value, { min = 0, max = 100, fallback = 0 } = {}) {
  const n = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
