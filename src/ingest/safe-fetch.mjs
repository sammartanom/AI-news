import { assertPublicHttpsUrl, UnsafeUrlError, hostAllowed } from '../lib/url.mjs';

export class FetchError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

const userAgent = (env) => `SignalBot/3.0 (+resource indexer for AI in education${env?.BOT_CONTACT ? `; ${env.BOT_CONTACT}` : ''})`;

/**
 * Fetches untrusted content with: HTTPS-only public hosts, a host allowlist applied to the first
 * request and every redirect hop, a redirect limit, a timeout, a content-type check and a hard
 * response-size cap enforced while streaming.
 */
export async function safeFetch(url, opts = {}) {
  const {
    env, allowedHosts = [], maxBytes = 2_000_000, timeoutMs = 15_000, maxRedirects = 3, method = 'GET',
    accept = '*/*', allowedTypes = null, headers = {}, fetchImpl = globalThis.fetch, readBody = true
  } = opts;
  const signal = AbortSignal.timeout(timeoutMs);
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let u;
    try { u = assertPublicHttpsUrl(current); } catch (e) {
      if (e instanceof UnsafeUrlError) throw new FetchError('unsafe_url', e.message);
      throw e;
    }
    if (allowedHosts.length && !hostAllowed(u.hostname, allowedHosts)) {
      throw new FetchError(hop === 0 ? 'host_not_allowed' : 'redirect_refused', `Host not allowed: ${u.hostname}`);
    }
    let res;
    try {
      res = await fetchImpl(u.href, { method, redirect: 'manual', signal, headers: { 'User-Agent': userAgent(env), Accept: accept, ...headers } });
    } catch (e) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new FetchError('timeout', 'Request timed out');
      throw new FetchError('network', `Network error: ${String(e?.message ?? e).slice(0, 120)}`);
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      try { await res.body?.cancel(); } catch { /* ignore */ }
      if (!loc) throw new FetchError('redirect_refused', 'Redirect without location');
      if (hop === maxRedirects) throw new FetchError('too_many_redirects', 'Too many redirects');
      current = new URL(loc, u.href).href;
      continue;
    }
    const base = { status: res.status, headers: res.headers, finalUrl: u.href, redirected: hop > 0 };
    if (res.status === 304) return { ...base, notModified: true, text: '' };
    if (!readBody) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      return { ...base, text: '' };
    }
    if (!res.ok) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      throw new FetchError('http_error', `HTTP ${res.status}`, { status: res.status });
    }
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (allowedTypes && !allowedTypes.some((re) => re.test(type))) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      throw new FetchError('bad_content_type', `Unexpected content type: ${type || 'none'}`);
    }
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > maxBytes) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      throw new FetchError('too_large', 'Response too large');
    }
    const reader = res.body?.getReader();
    if (!reader) return { ...base, text: '' };
    const chunks = [];
    let size = 0;
    for (;;) {
      let chunk;
      try { chunk = await reader.read(); } catch (e) {
        if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new FetchError('timeout', 'Request timed out');
        throw new FetchError('network', 'Read failed');
      }
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new FetchError('too_large', 'Response too large');
      }
      chunks.push(chunk.value);
    }
    const buf = new Uint8Array(size);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
    return { ...base, text: new TextDecoder('utf-8').decode(buf) };
  }
  throw new FetchError('too_many_redirects', 'Too many redirects');
}
