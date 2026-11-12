// Builds the statements that load data/resources.seed.json. Shared by the SQL file generator
// (scripts/seed.mjs) and the local harness. Re-running is safe: inserts are INSERT OR IGNORE, so
// existing rows (and any editor changes to them) are never overwritten.
import { canonicalizeUrl, extractDoi } from '../../src/lib/url.mjs';
import { titleKey } from '../../src/lib/text.mjs';
import { collectionName } from '../../src/lib/taxonomy.mjs';

const COLUMNS = [
  'id', 'url', 'canonical_url', 'title', 'publisher', 'format', 'audience', 'collection_name', 'audiences', 'collections', 'tags',
  'why', 'best_for', 'summary', 'published_at', 'discovered_at', 'added_at', 'created_at', 'updated_at', 'status', 'featured',
  'verification', 'verification_status', 'source_provenance', 'dup_key', 'doi'
];

export function seedStatements(resources, { now = new Date().toISOString() } = {}) {
  const stmts = [];
  for (const r of resources) {
    const canonical = canonicalizeUrl(r.url);
    const values = {
      id: r.id, url: r.url, canonical_url: canonical, title: r.title, publisher: r.publisher, format: r.format ?? 'Article',
      audience: r.audiences?.[0] ?? 'Everyone', collection_name: r.collections?.[0] ? collectionName(r.collections[0]) : 'Other',
      audiences: JSON.stringify(r.audiences ?? []), collections: JSON.stringify(r.collections ?? []), tags: JSON.stringify(r.topics ?? []),
      why: r.why ?? null, best_for: r.best_for ?? null, summary: r.summary ?? null, published_at: r.published_at ?? null,
      discovered_at: now, added_at: now, created_at: now, updated_at: now, status: 'published', featured: r.featured ? 1 : 0,
      verification: r.verification ?? null, verification_status: r.verification_status ?? 'unverified',
      source_provenance: JSON.stringify({ method: 'legacy-import', listing_url: r.listing_url ?? null }),
      dup_key: titleKey(r.title), doi: extractDoi(r.url)
    };
    stmts.push({
      sql: `INSERT OR IGNORE INTO resources(${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`,
      params: COLUMNS.map((c) => values[c])
    });
  }
  for (const r of resources) {
    for (const rel of r.read_with ?? []) {
      stmts.push({
        sql: `INSERT OR IGNORE INTO resource_relations(id, from_id, to_id, relation, note, created_by, created_at)
              SELECT ?, ?, ?, ?, NULL, 'import', ? WHERE EXISTS (SELECT 1 FROM resources WHERE id = ?) AND EXISTS (SELECT 1 FROM resources WHERE id = ?)`,
        params: [`seed-${r.id}-${rel.id}-${rel.relation}`, r.id, rel.id, rel.relation, now, r.id, rel.id]
      });
    }
  }
  // Rows seeded earlier with a URL that carried page-state parameters or a text fragment.
  for (const r of resources) {
    for (const old of r.legacy_urls ?? []) {
      stmts.push({
        sql: 'UPDATE resources SET url = ?, canonical_url = ? WHERE id = ? AND url = ?',
        params: [r.url, canonicalizeUrl(r.url), r.id, old]
      });
    }
  }
  return stmts;
}

// Candidate feeds. They are inserted unreviewed and switched off: an editor confirms the feed URL
// and the publisher's terms, marks the source verified, and only then turns it on.
export function sourceStatements(sources, { now = new Date().toISOString() } = {}) {
  return sources.map((s) => ({
    sql: `INSERT OR IGNORE INTO sources(id, name, feed_url, publisher, enabled, source_type, site_url, allowed_hosts, default_metadata, review_status, require_match, notes, created_at, updated_at)
          VALUES (?,?,?,?,0,'feed',?,?,?,'unreviewed',?,?,?,?)`,
    params: [s.id, s.name, s.feed_url, s.publisher, s.site_url ?? null, JSON.stringify(s.allowed_hosts ?? []), JSON.stringify(s.default_metadata ?? {}), s.require_match === false ? 0 : 1, s.notes ?? null, now, now]
  }));
}

const lit = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`);

export function toSqlFile(stmts) {
  return stmts.map(({ sql, params }) => {
    let i = 0;
    return sql.replace(/\?/g, () => lit(params[i++])) + ';';
  }).join('\n') + '\n';
}
