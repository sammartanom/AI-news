// Single definition of how Signal embeds text. Indexing and querying both go through here, so
// the model and pooling cannot drift apart. If any of these values change, bump `version`;
// backfill() then re-embeds every record whose stored embedding_version differs.
import { sha256Hex, parseJsonArray } from '../lib/text.mjs';
import { evidenceName, collectionName } from '../lib/taxonomy.mjs';
import { nowIso } from '../lib/ids.mjs';

export const EMBEDDING = Object.freeze({
  model: '@cf/baai/bge-base-en-v1.5',
  pooling: 'mean',
  dimensions: 768,
  version: 'bge-base-en-v1.5/mean/text-v1'
});

export class EmbeddingError extends Error {}

// Text that represents a resource in the vector index. Fields are listed explicitly so private
// data (user notes, reviewer names, provenance) cannot be included by accident.
export function embeddingText(row) {
  const lines = [
    row.title,
    row.publisher,
    row.summary && row.summary_approved === 1 ? row.summary : null,
    row.editorial_note,
    row.why,
    row.best_for ? `Best for: ${row.best_for}` : null,
    row.format || row.evidence_type
      ? `Type: ${[row.format, row.evidence_type ? evidenceName(row.evidence_type) : null].filter(Boolean).join(', ')}`
      : null,
    parseJsonArray(row.audiences).length ? `Audience: ${parseJsonArray(row.audiences).join(', ')}` : null,
    parseJsonArray(row.collections).length ? `Collections: ${parseJsonArray(row.collections).map(collectionName).join(', ')}` : null,
    parseJsonArray(row.tags).length ? `Topics: ${parseJsonArray(row.tags).join(', ')}` : null,
    parseJsonArray(row.grade_bands).length ? `Grades: ${parseJsonArray(row.grade_bands).join(', ')}` : null,
    parseJsonArray(row.subjects).length ? `Subjects: ${parseJsonArray(row.subjects).join(', ')}` : null
  ];
  return lines.filter(Boolean).join('\n').slice(0, 2500);
}

export const semanticAvailable = (env) => Boolean(env.AI && env.VECTORIZE);

export async function embedTexts(env, texts) {
  if (!env.AI) throw new EmbeddingError('Workers AI binding is not configured');
  const out = [];
  for (let i = 0; i < texts.length; i += 20) {
    const batch = texts.slice(i, i + 20);
    const res = await env.AI.run(EMBEDDING.model, { text: batch, pooling: EMBEDDING.pooling });
    const data = res?.data;
    if (!Array.isArray(data) || data.length !== batch.length) throw new EmbeddingError('Unexpected embedding response');
    for (const v of data) {
      if (!Array.isArray(v) || v.length !== EMBEDDING.dimensions) throw new EmbeddingError(`Expected ${EMBEDDING.dimensions} dimensions`);
      out.push(v);
    }
  }
  return out;
}

export async function embedQuery(env, q) {
  const [v] = await embedTexts(env, [String(q).slice(0, 500)]);
  return v;
}

// Embeds a published resource and writes the vector. D1 records the embedding model, version and
// a hash of the exact text so the record can be re-embedded safely later.
export async function indexResource(env, row, { force = false } = {}) {
  if (!semanticAvailable(env)) return { indexed: false, reason: 'not_configured' };
  if (row.status !== 'published') return { indexed: false, reason: 'not_published' };
  const text = embeddingText(row);
  const hash = await sha256Hex(`${EMBEDDING.version}\n${text}`);
  if (!force && row.embedding_hash === hash && row.embedded_at) return { indexed: true, skipped: true };
  const [values] = await embedTexts(env, [text]);
  await env.VECTORIZE.upsert([{ id: row.id, values }]);
  await env.DB.prepare('UPDATE resources SET embedding_model = ?, embedding_version = ?, embedding_hash = ?, embedded_at = ? WHERE id = ?')
    .bind(EMBEDDING.model, EMBEDDING.version, hash, nowIso(), row.id).run();
  return { indexed: true };
}

// Removes the vector. The D1 row keeps embedded_at until deletion succeeds so that
// reconcileRemovals() can retry. Public queries also post-filter by D1 status, so a stale
// vector can never expose an unpublished record.
export async function removeFromIndex(env, id) {
  if (!env.VECTORIZE) return { removed: false, reason: 'not_configured' };
  await env.VECTORIZE.deleteByIds([id]);
  await env.DB.prepare('UPDATE resources SET embedded_at = NULL, embedding_hash = NULL WHERE id = ?').bind(id).run();
  return { removed: true };
}

export async function reconcileRemovals(env, { limit = 100 } = {}) {
  if (!env.VECTORIZE) return { removed: 0 };
  const rows = (await env.DB.prepare(`SELECT id FROM resources WHERE status != 'published' AND embedded_at IS NOT NULL LIMIT ?`).bind(limit).all()).results;
  let removed = 0;
  for (const { id } of rows) {
    try { await removeFromIndex(env, id); removed++; } catch (e) { console.error('vector removal failed', id, e.message); }
  }
  return { removed };
}

// Embeds published records that have no vector or were embedded with a different strategy.
export async function backfill(env, { limit = 50 } = {}) {
  if (!semanticAvailable(env)) return { indexed: 0, remaining: null, reason: 'not_configured' };
  const where = `status = 'published' AND (embedding_hash IS NULL OR embedded_at IS NULL OR embedding_version IS NOT ?)`;
  const rows = (await env.DB.prepare(`SELECT * FROM resources WHERE ${where} ORDER BY added_at LIMIT ?`).bind(EMBEDDING.version, limit).all()).results;
  if (!rows.length) return { indexed: 0, remaining: 0 };
  const texts = rows.map(embeddingText);
  const hashes = await Promise.all(texts.map((t) => sha256Hex(`${EMBEDDING.version}\n${t}`)));
  const vectors = await embedTexts(env, texts);
  await env.VECTORIZE.upsert(rows.map((r, i) => ({ id: r.id, values: vectors[i] })));
  const at = nowIso();
  await env.DB.batch(rows.map((r, i) =>
    env.DB.prepare('UPDATE resources SET embedding_model = ?, embedding_version = ?, embedding_hash = ?, embedded_at = ? WHERE id = ?')
      .bind(EMBEDDING.model, EMBEDDING.version, hashes[i], at, r.id)));
  const remaining = await env.DB.prepare(`SELECT count(*) AS n FROM resources WHERE ${where}`).bind(EMBEDDING.version).first('n');
  return { indexed: rows.length, remaining };
}
