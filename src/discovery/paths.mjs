import { PATH_STAGES } from '../lib/taxonomy.mjs';
import { hybridSearch } from '../search/hybrid.mjs';
import { parseIntent } from '../search/intent.mjs';

export const PATH_PRESETS = [
  { id: 'teacher-start', short: 'Start here', label: 'Teacher starting with AI literacy', q: 'I am a teacher starting with AI literacy', audience: 'Teachers' },
  { id: 'classroom', short: 'Classroom', label: 'Teacher using AI for planning, feedback and lessons', q: 'teacher using AI tools for lesson planning, feedback and classroom activities', audience: 'Teachers' },
  { id: 'integrity', short: 'Integrity', label: 'Teacher handling student AI use and academic integrity', q: 'teacher handling student AI use, academic integrity and assessment', audience: 'Teachers' }
];
// Earlier presets, kept so old links still open a path.
export const PATH_ALIASES = { 'new-principal': 'teacher-start', 'district-policy': 'teacher-start', leader: 'teacher-start', family: 'teacher-start' };

// Stage assignment prefers resource type, then collection, then format.
export function stageFor(resource) {
  const cols = resource.collections ?? [];
  for (const s of PATH_STAGES) if (resource.evidence_type && s.evidence.includes(resource.evidence_type)) return s.key;
  for (const s of PATH_STAGES) if (cols.some((c) => s.collections.includes(c))) return s.key;
  for (const s of PATH_STAGES) if (s.formats.some((f) => f.toLowerCase() === String(resource.format).toLowerCase())) return s.key;
  return null;
}

/**
 * Builds a reading path from real Signal resources only. Stages without a matching resource are
 * returned empty; nothing is invented to fill them.
 */
export async function buildPath(env, { q, audience = 'Everyone', perStage = 3 }) {
  const intent = parseIntent(q);
  const lens = audience !== 'Everyone' ? audience : intent.audiences[0] ?? 'Everyone';
  const found = await hybridSearch(env, { q, audience: lens, limit: 60 });
  const stages = PATH_STAGES.map((s) => ({ key: s.key, name: s.name, resources: [] }));
  const unplaced = [];
  // A reading path is a recommendation, so it uses only resources a person chose: reviewed by an
  // editor, or added by hand after checking the page. Reviewed ones come first within each step.
  const chosen = found.results.filter((x) => x.reviewed || x.hand_picked);
  for (const r of [...chosen.filter((x) => x.reviewed), ...chosen.filter((x) => !x.reviewed)]) {
    const key = stageFor(r);
    const stage = stages.find((s) => s.key === key);
    if (stage && stage.resources.length < perStage) stage.resources.push(r);
    else if (!stage) unplaced.push(r.id);
  }
  const count = stages.reduce((n, s) => n + s.resources.length, 0);
  return {
    query: q,
    audience: lens,
    mode: found.mode,
    degraded: found.degraded,
    count,
    stages,
    note: count === 0 ? 'No matching resources yet.' : stages.some((s) => !s.resources.length) ? 'Some steps have no matching resource yet.' : null
  };
}
