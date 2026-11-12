// Regenerates src/db/schema.generated.mjs from migrations/. Run after adding a migration:
//   node scripts/build-schema.mjs
// A unit test fails if the generated file is out of date.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { schemaModule } from './lib/schema.mjs';

const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((name) => ({ name, sql: readFileSync(dir + name, 'utf8') }));
writeFileSync(new URL('../src/db/schema.generated.mjs', import.meta.url), schemaModule(files));
console.log(`wrote src/db/schema.generated.mjs (${files.length} migrations)`);
