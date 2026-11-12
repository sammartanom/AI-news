// Sets up an empty database by itself, so a new Cloudflare account needs no command line: the first
// request (or scheduled run) that finds no tables applies every migration, one transaction each,
// and records them in d1_migrations the way `wrangler d1 migrations apply` does. A database that
// already has tables is never touched here.
import { MIGRATIONS } from './schema.generated.mjs';

let ready = null;

async function setUp(env) {
  const has = await env.DB.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'resources'").first();
  if (has) return { created: false };
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)').run();
  for (const m of MIGRATIONS) {
    await env.DB.batch([...m.statements.map((s) => env.DB.prepare(s)), env.DB.prepare('INSERT OR IGNORE INTO d1_migrations(name) VALUES (?)').bind(m.name)]);
  }
  return { created: true, migrations: MIGRATIONS.length };
}

/** Resolves once the database has its tables. Checked once per Worker instance; retried after a failure. */
export function ensureSchema(env) {
  if (!env?.DB) return Promise.resolve({ created: false });
  if (!ready) ready = setUp(env).catch((e) => { ready = null; throw e; });
  return ready;
}

/** Tests only: forget that this instance has checked. */
export const resetSchemaCheck = () => { ready = null; };
