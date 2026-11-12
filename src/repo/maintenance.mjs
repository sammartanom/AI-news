import { canonicalizeUrl, extractDoi } from '../lib/url.mjs';
import { titleKey } from '../lib/text.mjs';

// Fills canonical_url, dup_key and doi for records created before those columns existed.
// If two records canonicalize to the same URL, the later one is flagged as a possible duplicate
// of the earlier one and keeps a null canonical_url; nothing is merged or deleted.
export async function backfillKeys(env, { limit = 200 } = {}) {
  const rows = (await env.DB.prepare(
    `SELECT id, url, title FROM resources WHERE canonical_url IS NULL OR dup_key IS NULL ORDER BY created_at LIMIT ?`
  ).bind(limit).all()).results;
  let updated = 0;
  let flagged = 0;
  for (const r of rows) {
    let canonical = null;
    try { canonical = canonicalizeUrl(r.url); } catch { /* keep null: URL is not a public https URL */ }
    try {
      await env.DB.prepare('UPDATE resources SET canonical_url = COALESCE(canonical_url, ?), dup_key = ?, doi = COALESCE(doi, ?) WHERE id = ?')
        .bind(canonical, titleKey(r.title), extractDoi(r.url), r.id).run();
      updated++;
    } catch (e) {
      if (!/UNIQUE/i.test(e.message)) throw e;
      const other = await env.DB.prepare('SELECT id, title FROM resources WHERE canonical_url = ?').bind(canonical).first();
      await env.DB.prepare('UPDATE resources SET dup_key = ?, duplicate_of = ?, duplicate_reason = ? WHERE id = ?')
        .bind(titleKey(r.title), other?.id ?? null, `Same canonical URL as "${other?.title ?? 'another resource'}"`, r.id).run();
      flagged++;
    }
  }
  return { updated, flagged };
}
