import { keywordSearch, matchedFields } from './keyword.mjs';
import { embedQuery, semanticAvailable } from './embedding.mjs';
import { parseIntent } from './intent.mjs';
import { understandQuery } from './understand.mjs';
import { rerank, RERANK_TOP } from './rerank.mjs';
import { rrf, applySignals, diversify, WEIGHTS } from './rank.mjs';
import { buildFilters, toPublic } from '../repo/resources.mjs';

export const DEFAULT_SEMANTIC_MIN_SCORE = 0.5;
const POOL = 60;

// Vector candidates, restricted to records that are published right now according to D1.
async function semanticCandidates(env, q, filters, minScore) {
  const vector = await embedQuery(env, q);
  const res = await env.VECTORIZE.query(vector, { topK: POOL, returnValues: false, returnMetadata: 'none' });
  const matches = (res?.matches ?? []).filter((m) => m.score >= minScore);
  if (!matches.length) return { ordered: [], scores: new Map(), rows: [] };
  const ids = matches.map((m) => m.id);
  const { where, params } = buildFilters(filters);
  const ph = ids.map(() => '?').join(',');
  const rows = (await env.DB.prepare(`SELECT r.* FROM resources r WHERE ${where.join(' AND ')} AND r.id IN (${ph})`).bind(...params, ...ids).all()).results;
  const allowed = new Set(rows.map((r) => r.id));
  const scores = new Map(matches.map((m) => [m.id, m.score]));
  return { ordered: ids.filter((id) => allowed.has(id)), scores, rows };
}

/**
 * Hybrid retrieval: FTS5 keyword + Vectorize semantic, fused with reciprocal rank fusion, then
 * adjusted by editorial, audience, intent and freshness signals and diversified by publisher.
 * Semantic retrieval is optional: if it is unavailable the response still contains keyword results
 * and says so in `mode` and `degraded`.
 */
export async function hybridSearch(env, opts) {
  const { q, audience = 'Everyone', filters = {}, limit = 20, offset = 0, explain = false, now = Date.now(), allowSemantic = true } = opts;
  const intent = parseIntent(q);
  const minScore = Number(env.SEMANTIC_MIN_SCORE) || DEFAULT_SEMANTIC_MIN_SCORE;
  const rows = new Map();
  const lists = [];
  let degraded = null;
  const canSemantic = allowSemantic && semanticAvailable(env);
  if (!allowSemantic) degraded = 'semantic_skipped';
  else if (!semanticAvailable(env)) degraded = 'semantic_unavailable';

  const semantic = async (text) => {
    try { return await semanticCandidates(env, text, filters, minScore); } catch (e) { console.error('semantic search failed:', e.message); return null; }
  };
  // First pass, in parallel: keyword and vector search on the words as typed, and the model's
  // reading of the question. The AI steps share the semantic rate limit.
  const [keywordRows, sem, understood] = await Promise.all([
    keywordSearch(env, q, filters, POOL),
    canSemantic ? semantic(q) : null,
    allowSemantic ? understandQuery(env, q) : null
  ]);
  const add = (name, list, weight) => { for (const r of list.rows ?? list) if (!rows.has(r.id)) rows.set(r.id, r); lists.push({ name, ids: list.ordered ?? list.map((r) => r.id), weight }); };
  add('keyword', keywordRows, WEIGHTS.keyword);
  let semanticScores = new Map();
  if (sem) { add('semantic', sem, WEIGHTS.semantic); semanticScores = sem.scores; } else if (canSemantic) degraded = 'semantic_failed';

  // Second pass: the model's rewrite and alternative phrasings widen recall.
  if (understood) {
    const extra = [understood.rewrite, ...understood.expansions].filter(Boolean).join(' ');
    const [kw2, sem2] = await Promise.all([
      extra ? keywordSearch(env, extra, filters, POOL) : [],
      understood.rewrite && canSemantic ? semantic(understood.rewrite) : null
    ]);
    if (kw2.length) add('expanded', kw2, WEIGHTS.expanded);
    if (sem2) { add('rewrite', sem2, WEIGHTS.rewrite); for (const [id, sc] of sem2.scores) if (!semanticScores.has(id)) semanticScores.set(id, sc); }
    if (understood.audience && !intent.audiences.includes(understood.audience)) intent.audiences.push(understood.audience);
    if (understood.kind) intent.kinds = [understood.kind];
    if (understood.recent) intent.wantsRecent = true;
  }
  const mode = understood ? 'ai' : lists.some((l) => l.name === 'semantic') ? 'hybrid' : 'keyword';

  const fused = rrf(lists);
  let adjusted = applySignals(fused, rows, { audience, intent, now });

  // Reranking reads the question beside the top candidates and reorders them.
  let reranked = false;
  if (allowSemantic && adjusted.length > 1) {
    const top = adjusted.slice(0, RERANK_TOP);
    const scores = await rerank(env, understood?.rewrite || q, top.map((i) => rows.get(i.id)));
    if (scores) {
      reranked = true;
      const max = adjusted[0].score || 1;
      const w = WEIGHTS.rerank;
      adjusted = adjusted.map((item) => {
        const rr = scores.get(item.id);
        const base = (item.score / max) * (1 - w);
        return rr === undefined ? { ...item, score: base } : { ...item, score: base + w * rr, signals: [...item.signals, { type: 'ai', detail: `AI relevance ${rr.toFixed(2)}`, delta: w * rr }] };
      }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    }
  }
  const ordered = diversify(adjusted, rows);
  const page = ordered.slice(offset, offset + limit);

  const results = page.map((item) => {
    const row = rows.get(item.id);
    const out = { ...toPublic(row), score: Number(item.score.toFixed(4)) };
    if (explain) out.why_matched = explainMatch(row, item, q, semanticScores.get(item.id));
    return out;
  });
  return {
    query: q, mode, degraded, intent: intent.matched, total: ordered.length, offset, limit, results,
    ai: { understood: understood ? { rewrite: understood.rewrite, expansions: understood.expansions, audience: understood.audience, kind: understood.kind, recent: understood.recent } : null, reranked }
  };
}

function explainMatch(row, item, q, semScore) {
  const reasons = [];
  for (const h of matchedFields(row, q)) reasons.push({ type: 'keyword', text: `Matches ${h.field}: ${h.terms.join(', ')}` });
  if (item.ranks.expanded || item.ranks.rewrite) reasons.push({ type: 'ai', text: 'Found through the AI reading of the question' });
  if (item.ranks.semantic) reasons.push({ type: 'semantic', text: `Close in meaning to the question (similarity ${semScore?.toFixed(2)})` });
  for (const s of item.signals) reasons.push({ type: s.type, text: s.detail });
  if (item.diversity_rank_penalty) reasons.push({ type: 'diversity', text: 'Ranked slightly lower because the same publisher appears higher up' });
  if (!reasons.length) reasons.push({ type: 'keyword', text: 'Matches the search terms' });
  return reasons;
}
