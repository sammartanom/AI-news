// Local development and end-to-end test server. It runs the real Worker code against an in-memory
// SQLite D1 and the mock AI / Vectorize from test/helpers, and serves ./public the way Workers
// static assets do (exact file, .html fallback, directory index, SPA fallback, _headers).
//
//   npm run dev            http://localhost:8787 (seeded; signed in as editor@signal.test unless DEV_USER_EMAIL is "")
//
// The embeddings here are a toy hashing model, so semantic ranking is NOT representative of the
// real bge model. Use `wrangler dev` / a deployed Worker to judge search quality.
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeEnv } from '../helpers/mocks.mjs';
import { handle } from '../../src/index.mjs';

const root = fileURLToPath(new URL('../../public/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' };

function parseHeadersFile() {
  const rules = [];
  let current = null;
  for (const line of readFileSync(join(root, '_headers'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) { current = { pattern: line.trim(), headers: {} }; rules.push(current); continue; }
    const i = line.indexOf(':');
    current.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return rules;
}
const headerRules = parseHeadersFile();
const matches = (pattern, path) => (pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : pattern === path);

// Mirrors run_worker_first in wrangler.jsonc (besides /api/*).
const WORKER_FIRST = new Set(['/login', '/feed.xml', '/robots.txt', '/sitemap.xml', '/', '/grid', '/saved']);

function staticAsset(pathname, method) {
  const file = resolveAsset(pathname) ?? (method === 'GET' && !extname(pathname) ? join(root, 'index.html') : null);
  return file
    ? new Response(readFileSync(file), { headers: { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' } })
    : new Response('Not found', { status: 404 });
}

function resolveAsset(pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const candidates = [clean, clean + '.html', join(clean, 'index.html')];
  for (const c of candidates) {
    const file = join(root, c);
    if (file.startsWith(root) && existsSync(file) && statSync(file).isFile()) return file;
  }
  return null;
}

export async function startServer({ port = 0, env: envOptions = {}, answers = false } = {}) {
  const vars = { SEMANTIC_MIN_SCORE: '0.25', RELATED_MIN_SCORE: '0.3', BOOTSTRAP_EDITOR_EMAILS: 'editor@signal.test', ...envOptions };
  if (answers) Object.assign(vars, { ENABLE_AI_ANSWERS: 'true', CHAT_MODEL: '@cf/mock/chat' });
  const base = await makeEnv({ seed: true, vars });
  if (answers) {
    // Deterministic stand-in for a chat model: restates the first entries it was given.
    base.AI.chatResponse = (input) => {
      const entries = [...input.messages.at(-1).content.matchAll(/^\[(\d+)\] (.+)$/gm)];
      return { response: JSON.stringify({
        orientation: `There are ${entries.length} resources that relate to this question.`,
        considerations: entries.slice(0, 2).map((m) => ({ text: `${m[2]} is one place to look.`, sources: [Number(m[1])] })),
        uncertainty: entries.length ? [{ text: 'These entries are described by editor notes only.', sources: [1] }] : [],
        start_with: entries.slice(0, 2).map((m) => Number(m[1]))
      }) };
    };
  }
  const state = { env: base };

  const server = http.createServer(async (nodeReq, nodeRes) => {
    try {
      const origin = `http://${nodeReq.headers.host}`;
      const url = new URL(nodeReq.url, origin);
      const chunks = [];
      for await (const c of nodeReq) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const headers = new Headers();
      for (const [k, v] of Object.entries(nodeReq.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
      const request = new Request(url, { method: nodeReq.method, headers, body: ['GET', 'HEAD'].includes(nodeReq.method) ? undefined : body });
      // Test hook: act as a particular user via a cookie. Only exists in this harness.
      const cookie = /(?:^|;\s*)signal-dev-user=([^;]*)/.exec(nodeReq.headers.cookie ?? '');
      const devUser = cookie ? decodeURIComponent(cookie[1]) : process.env.DEV_USER_EMAIL ?? '';
      const env = { ...state.env, DEV_USER_EMAIL: devUser || undefined };

      let response;
      if (url.pathname.startsWith('/api/') || WORKER_FIRST.has(url.pathname)) {
        response = await handle(request, { ...env, ASSETS: { fetch: async (r) => staticAsset(new URL(r.url ?? r).pathname, 'GET') } }, { waitUntil() {} });
      } else {
        response = staticAsset(url.pathname, nodeReq.method);
      }
      const out = new Headers(response.headers);
      for (const rule of headerRules) if (matches(rule.pattern, url.pathname)) for (const [k, v] of Object.entries(rule.headers)) out.set(k, v);
      nodeRes.writeHead(response.status, Object.fromEntries(out));
      nodeRes.end(Buffer.from(await response.arrayBuffer()));
    } catch (e) {
      console.error(e);
      nodeRes.writeHead(500).end('Harness error');
    }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const actual = server.address().port;
  return { url: `http://localhost:${actual}`, env: state.env, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.env.DEV_USER_EMAIL ??= 'editor@signal.test';
  const s = await startServer({ port: Number(process.env.PORT) || 8787, answers: process.env.ANSWERS === '1' });
  console.log(`Signal harness on ${s.url} (mock AI and Vectorize, in-memory database, signed in as ${process.env.DEV_USER_EMAIL || 'nobody'})`);
}
