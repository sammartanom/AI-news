export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

// Optional bearer token, used by the editor console when Cloudflare Access is not set up.
let authToken = null;
export const setAuthToken = (t) => { authToken = t; };

async function request(method, path, body, { signal, timeout = 15000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new DOMException('timeout', 'TimeoutError')), timeout);
  signal?.addEventListener('abort', () => ctl.abort(signal.reason), { once: true });
  try {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      signal: ctl.signal,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (${res.status})`, data);
    return data;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (signal?.aborted) throw e; // navigation cancelled this request
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ApiError(0, 'You are offline. Check your connection, then try again.', { offline: true });
    throw new ApiError(0, e?.name === 'TimeoutError' ? 'This is taking too long. Try again in a moment.' : 'Could not reach the server. Try again in a moment.');
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  get: (path, opts) => request('GET', path, undefined, opts),
  post: (path, body, opts) => request('POST', path, body ?? {}, opts),
  put: (path, body, opts) => request('PUT', path, body ?? {}, opts),
  patch: (path, body, opts) => request('PATCH', path, body ?? {}, opts),
  del: (path, body, opts) => request('DELETE', path, body, opts)
};

export const qs = (obj) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, v === true ? '1' : String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
