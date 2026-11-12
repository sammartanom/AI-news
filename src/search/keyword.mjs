import { queryTerms, ftsQuote, words } from '../lib/text.mjs';
import { buildFilters } from '../repo/resources.mjs';
import { synonymsFor } from './synonyms.mjs';

// Builds an FTS5 MATCH expression: every term is a quoted literal (no operator injection),
// terms are OR-ed so natural-language questions still match, the full phrase is added so
// exact phrases rank higher, and education synonyms widen the net.
export function buildMatch(q) {
  const terms = queryTerms(q);
  if (!terms.length) return null;
  const unique = [...new Set(terms)].slice(0, 12);
  const parts = unique.map(ftsQuote);
  // Prefix forms catch partly typed or longer word forms ("assess" finds "assessments").
  for (const t of unique) if (t.length >= 4 && !/^\d+$/.test(t)) parts.push(`${ftsQuote(t)}*`);
  if (terms.length >= 2 && terms.length <= 6) parts.push(ftsQuote(terms.join(' ')));
  // Education synonyms ("cheating" also finds "academic integrity"), each as a phrase.
  for (const s of synonymsFor(q)) parts.push(ftsQuote(s));
  return parts.join(' OR ');
}

// Column weights follow the resources_fts column order: id, title, publisher, summary, why,
// best_for, editorial_note, tags, format, evidence_type.
const BM25 = 'bm25(resources_fts, 0, 10, 3, 3, 4, 2, 3, 6, 1, 1)';

export async function keywordSearch(env, q, filters = {}, limit = 60) {
  const match = buildMatch(q);
  if (!match) return [];
  const { where, params } = buildFilters(filters);
  const sql = `SELECT r.*, ${BM25} AS bm25_score FROM resources_fts JOIN resources r ON r.id = resources_fts.id
    WHERE resources_fts MATCH ? AND ${where.join(' AND ')} ORDER BY bm25_score LIMIT ?`;
  const res = await env.DB.prepare(sql).bind(match, ...params, limit).all();
  return res.results;
}

// Which query terms appear in which fields, for "why this matched".
export function matchedFields(row, q) {
  const terms = new Set(queryTerms(q).map((t) => t.replace(/(ing|es|s|ed)$/, '')));
  const fields = { title: row.title, publisher: row.publisher, 'topics': row.tags, 'editor note': row.why, 'best for': row.best_for, summary: row.summary_approved === 1 ? row.summary : null };
  const hits = [];
  for (const [name, value] of Object.entries(fields)) {
    if (!value) continue;
    const ws = words(value).map((w) => w.replace(/(ing|es|s|ed)$/, ''));
    const found = [...terms].filter((t) => ws.includes(t));
    if (found.length) hits.push({ field: name, terms: found });
  }
  return hits;
}
