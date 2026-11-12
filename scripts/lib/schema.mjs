// Turns the numbered SQL files in migrations/ into the list of statements the Worker runs to set
// up an empty database by itself (src/db/migrate.mjs). Comments are dropped, PRAGMA lines are
// skipped (D1 enforces foreign keys on its own), and a CREATE TRIGGER ... END; stays one statement.
export function splitStatements(sql) {
  const out = [];
  let cur = [];
  let trigger = false;
  for (const raw of sql.split('\n')) {
    const line = raw.replace(/--.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (!cur.length && /^\s*PRAGMA\b/i.test(line)) continue;
    if (!cur.length && /^\s*CREATE\s+TRIGGER\b/i.test(line)) trigger = true;
    cur.push(line);
    const done = trigger ? /^\s*END;$/i.test(line) : /;$/.test(line);
    if (done) {
      out.push(cur.join('\n').replace(/;$/, ''));
      cur = [];
      trigger = false;
    }
  }
  if (cur.length) out.push(cur.join('\n'));
  return out;
}

export function schemaModule(files) {
  const list = files.map((f) => ({ name: f.name, statements: splitStatements(f.sql) }));
  return `// Generated from migrations/ by scripts/build-schema.mjs. Do not edit; run: node scripts/build-schema.mjs\nexport const MIGRATIONS = ${JSON.stringify(list, null, 1)};\n`;
}
