// Repository checks that need no dependencies: syntax, committed-secret patterns, and the copy
// rules from the product brief (no hype phrases, no emoji in the interface).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['node_modules', '.git', '.wrangler', 'coverage', 'test-results']);
const problems = [];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}
const files = [...walk(root)];
const rel = (f) => relative(root, f);

// 1. Syntax of every JavaScript module.
for (const f of files.filter((x) => extname(x) === '.mjs' || (extname(x) === '.js' && rel(x).startsWith('public')))) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) problems.push(`syntax: ${rel(f)}\n${r.stderr}`);
}

// 2. Secrets must not be committed.
const SECRET = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bcf[a-z]{0,3}[_-]?(api)?[_-]?token\s*[:=]\s*["']?[A-Za-z0-9_-]{30,}/i, 'Cloudflare API token'],
  [/\bBearer\s+[A-Za-z0-9._-]{24,}/, 'bearer token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/, 'GitHub token'],
  [/\bADMIN_TOKEN\s*[:=]\s*["'][^"']{8,}/, 'ADMIN_TOKEN value']
];
for (const f of files) {
  if (/\.(woff2|png|jpg|ico)$/.test(f) || rel(f) === 'package-lock.json' || rel(f).startsWith('test/')) continue;
  const text = readFileSync(f, 'utf8');
  for (const [re, label] of SECRET) if (re.test(text)) problems.push(`secret: ${label} in ${rel(f)}`);
}
const gi = readFileSync(join(root, '.gitignore'), 'utf8');
for (const must of ['.dev.vars', 'node_modules', '.wrangler']) if (!gi.includes(must)) problems.push(`.gitignore is missing ${must}`);
const wr = readFileSync(join(root, 'wrangler.jsonc'), 'utf8');
for (const key of ['ADMIN_TOKEN', 'BOOTSTRAP_EDITOR_EMAILS', 'DEV_USER_EMAIL']) {
  if (new RegExp(`"${key}"\\s*:`).test(wr)) problems.push(`wrangler.jsonc must not set ${key}; it is a secret or local-only`);
}
if (/REPLACE_WITH/.test(wr)) problems.push('wrangler.jsonc still has a placeholder');

// 3. Migrations must be additive. Destructive statements need an explicit, reviewed opt-in comment
// in the same file: "-- allow-destructive: <reason>". 0001 predates this rule and is never edited.
const DESTRUCTIVE = /\b(DROP\s+(TABLE|COLUMN|INDEX|TRIGGER|VIEW)|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE\s+\w+\s+(RENAME|DROP))\b/i;
for (const f of files.filter((x) => /^migrations\/\d{4}_.*\.sql$/.test(rel(x)) && !rel(x).startsWith('migrations/0001_'))) {
  const sql = readFileSync(f, 'utf8');
  const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  if (DESTRUCTIVE.test(code) && !/--\s*allow-destructive:\s*\S+/.test(sql)) problems.push(`migration: destructive statement without "-- allow-destructive: <reason>" in ${rel(f)}`);
  if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(rel(f).split('/')[1])) problems.push(`migration: bad file name ${rel(f)}`);
}

// 4. Copy rules for everything a visitor can read.
const BANNED = [
  'unlock', 'empower', 'revolutioniz', 'transformative', 'navigate the', 'harness the power', 'cutting-edge', 'cutting edge',
  'game-changing', 'game changing', 'dive into', 'thoughtfully curated', 'discover the future', 'explore a world', 'rapidly evolving'
];
const EMOJI = /\p{Extended_Pictographic}/u;
const visible = files.filter((f) => /^public\//.test(rel(f)) && ['.html', '.js', '.css'].includes(extname(f)));
for (const f of visible) {
  const text = readFileSync(f, 'utf8');
  const lower = text.toLowerCase();
  for (const b of BANNED) if (lower.includes(b)) problems.push(`copy: "${b}" in ${rel(f)}`);
  if (EMOJI.test(text)) problems.push(`emoji in ${rel(f)}`);
  // Gradients are allowed only as a mask (fading the edge of a scrolling row), never as decoration.
  const unmasked = text.replace(/(?:-webkit-)?mask-image:[^;]*;/g, '');
  if (/gradient\(|backdrop-filter/.test(unmasked)) problems.push(`decorative effect (gradient or blur) in ${rel(f)}`);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`check passed: ${files.length} files`);
