// Applies the topic rules (src/lib/autotopics.mjs) to stored resources. Topics an editor chose are
// left alone; rule-assigned topics (topics_auto = 1) are refreshed when better text arrives, such
// as a new AI brief.
import { inferTopics, inferCollection } from '../lib/autotopics.mjs';
import { parseJsonArray } from '../lib/text.mjs';
import { nowIso } from '../lib/ids.mjs';

export function topicsFor(row) {
  return inferTopics({
    title: row.title ?? '',
    text: [row.ai_brief, row.why, row.best_for, row.summary_approved === 1 ? row.summary : null].filter(Boolean).join(' '),
    collections: parseJsonArray(row.collections)
  });
}

const tagStatement = (env, row) => {
  const topics = topicsFor(row);
  const fillCollection = parseJsonArray(row.collections).length === 0 ? inferCollection(topics) : null;
  return env.DB.prepare(
    `UPDATE resources SET tags = ?, topics_auto = 1${fillCollection ? ', collections = ?' : ''}, updated_at = ? WHERE id = ?`
  ).bind(...[JSON.stringify(topics), ...(fillCollection ? [JSON.stringify([fillCollection])] : []), nowIso(), row.id]);
};

/** Re-tags one resource if its topics came from the rules (or it has none). */
export async function retagResource(env, id) {
  const row = await env.DB.prepare('SELECT * FROM resources WHERE id = ?').bind(id).first();
  if (!row || (row.topics_auto !== 1 && parseJsonArray(row.tags).length)) return false;
  await tagStatement(env, row).run();
  return true;
}

/** Scheduled: tags resources that have never been through the rules. One D1 batch per run. */
export async function tagUntagged(env, { limit = 150 } = {}) {
  const rows = (await env.DB.prepare(
    `SELECT * FROM resources WHERE status IN ('published', 'indexed') AND tags = '[]' AND topics_auto = 0 ORDER BY added_at DESC LIMIT ?`
  ).bind(limit).all()).results;
  if (rows.length) await env.DB.batch(rows.map((r) => tagStatement(env, r)));
  return { tagged: rows.length };
}
