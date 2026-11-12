// Pure ranking functions. No I/O, so each step can be tested on its own.
import { parseJsonArray } from '../lib/text.mjs';
import { kindOfFormat } from '../lib/taxonomy.mjs';

export const RRF_K = 60;

// Every tunable lives here. Values are starting points, not measured optima.
export const WEIGHTS = Object.freeze({
  keyword: 1.0, // list weight in rank fusion
  semantic: 1.0,
  expanded: 0.6, // keyword search on the AI rewrite and alternative phrasings
  rewrite: 0.7, // vector search on the AI rewrite
  rerank: 0.55, // share of the final score taken from the cross-encoder reranker
  intentKind: 0.08,
  featured: 0.05,
  unreviewed: -0.06, // automatically published items rank just below reviewed ones
  pick: 0.04, // editors' picks: added by hand after checking, or reviewed
  generalNews: -0.05, // general AI news ("AI beyond education") yields to education resources
  priorityPerLevel: 0.03,
  audienceMatch: 0.12,
  audienceEveryone: 0.04,
  audienceMismatch: -0.1,
  intentAudience: 0.08,
  intentCollection: 0.1,
  intentEvidence: 0.08,
  intentGrade: 0.05,
  freshnessMax: 0.1,
  freshnessHalfLifeDays: 365,
  publisherDecay: 0.85
});

// Reciprocal rank fusion: score(d) = sum over lists of weight / (k + rank(d)), rank starting at 1.
export function rrf(lists, { k = RRF_K } = {}) {
  const fused = new Map();
  for (const { name, ids, weight = 1 } of lists) {
    ids.forEach((id, i) => {
      const entry = fused.get(id) ?? { id, score: 0, ranks: {} };
      entry.score += weight / (k + i + 1);
      entry.ranks[name] = i + 1;
      fused.set(id, entry);
    });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

function ageDays(published, now) {
  const t = Date.parse(published.length === 4 ? `${published}-07-01` : published.length === 7 ? `${published}-15` : published);
  return Number.isFinite(t) ? Math.max(0, (now - t) / 86400000) : null;
}

// Adds editorial, audience, intent and freshness signals to normalized fusion scores.
// Returns items with `score` and `signals` (a list of {type, detail, delta}) for explanations.
export function applySignals(items, rows, { audience = 'Everyone', intent = null, now = Date.now(), weights = WEIGHTS } = {}) {
  const max = items.reduce((m, i) => Math.max(m, i.score), 0) || 1;
  return items.map((item) => {
    const row = rows.get(item.id);
    const signals = [];
    let s = item.score / max;
    const add = (type, detail, delta) => { s += delta; signals.push({ type, detail, delta }); };
    const auds = parseJsonArray(row.audiences);
    const cols = parseJsonArray(row.collections);
    const grades = parseJsonArray(row.grade_bands);
    if (row.featured === 1) add('editorial', 'Featured by the editors', weights.featured);
    const pick = !row.source_id || row.auto_published !== 1;
    if (pick) add('editorial', 'Editor’s pick', weights.pick);
    else add('editorial', 'Not reviewed by an editor yet', weights.unreviewed);
    if (cols.length && cols.every((c) => c === 'ai-beyond-education')) add('editorial', 'General AI news, outside education', weights.generalNews);
    if (row.editorial_priority > 0) add('editorial', 'Editor priority', weights.priorityPerLevel * row.editorial_priority);
    if (audience !== 'Everyone') {
      if (auds.includes(audience)) add('audience', `Listed for ${audience.toLowerCase()}`, weights.audienceMatch);
      else if (auds.includes('Everyone') || auds.length === 0) add('audience', 'Listed for everyone', weights.audienceEveryone);
      else add('audience', `Not listed for ${audience.toLowerCase()}`, weights.audienceMismatch);
    }
    if (intent) {
      const ia = intent.audiences.filter((a) => auds.includes(a));
      if (ia.length) add('intent', `Written for ${ia.join(', ').toLowerCase()}`, weights.intentAudience);
      const ic = intent.collections.filter((c) => cols.includes(c));
      if (ic.length) add('intent', 'In a collection that fits the question', weights.intentCollection);
      if (intent.evidence.includes(row.evidence_type)) add('intent', 'Resource type fits the question', weights.intentEvidence);
      if (intent.grades.some((g) => grades.includes(g))) add('intent', 'Grade band fits the question', weights.intentGrade);
      if (intent.kinds?.includes(kindOfFormat(row.format))) add('intent', 'Type of resource fits the question', weights.intentKind);
      if (intent.wantsRecent && row.published_at) {
        const age = ageDays(row.published_at, now);
        if (age !== null) add('freshness', `Published ${row.published_at}`, weights.freshnessMax * Math.pow(0.5, age / weights.freshnessHalfLifeDays));
      }
    }
    return { ...item, score: s, signals };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

// Greedy re-rank that discounts repeated publishers so one source cannot fill the page.
export function diversify(items, rows, { decay = WEIGHTS.publisherDecay } = {}) {
  const pool = items.map((i) => ({ ...i }));
  const seen = new Map();
  const out = [];
  while (pool.length) {
    let bestIdx = 0;
    let best = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const pub = (rows.get(pool[i].id).publisher || '').toLowerCase();
      const eff = pool[i].score * Math.pow(decay, seen.get(pub) ?? 0);
      if (eff > best) { best = eff; bestIdx = i; }
    }
    const [pick] = pool.splice(bestIdx, 1);
    const pub = (rows.get(pick.id).publisher || '').toLowerCase();
    const n = seen.get(pub) ?? 0;
    seen.set(pub, n + 1);
    out.push({ ...pick, diversity_rank_penalty: n > 0 });
  }
  return out;
}
