// When a search finds nothing, offer somewhere to go: topics that look close to the words typed
// and a few editors' picks. A search page should never be a dead end.
import { inferTopics } from '../lib/autotopics.mjs';
import { TOPICS } from '../lib/taxonomy.mjs';
import { queryTerms } from '../lib/text.mjs';
import { listPublished } from '../repo/resources.mjs';

export function nearbyTopics(q, { limit = 4 } = {}) {
  const found = inferTopics({ title: q });
  const terms = queryTerms(q).filter((t) => t.length >= 3);
  for (const t of TOPICS) {
    if (found.includes(t.slug)) continue;
    const words = `${t.name} ${t.query}`.toLowerCase();
    if (terms.some((w) => words.includes(w.slice(0, Math.max(4, w.length - 2))))) found.push(t.slug);
  }
  return found.slice(0, limit).map((slug) => ({ slug, name: TOPICS.find((t) => t.slug === slug).name }));
}

export async function searchFallback(env, q) {
  const { resources } = await listPublished(env, { sort: 'recommended', limit: 5 });
  return { topics: nearbyTopics(q), picks: resources };
}
