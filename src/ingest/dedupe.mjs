import { titleKey, titleTokens, jaccard } from '../lib/text.mjs';

export const SIMILAR_TITLE_THRESHOLD = 0.8;

/**
 * Looks for existing records that may be the same resource.
 *  - exact: same canonical URL (or stored URL). Safe to skip.
 *  - flag: same DOI, same normalized title, or very similar title. Never merged automatically;
 *    the new record is queued with a warning for a human to decide.
 */
export async function findDuplicates(env, { canonical, rawUrl, doi, title }) {
  const exact = await env.DB.prepare(
    'SELECT id, status FROM resources WHERE canonical_url = ? OR url = ? OR url = ? LIMIT 1'
  ).bind(canonical, canonical, rawUrl ?? canonical).first();
  if (exact) return { exact, flag: null };

  if (doi) {
    const d = await env.DB.prepare('SELECT id, title FROM resources WHERE doi = ? LIMIT 1').bind(doi).first();
    if (d) return { exact: null, flag: { id: d.id, reason: `Same DOI as "${d.title}"` } };
  }

  const key = titleKey(title);
  if (key) {
    const same = await env.DB.prepare('SELECT id, title, publisher FROM resources WHERE dup_key = ? LIMIT 1').bind(key).first();
    if (same) return { exact: null, flag: { id: same.id, reason: `Same title as "${same.title}" (${same.publisher}); may be a republished or syndicated copy` } };

    const tokens = titleTokens(title);
    const longest = [...tokens].sort((a, b) => b.length - a.length).slice(0, 2);
    if (longest.length) {
      const where = longest.map(() => 'dup_key LIKE ?').join(' OR ');
      const cands = (await env.DB.prepare(`SELECT id, title FROM resources WHERE ${where} LIMIT 40`).bind(...longest.map((t) => `%${t}%`)).all()).results;
      let best = null;
      for (const c of cands) {
        const s = jaccard(tokens, titleTokens(c.title));
        if (s >= SIMILAR_TITLE_THRESHOLD && (!best || s > best.s)) best = { c, s };
      }
      if (best) return { exact: null, flag: { id: best.c.id, reason: `Very similar title to "${best.c.title}"` } };
    }
  }
  return { exact: null, flag: null };
}
