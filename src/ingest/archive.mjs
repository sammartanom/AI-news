// Back catalogue. A feed lists only a source's newest items, so a new source would otherwise
// start with ten or twenty entries. Sources whose archive can be paged are read one page per run:
//   wordpress  the feed URL with ?paged=2, 3, ... (WordPress returns 404 past the last page)
//   blogger    the Atom feed with start-index and max-results
//   substack   the publication's archive listing (/api/v1/archive), free posts only
// Every item goes through the same queue as feed items (allowlisted host, deduplication), and
// only items whose title mentions AI are queued, so the archive never floods the review queue.
// Set default_metadata.archive to one of the kinds above; archive_pages caps how far back to go.
import { safeFetch, FetchError } from './safe-fetch.mjs';
import { parseFeed, FeedError } from './feed.mjs';
import { queueItem, knownUrls } from './pipeline.mjs';
import { hostOf } from '../lib/url.mjs';
import { parseJsonArray, parseJsonObject, stripHtml } from '../lib/text.mjs';
import { newId, nowIso } from '../lib/ids.mjs';

export const ARCHIVE_KINDS = ['wordpress', 'blogger', 'substack'];
export const DEFAULT_ARCHIVE_PAGES = 30;
const BLOGGER_PAGE = 25;
const SUBSTACK_PAGE = 20; // Substack returns at most about 23 per request, whatever limit asks for

const fetchOf = (env) => env.__fetch ?? globalThis.fetch;

// page 0 is the first page after what the feed itself already shows.
export function archiveUrl(kind, feedUrl, page) {
  const u = new URL(feedUrl);
  if (kind === 'wordpress') { u.searchParams.set('paged', String(page + 2)); return u.toString(); }
  if (kind === 'blogger') {
    u.searchParams.set('start-index', String((page + 1) * BLOGGER_PAGE + 1));
    u.searchParams.set('max-results', String(BLOGGER_PAGE));
    return u.toString();
  }
  if (kind === 'substack') return `${u.origin}/api/v1/archive?sort=new&offset=${(page + 1) * SUBSTACK_PAGE}&limit=${SUBSTACK_PAGE}`; // the feed shows the first 20
  throw new Error(`Unknown archive kind "${kind}"`);
}

const isoDate = (v) => {
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};

// Substack's listing is JSON. Paid-only posts are skipped: visitors could not read them.
export function parseSubstackArchive(text) {
  let rows;
  try { rows = JSON.parse(text); } catch { throw new FeedError('Archive listing is not valid JSON'); }
  if (!Array.isArray(rows)) throw new FeedError('Archive listing is not a list');
  const items = [];
  let skipped = 0;
  for (const r of rows.slice(0, 100)) {
    const title = stripHtml(String(r?.title ?? ''), 300).trim();
    const link = typeof r?.canonical_url === 'string' ? r.canonical_url : null;
    if (!title || !link || (r.audience && r.audience !== 'everyone')) { skipped++; continue; }
    items.push({ title, link, guid: r.id ? String(r.id) : link, published_at: isoDate(r.post_date), excerpt: r.subtitle ? stripHtml(String(r.subtitle), 400) : null });
  }
  return { items, skipped, total: rows.length };
}

export async function archiveSource(env, source, { now = Date.now(), maxNew = 50 } = {}) {
  const defaults = parseJsonObject(source.default_metadata);
  const kind = defaults.archive;
  const report = { source: source.id, page: source.archive_page ?? 0, status: 'ok', new: 0, duplicates: 0, flagged: 0, filtered: 0, invalid: 0, done: false };
  if (!ARCHIVE_KINDS.includes(kind)) return { ...report, status: 'skipped' };
  const allowed = parseJsonArray(source.allowed_hosts);
  const hosts = allowed.length ? allowed : [hostOf(source.feed_url)];
  const url = archiveUrl(kind, source.feed_url, report.page);
  const logId = newId();
  await env.DB.prepare(`INSERT INTO ingestion_log(id, source_id, started_at, status) VALUES (?,?,?,'archive')`).bind(logId, source.id, nowIso()).run();

  let items = [];
  let httpStatus = 200;
  try {
    // The listing is fetched from the source's own site, so its host must be allowlisted too.
    const res = await safeFetch(url, {
      env, allowedHosts: [...hosts, hostOf(source.feed_url)], fetchImpl: fetchOf(env),
      allowedTypes: kind === 'substack' ? [/json/] : [/xml/, /rss/, /atom/],
      accept: kind === 'substack' ? 'application/json' : 'application/rss+xml, application/atom+xml, application/xml;q=0.9'
    });
    httpStatus = res.status ?? 200;
    const parsed = kind === 'substack' ? parseSubstackArchive(res.text) : parseFeed(res.text, { now });
    items = parsed.items;
    report.invalid = parsed.skipped;
  } catch (e) {
    // Past the last page WordPress answers 404; that is the end of the archive, not a failure.
    if (e instanceof FetchError && e.status === 404) { items = []; httpStatus = 404; }
    else {
      report.status = 'error';
      report.error = `${e.code ?? 'archive'}: ${e.message}`.slice(0, 300);
      // A page that arrives but cannot be parsed will not parse next time either: skip past it.
      // Network and server errors are tried again on the next run.
      if (e instanceof FeedError) report.skip = true;
    }
  }
  if (report.skip) {
    await env.DB.prepare('UPDATE sources SET archive_page = ? WHERE id = ?').bind(report.page + 1, source.id).run();
  }

  if (report.status === 'ok') {
    const known = await knownUrls(env, items, defaults);
    for (const item of items) {
      if (report.new + report.flagged >= maxNew) break;
      const outcome = await queueItem(env, source, defaults, hosts, item, { logId, now, known, method: 'archive', requireTitle: true });
      report[outcome] = (report[outcome] ?? 0) + 1;
    }
    const cap = Number(defaults.archive_pages) > 0 ? Number(defaults.archive_pages) : DEFAULT_ARCHIVE_PAGES;
    report.done = items.length === 0 || report.page + 1 >= cap;
    await env.DB.prepare('UPDATE sources SET archive_page = ?, archive_done_at = ? WHERE id = ?')
      .bind(report.page + 1, report.done ? nowIso() : null, source.id).run();
  }
  await env.DB.prepare(
    `UPDATE ingestion_log SET finished_at = ?, status = ?, discovered_count = ?, new_count = ?, duplicate_count = ?, flagged_count = ?, filtered_count = ?, http_status = ?, error = ? WHERE id = ?`
  ).bind(nowIso(), report.status === 'ok' ? 'archive' : 'archive_error', items.length, report.new, report.duplicates, report.flagged, report.filtered, httpStatus, report.error ?? null, logId).run();
  return report;
}

/**
 * One archive page for each of up to `pages` sources, oldest-walked first. Archive errors never
 * disable a source; the page is simply tried again next time.
 */
const ARCHIVE_REST_MS = 24 * 3600 * 1000;

export async function runArchive(env, { pages = 6, maxNew = 60, sourceId = null, now = Date.now() } = {}) {
  // Least recently tried first, so a source that keeps failing cannot take every slot. A source
  // whose last archive page failed (a site that rate-limits us, say) rests for a day.
  const restUntil = new Date(now - ARCHIVE_REST_MS).toISOString();
  const rows = (await env.DB.prepare(
    `SELECT s.*,
       (SELECT max(started_at) FROM ingestion_log l WHERE l.source_id = s.id AND l.status IN ('archive', 'archive_error')) AS archive_tried,
       (SELECT max(started_at) FROM ingestion_log l WHERE l.source_id = s.id AND l.status = 'archive_error') AS archive_failed,
       (SELECT max(started_at) FROM ingestion_log l WHERE l.source_id = s.id AND l.status = 'archive') AS archive_ok
     FROM sources s WHERE enabled = 1 AND review_status = 'verified' AND source_type = 'feed' AND archive_done_at IS NULL
       AND json_extract(default_metadata, '$.archive') IS NOT NULL ${sourceId ? 'AND id = ?' : ''}
       AND (archive_failed IS NULL OR archive_ok > archive_failed OR archive_failed < ? ${sourceId ? 'OR 1' : ''})
     ORDER BY archive_tried IS NOT NULL, archive_tried, archive_page, id LIMIT ?`
  ).bind(...(sourceId ? [sourceId] : []), restUntil, pages).all()).results;
  const reports = [];
  let budget = maxNew;
  for (const s of rows) {
    if (budget <= 0) break;
    const r = await archiveSource(env, s, { now, maxNew: budget });
    budget -= r.new + r.flagged;
    reports.push(r);
  }
  return reports;
}
