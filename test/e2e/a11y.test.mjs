import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { launch, open } from './helpers.mjs';

// Automated WCAG 2.1 AA checks (axe-core) on every page and modal, in light and dark, desktop and phone.
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
let ctx;
before(async () => { ctx = await launch(); });
after(async () => { await ctx.close(); });

async function audit(page, include) {
  await page.evaluate(AXE); // evaluated by the test browser, so the site's CSP still applies to everything else
  return page.evaluate(async (sel) => {
    const r = await window.axe.run(sel ? { include: [sel] } : document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
    return r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  }, include ?? null);
}

const PAGES = [
  ['home', '/', null],
  ['browse', '/grid', null],
  ['search', '/grid?q=literacy', null],
  ['saved', '/saved', null],
  ['resource dialog', '/?r=1', '#dialog'],
  ['about', '/?about', '#panel'],
  ['privacy', '/?privacy', '#panel'],
  ['digest', '/?digest=', '#panel'],
  ['reading path', '/?path=teacher-start', '#panel']
];

for (const [label, o] of [['desktop', {}], ['dark', { scheme: 'dark' }], ['phone', { width: 390, height: 844, touch: true }]]) {
  test(`accessibility (${label}): no WCAG 2.1 AA violations on pages and modals`, async () => {
    const { page, context } = await open(ctx, null, { ...o, reducedMotion: 'reduce' });
    const problems = [];
    for (const [name, path, scope] of PAGES) {
      await page.goto(ctx.server.url + path, { waitUntil: 'networkidle' });
      if (scope) await page.locator(`${scope}[open] h2`).first().waitFor();
      await page.waitForTimeout(300);
      for (const v of await audit(page, scope)) problems.push(`${name}: ${v}`);
    }
    assert.deepEqual(problems, []);
    await context.close();
  });
}
