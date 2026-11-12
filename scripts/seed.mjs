// Generates SQL that loads the seed catalog into D1.
//   node scripts/seed.mjs --out .wrangler/seed.sql
// then: npx wrangler d1 execute DB --remote --file=.wrangler/seed.sql
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { seedStatements, sourceStatements, toSqlFile } from './lib/seed.mjs';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : '.wrangler/seed.sql';
const data = JSON.parse(readFileSync(new URL('../data/resources.seed.json', import.meta.url), 'utf8'));
const sources = JSON.parse(readFileSync(new URL('../data/sources.seed.json', import.meta.url), 'utf8'));
const sql = toSqlFile([...seedStatements(data), ...sourceStatements(sources)]);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, sql);
console.log(`Wrote ${out} (${data.length} resources, ${sources.length} candidate sources, all switched off). Apply with: npx wrangler d1 execute DB --local|--remote --file=${out}`);
