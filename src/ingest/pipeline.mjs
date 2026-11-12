import { safeFetch, FetchError } from './safe-fetch.mjs';
import { parseFeed, FeedError } from './feed.mjs';
import { relevance, titleMentionsAI } from './classify.mjs';
import { findDuplicates } from './dedupe.mjs';
import { canonicalizeUrl, extractDoi, hostAllowed, hostOf, UnsafeUrlError } from '../lib/url.mjs';
import { titleKey, parseJsonArray, parseJsonObject } from '../lib/text.mjs';
import { newId, nowIso } from '../lib/ids.mjs';
import { legacyColumns } from '../repo/legacy.mjs';

const FEED_TYPES = [/xml/, /rss/, /atom/, /text\/plain/];
export const MAX_NEW_PER_RUN = 50;
export const MIN_RECHECK_MS = 5 * 3600 * 1000;
export const AUTO_DISABLE_AFTER = 5;

const fetchOf = (env) => env.__fetch ?? globalThis.fetch;

/**
 * discover -> normalize -> deduplicate -> classify -> queue (status "indexed").
 * Nothing is published here. A human reviews the queue.
 */
export async function ingestSource(env, source, { now = Date.now() } = {}) {
  const startedAt = new Date(now).toISOString();
  const logId = newId();
  await env.DB.prepare(`INSERT INTO ingestion_log(id, source_id, started_at, status) VALUES (?,?,?,'running')`).bind(logId, source.id, startedAt).run();
  const report = { source: source.id, status: 'ok', new: 0, duplicates: 0, flagged: 0, filtered: 0, invalid: 0 };

  try {
    if (source.source_type !== 'feed') throw new FetchError('unsupported', `Source type "${source.source_type}" is not supported by the ingester yet`);
    const allowed = parseJsonArray(source.allowed_hosts);
    const hosts = allowed.length ? allowed : [hostOf(source.feed_url)];
    const defaults = parseJsonObject(source.default_metadata);

    const headers = {};
    if (source.etag) headers['If-None-Match'] = source.etag;
    if (source.modified) headers['If-Modified-Since'] = source.modified;
    const res = await safeFetch(source.feed_url, {
      env, allowedHosts: hosts, headers, fetchImpl: fetchOf(env), allowedTypes: FEED_TYPES,
      accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8'
    });
    if (res.notModified) {
      report.status = 'not_modified';
    } else {
      const feed = parseFeed(res.text, { now });
      report.invalid = feed.skipped;
      const known = await knownUrls(env, feed.items, defaults);
      for (const item of feed.items) {
        if (report.new + report.flagged >= MAX_NEW_PER_RUN) break;
        const outcome = await queueItem(env, source, defaults, hosts, item, { logId, now, known, requireTitle: defaults.title_only === true });
        report[outcome] = (report[outcome] ?? 0) + 1;
      }
      await env.DB.prepare('UPDATE sources SET etag = ?, modified = ? WHERE id = ?')
        .bind(res.headers.get('etag'), res.headers.get('last-modified'), source.id).run();
    }
    const finished = nowIso();
    await env.DB.prepare('UPDATE sources SET last_checked = ?, last_success = ?, last_error = NULL, last_error_at = NULL, consecutive_failures = 0 WHERE id = ?')
      .bind(finished, finished, source.id).run();
    await finishLog(env, logId, report, res.status ?? 200, null);
  } catch (e) {
    report.status = 'error';
    report.error = errorMessage(e);
    const failures = (source.consecutive_failures ?? 0) + 1;
    const disable = failures >= AUTO_DISABLE_AFTER;
    await env.DB.prepare('UPDATE sources SET last_checked = ?, last_error = ?, last_error_at = ?, consecutive_failures = ?, enabled = CASE WHEN ? THEN 0 ELSE enabled END WHERE id = ?')
      .bind(nowIso(), report.error, nowIso(), failures, disable ? 1 : 0, source.id).run();
    if (disable) report.disabled = true;
    await finishLog(env, logId, report, e.status ?? null, report.error);
  }
  return report;
}

function errorMessage(e) {
  if (e instanceof FetchError || e instanceof FeedError) return `${e.code ?? 'feed'}: ${e.message}`.slice(0, 300);
  console.error('ingestion error:', e);
  return 'unexpected: ingestion failed'.slice(0, 300);
}

async function finishLog(env, id, r, httpStatus, error) {
  await env.DB.prepare(
    `UPDATE ingestion_log SET finished_at = ?, status = ?, discovered_count = ?, new_count = ?, duplicate_count = ?, flagged_count = ?, filtered_count = ?, http_status = ?, error = ? WHERE id = ?`
  ).bind(nowIso(), r.status, r.new + r.duplicates + r.flagged + r.filtered, r.new, r.duplicates, r.flagged, r.filtered, httpStatus, error, id).run();
}

// One query per 80 feed items instead of one per item (D1 allows 100 bound parameters).
export async function knownUrls(env, items, defaults) {
  const urls = [];
  for (const i of items) {
    try { urls.push(canonicalizeUrl(i.link, { stripParams: defaults.strip_params ?? [] })); } catch { /* invalid links are counted later */ }
  }
  const known = new Set();
  if (!urls.length) return known;
  // One query with the list as JSON: D1 allows at most 100 bound parameters per query.
  const list = JSON.stringify([...new Set(urls)]);
  const rows = await env.DB.prepare(
    `SELECT canonical_url, url FROM resources WHERE canonical_url IN (SELECT value FROM json_each(?1)) OR url IN (SELECT value FROM json_each(?1))`
  ).bind(list).all();
  for (const r of rows.results) { if (r.canonical_url) known.add(r.canonical_url); known.add(r.url); }
  return known;
}

// Returns 'new' | 'flagged' | 'duplicates' | 'filtered' | 'invalid'.
export async function queueItem(env, source, defaults, hosts, item, { logId, now, known, method = 'feed', requireTitle = false }) {
  let canonical;
  try {
    canonical = canonicalizeUrl(item.link, { stripParams: defaults.strip_params ?? [] });
  } catch (e) {
    if (e instanceof UnsafeUrlError) return 'invalid';
    throw e;
  }
  if (!hostAllowed(hostOf(canonical), hosts)) return 'filtered'; // link points off the allowlisted site

  if (known.has(canonical)) return 'duplicates'; // exact URL already in Signal; no further queries needed

  const rel = relevance(item);
  if (source.require_match === 1 && !rel.relevant) return 'filtered';
  if (requireTitle && !titleMentionsAI(item.title)) return 'filtered'; // archives: only what triage could publish

  const doi = extractDoi(canonical);
  const { exact, flag } = await findDuplicates(env, { canonical, rawUrl: item.link, doi, title: item.title });
  if (exact) return 'duplicates';

  const audiences = defaults.audiences?.length ? defaults.audiences : [];
  const collections = defaults.collections ?? [];
  const legacy = legacyColumns(audiences, collections);
  const provenance = {
    method, source_id: source.id, source_name: source.name, feed_url: source.feed_url,
    guid: item.guid, discovered_url: item.link, matched_terms: rel.matched, ingestion_run: logId
  };
  const stamp = new Date(now).toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO resources(id, url, canonical_url, title, publisher, format, audience, collection_name, tags, audiences, collections, evidence_type,
         description, published_at, discovered_at, status, source_id, source_item_id, source_provenance, verification, verification_status,
         dup_key, doi, duplicate_of, duplicate_reason, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'indexed',?,?,?,?,'unverified',?,?,?,?,?,?)`
    ).bind(
      newId(), canonical, canonical, item.title, source.publisher, defaults.format || 'Article', legacy.audience, legacy.collection_name,
      JSON.stringify(defaults.topics ?? []), JSON.stringify(audiences), JSON.stringify(collections), defaults.evidence_type ?? null,
      defaults.store_excerpt ? item.excerpt : null, item.published_at, stamp, source.id, item.guid,
      JSON.stringify(provenance), 'Feed metadata; not yet reviewed', titleKey(item.title), doi,
      flag?.id ?? null, flag?.reason ?? null, stamp, stamp
    ).run();
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) return 'duplicates'; // concurrent run inserted the same URL
    throw e;
  }
  return flag ? 'flagged' : 'new';
}

// Sources that are verified, enabled and not checked recently.
export async function dueSources(env, { now = Date.now(), sourceId = null, force = false, limit = 5 } = {}) {
  const cutoff = new Date(now - MIN_RECHECK_MS).toISOString();
  const sql = `SELECT * FROM sources WHERE enabled = 1 AND review_status = 'verified' AND source_type = 'feed'
    ${sourceId ? 'AND id = ?' : ''} ${force ? '' : 'AND (last_checked IS NULL OR last_checked < ?)'} ORDER BY COALESCE(last_checked, '') LIMIT ${Number(limit) || 5}`;
  const binds = [];
  if (sourceId) binds.push(sourceId);
  if (!force) binds.push(cutoff);
  return (await env.DB.prepare(sql).bind(...binds).all()).results;
}

export async function runIngestion(env, opts = {}) {
  const sources = await dueSources(env, opts);
  const reports = [];
  for (const s of sources) reports.push(await ingestSource(env, s, opts));
  return reports;
}
