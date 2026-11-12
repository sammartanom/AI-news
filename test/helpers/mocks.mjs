// Test doubles for Cloudflare bindings that cannot run locally: Workers AI and Vectorize.
// The embedding is a deterministic bag-of-words hash with a small concept table, so texts that
// share words or concepts are close under cosine similarity. It is NOT a language model: it only
// exercises the retrieval pipeline. Real similarity quality must be measured against the real model.
import { readFileSync } from 'node:fs';
import { freshDb } from './d1.mjs';
import { seedStatements } from '../../scripts/lib/seed.mjs';
import { EMBEDDING } from '../../src/search/embedding.mjs';

const CONCEPTS = {
  cheating: ['integrity', 'plagiarism', 'detection'], cheat: ['integrity', 'plagiarism'], plagiarism: ['integrity'],
  parents: ['families', 'family'], parent: ['families', 'family'], caregivers: ['families'],
  kids: ['children', 'students'], children: ['students'], kid: ['children'],
  superintendent: ['administrators', 'district', 'leaders'], principal: ['administrators', 'leaders'],
  tutor: ['tutoring'], tutoring: ['tutor', 'tutors'], skeptical: ['concerns', 'critical', 'risks'],
  grading: ['assessment', 'feedback'], essays: ['writing'], essay: ['writing']
};
const stem = (w) => w.replace(/(ing|ers|er|es|s|ed)$/, '');

export function mockVector(text) {
  const v = new Array(EMBEDDING.dimensions).fill(0);
  const tokens = (String(text).toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const add = (t, weight) => {
    let h = 2166136261;
    for (const ch of stem(t)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    v[h % EMBEDDING.dimensions] += weight;
  };
  for (const t of tokens) {
    add(t, 1);
    for (const c of CONCEPTS[t] ?? []) add(c, 0.8);
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export class MockAI {
  constructor() { this.calls = []; this.fail = false; this.chatResponse = null; }
  async run(model, input) {
    this.calls.push({ model, input });
    if (this.fail) throw new Error('mock AI failure');
    if (model === EMBEDDING.model) {
      if (input.pooling !== EMBEDDING.pooling) throw new Error(`pooling mismatch: ${input.pooling}`);
      return { shape: [input.text.length, EMBEDDING.dimensions], data: input.text.map(mockVector) };
    }
    if (typeof this.chatResponse === 'function') return this.chatResponse(input);
    return { response: this.chatResponse ?? '{}' };
  }
}

const cosine = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

export class MockVectorize {
  constructor() { this.vectors = new Map(); this.fail = false; }
  async upsert(items) {
    if (this.fail) throw new Error('mock vectorize failure');
    for (const { id, values } of items) {
      if (values.length !== EMBEDDING.dimensions) throw new Error('bad dimensions');
      this.vectors.set(id, values);
    }
    return { mutationId: 'm' };
  }
  async deleteByIds(ids) {
    if (this.fail) throw new Error('mock vectorize failure');
    ids.forEach((id) => this.vectors.delete(id));
    return { mutationId: 'm' };
  }
  async query(values, { topK = 10 } = {}) {
    if (this.fail) throw new Error('mock vectorize failure');
    const matches = [...this.vectors].map(([id, v]) => ({ id, score: cosine(values, v) })).sort((a, b) => b.score - a.score).slice(0, topK);
    return { matches, count: matches.length };
  }
  async queryById(id, opts) {
    const v = this.vectors.get(id);
    if (!v) throw new Error('vector not found');
    return this.query(v, { ...opts, topK: (opts?.topK ?? 10) + 1 });
  }
}

export function seedData() {
  return JSON.parse(readFileSync(new URL('../../data/resources.seed.json', import.meta.url), 'utf8'));
}

/** A complete test environment: migrated in-memory D1, mock AI/Vectorize, optional seed data. */
export async function makeEnv({ seed = true, vars = {}, semantic = true } = {}) {
  const DB = freshDb();
  const env = { DB, ASSETS: { fetch: async () => new Response('asset', { status: 200 }) }, SEMANTIC_MIN_SCORE: '0.2', RELATED_MIN_SCORE: '0.25', ...vars };
  if (semantic) { env.AI = new MockAI(); env.VECTORIZE = new MockVectorize(); }
  if (seed) {
    for (const { sql, params } of seedStatements(seedData(), { now: '2026-10-20T12:00:00.000Z' })) await DB.prepare(sql).bind(...params).run();
    if (semantic) {
      const { backfill } = await import('../../src/search/embedding.mjs');
      await backfill(env, { limit: 100 });
    }
  }
  return env;
}

export const req = (path, { method = 'GET', body, headers = {}, origin = 'https://signal.test' } = {}) =>
  new Request(`${origin}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { origin } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

let counter = 0;
/** Inserts a resource directly. Defaults to a published, fully described record. */
export async function addResource(env, o = {}) {
  const n = ++counter;
  const now = o.now ?? '2026-10-20T12:00:00.000Z';
  const r = {
    id: `t${n}`, url: `https://example.org/r/${n}`, title: `Resource ${n}`, publisher: 'Example Publisher', format: 'Article',
    audiences: ['Everyone'], collections: [], topics: [], grade_bands: [], evidence_type: null, why: 'Included for testing.', best_for: 'Testers.',
    summary: null, summary_approved: 0, published_at: null, status: 'published', featured: 0, editorial_priority: 0, added_at: now, ...o
  };
  await env.DB.prepare(
    `INSERT INTO resources(id, url, canonical_url, title, publisher, format, evidence_type, audience, collection_name, audiences, collections, tags, grade_bands,
       why, best_for, summary, summary_approved, published_at, discovered_at, added_at, created_at, updated_at, status, featured, editorial_priority, dup_key)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(r.id, r.url, r.canonical_url ?? r.url, r.title, r.publisher, r.format, r.evidence_type, r.audiences[0] ?? 'Everyone', 'Other', JSON.stringify(r.audiences),
    JSON.stringify(r.collections), JSON.stringify(r.topics), JSON.stringify(r.grade_bands), r.why, r.best_for, r.summary, r.summary_approved, r.published_at, now,
    r.status === 'published' ? r.added_at : null, now, now, r.status, r.featured, r.editorial_priority, r.title.toLowerCase()).run();
  if (r.status === 'published' && env.VECTORIZE && r.index !== false) {
    const { indexResource } = await import('../../src/search/embedding.mjs');
    await indexResource(env, await env.DB.prepare('SELECT * FROM resources WHERE id = ?').bind(r.id).first());
  }
  return r.id;
}

/** A caller that acts as `email` using the localhost-only DEV_USER_EMAIL path. */
export function client(env, email) {
  const { handle } = globalThis.__signalHandle;
  return async (path, opts = {}) => {
    const e = { ...env, ...(email ? { DEV_USER_EMAIL: email } : {}) };
    const res = await handle(req(path, { origin: 'http://localhost', ...opts }), e, { waitUntil() {} });
    const body = await res.text();
    let data = body;
    try { data = JSON.parse(body); } catch { /* text body */ }
    return { status: res.status, data, headers: res.headers };
  };
}

export async function loadHandler() {
  globalThis.__signalHandle = await import('../../src/index.mjs');
}
