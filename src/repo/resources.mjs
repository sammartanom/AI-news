import { parseJsonArray } from '../lib/text.mjs';
import { collectionName, evidenceName, KINDS, TOPICS, topicName } from '../lib/taxonomy.mjs';

export const SORTS = {
  // Editors' picks first (featured, then chosen by hand or reviewed), each group newest first.
  recommended: 'r.featured DESC, (r.source_id IS NULL OR r.auto_published = 0) DESC, r.published_at IS NULL, r.published_at DESC, r.added_at DESC, r.title COLLATE NOCASE',
  newest: 'r.published_at IS NULL, r.published_at DESC, r.added_at DESC, r.title COLLATE NOCASE',
  added: 'r.added_at DESC, r.title COLLATE NOCASE',
  publisher: 'r.publisher COLLATE NOCASE, r.title COLLATE NOCASE',
  format: 'r.format COLLATE NOCASE, r.title COLLATE NOCASE',
  title: 'r.title COLLATE NOCASE'
};

export function curationOf(row) {
  if (row.status === 'rejected') return 'rejected';
  if (row.status !== 'published') return 'indexed';
  if (row.auto_published === 1) return 'indexed'; // public, found automatically, not reviewed by an editor
  return row.featured ? 'featured' : 'curated';
}

function arrays(row) {
  return {
    audiences: parseJsonArray(row.audiences),
    collections: parseJsonArray(row.collections),
    topics: parseJsonArray(row.tags),
    grade_bands: parseJsonArray(row.grade_bands),
    subjects: parseJsonArray(row.subjects)
  };
}

// Public shape. Internal pipeline fields (provenance, reviewer, duplicate flags, embedding state)
// are never included. A summary is shown only after an editor has approved it.
export function toPublic(row) {
  if (!row) return null;
  const a = arrays(row);
  const showSummary = row.summary && row.summary_approved === 1;
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    publisher: row.publisher,
    author: row.author ?? null,
    format: row.format,
    evidence_type: row.evidence_type ?? null,
    evidence_label: row.evidence_type ? evidenceName(row.evidence_type) : null,
    ...a,
    collection_labels: a.collections.map(collectionName),
    topic_labels: a.topics.map(topicName),
    language: row.language ?? null,
    reading_minutes: row.reading_minutes ?? null,
    why: row.why ?? null,
    best_for: row.best_for ?? null,
    editorial_note: row.editorial_note ?? null,
    description: row.description ?? null,
    summary: showSummary ? row.summary : null,
    summary_generated: showSummary ? row.summary_generated === 1 : false,
    brief: row.ai_brief ?? null, // AI-written description; see src/discovery/brief.mjs
    brief_basis: row.ai_brief ? row.ai_brief_basis : null, // 'page' or 'listing'
    published_at: row.published_at ?? null, // original publication date; null means unknown
    status_checked_at: row.status_checked_at ?? null, // laws and trackers: when their status was last confirmed
    added_at: row.added_at ?? null, // date added to Signal
    verification_status: row.verification_status,
    link_status: row.link_status,
    featured: row.featured === 1,
    curation: curationOf(row),
    reviewed: row.auto_published !== 1, // false means no editor has reviewed it
    hand_picked: !row.source_id, // added by hand after checking the page, not taken from a feed
    pick: !row.source_id || row.auto_published !== 1 // an editor's pick: chosen by hand or reviewed; shown first
  };
}

export function toEditor(row) {
  if (!row) return null;
  return {
    ...toPublic({ ...row, summary_approved: 1 }),
    summary: row.summary ?? null,
    summary_approved: row.summary_approved === 1,
    summary_generated: row.summary_generated === 1,
    status: row.status,
    canonical_url: row.canonical_url,
    doi: row.doi,
    verification: row.verification,
    discovered_at: row.discovered_at,
    reviewed_at: row.reviewed_at,
    reviewed_by: row.reviewed_by,
    editorial_priority: row.editorial_priority,
    source_id: row.source_id,
    source_provenance: safeJson(row.source_provenance),
    duplicate_of: row.duplicate_of,
    duplicate_reason: row.duplicate_reason,
    duplicate_dismissed: row.duplicate_dismissed === 1,
    rejected_reason: row.rejected_reason,
    embedding_model: row.embedding_model,
    embedding_version: row.embedding_version,
    embedded_at: row.embedded_at,
    last_link_check: row.last_link_check,
    link_http_status: row.link_http_status,
    updated_at: row.updated_at,
    auto_published: row.auto_published === 1,
    auto_published_at: row.auto_published_at,
    auto_assessment: safeJson(row.auto_assessment),
    auto_hold: row.auto_hold,
    spot_checked_at: row.spot_checked_at
  };
}

function safeJson(s) {
  try { return s ? JSON.parse(s) : null; } catch { return null; }
}

const member = (col) => `EXISTS (SELECT 1 FROM json_each(r.${col}) j WHERE j.value = ?)`;

// Builds WHERE fragments for the public filters. Only published rows are ever selectable here.
export function buildFilters(f = {}, { alias = 'r' } = {}) {
  const where = [`${alias}.status = 'published'`];
  const params = [];
  if (f.audience && f.audience !== 'Everyone') {
    where.push(`EXISTS (SELECT 1 FROM json_each(r.audiences) j WHERE j.value IN (?, 'Everyone'))`);
    params.push(f.audience);
  }
  if (f.collection) { where.push(member('collections')); params.push(f.collection); }
  if (f.topic) { where.push(member('tags')); params.push(f.topic); }
  if (f.grade) { where.push(member('grade_bands')); params.push(f.grade); }
  if (f.subject) { where.push(member('subjects')); params.push(f.subject); }
  if (f.format) { where.push('r.format = ? COLLATE NOCASE'); params.push(f.format); }
  if (f.kind) {
    const kind = KINDS.find((k) => k.slug === f.kind);
    if (kind?.slug === 'articles') {
      // Articles, plus any format that no other kind claims.
      const others = KINDS.filter((k) => k.slug !== 'articles').flatMap((k) => k.formats);
      where.push(`COALESCE(r.format, '') COLLATE NOCASE NOT IN (${others.map(() => '?').join(',')})`);
      params.push(...others);
    } else if (kind) {
      where.push(`r.format COLLATE NOCASE IN (${kind.formats.map(() => '?').join(',')})`);
      params.push(...kind.formats);
    }
  }
  if (f.evidence) { where.push('r.evidence_type = ?'); params.push(f.evidence); }
  if (f.publisher) { where.push('r.publisher = ? COLLATE NOCASE'); params.push(f.publisher); }
  if (f.featured) where.push('r.featured = 1');
  if (f.reviewed) where.push('(r.source_id IS NULL OR r.auto_published = 0)'); // editors' picks only: chosen by hand or reviewed
  if (f.dated) where.push('r.published_at IS NOT NULL');
  if (f.added_since) { where.push('r.added_at >= ?'); params.push(f.added_since); }
  return { where, params };
}

export async function listPublished(env, { filters = {}, sort = 'newest', limit = 24, offset = 0 } = {}) {
  const { where, params } = buildFilters(filters);
  const order = SORTS[sort] ?? SORTS.newest;
  const sql = `SELECT r.* FROM resources r WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`;
  const [rows, total] = await Promise.all([
    env.DB.prepare(sql).bind(...params, limit, offset).all(),
    env.DB.prepare(`SELECT count(*) AS n FROM resources r WHERE ${where.join(' AND ')}`).bind(...params).first('n')
  ]);
  return { resources: rows.results.map(toPublic), total };
}

// Returns published rows for the given ids, in the order given. Anything not published is dropped.
export async function publishedByIds(env, ids, { rawRows = false } = {}) {
  if (!ids.length) return [];
  const out = new Map();
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const ph = chunk.map(() => '?').join(',');
    const res = await env.DB.prepare(`SELECT * FROM resources WHERE status = 'published' AND id IN (${ph})`).bind(...chunk).all();
    for (const r of res.results) out.set(r.id, r);
  }
  return ids.filter((id) => out.has(id)).map((id) => (rawRows ? out.get(id) : toPublic(out.get(id))));
}

export const getRow = (env, id) => env.DB.prepare('SELECT * FROM resources WHERE id = ?').bind(id).first();

export async function getPublished(env, id) {
  const row = await env.DB.prepare(`SELECT * FROM resources WHERE id = ? AND status = 'published'`).bind(id).first();
  return row ? toPublic(row) : null;
}

export async function facets(env) {
  const q = (sql) => env.DB.prepare(sql).all().then((r) => r.results);
  const [formats, audiences, collections, evidence, grades, topics, publishers] = await Promise.all([
    q(`SELECT format AS value, count(*) AS n FROM resources WHERE status='published' GROUP BY format ORDER BY n DESC, format`),
    q(`SELECT j.value AS value, count(*) AS n FROM resources r, json_each(r.audiences) j WHERE r.status='published' GROUP BY j.value`),
    q(`SELECT j.value AS value, count(*) AS n FROM resources r, json_each(r.collections) j WHERE r.status='published' GROUP BY j.value`),
    q(`SELECT evidence_type AS value, count(*) AS n FROM resources WHERE status='published' AND evidence_type IS NOT NULL GROUP BY evidence_type`),
    q(`SELECT j.value AS value, count(*) AS n FROM resources r, json_each(r.grade_bands) j WHERE r.status='published' GROUP BY j.value`),
    q(`SELECT j.value AS value, count(*) AS n FROM resources r, json_each(r.tags) j WHERE r.status='published' GROUP BY j.value ORDER BY n DESC LIMIT 60`),
    q(`SELECT publisher AS value, count(*) AS n FROM resources WHERE status='published' GROUP BY publisher ORDER BY n DESC, publisher LIMIT 100`)
  ]);
  const total = await env.DB.prepare(`SELECT count(*) AS n FROM resources WHERE status='published'`).first('n');
  return {
    total,
    formats,
    audiences,
    collections: collections.map((c) => ({ ...c, label: collectionName(c.value) })),
    evidence: evidence.map((e) => ({ ...e, label: evidenceName(e.value) })),
    grades,
    // Only topics from the topic list are offered as filters, under their names.
    topics: topics.filter((t) => TOPICS.some((x) => x.slug === t.value)).map((t) => ({ ...t, label: topicName(t.value) })),
    publishers
  };
}
