import { safeFetch, FetchError } from './safe-fetch.mjs';
import { canonicalizeUrl } from '../lib/url.mjs';
import { nowIso } from '../lib/ids.mjs';
import { holdResource } from '../curation/service.mjs';

const fetchOf = (env) => env.__fetch ?? globalThis.fetch;

// Maps an HTTP outcome to a link status. 401/403/429 mean the publisher refused an automated
// request, which says nothing about whether the page works, so they are "blocked", not "broken".
export function classifyStatus(status) {
  if (status >= 200 && status < 300) return 'ok';
  if ([404, 410].includes(status)) return 'broken';
  if ([401, 403, 406, 429, 451, 999].includes(status)) return 'blocked';
  return 'error';
}

export async function checkLink(env, url) {
  const opts = { env, fetchImpl: fetchOf(env), readBody: false, timeoutMs: 10_000 };
  try {
    let res = await safeFetch(url, { ...opts, method: 'HEAD' });
    if ([405, 501].includes(res.status)) res = await safeFetch(url, { ...opts, method: 'GET', headers: { Range: 'bytes=0-0' } });
    let status = classifyStatus(res.status);
    if (status === 'ok' && res.redirected) {
      let same = false;
      try { same = canonicalizeUrl(res.finalUrl) === canonicalizeUrl(url); } catch { /* keep redirected */ }
      if (!same) status = 'redirected';
    }
    return { link_status: status, http: res.status, final_url: res.finalUrl };
  } catch (e) {
    if (e instanceof FetchError) return { link_status: e.code === 'http_error' ? classifyStatus(e.status) : 'error', http: e.status ?? null, error: e.code };
    return { link_status: 'error', http: null, error: 'unexpected' };
  }
}

export async function checkAndStore(env, row) {
  const r = await checkLink(env, row.url);
  await env.DB.prepare('UPDATE resources SET link_status = ?, link_http_status = ?, last_link_check = ? WHERE id = ?')
    .bind(r.link_status, r.http, nowIso(), row.id).run();
  return r;
}

// Oldest-checked published resources first.
export async function runLinkChecks(env, { limit = 25 } = {}) {
  const rows = (await env.DB.prepare(
    `SELECT id, url, auto_published FROM resources WHERE status = 'published' ORDER BY last_link_check IS NOT NULL, last_link_check LIMIT ?`
  ).bind(limit).all()).results;
  const out = { checked: 0, broken: 0, blocked: 0, errors: 0 };
  for (const row of rows) {
    const r = await checkAndStore(env, row);
    out.checked++;
    if (r.link_status === 'broken') {
      out.broken++;
      // A reviewed resource is only flagged. An automatic one is pulled back until an editor looks.
      if (row.auto_published === 1) { await holdResource(env, row.id, 'link_broken'); out.held = (out.held ?? 0) + 1; }
    }
    else if (r.link_status === 'blocked') out.blocked++;
    else if (r.link_status === 'error') out.errors++;
  }
  return out;
}
