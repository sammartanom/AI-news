import { HttpError, intParam } from '../lib/http.mjs';
import { AUDIENCES, GRADE_BANDS, collectionSlugs, EVIDENCE_TYPES, KINDS } from '../lib/taxonomy.mjs';
import { SORTS } from '../repo/resources.mjs';

const evidenceSlugs = new Set(EVIDENCE_TYPES.map((e) => e.slug));

export function parseFilters(url) {
  const p = url.searchParams;
  const f = {};
  const audience = p.get('audience');
  if (audience) {
    if (!AUDIENCES.includes(audience)) throw new HttpError(400, 'Unknown audience');
    f.audience = audience;
  }
  const collection = p.get('collection');
  if (collection) {
    if (!collectionSlugs.has(collection)) throw new HttpError(400, 'Unknown collection');
    f.collection = collection;
  }
  const evidence = p.get('evidence');
  if (evidence) {
    if (!evidenceSlugs.has(evidence)) throw new HttpError(400, 'Unknown resource type');
    f.evidence = evidence;
  }
  const grade = p.get('grade');
  if (grade) {
    if (!GRADE_BANDS.includes(grade)) throw new HttpError(400, 'Unknown grade band');
    f.grade = grade;
  }
  const kind = p.get('kind');
  if (kind) {
    if (!KINDS.some((k) => k.slug === kind)) throw new HttpError(400, 'Unknown kind');
    f.kind = kind;
  }
  for (const [key, max] of [['topic', 60], ['format', 40], ['publisher', 200], ['subject', 60]]) {
    const v = p.get(key);
    if (v) f[key] = v.slice(0, max);
  }
  if (p.get('dated') === '1') f.dated = true;
  if (p.get('reviewed') === '1') f.reviewed = true;
  return f;
}

export function parseSort(url, fallback = 'newest') {
  const s = url.searchParams.get('sort') || fallback;
  if (!(s in SORTS)) throw new HttpError(400, 'Unknown sort');
  return s;
}

export function parsePaging(url, { max = 50, fallback = 24 } = {}) {
  return {
    limit: intParam(url.searchParams.get('limit'), { min: 1, max, fallback }),
    offset: intParam(url.searchParams.get('offset'), { min: 0, max: 5000, fallback: 0 })
  };
}

export function parseQuery(raw, { min = 1, max = 300 } = {}) {
  // eslint-disable-next-line no-control-regex
  const q = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (q.length < min) throw new HttpError(400, 'Enter a search');
  if (q.length > max) throw new HttpError(400, `Search must be ${max} characters or fewer`);
  return q;
}

export const clientKey = (req) => req.headers.get('cf-connecting-ip') || 'unknown';

// Rate-limit binding wrapper. A missing binding (local development) means "allowed".
export async function allowed(env, binding, key) {
  const limiter = env[binding];
  if (!limiter) return true;
  try { return (await limiter.limit({ key })).success; } catch { return true; }
}

// Caches identical public GET responses at the edge for a short time.
export async function cached(c, seconds, produce) {
  const cache = globalThis.caches?.default;
  if (!cache || c.req.method !== 'GET') return produce();
  const key = new Request(c.url.origin + c.url.pathname + c.url.search, { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await produce();
  if (res.status === 200) c.exec?.waitUntil?.(cache.put(key, res.clone()));
  return res;
}
