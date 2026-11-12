// The district site must not collect or keep personal information. These checks hold the
// configuration to that: no sign-in accounts (Cloudflare Access is what creates them), no
// Cloudflare request logs, no donate or other third-party frame, and nothing loaded from elsewhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ABOUT } from '../../public/js/about.js';
import { PAGE_HEADERS } from '../../src/routes/pages.mjs';

const jsonc = (s) => JSON.parse(s.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'));
const cfg = jsonc(readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));

test('district privacy: no accounts, so no email addresses are ever stored', () => {
  assert.equal(cfg.vars.ACCESS_TEAM_DOMAIN, '');
  assert.equal(cfg.vars.ACCESS_AUD, '');
  assert.equal(cfg.vars.DEV_USER_EMAIL, undefined);
  assert.equal(cfg.vars.SHARE_ALLOWED_DOMAINS, '');
});

test('district privacy: Cloudflare request logging is off', () => {
  assert.equal(cfg.observability?.enabled, false);
  assert.equal(cfg.observability?.logs?.enabled, false);
});

test('district privacy: no donate link and no third-party frames or connections', () => {
  assert.equal(ABOUT.donate.href, '');
  assert.equal(ABOUT.donate.embed, '');
  const csp = PAGE_HEADERS['Content-Security-Policy'];
  assert.match(csp, /frame-src 'none'/);
  assert.match(csp, /connect-src 'self';/);
  assert.match(PAGE_HEADERS['Permissions-Policy'], /payment=\(\)/);
});
