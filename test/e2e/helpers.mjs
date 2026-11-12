// Browser tests drive the real frontend against the local harness (real Worker code, in-memory
// D1, mock AI/Vectorize). Playwright is resolved from the environment: `npm i -D playwright` and
// `npx playwright install chromium`, or a globally installed copy.
import { createRequire } from 'node:module';
import { startServer } from '../harness/server.mjs';

const require = createRequire(import.meta.url);
export const { chromium } = require('playwright');

export async function launch() {
  delete process.env.DEV_USER_EMAIL;
  const server = await startServer({ answers: false });
  const browser = await chromium.launch();
  return { server, browser, close: async () => { await browser.close(); await server.close(); } };
}

/** New isolated page. `user` signs in through the harness cookie (null = anonymous). */
export async function open(ctx, path, { width = 1440, height = 900, scheme = 'light', reducedMotion = 'no-preference', user = null, touch = false, wait = true } = {}) {
  const context = await ctx.browser.newContext({ viewport: { width, height }, colorScheme: scheme, reducedMotion, hasTouch: touch, acceptDownloads: true });
  if (user !== undefined) await context.addCookies([{ name: 'signal-dev-user', value: user ?? '', url: ctx.server.url }]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  if (path) await page.goto(ctx.server.url + path, { waitUntil: wait ? 'networkidle' : 'load' });
  return { page, context, errors };
}

export const rgb = (s) => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
