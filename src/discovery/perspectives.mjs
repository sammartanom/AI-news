import { PERSPECTIVE_GROUPS } from '../lib/taxonomy.mjs';
import { parseJsonArray } from '../lib/text.mjs';

// Assigns each resource to at most one group using editor-set metadata: resource type first,
// then collection. Text is never classified, and no pro/con grouping is created.
export function groupFor(resource) {
  const evidence = resource.evidence_type;
  const cols = Array.isArray(resource.collections) ? resource.collections : parseJsonArray(resource.collections);
  for (const g of PERSPECTIVE_GROUPS) if (evidence && g.evidence.includes(evidence)) return g.key;
  for (const g of PERSPECTIVE_GROUPS) if (cols.some((c) => g.collections.includes(c))) return g.key;
  return null;
}

export function groupPerspectives(resources) {
  const groups = PERSPECTIVE_GROUPS.map((g) => ({ key: g.key, name: g.name, resources: [] }));
  const other = { key: 'other', name: 'Other', resources: [] };
  for (const r of resources) {
    const key = groupFor(r);
    (groups.find((g) => g.key === key) ?? other).resources.push(r);
  }
  return [...groups, other].filter((g) => g.resources.length);
}
