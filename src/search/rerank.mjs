// Cross-encoder reranking. The reranker reads the question next to each candidate's title,
// publisher and description and scores how well they match, which catches relevance that word
// overlap and vector distance miss. Optional: on failure or timeout the fused order stands.
import { parseJsonArray } from '../lib/text.mjs';

export const rerankModel = (env) => (env.AI && env.RERANK_MODEL ? env.RERANK_MODEL : null);
export const RERANK_TOP = 40;
const TIMEOUT_MS = 2500;

export function rerankText(row) {
  return [
    row.title,
    row.publisher ? `Publisher: ${row.publisher}` : null,
    row.format ? `Type: ${row.format}` : null,
    row.summary && row.summary_approved === 1 ? row.summary : null,
    row.why,
    row.description,
    parseJsonArray(row.tags).length ? `Topics: ${parseJsonArray(row.tags).join(', ')}` : null
  ].filter(Boolean).join('\n').slice(0, 900);
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

// Returns Map(id -> relevance in 0..1), or null when reranking is unavailable.
export async function rerank(env, q, rows) {
  const model = rerankModel(env);
  if (!model || !rows.length) return null;
  try {
    const out = await Promise.race([
      env.AI.run(model, { query: q.slice(0, 300), contexts: rows.map((r) => ({ text: rerankText(r) })) }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS))
    ]);
    const list = Array.isArray(out?.response) ? out.response : Array.isArray(out?.data) ? out.data : null;
    if (!list) return null;
    const scores = new Map();
    for (const x of list) {
      const i = Number(x?.id ?? x?.index);
      const s = Number(x?.score);
      if (!Number.isInteger(i) || i < 0 || i >= rows.length || !Number.isFinite(s)) continue;
      scores.set(rows[i].id, s >= 0 && s <= 1 ? s : sigmoid(s));
    }
    return scores.size ? scores : null;
  } catch (e) {
    console.error('rerank failed:', e.message);
    return null;
  }
}
