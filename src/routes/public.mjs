import { route } from '../router.mjs';
import { json, publicCache, readJson, HttpError } from '../lib/http.mjs';
import { intParam } from '../lib/http.mjs';
import { AUDIENCES, COLLECTIONS, EVIDENCE_TYPES, GRADE_BANDS, RELATIONS, FORMATS, KINDS, collectionName } from '../lib/taxonomy.mjs';
import { listPublished, getPublished, facets, publishedByIds } from '../repo/resources.mjs';
import { hybridSearch } from '../search/hybrid.mjs';
import { EMBEDDING, semanticAvailable } from '../search/embedding.mjs';
import { askSignal, answersEnabled } from '../discovery/answer.mjs';
import { relatedFor } from '../discovery/related.mjs';
import { groupPerspectives } from '../discovery/perspectives.mjs';
import { buildPath, PATH_PRESETS, PATH_ALIASES } from '../discovery/paths.mjs';
import { listTopics, topicDossier } from '../discovery/topics.mjs';
import { searchFallback } from '../search/fallback.mjs';
import { catchUp, CATCHUP_AUDIENCES } from '../discovery/catchup.mjs';
import { ensureDigest, latestDigest, digestView, digestFeed } from '../discovery/digest.mjs';
import { briefModel, ensureBrief } from '../discovery/brief.mjs';
import { searchModel } from '../search/understand.mjs';
import { rerankModel } from '../search/rerank.mjs';
import { accountsEnabled } from '../auth/session.mjs';
import { parseFilters, parseSort, parsePaging, parseQuery, clientKey, allowed, cached } from './util.mjs';

route('GET', '/api/health', async (c) => {
  let database = false;
  try { database = (await c.env.DB.prepare('SELECT 1 AS ok').first('ok')) === 1; } catch { /* reported below */ }
  return json({
    ok: database,
    service: 'signal',
    database,
    vectorize: Boolean(c.env.VECTORIZE),
    ai: Boolean(c.env.AI),
    semantic_search: semanticAvailable(c.env),
    ai_search: { understanding: Boolean(searchModel(c.env)), rerank: Boolean(rerankModel(c.env)) },
    answers: answersEnabled(c.env),
    accounts: accountsEnabled(c.env),
    embedding: { model: EMBEDDING.model, version: EMBEDDING.version }
  }, database ? 200 : 503);
});

route('GET', '/api/config', (c) => cached(c, 300, async () => json({
  answers: answersEnabled(c.env),
  semantic: semanticAvailable(c.env),
  audiences: AUDIENCES,
  collections: COLLECTIONS,
  evidence_types: EVIDENCE_TYPES,
  grade_bands: GRADE_BANDS,
  relations: RELATIONS,
  formats: FORMATS,
  kinds: KINDS,
  catchup_audiences: CATCHUP_AUDIENCES
}, 200, publicCache(300))));

route('GET', '/api/facets', (c) => cached(c, 120, async () => json(await facets(c.env), 200, publicCache(120))));

route('GET', '/api/featured', (c) => cached(c, 120, async () => {
  const audience = c.url.searchParams.get('audience');
  const limit = intParam(c.url.searchParams.get('limit'), { min: 1, max: 12, fallback: 12 });
  const { resources } = await listPublished(c.env, { filters: { featured: true, ...(AUDIENCES.includes(audience) ? { audience } : {}) }, sort: 'added', limit });
  return json({ resources }, 200, publicCache(120));
}));

route('GET', '/api/resources', (c) => cached(c, 60, async () => {
  const filters = parseFilters(c.url);
  const { limit, offset } = parsePaging(c.url);
  const out = await listPublished(c.env, { filters, sort: parseSort(c.url), limit, offset });
  return json({ ...out, limit, offset }, 200, publicCache(60));
}));

// Up to 50 published resources by id, in the order requested. Used for on-device saved lists.
route('GET', '/api/resources/batch', async (c) => {
  const ids = (c.url.searchParams.get('ids') || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 50);
  return json({ resources: await publishedByIds(c.env, ids).then((rows) => rows) }, 200, { 'Cache-Control': 'private, max-age=30' });
});

route('GET', '/api/resources/:id', async (c) => {
  const r = await getPublished(c.env, c.params.id);
  if (!r) throw new HttpError(404, 'Resource not found');
  return json({ resource: r }, 200, publicCache(60));
});

// The AI-written brief for a resource, written on first request if the scheduled job has not got
// to it yet. Rate limited per visitor, since writing one fetches the page and calls a model.
route('GET', '/api/resources/:id/brief', async (c) => {
  const have = await c.env.DB.prepare("SELECT ai_brief, ai_brief_basis FROM resources WHERE id = ? AND status = 'published'").bind(c.params.id).first();
  if (!have) throw new HttpError(404, 'Resource not found');
  if (have.ai_brief) return json({ brief: have.ai_brief, basis: have.ai_brief_basis }, 200, publicCache(3600));
  if (!briefModel(c.env) || !(await allowed(c.env, 'AI_LIMITER', clientKey(c.req)))) return json({ brief: null, basis: null }, 200, { 'Cache-Control': 'no-store' });
  const r = await ensureBrief(c.env, c.params.id);
  return json({ brief: r?.brief ?? null, basis: r?.brief ? r.basis : null }, 200, r?.brief ? publicCache(3600) : { 'Cache-Control': 'no-store' });
});

route('GET', '/api/resources/:id/related', async (c) => {
  const out = await relatedFor(c.env, c.params.id, { limit: intParam(c.url.searchParams.get('limit'), { min: 1, max: 12, fallback: 6 }) });
  if (!out) throw new HttpError(404, 'Resource not found');
  return json(out, 200, publicCache(60));
});

route('GET', '/api/search', async (c) => {
  const q = parseQuery(c.url.searchParams.get('q'));
  const filters = parseFilters(c.url);
  const { limit, offset } = parsePaging(c.url, { max: 50, fallback: 20 });
  const allowSemantic = await allowed(c.env, 'SEARCH_LIMITER', clientKey(c.req));
  const out = await hybridSearch(c.env, {
    q, audience: filters.audience ?? 'Everyone', filters: { ...filters, audience: undefined }, limit, offset,
    explain: c.url.searchParams.get('explain') === '1', allowSemantic
  });
  if (!out.total && !offset) out.fallback = await searchFallback(c.env, q); // never a dead end
  return json(out, 200, { 'Cache-Control': 'private, max-age=30' });
});

route('POST', '/api/ask', async (c) => {
  if (!answersEnabled(c.env)) throw new HttpError(503, 'Answers are not enabled');
  if (!(await allowed(c.env, 'AI_LIMITER', clientKey(c.req)))) throw new HttpError(429, 'Too many questions. Try again in a minute.');
  const body = await readJson(c.req, 4096);
  const q = parseQuery(body.q, { min: 3 });
  const audience = AUDIENCES.includes(body.audience) ? body.audience : 'Everyone';
  return json(await askSignal(c.env, { q, audience }));
});

route('GET', '/api/perspectives', async (c) => {
  const q = parseQuery(c.url.searchParams.get('q'));
  const audience = AUDIENCES.includes(c.url.searchParams.get('audience')) ? c.url.searchParams.get('audience') : 'Everyone';
  const allowSemantic = await allowed(c.env, 'SEARCH_LIMITER', clientKey(c.req));
  const found = await hybridSearch(c.env, { q, audience, limit: 40, allowSemantic });
  return json({ query: q, mode: found.mode, degraded: found.degraded, groups: groupPerspectives(found.results) }, 200, { 'Cache-Control': 'private, max-age=30' });
});

route('GET', '/api/paths/presets', () => json({ presets: PATH_PRESETS }, 200, publicCache(300)));

route('GET', '/api/paths', async (c) => {
  // A preset (?preset=teacher-start) is the same for everyone, so it can be cached publicly.
  const wanted = c.url.searchParams.get('preset');
  const preset = PATH_PRESETS.find((p) => p.id === (PATH_ALIASES[wanted] ?? wanted));
  if (preset) return cached(c, 600, async () => json({ preset, ...(await buildPath(c.env, { q: preset.q, audience: preset.audience })) }, 200, publicCache(600)));
  const q = parseQuery(c.url.searchParams.get('q'));
  const audience = AUDIENCES.includes(c.url.searchParams.get('audience')) ? c.url.searchParams.get('audience') : 'Everyone';
  return json(await buildPath(c.env, { q, audience }), 200, { 'Cache-Control': 'private, max-age=30' });
});

route('GET', '/api/topics', (c) => cached(c, 300, async () => json({ topics: await listTopics(c.env) }, 200, publicCache(300))));

route('GET', '/api/topics/:slug', async (c) => {
  const audience = AUDIENCES.includes(c.url.searchParams.get('audience')) ? c.url.searchParams.get('audience') : 'Everyone';
  const out = await topicDossier(c.env, c.params.slug, { audience });
  if (!out) throw new HttpError(404, 'Topic not found');
  return json(out, 200, { 'Cache-Control': 'private, max-age=60' });
});

route('GET', '/api/catch-up', async (c) => {
  const audience = c.url.searchParams.get('audience') ?? 'Everyone';
  if (!CATCHUP_AUDIENCES.includes(audience)) throw new HttpError(400, 'Unknown audience');
  const days = intParam(c.url.searchParams.get('days'), { min: 1, max: 180, fallback: 30 });
  return json(await catchUp(c.env, { audience, days }), 200, publicCache(60));
});

// The weekly digest. The first request after a week has passed builds the next one; the daily
// scheduled job does the same, so a digest exists even if nobody asks.
route('GET', '/api/digest', async (c) => {
  const id = c.url.searchParams.get('id');
  let row = id ? await c.env.DB.prepare('SELECT * FROM digests WHERE id = ?').bind(id.slice(0, 64)).first() : null;
  if (id && !row) throw new HttpError(404, 'Digest not found');
  if (!row) {
    await ensureDigest(c.env);
    row = await latestDigest(c.env);
  }
  return json({ digest: await digestView(c.env, row) }, 200, publicCache(300));
});

route('GET', '/feed.xml', (c) => cached(c, 900, async () => {
  const rows = (await c.env.DB.prepare('SELECT * FROM digests ORDER BY created_at DESC LIMIT 12').all()).results;
  const digests = (await Promise.all(rows.map((r) => digestView(c.env, r)))).filter(Boolean);
  return new Response(digestFeed(c.url.origin, digests), { headers: { 'content-type': 'application/rss+xml; charset=utf-8', ...publicCache(900) } });
}));
