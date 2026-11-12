import { match } from './router.mjs';
import { json, HttpError } from './lib/http.mjs';
import { currentUser } from './auth/session.mjs';
import { editorDevice } from './auth/device.mjs';
import { runScheduled } from './jobs.mjs';
import { ensureSchema } from './db/migrate.mjs';
import './routes/public.mjs';
import './routes/me.mjs';
import './routes/vault.mjs';
import './routes/editor.mjs';
import './routes/pages.mjs';

// Routes that need the signed-in editor (Cloudflare Access). Everything else skips identity checks entirely.
const NEEDS_USER = /^\/(api\/(me|editor)(\/|$)|login$)/;

export async function handle(req, env, exec) {
  const url = new URL(req.url);
  const path = url.pathname;
  try {
    // HEAD is answered as GET without the body (link-preview bots often check a page with HEAD first).
    const head = req.method === 'HEAD';
    const { handler, params, pathMatched } = match(head ? 'GET' : req.method, path);
    if (!handler) {
      if (pathMatched) throw new HttpError(405, 'Method not allowed');
      if (path.startsWith('/api/')) throw new HttpError(404, 'Not found');
      return env.ASSETS ? env.ASSETS.fetch(req) : new Response('Not found', { status: 404 });
    }
    await ensureSchema(env); // a brand-new, empty database sets itself up on first use
    const c = { req, env, url, params, exec, user: null, device: false };
    if (NEEDS_USER.test(path)) [c.user, c.device] = await Promise.all([currentUser(req, env), editorDevice(req, env)]);
    const out = await handler(c);
    const res = out instanceof Response ? out : json(out);
    return head ? new Response(null, { status: res.status, headers: res.headers }) : res;
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status);
    console.error('unhandled error:', req.method, path, e);
    return json({ error: 'Request failed' }, 500);
  }
}

export default {
  fetch: handle,
  async scheduled(event, env, exec) {
    exec.waitUntil(ensureSchema(env).then(() => runScheduled(env, event.cron)));
  }
};
