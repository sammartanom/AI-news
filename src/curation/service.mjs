import { HttpError } from '../lib/http.mjs';
import { canonicalizeUrl, extractDoi, UnsafeUrlError } from '../lib/url.mjs';
import { titleKey } from '../lib/text.mjs';
import { newId, nowIso } from '../lib/ids.mjs';
import { cleanResourceInput, requirePublishable } from '../lib/validate.mjs';
import { RELATIONS } from '../lib/taxonomy.mjs';
import { getRow, toEditor } from '../repo/resources.mjs';
import { legacyColumns } from '../repo/legacy.mjs';
import { audit } from '../repo/audit.mjs';
import { findDuplicates } from '../ingest/dedupe.mjs';
import { indexResource, removeFromIndex } from '../search/embedding.mjs';
import { parseJsonArray } from '../lib/text.mjs';
import { retagResource } from '../discovery/tagging.mjs';

const TEXT_COLUMNS = [
  'title', 'publisher', 'author', 'format', 'evidence_type', 'why', 'best_for', 'editorial_note', 'description', 'summary',
  'verification', 'language', 'rejected_reason', 'published_at', 'reading_minutes', 'verification_status', 'link_status', 'editorial_priority', 'status_checked_at'
];
const BOOL_COLUMNS = ['summary_generated', 'summary_approved', 'featured', 'duplicate_dismissed'];
const JSON_COLUMNS = { audiences: 'audiences', collections: 'collections', topics: 'tags', grade_bands: 'grade_bands', subjects: 'subjects' };
// Fields that change what is embedded or keyword-indexed.
const INDEXED_FIELDS = new Set(['title', 'publisher', 'summary', 'summary_approved', 'editorial_note', 'why', 'best_for', 'format', 'evidence_type', 'audiences', 'collections', 'topics', 'grade_bands', 'subjects']);

async function mustGet(env, id) {
  const row = await getRow(env, id);
  if (!row) throw new HttpError(404, 'Resource not found');
  return row;
}

// Vector indexing never blocks a curation decision. Failures are reported to the editor and
// retried by backfill (publish) or reconcileRemovals (reject / unpublish).
async function tryIndex(env, id) {
  try {
    const fresh = await getRow(env, id);
    const r = await indexResource(env, fresh);
    return r.indexed ? { ok: true } : { ok: false, reason: r.reason };
  } catch (e) {
    console.error('indexing failed:', id, e.message);
    await env.DB.prepare('UPDATE resources SET embedding_hash = NULL WHERE id = ?').bind(id).run();
    return { ok: false, reason: 'failed' };
  }
}

async function tryRemove(env, id) {
  try {
    const r = await removeFromIndex(env, id);
    return r.removed ? { ok: true } : { ok: false, reason: r.reason };
  } catch (e) {
    console.error('vector removal failed:', id, e.message);
    return { ok: false, reason: 'failed' };
  }
}

export async function publishResource(env, id, actor) {
  const row = await mustGet(env, id);
  requirePublishable(row);
  const now = nowIso();
  await env.DB.prepare(
    `UPDATE resources SET status = 'published', auto_published = 0, auto_hold = NULL, reviewed_at = ?, reviewed_by = ?, added_at = COALESCE(added_at, ?), rejected_reason = NULL, updated_at = ? WHERE id = ?`
  ).bind(now, actor, now, now, id).run();
  await audit(env, actor, 'publish', 'resource', id);
  const indexing = await tryIndex(env, id);
  return { resource: toEditor(await getRow(env, id)), indexing };
}

export async function rejectResource(env, id, actor, reason = null) {
  await mustGet(env, id);
  const now = nowIso();
  await env.DB.prepare(
    `UPDATE resources SET status = 'rejected', featured = 0, reviewed_at = ?, reviewed_by = ?, rejected_reason = ?, updated_at = ? WHERE id = ?`
  ).bind(now, actor, reason ? String(reason).slice(0, 300) : null, now, id).run();
  await audit(env, actor, 'reject', 'resource', id, reason ? { reason } : null);
  const indexing = await tryRemove(env, id);
  return { resource: toEditor(await getRow(env, id)), indexing };
}

// Undoes a removal: a rejected resource goes back to where it was (published or the queue),
// keeping how it was published (curated or automatic).
export async function restoreResource(env, id, actor, to = 'published') {
  const row = await mustGet(env, id);
  if (row.status !== 'rejected') return { resource: toEditor(row), indexing: { ok: true } };
  const status = to === 'indexed' ? 'indexed' : 'published';
  // No publishability check: an automatic item was live without a reason, and undo puts it back as it was.
  const now = nowIso();
  await env.DB.prepare(`UPDATE resources SET status = ?, rejected_reason = NULL, added_at = COALESCE(added_at, ?), updated_at = ? WHERE id = ?`).bind(status, now, now, id).run();
  await audit(env, actor, 'restore', 'resource', id, { to: status });
  const indexing = status === 'published' ? await tryIndex(env, id) : { ok: true };
  return { resource: toEditor(await getRow(env, id)), indexing };
}

// Takes a published resource back to the review queue.
export async function unpublishResource(env, id, actor) {
  await mustGet(env, id);
  const now = nowIso();
  await env.DB.prepare(`UPDATE resources SET status = 'indexed', featured = 0, updated_at = ? WHERE id = ?`).bind(now, id).run();
  await audit(env, actor, 'unpublish', 'resource', id);
  const indexing = await tryRemove(env, id);
  return { resource: toEditor(await getRow(env, id)), indexing };
}

export async function updateResource(env, id, rawPatch, actor) {
  const row = await mustGet(env, id);
  const patch = cleanResourceInput(rawPatch);
  const sets = [];
  const vals = [];
  const set = (col, v) => { sets.push(`${col} = ?`); vals.push(v); };

  for (const k of TEXT_COLUMNS) if (k in patch) set(k, patch[k]);
  for (const k of BOOL_COLUMNS) if (k in patch) set(k, patch[k] ? 1 : 0);
  for (const [k, col] of Object.entries(JSON_COLUMNS)) if (k in patch) set(col, JSON.stringify(patch[k]));
  if ('topics' in patch && JSON.stringify(patch.topics) !== JSON.stringify(parseJsonArray(row.tags))) set('topics_auto', 0); // an editor's topics are never replaced by the rules

  // A summary is only used publicly (display, search, embeddings, answers) once approved.
  // Empty summaries cannot be approved, and edited text needs approving again.
  const summary = 'summary' in patch ? patch.summary : row.summary;
  if (patch.summary_approved && !summary) throw new HttpError(422, 'Add a summary before approving it', { field: 'summary_approved' });
  if ('summary' in patch && !('summary_approved' in patch) && row.summary !== patch.summary) set('summary_approved', 0);

  if (patch.featured && row.status !== 'published') throw new HttpError(422, 'Only published resources can be featured', { field: 'featured' });

  if ('url' in patch) {
    let canonical;
    try { canonical = canonicalizeUrl(patch.url); } catch (e) {
      if (e instanceof UnsafeUrlError) throw new HttpError(400, `url: ${e.message}`, { field: 'url' });
      throw e;
    }
    const clash = await env.DB.prepare('SELECT id FROM resources WHERE (canonical_url = ? OR url = ?) AND id != ?').bind(canonical, canonical, id).first();
    if (clash) throw new HttpError(409, 'Another resource already uses this URL', { existing_id: clash.id });
    set('url', canonical);
    set('canonical_url', canonical);
    set('doi', extractDoi(canonical));
    set('link_status', 'unchecked');
    set('last_link_check', null);
    if (canonical !== row.url) { set('ai_brief', null); set('ai_brief_basis', null); set('ai_brief_at', null); } // a new page needs a new brief
  }
  if ('title' in patch) set('dup_key', titleKey(patch.title));
  if ('audiences' in patch || 'collections' in patch) {
    const legacy = legacyColumns(patch.audiences ?? JSON.parse(row.audiences), patch.collections ?? JSON.parse(row.collections));
    set('audience', legacy.audience);
    set('collection_name', legacy.collection_name);
  }
  if (!sets.length) return { resource: toEditor(row), indexing: null };

  // A published record must stay publishable.
  if (row.status === 'published') {
    requirePublishable({ ...row, ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, Array.isArray(v) ? JSON.stringify(v) : v])) });
  }
  set('updated_at', nowIso());
  await env.DB.prepare(`UPDATE resources SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
  await audit(env, actor, 'update', 'resource', id, { fields: Object.keys(patch) });

  let indexing = null;
  if (row.status === 'published' && Object.keys(patch).some((k) => INDEXED_FIELDS.has(k))) indexing = await tryIndex(env, id);
  return { resource: toEditor(await getRow(env, id)), indexing };
}

// Editor adds a resource by hand. It enters the queue like any other discovery.
export async function createManual(env, body, actor) {
  const input = cleanResourceInput(body);
  for (const f of ['url', 'title', 'publisher']) if (!input[f]) throw new HttpError(400, `${f} is required`, { field: f });
  const canonical = canonicalizeUrl(input.url);
  const doi = extractDoi(canonical);
  const { exact, flag } = await findDuplicates(env, { canonical, rawUrl: input.url, doi, title: input.title });
  if (exact) throw new HttpError(409, 'This URL is already in the collection', { existing_id: exact.id, existing_status: exact.status });
  const audiences = input.audiences ?? [];
  const collections = input.collections ?? [];
  const legacy = legacyColumns(audiences, collections);
  const id = newId();
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO resources(id, url, canonical_url, title, publisher, author, format, evidence_type, audience, collection_name, audiences, collections, tags, grade_bands, subjects,
       why, best_for, editorial_note, description, published_at, language, discovered_at, status, source_provenance, verification, verification_status, dup_key, doi,
       duplicate_of, duplicate_reason, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'indexed',?,?,'unverified',?,?,?,?,?,?)`
  ).bind(
    id, canonical, canonical, input.title, input.publisher, input.author ?? null, input.format ?? 'Article', input.evidence_type ?? null, legacy.audience, legacy.collection_name,
    JSON.stringify(audiences), JSON.stringify(collections), JSON.stringify(input.topics ?? []), JSON.stringify(input.grade_bands ?? []), JSON.stringify(input.subjects ?? []),
    input.why ?? null, input.best_for ?? null, input.editorial_note ?? null, input.description ?? null, input.published_at ?? null, input.language ?? null, now,
    JSON.stringify({ method: 'editor', added_by: actor }), input.verification ?? 'Added by an editor; not yet reviewed', titleKey(input.title), doi,
    flag?.id ?? null, flag?.reason ?? null, now, now
  ).run();
  await audit(env, actor, 'create', 'resource', id);
  return toEditor(await getRow(env, id));
}

export async function addRelation(env, fromId, body, actor) {
  const relation = String(body.relation ?? '');
  if (!RELATIONS.some((r) => r.slug === relation)) throw new HttpError(400, 'relation is not allowed', { field: 'relation' });
  const toId = String(body.to_id ?? '');
  if (toId === fromId) throw new HttpError(400, 'A resource cannot relate to itself');
  await mustGet(env, fromId);
  await mustGet(env, toId);
  const note = body.note ? String(body.note).slice(0, 200) : null;
  await env.DB.prepare(
    `INSERT INTO resource_relations(id, from_id, to_id, relation, note, created_by, created_at) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(from_id, to_id, relation) DO UPDATE SET note = excluded.note`
  ).bind(newId(), fromId, toId, relation, note, actor, nowIso()).run();
  await audit(env, actor, 'relate', 'resource', fromId, { to: toId, relation });
}

export async function removeRelation(env, fromId, relationId, actor) {
  await env.DB.prepare('DELETE FROM resource_relations WHERE id = ? AND from_id = ?').bind(relationId, fromId).run();
  await audit(env, actor, 'unrelate', 'resource', fromId, { relation_id: relationId });
}

export async function listRelations(env, id) {
  return (await env.DB.prepare(
    `SELECT rr.id, rr.relation, rr.note, r.id AS to_id, r.title, r.publisher, r.status FROM resource_relations rr JOIN resources r ON r.id = rr.to_id WHERE rr.from_id = ? ORDER BY rr.created_at`
  ).bind(id).all()).results;
}

/**
 * Publishes an item found by a trusted source, as "indexed": public and labelled as not reviewed.
 * It records how the decision was made. Metadata a model suggested is applied only where the
 * record has none (source defaults win), and never touches why, summary, dates or author.
 */
export async function autoPublishResource(env, id, assessment, suggestion = null) {
  const row = await mustGet(env, id);
  const sets = [];
  const vals = [];
  const applied = [];
  const fill = (col, current, suggested, key) => {
    const has = Array.isArray(current) ? current.length > 0 : Boolean(current);
    if (!has && suggested && (!Array.isArray(suggested) || suggested.length)) {
      sets.push(`${col} = ?`);
      vals.push(Array.isArray(suggested) ? JSON.stringify(suggested) : suggested);
      applied.push(key);
    }
  };
  const audiences = parseJsonArray(row.audiences);
  const collections = parseJsonArray(row.collections);
  fill('audiences', audiences, suggestion?.audiences, 'audiences');
  fill('collections', collections, suggestion?.collections, 'collections');
  fill('evidence_type', row.evidence_type, suggestion?.evidence_type, 'evidence_type');
  fill('grade_bands', parseJsonArray(row.grade_bands), suggestion?.grade_bands, 'grade_bands');
  if (parseJsonArray(row.tags).length === 0 && suggestion?.topics?.length) { sets.push('tags = ?'); vals.push(JSON.stringify(suggestion.topics)); applied.push('topics'); }
  const finalAud = audiences.length ? audiences : suggestion?.audiences?.length ? suggestion.audiences : ['Everyone'];
  if (!audiences.length && !suggestion?.audiences?.length) { sets.push('audiences = ?'); vals.push(JSON.stringify(finalAud)); applied.push('audiences (default: Everyone)'); }
  const finalCols = collections.length ? collections : suggestion?.collections ?? [];
  const legacy = legacyColumns(finalAud, finalCols);
  const now = nowIso();
  await env.DB.prepare(
    `UPDATE resources SET status = 'published', auto_published = 1, auto_published_at = ?, added_at = COALESCE(added_at, ?), auto_assessment = ?, audience = ?, collection_name = ?, updated_at = ?${sets.length ? ', ' + sets.join(', ') : ''} WHERE id = ?`
  ).bind(now, now, JSON.stringify({ ...assessment, applied }), legacy.audience, legacy.collection_name, now, ...vals, id).run();
  await audit(env, 'triage', 'auto_publish', 'resource', id, { mode: assessment.mode });
  await retagResource(env, id); // topics (and a collection, if none) from the rules, before indexing
  await tryIndex(env, id);
  return toEditor(await getRow(env, id));
}

/** Pulls an automatically published item back to the queue (for example, its link broke). */
export async function holdResource(env, id, reason, actor = 'triage') {
  const now = nowIso();
  await env.DB.prepare(`UPDATE resources SET status = 'indexed', auto_published = 0, auto_hold = ?, featured = 0, updated_at = ? WHERE id = ?`).bind(reason, now, id).run();
  await audit(env, actor, 'hold', 'resource', id, { reason });
  await tryRemove(env, id);
}

/** An editor looked at an automatic item and left it as it is. */
export async function spotCheckResource(env, id, actor) {
  await mustGet(env, id);
  await env.DB.prepare('UPDATE resources SET spot_checked_at = ? WHERE id = ?').bind(nowIso(), id).run();
  await audit(env, actor, 'spot_check', 'resource', id);
}
