import { hybridSearch } from '../search/hybrid.mjs';
import { groupFor } from './perspectives.mjs';
import { toPublic } from '../repo/resources.mjs';

const SECTIONS = [
  { key: 'start', name: 'Start here' },
  { key: 'latest', name: 'Latest' },
  { key: 'classroom', name: 'Classroom' },
  { key: 'research', name: 'Research' },
  { key: 'leadership', name: 'Leadership and policy' },
  { key: 'students', name: 'Student perspectives' },
  { key: 'concerns', name: 'Questions and concerns' }
];
const GROUP_TO_SECTION = { classroom: 'classroom', research: 'research', guidance: 'leadership', students: 'students', concerns: 'concerns' };

export async function listTopics(env) {
  return (await env.DB.prepare('SELECT slug, name, query FROM topics ORDER BY position').all()).results;
}

/**
 * Topic page: resources the editors tagged with the topic, plus hybrid search results for the
 * topic's query, sorted into sections by metadata. Editors can pin resources into a section.
 */
export async function topicDossier(env, slug, { audience = 'Everyone', now = Date.now() } = {}) {
  const topic = await env.DB.prepare('SELECT slug, name, query FROM topics WHERE slug = ?').bind(slug).first();
  if (!topic) return null;

  const tagged = (await env.DB.prepare(
    `SELECT r.* FROM resources r WHERE r.status = 'published' AND EXISTS (SELECT 1 FROM json_each(r.tags) j WHERE j.value = ?) LIMIT 60`
  ).bind(slug).all()).results.map(toPublic);
  const found = await hybridSearch(env, { q: topic.query, audience, limit: 40, now });

  const byId = new Map();
  for (const r of [...tagged, ...found.results]) if (!byId.has(r.id)) byId.set(r.id, r);
  const all = [...byId.values()];

  const sections = Object.fromEntries(SECTIONS.map((s) => [s.key, []]));
  for (const r of all) {
    if (r.collections.includes('start-here') && r.reviewed) sections.start.push(r);
    const key = GROUP_TO_SECTION[groupFor(r)];
    if (key) sections[key].push(r);
  }
  // "Latest" uses known publication dates only; undated resources are not listed as recent.
  sections.latest = all.filter((r) => r.published_at).sort((a, b) => b.published_at.localeCompare(a.published_at)).slice(0, 5);

  const pins = (await env.DB.prepare(
    `SELECT p.section, p.position, r.* FROM topic_pins p JOIN resources r ON r.id = p.resource_id
     WHERE p.topic_slug = ? AND r.status = 'published' ORDER BY p.position`
  ).bind(slug).all()).results;
  for (const p of pins) {
    const pub = toPublic(p);
    sections[p.section] = [pub, ...sections[p.section].filter((r) => r.id !== pub.id)];
  }

  const otherTopics = (await env.DB.prepare('SELECT slug, name FROM topics WHERE slug != ? ORDER BY position').bind(slug).all()).results;
  const tagCounts = new Map();
  for (const r of all) for (const t of r.topics) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const related = otherTopics.filter((t) => tagCounts.has(t.slug));

  return {
    topic,
    mode: found.mode,
    degraded: found.degraded,
    total: all.length,
    sections: SECTIONS.map((s) => ({ ...s, resources: sections[s.key].slice(0, 8) })).filter((s) => s.resources.length),
    related_topics: related
  };
}
