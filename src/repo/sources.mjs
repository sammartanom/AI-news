import { ARCHIVE_KINDS } from '../ingest/archive.mjs';
import { HttpError } from '../lib/http.mjs';
import { stripHtml, parseJsonArray, parseJsonObject } from '../lib/text.mjs';
import { assertPublicHttpsUrl, UnsafeUrlError, hostOf } from '../lib/url.mjs';
import { nowIso } from '../lib/ids.mjs';
import { AUDIENCES, collectionSlugs, EVIDENCE_TYPES } from '../lib/taxonomy.mjs';

const SOURCE_TYPES = ['feed', 'sitemap', 'api'];
const REVIEW = ['unreviewed', 'verified', 'rejected'];
const evidenceSlugs = new Set(EVIDENCE_TYPES.map((e) => e.slug));

export function sourceView(row, stats = {}) {
  return {
    id: row.id,
    name: row.name,
    publisher: row.publisher,
    feed_url: row.feed_url,
    site_url: row.site_url,
    source_type: row.source_type,
    allowed_hosts: parseJsonArray(row.allowed_hosts),
    default_metadata: parseJsonObject(row.default_metadata),
    review_status: row.review_status,
    enabled: row.enabled === 1,
    require_match: row.require_match === 1,
    auto_publish: row.auto_publish === 1,
    last_checked: row.last_checked,
    last_success: row.last_success,
    last_error: row.last_error,
    last_error_at: row.last_error_at,
    consecutive_failures: row.consecutive_failures,
    notes: row.notes,
    archive_page: row.archive_page ?? 0,
    archive_done_at: row.archive_done_at ?? null,
    ...stats
  };
}

export async function listSources(env) {
  const rows = (await env.DB.prepare('SELECT * FROM sources ORDER BY name').all()).results;
  const counts = (await env.DB.prepare(`SELECT source_id, status, count(*) AS n FROM resources WHERE source_id IS NOT NULL GROUP BY source_id, status`).all()).results;
  return rows.map((r) => {
    const c = Object.fromEntries(counts.filter((x) => x.source_id === r.id).map((x) => [x.status, x.n]));
    return sourceView(r, { counts: { indexed: c.indexed ?? 0, published: c.published ?? 0, rejected: c.rejected ?? 0 } });
  });
}

function cleanDefaults(d) {
  if (d === undefined) return undefined;
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new HttpError(400, 'default_metadata must be an object', { field: 'default_metadata' });
  const out = {};
  if (d.format) out.format = stripHtml(String(d.format), 40);
  if (d.audiences) out.audiences = parseJsonArray(d.audiences).filter((a) => AUDIENCES.includes(a));
  if (d.collections) out.collections = parseJsonArray(d.collections).filter((c) => collectionSlugs.has(c));
  if (d.evidence_type && evidenceSlugs.has(d.evidence_type)) out.evidence_type = d.evidence_type;
  if (d.topics) out.topics = parseJsonArray(d.topics).map((t) => stripHtml(String(t), 60).toLowerCase()).filter(Boolean).slice(0, 10);
  if (d.strip_params) out.strip_params = parseJsonArray(d.strip_params).map((p) => String(p).slice(0, 40)).slice(0, 10);
  if (d.store_excerpt === true) out.store_excerpt = true;
  if (d.title_only === true) out.title_only = true; // only items whose title mentions AI (videos, podcasts)
  if (d.focus === 'strict') out.focus = 'strict'; // general AI news must show an educator angle (src/ingest/focus.mjs)
  if (ARCHIVE_KINDS.includes(d.archive)) out.archive = d.archive;
  if (Number.isInteger(Number(d.archive_pages)) && Number(d.archive_pages) > 0) out.archive_pages = Math.min(Number(d.archive_pages), 200);
  return out;
}

export async function createSource(env, body) {
  const id = String(body.id ?? '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,59}$/.test(id)) throw new HttpError(400, 'id must be 3-60 lowercase letters, numbers or hyphens', { field: 'id' });
  const name = stripHtml(body.name ?? '', 120);
  const publisher = stripHtml(body.publisher ?? '', 200);
  if (!name || !publisher) throw new HttpError(400, 'name and publisher are required');
  const sourceType = body.source_type ?? 'feed';
  if (!SOURCE_TYPES.includes(sourceType)) throw new HttpError(400, 'source_type is not allowed', { field: 'source_type' });
  let feed;
  try { feed = assertPublicHttpsUrl(body.feed_url).href; } catch (e) {
    if (e instanceof UnsafeUrlError) throw new HttpError(400, `feed_url: ${e.message}`, { field: 'feed_url' });
    throw e;
  }
  let site = null;
  if (body.site_url) {
    try { site = assertPublicHttpsUrl(body.site_url).href; } catch (e) {
      if (e instanceof UnsafeUrlError) throw new HttpError(400, `site_url: ${e.message}`, { field: 'site_url' });
      throw e;
    }
  }
  const hosts = parseJsonArray(body.allowed_hosts).map((h) => String(h).toLowerCase().trim()).filter((h) => /^(\*\.)?[a-z0-9.-]+\.[a-z]{2,}$/.test(h));
  const allowed = hosts.length ? hosts : [...new Set([hostOf(feed), site ? hostOf(site) : null].filter(Boolean))];
  const now = nowIso();
  try {
    await env.DB.prepare(
      `INSERT INTO sources(id, name, feed_url, publisher, enabled, source_type, site_url, allowed_hosts, default_metadata, review_status, require_match, notes, created_at, updated_at)
       VALUES (?,?,?,?,0,?,?,?,?,'unreviewed',?,?,?,?)`
    ).bind(id, name, feed, publisher, sourceType, site, JSON.stringify(allowed), JSON.stringify(cleanDefaults(body.default_metadata) ?? {}),
      body.require_match === false ? 0 : 1, body.notes ? stripHtml(body.notes, 500) : null, now, now).run();
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) throw new HttpError(409, 'A source with this id or URL already exists');
    throw e;
  }
  return getSource(env, id);
}

export const getSource = (env, id) => env.DB.prepare('SELECT * FROM sources WHERE id = ?').bind(id).first();

export async function updateSource(env, id, body) {
  const row = await getSource(env, id);
  if (!row) throw new HttpError(404, 'Source not found');
  const sets = [];
  const vals = [];
  const set = (col, v) => { sets.push(`${col} = ?`); vals.push(v); };
  let review = row.review_status;
  if (body.review_status !== undefined) {
    if (!REVIEW.includes(body.review_status)) throw new HttpError(400, 'review_status is not allowed');
    review = body.review_status;
  }
  if (body.name !== undefined) set('name', stripHtml(body.name, 120));
  if (body.publisher !== undefined) set('publisher', stripHtml(body.publisher, 200));
  if (body.notes !== undefined) set('notes', body.notes ? stripHtml(body.notes, 500) : null);
  if (body.require_match !== undefined) set('require_match', body.require_match ? 1 : 0);
  if (body.auto_publish !== undefined) {
    if (body.auto_publish && (review !== 'verified' || (body.enabled === undefined ? row.enabled : body.enabled ? 1 : 0) !== 1)) throw new HttpError(422, 'Automatic publishing needs a verified source that is switched on');
    set('auto_publish', body.auto_publish ? 1 : 0);
  }
  if (body.default_metadata !== undefined) set('default_metadata', JSON.stringify(cleanDefaults(body.default_metadata)));
  if (body.allowed_hosts !== undefined) {
    const hosts = parseJsonArray(body.allowed_hosts).map((h) => String(h).toLowerCase().trim()).filter((h) => /^(\*\.)?[a-z0-9.-]+\.[a-z]{2,}$/.test(h));
    if (!hosts.length) throw new HttpError(400, 'allowed_hosts needs at least one valid host');
    set('allowed_hosts', JSON.stringify(hosts));
  }
  if (body.review_status !== undefined) set('review_status', review);
  if (body.enabled !== undefined) {
    if (body.enabled && review !== 'verified') throw new HttpError(422, 'A source must be marked verified before it can be enabled');
    if (body.enabled && row.source_type !== 'feed') throw new HttpError(422, `Source type "${row.source_type}" is not supported by the ingester yet`);
    set('enabled', body.enabled ? 1 : 0);
    if (body.enabled) set('consecutive_failures', 0);
  }
  if (review !== 'verified' && row.enabled === 1 && body.enabled === undefined) { set('enabled', 0); set('auto_publish', 0); }
  if (body.enabled === false) set('auto_publish', 0);
  if (!sets.length) return row;
  set('updated_at', nowIso());
  await env.DB.prepare(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
  return getSource(env, id);
}
