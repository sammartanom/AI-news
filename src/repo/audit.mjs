import { newId, nowIso } from '../lib/ids.mjs';

export async function audit(env, actor, action, entity, entityId = null, detail = null) {
  try {
    await env.DB.prepare('INSERT INTO audit_log(id, at, actor, action, entity, entity_id, detail) VALUES (?,?,?,?,?,?,?)')
      .bind(newId(), nowIso(), actor, action, entity, entityId, detail ? JSON.stringify(detail).slice(0, 2000) : null).run();
  } catch (e) {
    console.error('audit write failed:', e.message);
  }
}
