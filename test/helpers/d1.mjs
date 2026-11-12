// Minimal D1Database implementation over node:sqlite, used by tests and the local harness.
// It follows the D1 API surface the Worker uses: prepare/bind/first/all/run/raw, batch, exec.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function normalize(params) {
  return params.map((v) => {
    if (v === undefined) throw new TypeError('D1 does not accept undefined bind values');
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
}

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    // Like real D1, which rejects a query with more than 100 bound parameters.
    if (params.length > 100) throw new Error(`D1_ERROR: too many SQL variables (${params.length}; the limit is 100)`);
    return new Statement(this.db, this.sql, normalize(params));
  }
  #run() {
    const stmt = this.db.raw.prepare(this.sql);
    return { stmt, params: this.params };
  }
  async first(col) {
    const { stmt, params } = this.#run();
    const row = stmt.get(...params);
    if (!row) return null;
    const plain = { ...row };
    return col ? plain[col] ?? null : plain;
  }
  async all() {
    const { stmt, params } = this.#run();
    const results = stmt.all(...params).map((r) => ({ ...r }));
    return { success: true, results, meta: { changes: 0, rows_read: results.length } };
  }
  async raw() {
    const { stmt, params } = this.#run();
    stmt.setReturnArrays?.(true);
    return stmt.all(...params);
  }
  async run() {
    const { stmt, params } = this.#run();
    const info = stmt.run(...params);
    return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }
}

export class D1Shim {
  constructor(path = ':memory:') {
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.writes = 0;
  }
  prepare(sql) {
    return new Statement(this, sql);
  }
  async batch(statements) {
    const out = [];
    this.raw.exec('BEGIN');
    try {
      for (const s of statements) out.push(await s.run());
      this.raw.exec('COMMIT');
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
    return out;
  }
  async exec(sql) {
    this.raw.exec(sql);
    return { count: 1, duration: 0 };
  }
}

export function migrationFiles() {
  const dir = join(root, 'migrations');
  return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => ({ name: f, sql: readFileSync(join(dir, f), 'utf8') }));
}

export function applyMigrations(db, { upTo } = {}) {
  for (const m of migrationFiles()) {
    if (upTo && m.name > upTo) break;
    db.raw.exec(m.sql);
  }
  return db;
}

export function freshDb(opts) {
  const db = new D1Shim();
  applyMigrations(db, opts);
  return db;
}
