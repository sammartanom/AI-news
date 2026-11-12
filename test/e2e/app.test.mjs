import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { launch, open } from './helpers.mjs';
import { startServer } from '../harness/server.mjs';

let ctx;
before(async () => { ctx = await launch(); });
after(async () => { await ctx.close(); });

const rowTitles = (page) => page.locator('.rows .row h3').allInnerTexts();

test('search: submitting from the home page shows results, a status message and no console errors', async () => {
  const { page, errors, context } = await open(ctx, '/');
  await page.getByRole('searchbox', { name: 'Search resources' }).fill('What should parents know about AI and children?');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.waitForURL(/\/grid\?q=/);
  await page.waitForSelector('.rows .row');
  assert.match(await page.locator('h1').innerText(), /parents/);
  assert.match(await page.locator('.status').first().innerText(), /^\d+ results$/);
  assert.ok((await rowTitles(page)).length > 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('search: results show on the browse page, filters narrow them, and the search can be cleared', async () => {
  const { page, context, errors } = await open(ctx, '/search?q=' + encodeURIComponent('AI literacy')); // old links still work
  await page.waitForSelector('.rows .row');
  assert.match(page.url(), /\/grid\?q=AI\+literacy|\/grid\?q=AI%20literacy/);
  assert.equal(await page.locator('.query-text').innerText(), '“AI literacy”');
  assert.equal(await page.locator('#g-sort').count(), 0, 'a search is ordered by relevance');
  const all = await page.locator('.rows .row').count();
  await page.goto(ctx.server.url + '/grid?q=' + encodeURIComponent('AI literacy') + '&audience=Families', { waitUntil: 'networkidle' });
  await page.waitForSelector('.rows .row, .empty');
  assert.ok((await page.locator('.rows .row').count()) <= all);
  // A search typed into the filter palette stays on this page.
  await page.locator('#fq').fill('privacy');
  await page.getByRole('option', { name: /Search for “privacy”/ }).click();
  await page.waitForFunction(() => new URL(location.href).searchParams.get('q') === 'privacy');
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.waitForFunction(() => !new URL(location.href).searchParams.get('q'));
  await page.locator('#g-sort').waitFor();
  assert.match(await page.locator('.status').first().innerText(), /resources$/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('search: no results and keyword fallback are explained plainly', async () => {
  const { page, context } = await open(ctx, '/grid?q=zzzzqqqq');
  await page.waitForSelector('.empty-state');
  assert.match(await page.locator('.empty-state .empty-title').innerText(), /Nothing found for “zzzzqqqq”/);
  assert.equal(await page.locator('.status').first().innerText(), '0 results');
  // Never a dead end: editors' picks to start with, each opening the resource.
  assert.ok(await page.locator('.empty-state .rows .row').count() > 0);
  await context.close();
});

test('filters: sort and filter the complete collection; state lives in the URL', async () => {
  const { page, context } = await open(ctx, '/grid');
  await page.waitForSelector('.rows .row');
  assert.equal(await page.locator('.status').first().innerText(), '30 resources');
  await page.locator('#g-sort').selectOption('publisher');
  await page.waitForFunction(() => new URL(location.href).searchParams.get('sort') === 'publisher');
  await page.waitForTimeout(300);
  const pubs = await page.locator('.rows .row .by .pub').allInnerTexts();
  assert.deepEqual(pubs, [...pubs].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
  // The palette: type, pick with the keyboard, filters become tokens and live in the URL.
  const fq = page.locator('#fq');
  await fq.click();
  assert.equal(await fq.getAttribute('aria-expanded'), 'true');
  await fq.fill('collection: research');
  await page.locator('[role=option][aria-selected=true]', { hasText: 'Research and evidence' }).waitFor();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.status').innerText === '3 resources');
  assert.equal((await rowTitles(page)).length, 3);
  assert.match(page.url(), /collection=research-evidence/);
  assert.match(await page.locator('.pal-token').innerText(), /Collection\s*Research and evidence/);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.rows .row');
  assert.equal(await page.locator('.status').first().innerText(), '3 resources');
  assert.equal(await page.locator('.pal-token').count(), 1);
  // Backspace on the empty field removes the last token; a "group: value" query narrows to one group.
  await fq.click();
  await page.keyboard.press('Backspace');
  await page.waitForFunction(() => document.querySelector('.status').innerText === '30 resources');
  await fq.fill('format: pod');
  assert.deepEqual(await page.locator('.pal-group:not(:has(.pal-search)) .pal-head').allInnerTexts(), ['Format']);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.status').innerText === '2 resources');
  await page.keyboard.press('Escape');
  assert.equal(await fq.getAttribute('aria-expanded'), 'false');
  // The token's remove button is labelled and works.
  await page.getByRole('button', { name: 'Remove Format: Podcast' }).click();
  await page.waitForFunction(() => document.querySelector('.status').innerText === '30 resources');
  await context.close();
});

test('grid page opens as cards; the choice is remembered per page', async () => {
  const { page, context } = await open(ctx, '/grid');
  await page.waitForSelector('.rows .row');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.layout), 'grid');
  await page.getByRole('button', { name: 'List view' }).click();
  await page.waitForFunction(() => document.documentElement.dataset.layout === 'list');
  await page.goto(ctx.server.url + '/grid?q=literacy', { waitUntil: 'networkidle' });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.layout), 'list');
  await page.goto(ctx.server.url + '/grid', { waitUntil: 'networkidle' });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.layout), 'list');
  await context.close();
});

test('grid: rows show only title, source and one date; unknown publication dates stay unknown', async () => {
  const { page, context } = await open(ctx, '/grid');
  await page.waitForSelector('.rows .row');
  const row = await page.locator('.rows .row').first().innerText();
  assert.match(row, /Added \w{3} \d{1,2}, 2026/); // publication date unknown, so the card shows when it was added
  assert.doesNotMatch(row, /Publication date|Published/);
  await page.locator('.rows .row h3 button').first().click();
  await page.waitForSelector('dialog[open] .detail .meta');
  // An unknown publication date is not shown as one: the date line says when it was added.
  assert.match(await page.locator('dialog[open] .meta').innerText(), /^Added \w{3} \d{1,2}, 2026/);
  await context.close();
});

test('grid: long lists page with "Show more"', async () => {
  const { page, context } = await open(ctx, '/grid');
  await page.waitForSelector('.rows .row');
  assert.equal(await page.locator('.rows .row').count(), 24);
  await page.getByRole('button', { name: /Show more \(6 left\)/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.rows .row').length === 30);
  assert.equal(await page.getByRole('button', { name: /Show more/ }).count(), 0);
  await context.close();
});

test('resource dialog: opens, is labelled, traps focus, closes with Escape and returns focus', async () => {
  const { page, context } = await open(ctx, '/grid');
  await page.waitForSelector('.rows .row');
  const opener = page.locator('.rows .row h3 button').first();
  const title = await opener.innerText();
  await opener.focus();
  await page.keyboard.press('Enter');
  const dlg = page.locator('dialog[open]');
  await dlg.waitFor();
  assert.equal(await dlg.locator('h2').innerText(), title);
  const labelledBy = await dlg.getAttribute('aria-labelledby');
  assert.equal(await page.locator('#' + labelledBy).innerText(), title);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'dlg-title');
  assert.match(page.url(), /[?&]r=/);
  // focus stays inside while tabbing
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('dialog') || document.activeElement === document.body), true);
  }
  const link = dlg.locator('.actions a.btn-primary'); // "View original", or "Start the course" and the like
  assert.match(await link.getAttribute('href'), /^https:\/\//);
  assert.match(await link.getAttribute('rel'), /noopener/);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  // Focus returns in the dialog's close event, a moment after it closes; wait for it rather than race it.
  await opener.evaluate((el) => new Promise((resolve, reject) => {
    const t0 = performance.now();
    const check = () => (el === document.activeElement ? resolve() : performance.now() - t0 > 2000 ? reject(new Error('focus did not return to the opener')) : requestAnimationFrame(check));
    check();
  }));
  assert.doesNotMatch(await page.evaluate(() => location.href), /[?&]r=/); // the page's own URL; page.url() can lag history updates
  await context.close();
});

test('resource dialog: related resources load after it opens; links to others work; deep links open it', async () => {
  const { page, context } = await open(ctx, '/grid');
  await page.waitForSelector('.rows .row');
  const related = page.waitForResponse((r) => /\/api\/resources\/[^/]+\/related/.test(r.url()));
  await page.locator('.rows .row h3 button').first().click();
  await page.locator('dialog[open] .detail h2').waitFor();
  await related;
  await page.waitForSelector('dialog .rel');
  const first = await page.locator('dialog .rel button').first().innerText();
  await page.locator('dialog .rel button').first().click();
  await page.waitForFunction((t) => document.querySelector('dialog h2')?.innerText === t, first);
  const url = page.url();
  assert.match(url, /r=/);
  await page.keyboard.press('Escape');
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('dialog[open] h2').waitFor();
  await context.close();
});

test('resource dialog: kept short, with the date, why it is here and related reading as pills', async () => {
  const { page, context } = await open(ctx, '/?r=1');
  const dlg = page.locator('dialog[open]');
  await dlg.waitFor();
  const text = await dlg.innerText();
  assert.match(text, /Why it.s here/i);
  assert.match(text, /Best for/i);
  assert.match(await dlg.locator('.meta').innerText(), /^Added \w{3} \d{1,2}, 2026/);
  for (const gone of [/Details/, /Checked/, /Collections/, /From the publisher/]) assert.doesNotMatch(text, gone);
  await dlg.locator('.rel .pill').first().waitFor();
  assert.match(await dlg.innerText(), /Related/);
  assert.equal(await dlg.getByRole('textbox', { name: 'Your note' }).count(), 1);
  await context.close();
});

test('resource dialog: an AI brief sits under the title, labelled, with the actions right after it', async () => {
  const db = ctx.server.env.DB;
  const ids = (await db.prepare("SELECT id FROM resources WHERE status = 'published' ORDER BY id LIMIT 2").all()).results.map((r) => r.id);
  await db.prepare("UPDATE resources SET ai_brief = ?, ai_brief_basis = 'page' WHERE id = ?").bind('A practical district guide to using AI feedback tools on student writing, with rubrics.', ids[0]).run();
  const { page, context, errors } = await open(ctx, '/?r=' + ids[0]);
  const dlg = page.locator('dialog[open]');
  await dlg.locator('.brief-text').waitFor();
  assert.match(await dlg.locator('.brief-text').innerText(), /^A practical district guide/);
  assert.match(await dlg.locator('.brief').innerText(), /In brief[\s\S]*AI[\s\S]*Written by AI from the publisher/i);
  const order = await dlg.evaluate((el) => ['.kicker', 'h2', '.meta', '.brief', '.actions'].map((s) => el.querySelector(s).getBoundingClientRect().top));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'kicker, title, meta, brief, actions');
  assert.equal(await dlg.getByRole('button', { name: 'Copy link to this resource' }).count(), 1);
  await page.keyboard.press('Escape');
  // Without a brief and no model to write one, the card leaves quietly.
  await page.goto(ctx.server.url + '/?r=' + ids[1], { waitUntil: 'networkidle' });
  await page.locator('dialog[open] h2').waitFor();
  await page.waitForFunction(() => !document.querySelector('dialog[open] .brief'));
  await db.prepare('UPDATE resources SET ai_brief = NULL, ai_brief_basis = NULL').run();
  assert.deepEqual(errors, []);
  await context.close();
});

test('missing resources and a failing API are explained, with a way to retry', async () => {
  const { page, context } = await open(ctx, '/?r=does-not-exist');
  await page.locator('dialog[open] h2').waitFor();
  assert.equal(await page.locator('dialog[open] h2').innerText(), 'Resource not found');
  await context.close();

  const g = await open(ctx, null);
  let fail = true;
  await g.page.route('**/api/resources?*', (route) => (fail ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Request failed"}' }) : route.continue()));
  await g.page.goto(ctx.server.url + '/grid', { waitUntil: 'networkidle' });
  const alert = g.page.getByRole('alert');
  await alert.waitFor();
  assert.match(await alert.innerText(), /Request failed/);
  fail = false;
  await g.page.getByRole('button', { name: 'Try again' }).click();
  await g.page.waitForSelector('.rows .row');
  await g.context.close();

  const s = await open(ctx, null);
  await s.page.route('**/api/search*', (route) => route.abort());
  await s.page.goto(ctx.server.url + '/grid?q=literacy', { waitUntil: 'networkidle' });
  await s.page.getByRole('alert').waitFor();
  assert.match(await s.page.getByRole('alert').innerText(), /Could not reach the server/);
  await s.context.close();
});

test('home still works when the featured list cannot load', async () => {
  const { page, context } = await open(ctx, null);
  await page.route('**/api/featured*', (route) => route.fulfill({ status: 500, body: '{}', contentType: 'application/json' }));
  await page.route('**/api/resources?*', (route) => route.fulfill({ status: 500, body: '{}', contentType: 'application/json' }));
  await page.goto(ctx.server.url + '/', { waitUntil: 'networkidle' });
  assert.equal(await page.locator('.orbit-card').count(), 0);
  await page.getByRole('searchbox').fill('privacy');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.rows .row');
  await context.close();
});

test('keyboard: skip link, tab order, lenses, search with Enter, visible focus', async () => {
  const { page, context } = await open(ctx, '/grid');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'skip');
  assert.equal(await page.locator('.skip').isVisible(), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'brand');
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  assert.notEqual(outline, 'none');
  await context.close();

  // The skip link, the wordmark, then the menu button. The closed menu's links are not in the tab order.
  const g = await open(ctx, '/grid');
  const order = [];
  for (let i = 0; i < 3; i++) { await g.page.keyboard.press('Tab'); order.push(await g.page.evaluate(() => document.activeElement.getAttribute('aria-label') || document.activeElement.textContent.trim().slice(0, 20))); }
  assert.deepEqual(order, ['Skip to content', 'Home', 'Menu']);
  await g.page.keyboard.press('Enter');
  await g.page.waitForFunction(() => document.activeElement?.textContent === 'Search');
  const links = [];
  for (let i = 0; i < 2; i++) { await g.page.keyboard.press('Tab'); links.push(await g.page.evaluate(() => document.activeElement.textContent.trim())); }
  assert.deepEqual(links.slice(0, 2), ['Browse', 'Saved']);
  await g.page.keyboard.press('Escape');
  await g.page.locator('#nav').waitFor({ state: 'hidden' });
  assert.equal(await g.page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Menu');
  await g.context.close();

  // Home: the search box has focus on desktop, then the button; Enter searches.
  const h = await open(ctx, '/');
  assert.equal(await h.page.evaluate(() => document.activeElement.id), 'q');
  await h.page.keyboard.press('Tab');
  assert.equal(await h.page.evaluate(() => document.activeElement.textContent), 'Search');
  await h.page.getByRole('searchbox').focus();
  await h.page.keyboard.type('assessment');
  await h.page.keyboard.press('Enter');
  await h.page.waitForURL(/\/grid\?q=assessment$/);
  await h.context.close();
});

test('status messages for dynamic updates are announced in live regions', async () => {
  const { page, context } = await open(ctx, '/grid?q=literacy');
  await page.waitForSelector('.rows .row');
  assert.equal(await page.locator('.status').first().getAttribute('role'), 'status');
  assert.equal(await page.locator('#live').getAttribute('role'), 'status');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('link', { name: 'Browse' }).click();
  await page.waitForFunction(() => document.querySelector('#live').textContent === '30 resources');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'page-title'); // focus moves to the new page heading
  await context.close();
});

test('no page shows the product name', async () => {
  for (const path of ['/', '/grid', '/grid?q=literacy', '/saved', '/privacy', '/editor/']) {
    const { page, context } = await open(ctx, path);
    await page.waitForTimeout(400);
    const text = await page.evaluate(() => document.body.innerText + ' ' + document.title);
    assert.doesNotMatch(text, /\bSignal\b/, path);
    await context.close();
  }
});

test('every page: one h1, landmarks, labelled form controls', async () => {
  for (const path of ['/', '/grid', '/grid?q=literacy', '/saved']) {
    const { page, context } = await open(ctx, path);
    await page.waitForTimeout(200);
    assert.equal(await page.locator('h1').count(), 1, `${path}: h1`);
    assert.equal(await page.locator('main').count(), 1, `${path}: main`);
    assert.equal(await page.locator('nav#nav').count(), 1, `${path}: navigation`);
    const unlabeled = await page.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]), select, textarea')].filter((el) => !(el.labels?.length || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'))).map((el) => el.outerHTML.slice(0, 80)));
    assert.deepEqual(unlabeled, [], `${path}: unlabeled controls`);
    const unnamed = await page.evaluate(() => [...document.querySelectorAll('button, a[href]')].filter((el) => !(el.textContent.trim() || el.getAttribute('aria-label'))).map((el) => el.outerHTML.slice(0, 80)));
    assert.deepEqual(unnamed, [], `${path}: unnamed buttons or links`);
    await context.close();
  }
});

test('saved: saves on this device, survives reload, exports with notes', async () => {
  const { page, context } = await open(ctx, '/grid', { user: null });
  await page.waitForSelector('.rows .row');
  const first = page.locator('.rows .row').nth(0);
  const second = page.locator('.rows .row').nth(1);
  const t1 = await first.locator('h3').innerText();
  await first.getByRole('button', { name: /^Save/ }).click();
  await second.getByRole('button', { name: /^Save/ }).click();
  await page.waitForFunction(() => /Saved 2/.test(document.querySelector('#nav').textContent));
  assert.equal(await first.getByRole('button', { name: /^Saved/ }).getAttribute('aria-pressed'), 'true');

  await first.locator('h3 button').click();
  await page.locator('dialog #note').fill('Use in the August workshop');
  await page.waitForSelector('dialog [role=status]:has-text("Note saved.")');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('link', { name: /^Saved/ }).click();
  await page.waitForSelector('.rows .row');
  assert.equal(await page.locator('.rows .row').count(), 2);
  assert.match(await page.locator('.rows').innerText(), /Use in the August workshop/);
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('.rows .row').count(), 2);

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-md').click()]);
  const text = await readFile(await download.path(), 'utf8');
  assert.match(text, new RegExp(t1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(text, /Published: Unknown/);
  assert.match(text, /Note: Use in the August workshop/);

  await page.locator('.rows .row').first().getByRole('button', { name: /^Saved/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.rows .row').length === 1);
  await context.close();
});

const linkOf = (page) => page.evaluate(() => `${location.origin}/saved#key=${JSON.parse(localStorage.getItem('signal:sync')).s}`);

test('saved: a private link syncs encrypted saves and notes to another device', async () => {
  const a = await open(ctx, '/grid');
  await a.page.waitForSelector('.rows .row');
  const ids = await a.page.locator('.rows .row').evaluateAll((rows) => rows.slice(0, 2).map((r) => r.dataset.id));
  for (const i of [0, 1]) await a.page.locator('.rows .row').nth(i).getByRole('button', { name: /^Save/ }).click();
  await a.page.locator('.rows .row h3 button').first().click();
  await a.page.locator('dialog #note').fill('Bring to the staff meeting');
  await a.page.waitForSelector('dialog [role=status]:has-text("Note saved.")');
  await a.page.keyboard.press('Escape');
  await a.page.goto(ctx.server.url + '/saved', { waitUntil: 'networkidle' });

  // Everything that leaves the browser is ciphertext.
  const bodies = [];
  a.page.on('request', (r) => { if (r.url().includes('/api/vault/')) bodies.push(`${r.headers().authorization ?? ''} ${r.postData() ?? ''}`); });
  await a.page.getByRole('button', { name: 'Use a private link' }).click();
  await a.page.locator('.vault-status[data-status=synced]').waitFor();
  assert.ok(bodies.length > 0);
  const titles = await a.page.locator('.rows .row h3').allInnerTexts();
  for (const b of bodies) for (const secret of [...titles, 'staff meeting', ...ids.map((id) => `"${id}"`)]) assert.ok(!b.includes(secret), 'plaintext left the browser');
  await a.page.locator('#vault-device svg.qr').waitFor();
  const link = await linkOf(a.page);

  // Another device opens the link: the key leaves the address bar, and the saves and note arrive.
  const b = await open(ctx, null);
  await b.page.goto(link, { waitUntil: 'networkidle' });
  assert.equal(new URL(b.page.url()).hash, '');
  await b.page.getByRole('button', { name: 'Open saves here' }).click();
  await b.page.waitForFunction(() => document.querySelectorAll('.rows .row').length === 2);
  assert.match(await b.page.locator('.rows').innerText(), /Bring to the staff meeting/);

  // A change on one device reaches the other.
  await b.page.locator('.rows .row').first().getByRole('button', { name: /^Saved/ }).click();
  await b.page.locator('.vault-status[data-status=synced]').waitFor();
  await b.page.waitForTimeout(1200);
  await a.page.reload({ waitUntil: 'networkidle' });
  await a.page.waitForFunction(() => document.querySelectorAll('.rows .row').length === 1);

  // Delete everywhere removes the encrypted copy; the link then opens nothing.
  a.page.once('dialog', (d) => d.accept());
  await a.page.getByText('Manage').click();
  await a.page.getByRole('button', { name: 'Delete everywhere' }).click();
  await a.page.locator('.vault-msg', { hasText: 'Deleted everywhere.' }).waitFor();
  // The other device notices on its next sync and clears its copy too.
  await b.page.reload({ waitUntil: 'networkidle' });
  await b.page.getByRole('heading', { name: 'Keep your saves on every device' }).waitFor();
  await b.page.waitForFunction(() => !document.querySelector('.rows .row'));
  await a.context.close();
  await b.context.close();
});

test('saved: a passkey protects the saves and opens them again after this device forgets them', async () => {
  const { page, context, errors } = await open(ctx, '/grid');
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } });
  await page.waitForSelector('.rows .row');
  await page.locator('.rows .row').first().getByRole('button', { name: /^Save/ }).click();
  await page.goto(ctx.server.url + '/saved', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Protect with a passkey' }).click();
  await page.getByRole('heading', { name: 'Protected by your passkey' }).waitFor();
  await page.locator('.vault-status[data-status=synced]').waitFor();
  await page.getByText('Manage').click();
  await page.getByRole('button', { name: 'Remove from this device' }).click();
  await page.waitForFunction(() => !document.querySelector('.rows .row'));
  assert.equal(await page.evaluate(() => localStorage.getItem('signal:sync')), null);
  await page.getByRole('button', { name: /Open with your passkey/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.rows .row').length === 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('phones: a bottom dock replaces the menu button, and the filter palette opens as a full-screen sheet', async () => {
  const { page, context } = await open(ctx, '/grid', { width: 390, height: 844, touch: true });
  await page.waitForSelector('.rows .row');
  assert.equal(await page.locator('.menu-toggle').isVisible(), false);
  const dock = page.getByRole('navigation', { name: 'Quick' });
  assert.deepEqual(await dock.locator('.dock-label').allInnerTexts(), ['Home', 'Browse', 'Saved', 'More']);
  assert.equal(await dock.getByRole('link', { name: /Browse/ }).getAttribute('aria-current'), 'page');
  await page.locator('.rows .row').first().getByRole('button', { name: /^Save/ }).click();
  await dock.locator('.badge', { hasText: '1' }).waitFor();
  await page.locator('#fq').click();
  await page.waitForTimeout(500);
  const box = await page.locator('.palette').boundingBox();
  assert.deepEqual([box.x, box.y, box.width], [0, 0, 390]);
  await page.getByRole('button', { name: 'Done' }).click();
  assert.equal(await page.locator('.palette.open').count(), 0);
  await dock.getByRole('button', { name: 'Menu' }).click();
  await page.locator('#nav.open').waitFor();
  await dock.getByRole('link', { name: /Saved/ }).click();
  await page.waitForURL(/\/saved$/);
  await page.waitForSelector('.rows .row');
  await context.close();
});

test('editor console: review an incoming item, publish it, then it is public', async () => {
  const api = (path, init) => fetch(ctx.server.url + path, { ...init, headers: { 'content-type': 'application/json', origin: ctx.server.url, cookie: 'signal-dev-user=editor@signal.test', ...(init?.headers ?? {}) } });
  const added = await (await api('/api/editor/resources', { method: 'POST', body: JSON.stringify({ url: 'https://example.org/e2e-queued', title: 'Zebra assessment rubrics for AI-assisted essays', publisher: 'Example Journal', format: 'Report' }) })).json();
  const id = added.resource.id;
  const pub = await (await fetch(ctx.server.url + '/api/search?q=zebra')).json();
  assert.equal(pub.total, 0, 'incoming items are not public');

  const { page, context } = await open(ctx, '/editor/', { user: 'editor@signal.test' });
  await page.getByRole('button', { name: /^Zebra assessment rubrics/ }).click();
  await page.waitForSelector('.ed-detail .ed-form');
  await page.locator('.ed-actions').getByRole('button', { name: 'Publish', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.ed-detail .ed-msg')?.className.includes('ed-flag'));
  assert.match(await page.locator('.ed-detail .ed-msg').innerText(), /Cannot publish: missing why included, audience/);

  await page.getByLabel('Why included').fill('A practical rubric set for essays written with AI help.');
  await page.getByRole('group', { name: 'Audience' }).getByLabel('Teachers').check();
  await page.getByRole('group', { name: 'Collections' }).getByLabel('Assessment and academic integrity').check();
  await page.getByLabel('Topics').fill('assessment, writing');
  await page.getByLabel('Original publication date').fill('2025-03');
  await page.locator('.ed-actions').getByRole('button', { name: 'Publish', exact: true }).click();
  await page.waitForFunction(() => /Published/.test(document.querySelector('.ed-detail .ed-msg')?.innerText ?? ''));

  const after = await (await fetch(ctx.server.url + '/api/search?q=zebra')).json();
  assert.equal(after.total, 1);
  assert.equal(after.results[0].published_at, '2025-03');
  assert.equal(after.results[0].curation, 'curated');
  assert.ok(ctx.server.env.VECTORIZE.vectors.has(id));
  await context.close();
});

test('editor console: remove takes an item off with undo; bulk remove; non-editors and anonymous users are turned away', async () => {
  const api = (path, init) => fetch(ctx.server.url + path, { ...init, headers: { 'content-type': 'application/json', origin: ctx.server.url, cookie: 'signal-dev-user=editor@signal.test' } });
  await api('/api/editor/resources', { method: 'POST', body: JSON.stringify({ url: 'https://example.org/e2e-reject', title: 'Giraffe vendor press release', publisher: 'Vendor' }) });
  const { page, context } = await open(ctx, '/editor/', { user: 'editor@signal.test' });
  await page.getByRole('button', { name: 'Remove Giraffe vendor press release' }).click();
  await page.locator('#toast').getByText('Removed “Giraffe vendor press release”.').waitFor();
  await page.waitForFunction(() => !document.querySelector('.ed-list').innerText.includes('Giraffe vendor press release'));
  assert.equal((await (await api('/api/editor/queue?status=rejected')).json()).items.length, 1);
  // Undo puts it back where it was.
  await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Remove Giraffe vendor press release' }).waitFor();
  assert.equal((await (await api('/api/editor/queue?status=indexed&q=Giraffe')).json()).items.length, 1);
  // Remove from the item itself.
  await page.getByRole('button', { name: /^Giraffe vendor press release/ }).click();
  await page.locator('.ed-actions').getByRole('button', { name: 'Remove' }).click();
  await page.waitForFunction(() => !document.querySelector('.ed-list').innerText.includes('Giraffe vendor press release'));
  const after = await (await fetch(ctx.server.url + '/api/search?q=giraffe')).json();
  assert.ok(after.results.every((r) => r.title !== 'Giraffe vendor press release'), 'removed items are never returned');
  // Library: tick two, remove both, then find them under Removed and restore one.
  await page.locator('[data-tab=library]').click();
  const before = (await (await api('/api/editor/summary')).json()).counts.published;
  await page.locator('.ed-row-check input').nth(0).check();
  await page.locator('.ed-row-check input').nth(1).check();
  await page.locator('.ed-bulk').getByRole('button', { name: 'Remove' }).click();
  await page.locator('#toast').getByText('Removed 2 items.').waitFor();
  assert.equal((await (await api('/api/editor/summary')).json()).counts.published, before - 2);
  await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  await page.locator('#toast').getByText('Put back.').waitFor();
  assert.equal((await (await api('/api/editor/summary')).json()).counts.published, before);
  await context.close();

  const plain = await open(ctx, '/editor/', { user: 'plain@school.test' });
  await plain.page.getByText('does not have editor access').waitFor();
  assert.equal(await plain.page.locator('.ed-list').count(), 0);
  await plain.context.close();
  const anon = await open(ctx, '/editor/', { user: null });
  await anon.page.getByLabel('Editor token').waitFor();
  assert.equal(await anon.page.locator('.ed-list').count(), 0);
  assert.equal(await anon.page.locator('.ed-tabs').isVisible(), false, 'the tabs stay hidden until signed in');
  assert.equal(await anon.page.locator('#add-open').isVisible(), false);
  assert.equal(await anon.page.getByText('Cloudflare Access').count(), 0);
  await anon.context.close();
});

test('editor console: add a feed from any page on the site, and an article from a link; works on a phone', async () => {
  const solo = await startServer();
  try {
    const FEED = '<?xml version="1.0"?><rss version="2.0"><channel><title>Lantern Teaching Blog</title><item><title>AI tutors in the classroom</title><link>https://lantern.example.org/a</link></item><item><title>Snow day</title><link>https://lantern.example.org/b</link></item></channel></rss>';
    solo.env.__fetch = async (u) => {
      const url = new URL(u);
      if (url.pathname === '/feed.xml') return new Response(FEED, { headers: { 'content-type': 'application/rss+xml' } });
      if (url.hostname === 'lantern.example.org' && url.pathname === '/') return new Response('<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>', { headers: { 'content-type': 'text/html' } });
      if (url.pathname === '/guide') return new Response('<html><head><title>Owl guide to AI policy</title><meta property="og:site_name" content="Owl Org"></head></html>', { headers: { 'content-type': 'text/html' } });
      return new Response('no', { status: 404, headers: { 'content-type': 'text/html' } });
    };
    const context = await ctx.browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await context.addCookies([{ name: 'signal-dev-user', value: 'editor@signal.test', url: solo.url }]);
    const page = await context.newPage();
    await page.goto(solo.url + '/editor/', { waitUntil: 'networkidle' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390, 'nothing runs off the side of a phone');

    await page.locator('#add-open').click();
    await page.getByRole('tab', { name: 'A feed' }).click();
    await page.getByLabel('The website or its feed address').fill('https://lantern.example.org/');
    await page.getByRole('button', { name: 'Find feed' }).click();
    await page.getByText('2 recent items, 1 about AI.').waitFor();
    assert.equal(await page.getByLabel('Name').inputValue(), 'Lantern Teaching Blog');
    await page.getByRole('button', { name: 'Add feed' }).click();
    await page.locator('#toast').getByText(/Added “Lantern Teaching Blog”. 1 new item found./).waitFor();
    await page.getByText('Lantern Teaching Blog').first().waitFor();
    assert.match(await page.locator('.ed-feed').filter({ hasText: 'Lantern Teaching Blog' }).innerText(), /Active/);
    await page.getByRole('button', { name: 'Pause Lantern Teaching Blog' }).click();
    await page.locator('.ed-feed').filter({ hasText: 'Lantern Teaching Blog' }).getByText('Paused').waitFor();

    await page.locator('#add-open').click();
    await page.getByLabel('Link to the article, guide, video or report').fill('https://owl.example.org/guide');
    await page.getByRole('button', { name: 'Look it up' }).click();
    assert.equal(await page.getByLabel('Title').inputValue().then(async (v) => { await page.getByLabel('Title').waitFor(); return v; }), 'Owl guide to AI policy');
    await page.getByRole('button', { name: 'Publish' }).click();
    await page.getByText('Add one sentence on why it is worth reading, or choose Save for review.').waitFor();
    await page.getByLabel('Why it is worth reading').fill('A short, plain policy starter for schools.');
    await page.getByRole('button', { name: 'Publish' }).click();
    await page.locator('#toast').getByText('Published “Owl guide to AI policy”.').waitFor();
    const found = await (await fetch(solo.url + '/api/search?q=owl')).json();
    assert.equal(found.results[0]?.title, 'Owl guide to AI policy');
    await context.close();
  } finally { await solo.close(); }
});

test('editor console without Access: the token signs in once per device; a wrong token is refused', async () => {
  const token = 'e2e-editor-token-0123456789-abcdef';
  const solo = await startServer({ env: { ADMIN_TOKEN: token } });
  try {
    const context = await ctx.browser.newContext();
    await context.addCookies([{ name: 'signal-dev-user', value: '', url: solo.url }]);
    const page = await context.newPage();
    await page.goto(solo.url + '/editor/', { waitUntil: 'networkidle' });
    assert.equal(await page.getByLabel('Keep me signed in on this device for 90 days').isChecked(), true);
    await page.getByLabel('Editor token').fill('wrong-token-wrong-token-wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByText('That token was not accepted.').waitFor();
    assert.equal(await page.locator('.ed-list').count(), 0);
    await page.getByLabel('Editor token').fill(token);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('heading', { name: 'Review' }).waitFor();
    await page.getByRole('button', { name: 'Activity' }).click();
    await page.getByRole('heading', { name: 'Editor actions' }).waitFor();
    // The token is never kept where page scripts can read it; the device stays signed in.
    assert.equal(await page.evaluate(() => sessionStorage.getItem('signal:editor-token')), null);
    assert.equal(await page.evaluate(() => document.cookie.includes('signal-editor')), false);
    const tab = await context.newPage();
    await tab.goto(solo.url + '/editor/', { waitUntil: 'networkidle' });
    await tab.getByRole('heading', { name: 'Review' }).waitFor();
    await tab.getByRole('button', { name: 'Sign out' }).click();
    await tab.getByLabel('Editor token').waitFor();
    await context.close();

    // Unticked: this tab only, as before.
    const once = await ctx.browser.newContext();
    await once.addCookies([{ name: 'signal-dev-user', value: '', url: solo.url }]);
    const p1 = await once.newPage();
    await p1.goto(solo.url + '/editor/', { waitUntil: 'networkidle' });
    await p1.getByLabel('Keep me signed in on this device for 90 days').uncheck();
    await p1.getByLabel('Editor token').fill(token);
    await p1.getByRole('button', { name: 'Sign in' }).click();
    await p1.getByRole('heading', { name: 'Review' }).waitFor();
    await p1.reload({ waitUntil: 'networkidle' });
    await p1.getByRole('heading', { name: 'Review' }).waitFor();
    const p2 = await once.newPage();
    await p2.goto(solo.url + '/editor/', { waitUntil: 'networkidle' });
    await p2.getByLabel('Editor token').waitFor();
    await once.close();
  } finally { await solo.close(); }
});

test('automation: an automatic item is public and labelled, can be filtered out, and the editor can spot-check it', async () => {
  const solo = await startServer();
  try {
    const { createSource, updateSource } = await import('../../src/repo/sources.mjs');
    const { runTriage } = await import('../../src/ingest/triage.mjs');
    const env = solo.env;
    await createSource(env, { id: 'auto-feed', name: 'Auto feed', publisher: 'Auto News', feed_url: 'https://news.example.org/feed' });
    await updateSource(env, 'auto-feed', { review_status: 'verified', enabled: true });
    await updateSource(env, 'auto-feed', { auto_publish: true });
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO resources(id, url, canonical_url, title, publisher, format, status, source_id, discovered_at, created_at, updated_at, dup_key)
      VALUES ('auto1', 'https://news.example.org/auto1', 'https://news.example.org/auto1', 'Zebra generative AI pilot reaches district classrooms', 'Auto News', 'Article', 'indexed', 'auto-feed', ?, ?, ?, 'zebra')`).bind(now, now, now).run();
    await env.DB.prepare(`INSERT INTO resources(id, url, canonical_url, title, publisher, format, status, source_id, discovered_at, created_at, updated_at, dup_key)
      VALUES ('skip1', 'https://news.example.org/skip1', 'https://news.example.org/skip1', 'Bus routes change in October for all schools', 'Auto News', 'Article', 'indexed', 'auto-feed', ?, ?, ?, 'bus')`).bind(now, now, now).run();
    assert.equal((await runTriage(env)).published, 1);

    const context = await ctx.browser.newContext();
    await context.addCookies([{ name: 'signal-dev-user', value: 'editor@signal.test', url: solo.url }]);
    const page = await context.newPage();
    await page.goto(solo.url + '/grid?q=zebra', { waitUntil: 'networkidle' });
    await page.locator('.rows .row').first().waitFor();
    await page.locator('.rows .row h3 button').first().click();
    await page.locator('dialog[open] [data-unreviewed]').waitFor();
    assert.match(await page.locator('dialog[open]').innerText(), /Not yet reviewed by an editor/);
    await page.keyboard.press('Escape');
    await page.goto(solo.url + '/grid?q=zebra&reviewed=1', { waitUntil: 'networkidle' });
    await page.waitForSelector('.empty-state');
    assert.match(page.url(), /reviewed=1/);

    await page.goto(solo.url + '/editor/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /^Bus routes change/ }).waitFor();
    assert.match(await page.locator('.ed-list').innerText(), /Needs review/);
    await page.locator('[data-tab=library]').click();
    await page.getByRole('button', { name: /Not reviewed/ }).click();
    await page.getByRole('button', { name: /^Zebra generative AI pilot/ }).click();
    await page.getByText('Automatic decision').waitFor();
    assert.match(await page.locator('.ed-form').innerText(), /published automatically \(rules only\)/);
    await page.getByRole('button', { name: 'Looks fine' }).click();
    await page.getByText('Marked as checked.').waitFor();
    await context.close();
  } finally { await solo.close(); }
});

test('about and digest: the menu opens About; the home button opens the weekly digest with a feed to subscribe to', async () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  await ctx.server.env.DB.prepare("UPDATE resources SET added_at = ?, published_at = ? WHERE status = 'published'").bind(yesterday, yesterday.slice(0, 10)).run(); // published this week
  const { page, errors, context } = await open(ctx, '/');
  await page.locator('.menu-toggle').click();
  await page.getByRole('button', { name: 'About' }).click();
  const panel = page.locator('#panel');
  await panel.getByRole('heading', { name: 'About', exact: true }).waitFor();
  assert.match(await panel.innerText(), /Pleasantville UFSD teachers[\s\S]*Mike Sammartano[\s\S]*Gathered from trusted sources/);
  assert.equal(await page.locator('.donate-link, #panel .doc-foot a[href*="donate"]').count(), 0, 'no donate link on the district site');
  assert.equal(await panel.getByRole('link', { name: 'Mike Sammartano' }).getAttribute('href'), 'https://mikesammartano.com/');
  // Privacy opens from About, from the menu, and from its old address.
  await panel.getByRole('button', { name: 'Privacy' }).click();
  await panel.getByRole('heading', { name: 'Privacy' }).waitFor();
  assert.match(await panel.locator('.callout').innerText(), /Do not type student names/);
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  await page.locator('.menu-toggle').click();
  await page.getByRole('button', { name: 'Privacy' }).click();
  await panel.getByRole('heading', { name: 'Privacy' }).waitFor();
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  const old = await context.newPage();
  await old.goto(ctx.server.url + '/privacy', { waitUntil: 'networkidle' });
  await old.locator('#panel[open]').getByRole('heading', { name: 'Privacy' }).waitFor();
  await old.close();

  await page.getByRole('button', { name: 'This week, summarized' }).click();
  await panel.locator('.digest-picks').waitFor();
  assert.ok((await panel.locator('.digest-item').count()) <= 5);
  assert.match(await panel.locator('.digest-kicker').innerText(), /^Signal weekly/);
  assert.equal(await panel.getByRole('link', { name: 'Subscribe' }).getAttribute('href'), '/feed.xml');
  const mail = await panel.getByRole('link', { name: 'Email this digest' }).getAttribute('href');
  assert.match(mail, /^mailto:\?subject=This%20week%20in%20AI%20and%20education/);
  assert.match(decodeURIComponent(mail), /Worth your time:[\s\S]*https?:\/\//);
  // A resource opens above the digest, and closing it returns to the digest.
  await panel.locator('.digest-item').first().click();
  await page.locator('#dialog #dlg-title').waitFor();
  await page.locator('#dialog .dlg-close').click();
  assert.ok(await panel.isVisible());
  const feed = await page.request.get(ctx.server.url + '/feed.xml');
  assert.match(feed.headers()['content-type'], /rss\+xml/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('phones: dialogs sit 6px from every edge and scroll inside, not the page behind', async () => {
  const { page, context, errors } = await open(ctx, '/grid', { width: 390, height: 844, touch: true });
  await page.waitForSelector('.rows .row');
  // Measure only once the slide-up animation has finished, however busy the machine is.
  const settledDialog = (sel) => page.waitForFunction((s) => document.querySelector(s).getAnimations().every((a) => a.playState === 'finished'), sel);
  const edges = (sel) => page.locator(sel).evaluate((el) => { const r = el.getBoundingClientRect(); const d = document.documentElement; return [r.left, r.top, d.clientWidth - r.right, d.clientHeight - r.bottom].map(Math.round); });
  await page.locator('.rows .row').first().locator('a, button').first().click();
  await page.locator('#dialog #dlg-title').waitFor();
  await settledDialog('#dialog');
  assert.deepEqual(await edges('#dialog'), [6, 6, 6, 6]);
  const scroll = await page.locator('#dialog').evaluate((el) => ({ over: el.scrollHeight > el.clientHeight, y: getComputedStyle(el).overflowY }));
  assert.equal(scroll.y, 'auto');
  if (scroll.over) {
    const box = await page.locator('#dialog').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(300);
    assert.ok(await page.locator('#dialog').evaluate((el) => el.scrollTop) > 0, 'the dialog scrolls');
  }
  assert.equal(await page.evaluate(() => scrollY), 0, 'the page behind stays put');
  // Closing slides it down first, then it leaves.
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#dialog').evaluate((el) => el.open && el.classList.contains('closing')), true, 'slides down before closing');
  await page.locator('#dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#dialog').evaluate((el) => el.open || el.classList.contains('closing')), false);
  await page.goto(ctx.server.url + '/?digest=');
  await page.locator('#panel[open]').waitFor();
  await settledDialog('#panel');
  assert.deepEqual(await edges('#panel'), [6, 6, 6, 6]);
  await page.locator('#panel .dlg-close').click();
  await page.locator('#panel').waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  await context.close();
});

test('reading paths: the home row opens a numbered path of chosen resources, also by link', async () => {
  const { page, context, errors } = await open(ctx, '/');
  const row = page.getByRole('navigation', { name: 'Reading paths' });
  assert.deepEqual(await row.getByRole('button').allInnerTexts(), ['Start here', 'Classroom', 'Integrity']);
  await row.getByRole('button', { name: 'Start here' }).click();
  const panel = page.locator('#panel');
  await panel.getByRole('heading', { name: 'Teacher starting with AI literacy' }).waitFor();
  await panel.locator('.path-steps .digest-item, .path-steps + *, p').first().waitFor();
  await page.waitForFunction(() => !document.querySelector('#panel .digest-wait'));
  if (await panel.locator('.path-steps').count()) {
    assert.match(await panel.locator('.path-n').first().innerText(), /^1$/);
    await panel.locator('.digest-item').first().click();
    await page.locator('#dialog[open] #dlg-title').waitFor();
    await page.keyboard.press('Escape');
  }
  await page.goto(ctx.server.url + '/?path=integrity', { waitUntil: 'networkidle' });
  await page.locator('#panel[open]').getByRole('heading', { name: /academic integrity/ }).waitFor();
  await page.goto(ctx.server.url + '/?path=family', { waitUntil: 'networkidle' }); // an old Signal path link
  await page.locator('#panel[open]').getByRole('heading', { name: 'Teacher starting with AI literacy' }).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

test('shared lists: a saved list becomes a link; the link shows the list and saves it on another device', async () => {
  const a = await open(ctx, '/grid', { user: null });
  await a.page.waitForSelector('.rows .row');
  const titles = [];
  for (const i of [0, 1, 2]) {
    const row = a.page.locator('.rows .row').nth(i);
    titles.push(await row.locator('h3').innerText());
    await row.getByRole('button', { name: /^Save/ }).click();
  }
  await a.page.locator('.rows .row').first().locator('h3 button').click();
  await a.page.locator('dialog #note').fill('Start the PD day with this one');
  await a.page.waitForSelector('dialog [role=status]:has-text("Note saved.")');
  await a.page.keyboard.press('Escape');
  await a.page.goto(ctx.server.url + '/saved', { waitUntil: 'networkidle' });
  await a.page.getByText('Share this list').click();
  await a.page.locator('#share-name').fill('PD day reading');
  await a.page.locator('#share-notes').check();
  const link = await a.page.evaluate(async () => (await import('/js/views/saved.js')).shareLink(document.querySelector('#share-name').value, [...document.querySelectorAll('.rows .row')].map((r) => ({ id: r.dataset.id })), true));
  assert.match(link, /\/shared#d=[A-Za-z0-9_-]+$/);
  await a.context.close();

  const b = await open(ctx, null, { user: null });
  await b.page.goto(link, { waitUntil: 'networkidle' });
  await b.page.getByRole('heading', { name: 'PD day reading' }).waitFor();
  await b.page.waitForSelector('.rows .row');
  assert.deepEqual((await b.page.locator('.rows .row h3').allInnerTexts()).sort(), [...titles].sort());
  assert.match(await b.page.locator('.rows').innerText(), /Start the PD day with this one/);
  await b.page.getByRole('button', { name: /Save all to my list/ }).click();
  await b.page.getByRole('button', { name: 'All saved' }).waitFor();
  await b.page.goto(ctx.server.url + '/saved', { waitUntil: 'networkidle' });
  assert.equal(await b.page.locator('.rows .row').count(), 3);
  await b.page.goto(ctx.server.url + '/shared#d=nonsense', { waitUntil: 'networkidle' });
  await b.page.getByText('This link does not contain a list.').waitFor();
  await b.context.close();
});

test('editor console: the Activity tab downloads a backup of the catalogue', async () => {
  const { page, context } = await open(ctx, '/editor/', { user: 'editor@signal.test' });
  await page.getByRole('button', { name: 'Activity' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download a backup' }).click();
  const file = await download;
  assert.match(file.suggestedFilename(), /^signal-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(await (await import('node:fs/promises')).readFile(await file.path(), 'utf8'));
  assert.ok(data.tables.resources.length >= 30);
  assert.ok(Array.isArray(data.tables.resource_relations));
  assert.equal(data.tables.vault_blobs, undefined);
  await context.close();
});
