import { toPublic, publishedByIds, getRow } from '../repo/resources.mjs';
import { relationName } from '../lib/taxonomy.mjs';
import { keywordSearch } from '../search/keyword.mjs';
import { parseJsonArray } from '../lib/text.mjs';

export const DEFAULT_RELATED_MIN_SCORE = 0.6;

// Label for a similarity-based neighbor. It describes the neighbor itself (its own type and
// dates). It never claims agreement or disagreement with the base resource.
export function labelNeighbor(base, neighbor) {
  if (base.published_at && neighbor.published_at && neighbor.published_at > base.published_at) return 'Newer';
  if (['research', 'research_summary', 'survey_data'].includes(neighbor.evidence_type)) return 'Research';
  if (['classroom_example', 'lesson_resource'].includes(neighbor.evidence_type)) return 'Practical example';
  return 'Related';
}

export async function relatedFor(env, id, { limit = 8 } = {}) {
  const base = await getRow(env, id);
  if (!base || base.status !== 'published') return null;

  // Editor-selected relationships. "companion" is symmetric, so it is also read in reverse.
  const curatedRows = (await env.DB.prepare(
    `SELECT * FROM (
       SELECT rr.rowid AS rel_order, rr.relation, rr.note, r.* FROM resource_relations rr JOIN resources r ON r.id = rr.to_id
       WHERE rr.from_id = ?1 AND r.status = 'published'
       UNION ALL
       SELECT rr.rowid AS rel_order, rr.relation, rr.note, r.* FROM resource_relations rr JOIN resources r ON r.id = rr.from_id
       WHERE rr.to_id = ?1 AND rr.relation = 'companion' AND r.status = 'published'
     ) ORDER BY rel_order`
  ).bind(id).all()).results;
  const seen = new Set([id]);
  const curated = [];
  for (const row of curatedRows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    curated.push({ relation: row.relation, label: relationName(row.relation), note: row.note ?? null, resource: toPublic(row) });
  }

  // Similar resources: vector neighbors when available, keyword neighbors otherwise.
  let neighbors = [];
  let via = 'keyword';
  const minScore = Number(env.RELATED_MIN_SCORE) || DEFAULT_RELATED_MIN_SCORE;
  if (env.VECTORIZE?.queryById) {
    try {
      const res = await env.VECTORIZE.queryById(id, { topK: limit + 8, returnValues: false, returnMetadata: 'none' });
      const ids = (res?.matches ?? []).filter((m) => m.id !== id && m.score >= minScore).map((m) => m.id);
      neighbors = await publishedByIds(env, ids, { rawRows: true });
      via = 'semantic';
    } catch (e) {
      console.error('related vector lookup failed:', e.message);
    }
  }
  if (via === 'keyword') {
    const q = [base.title, ...parseJsonArray(base.tags)].join(' ');
    neighbors = (await keywordSearch(env, q, {}, limit + 8)).filter((r) => r.id !== id);
  }
  const similar = [];
  for (const row of neighbors) {
    if (seen.has(row.id) || similar.length >= limit) continue;
    seen.add(row.id);
    similar.push({ label: labelNeighbor(base, row), via, resource: toPublic(row) });
  }
  return { curated, similar };
}
