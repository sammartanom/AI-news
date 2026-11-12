import { listPublished } from '../repo/resources.mjs';

export const CATCHUP_AUDIENCES = ['Everyone', 'Teachers', 'Administrators', 'Families', 'Students'];

/**
 * Resources added to Signal in the last `days` days. "Added" is the date the resource became
 * public on Signal (added_at). Publication date is never used as a substitute, so a resource with
 * an unknown publication date can still appear here, and an old article added today is new to
 * Signal. Resources with no recorded added_at are not listed.
 */
export async function catchUp(env, { audience = 'Everyone', days = 30, now = Date.now(), limit = 40 } = {}) {
  const since = new Date(now - days * 86400000).toISOString();
  const { resources, total } = await listPublished(env, { filters: { audience, added_since: since }, sort: 'added', limit, offset: 0 });
  const groups = [];
  for (const r of resources) {
    const day = r.added_at.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last?.date === day) last.resources.push(r);
    else groups.push({ date: day, resources: [r] });
  }
  return { audience, days, since, total, groups };
}
