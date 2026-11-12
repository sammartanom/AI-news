import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, open } from './helpers.mjs';

let ctx;
before(async () => { ctx = await launch(); });
after(async () => { await ctx.close(); });

test('desktop: the home page is the heading, a labelled search, the digest button and resource cards, nothing else', async () => {
  const { page, errors, context } = await open(ctx, '/');
  assert.equal(await page.locator('h1').innerText(), 'AI for\nteachers.');
  assert.equal(await page.getByRole('searchbox', { name: 'Search resources' }).count(), 1);
  assert.equal(await page.getByRole('group', { name: 'Audience' }).count(), 0);
  assert.equal(await page.locator('.center').evaluate((el) => el.children.length), 5, 'heading, search, the digest button, reading paths and the Browse link only');
  assert.equal(await page.getByRole('button', { name: 'This week, summarized' }).count(), 1);
  const cards = page.locator('.orbit-card:visible');
  assert.ok(await cards.count() >= 12, `${await cards.count()} cards`);
  assert.equal(await page.locator('.brand').isVisible(), false, 'no wordmark or bar over the home page');
  for (const card of await cards.all()) {
    assert.ok((await card.locator('.name').innerText()).length > 3);
    assert.match(await card.locator('.pub').innerText(), /^\S[\s\S]*\n(Added \w{3} \d{1,2}, \d{4}|\w{3} \d{1,2}, \d{4}|(\w{3} )?\d{4})$/);
  }
  // A visible way into Browse, for anyone who misses the menu.
  const browse = page.getByRole('link', { name: /^Browse all \d+ resources$/ });
  await browse.waitFor();
  assert.ok(await browse.isVisible());
  await browse.click();
  await page.waitForURL(/\/grid$/);
  await page.waitForSelector('.rows .row, .cards .card');
  assert.deepEqual(errors, []);
  await context.close();
});

test('desktop: cards sit around the search, never over it, and reach the edges of the screen', async () => {
  const { page, context } = await open(ctx, '/');
  const center = await page.locator('.center').boundingBox();
  const boxes = [];
  for (const card of await page.locator('.orbit-card:visible').all()) {
    const b = await card.boundingBox();
    boxes.push(b);
    const overlaps = b.x < center.x + center.width && b.x + b.width > center.x && b.y < center.y + center.height && b.y + b.height > center.y;
    assert.equal(overlaps, false, `${await card.locator('.name').innerText()} overlaps the search block`);
  }
  assert.ok(boxes.some((b) => b.x < 60), 'the field reaches the left edge');
  assert.ok(boxes.some((b) => b.x + b.width > 1440 - 60), 'the field reaches the right edge');
  assert.ok(boxes.some((b) => b.y < 80) && boxes.some((b) => b.y + b.height > 900 - 80), 'and the top and bottom');
  await context.close();
});

test('layering: each ring keeps its place, so cards never swap over and under each other', async () => {
  const { page, context } = await open(ctx, '/');
  await settled(page);
  const order = () => page.evaluate(() => [...document.querySelectorAll('.orbit-card:not([hidden])')].map((c) => c.style.zIndex).join());
  const a = await order();
  await page.waitForTimeout(3000);
  assert.equal(await order(), a);
  await context.close();
});

test('cards never cover the search, and the menu button stays on top, at common screen sizes', async () => {
  for (const [width, height] of [[1024, 768], [1280, 720], [1366, 768], [1440, 900], [1536, 864], [1920, 1080], [820, 1180]]) {
    const { page, context } = await open(ctx, '/', { width, height });
    const boxes = async (sel) => Promise.all((await page.locator(sel).all()).filter(Boolean).map((l) => l.boundingBox()));
    const hit = (a, b) => a && b && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    const guards = await boxes('.center');
    const menuOnTop = await page.evaluate(() => { const b = document.querySelector('.menu-toggle').getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('.menu-toggle') !== null; });
    assert.ok(menuOnTop, `${width}x${height}: menu button is reachable`);
    for (const card of await page.locator('.orbit-card:visible').all()) {
      const b = await card.boundingBox();
      const name = await card.locator('.name').innerText();
      guards.forEach((g, i) => assert.equal(hit(b, g), false, `${width}x${height}: "${name}" covers guarded element ${i}`));
    }
    await context.close();
  }
});

const positions = (page) => page.evaluate(() => [...document.querySelectorAll('.orbit-card:not([hidden])')].map((c) => { const r = c.getBoundingClientRect(); return [r.x, r.y]; }));
const settled = (page) => page.waitForFunction(() => document.querySelector('.constellation.ready') && document.getAnimations().every((a) => a.animationName !== 'appear' || a.playState === 'finished'));
const moved = (a, b) => Math.max(...a.map((p, i) => Math.hypot(b[i][0] - p[0], b[i][1] - p[1])));

test('motion: cards orbit the search slowly and visibly, nearer ones larger and in front', async () => {
  const { page, context } = await open(ctx, '/');
  await settled(page);
  const a = await positions(page);
  await page.waitForTimeout(4000);
  const b = await positions(page);
  const m = moved(a, b);
  assert.ok(m >= 20, `moved ${m.toFixed(2)}px in 4s: should be visible`);
  assert.ok(m < 120, `moved ${m.toFixed(2)}px in 4s: should be slow`);
  // Cards may pass over each other, nearer ones in front.
  const z = await page.evaluate(() => [...document.querySelectorAll('.orbit-card:not([hidden])')].map((c) => [Number(c.style.zIndex), parseFloat(getComputedStyle(c).scale)]));
  const front = z.reduce((a, b) => (b[0] > a[0] ? b : a));
  const back = z.reduce((a, b) => (b[0] < a[0] ? b : a));
  assert.ok(front[1] > back[1], 'nearer cards are larger');
  await context.close();
});

test('hover and keyboard focus enlarge and straighten a card, dim the others and pause the motion', async () => {
  const { page, context } = await open(ctx, '/');
  await settled(page);
  const card = page.locator('.orbit-card').nth(1);
  const others = page.locator('.orbit-card:not(:nth-child(2)):not([hidden])');
  const before = await card.evaluate((el) => getComputedStyle(el).rotate);
  assert.notEqual(before, '0deg');

  const check = async (label) => {
    await page.waitForTimeout(700);
    const s = await card.evaluate((el) => ({ scale: parseFloat(getComputedStyle(el).scale), rotate: parseFloat(getComputedStyle(el).rotate) }));
    assert.ok(s.scale > 1.05, `${label}: scale ${s.scale}`);
    assert.ok(Math.abs(s.rotate) < 0.01, `${label}: rotate ${s.rotate}`);
    for (const o of await others.all()) assert.ok(parseFloat(await o.evaluate((el) => getComputedStyle(el).opacity)) < 0.5, `${label}: others dim`);
    const a = await positions(page);
    await page.waitForTimeout(1200);
    assert.ok(moved(a, await positions(page)) < 0.5, `${label}: motion paused`);
  };
  await card.hover({ force: true });
  await check('hover');
  const h1 = await page.locator('.hero h1').boundingBox();
  await page.mouse.move(h1.x + h1.width / 2, h1.y + h1.height / 2); // the heading never has a card over it
  await page.waitForTimeout(700);
  assert.ok(parseFloat(await card.evaluate((el) => getComputedStyle(el).scale)) < 1.06, 'settles back to its depth scale');
  const a = await positions(page);
  await page.waitForTimeout(1500);
  assert.ok(moved(a, await positions(page)) > 0.5, 'moving again');

  await card.focus();
  await check('keyboard focus');
  await context.close();
});

test('reduced motion: cards stay put, hover still works', async () => {
  const { page, context } = await open(ctx, '/', { reducedMotion: 'reduce' });
  await page.waitForSelector('.constellation.ready');
  const a = await positions(page);
  await page.waitForTimeout(1500);
  assert.equal(moved(a, await positions(page)), 0);
  await page.locator('.orbit-card').nth(1).hover({ force: true });
  assert.ok(parseFloat(await page.locator('.orbit-card').nth(1).evaluate((el) => getComputedStyle(el).scale)) > 1.05);
  await context.close();
});

test('mobile (390px): own composition, search first, then a clean sideways shelf of cards, no page scroll sideways', async () => {
  const { page, context } = await open(ctx, '/', { width: 390, height: 844, touch: true });
  await settled(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  const search = await page.locator('.center .search').boundingBox();
  const visible = [];
  for (const c of await page.locator('.orbit-card').all()) if (await c.isVisible()) visible.push(await c.boundingBox());
  assert.equal(visible.length, 10);
  assert.ok(visible.every((b) => b.y > search.y + search.height), 'all cards are below the search');
  // A clean shelf: one straight row of equal cards, the first aligned with the page edge, scrolling sideways.
  assert.equal(new Set(visible.map((b) => Math.round(b.y))).size, 1, 'one row');
  assert.equal(new Set(visible.map((b) => Math.round(b.width))).size, 1, 'equal widths');
  assert.ok(Math.abs(visible[0].x - 20) <= 1, 'first card lines up with the page edge');
  const look = await page.locator('.orbit-card').first().evaluate((el) => { const cs = getComputedStyle(el); return { rotate: cs.rotate, snap: cs.scrollSnapAlign }; });
  assert.equal(look.rotate, 'none', 'no tilt');
  assert.equal(look.snap, 'start');
  assert.equal(await page.locator('.constellation').evaluate((el) => getComputedStyle(el).overflowX), 'auto');
  assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'q', 'no keyboard pop-up on touch');
  assert.equal(await page.locator('.brand').isVisible(), true, 'the logo shows on phones, home included');
  await page.locator('.dock-more').click();
  await page.locator('#nav.open').waitFor();
  const logo = await page.locator('.brand').boundingBox();
  assert.equal(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.brand'), [logo.x + logo.width / 2, logo.y + logo.height / 2]), true, 'the logo shows over the open menu');
  await page.locator('.dock-more').click();
  await page.waitForFunction(() => !document.querySelector('#nav.open'));
  assert.equal(await page.locator('.shelf-title').innerText(), 'Worth a look');
  assert.match(await page.locator('.browse-all').getAttribute('aria-label'), /^See all [\d,]+ resources$/);
  // A tap opens the resource.
  const card = page.locator('.orbit-card:visible').first();
  const name = await card.locator('.name').innerText();
  const b = await card.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await page.locator('dialog[open] h2').waitFor();
  assert.equal(await page.locator('dialog[open] h2').innerText(), name.replace(/\s+/g, ' ').trim());
  await context.close();
});

test('320px wide: nothing overflows, home and grid', async () => {
  for (const path of ['/', '/grid', '/search?q=literacy', '/saved']) {
    const { page, context } = await open(ctx, path, { width: 320, height: 640, touch: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `${path} overflows at 320px`);
    await context.close();
  }
});

test('mobile menu opens and closes by button', async () => {
  const { page, context } = await open(ctx, '/grid', { width: 390, height: 844, touch: true });
  const toggle = page.getByRole('button', { name: 'Menu' });
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#nav').isVisible(), false);
  await toggle.click();
  assert.equal(await page.getByRole('button', { name: 'Menu' }).getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('#nav').isVisible(), true);
  await context.close();
});

test('dark mode follows the system and keeps the same layout', async () => {
  const light = await open(ctx, '/', { scheme: 'light' });
  const dark = await open(ctx, '/', { scheme: 'dark' });
  const bg = (p) => p.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(await bg(light), 'rgb(255, 255, 255)');
  assert.equal(await bg(dark), 'rgb(11, 23, 16)'); // near-black green, not gray
  const box = (p) => p.page.locator('.center').boundingBox();
  assert.deepEqual(await box(light), await box(dark));
  const surface = await dark.page.evaluate(() => getComputedStyle(document.querySelector('.orbit-card')).backgroundColor);
  assert.equal(surface, 'rgb(11, 23, 16)');
  await light.context.close();
  await dark.context.close();
});

test('theme override: Auto, Light, Dark; remembered across reloads', async () => {
  const { page, context } = await open(ctx, '/', { scheme: 'dark' });
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const btn = () => page.locator('#theme');
  const menu = () => page.getByRole('button', { name: 'Menu' }).click();
  await menu();
  assert.equal(await btn().innerText(), 'Auto');
  await btn().click();
  assert.equal(await btn().innerText(), 'Light');
  assert.equal(await bg(), 'rgb(255, 255, 255)'); // override beats the dark system setting
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await bg(), 'rgb(255, 255, 255)');
  await menu();
  await btn().click();
  assert.equal(await btn().innerText(), 'Dark');
  await btn().click();
  assert.equal(await btn().innerText(), 'Auto');
  assert.equal(await bg(), 'rgb(11, 23, 16)');
  await context.close();
});

test('typography: Figtree on every kind of element', async () => {
  const { page, context } = await open(ctx, '/grid');
  await page.locator('.rows .row h3 button').first().click();
  await page.waitForSelector('dialog[open] .detail h2');
  const report = await page.evaluate(async () => {
    await document.fonts.ready;
    const pick = (sel) => { const el = document.querySelector(sel); const cs = getComputedStyle(el); return { sel, family: cs.fontFamily, weight: cs.fontWeight }; };
    return {
      loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')),
      els: ['h1', 'body', '#fq', '.kinds button', '.row h3 button', '.row .by', 'select', 'dialog', 'dialog h2', 'dialog textarea', 'dialog .btn'].map(pick)
    };
  });
  assert.ok(report.loaded.includes('Figtree'), `loaded fonts: ${report.loaded}`);
  for (const e of report.els) {
    assert.match(e.family, /^"?Figtree"?/, e.sel);
    assert.ok(Number(e.weight) >= 400 && Number(e.weight) <= 600, `${e.sel} weight ${e.weight}`);
  }
  await context.close();
});

test('no emoji, no gradients, no external requests', async () => {
  const requests = [];
  const { page, context } = await open(ctx, null);
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(ctx.server.url + '/', { waitUntil: 'networkidle' });
  await page.goto(ctx.server.url + '/grid', { waitUntil: 'networkidle' });
  assert.ok(requests.every((u) => new URL(u).origin === ctx.server.url || u.startsWith('data:')), requests.filter((u) => new URL(u).origin !== ctx.server.url).join(', '));
  const text = await page.evaluate(() => document.body.innerText);
  assert.equal(/\p{Extended_Pictographic}/u.test(text), false);
  const css = await (await page.request.get(ctx.server.url + '/styles.css')).text();
  assert.equal(/gradient\(/i.test(css.replace(/(?:-webkit-)?mask-image:[^;]*;/g, '')), false, 'gradients only as edge-fade masks');
  assert.equal(/backdrop-filter/i.test(css), false);
  await context.close();
});

test('the CSP header is sent and the page works under it', async () => {
  const { page, errors, context } = await open(ctx, null);
  const res = await page.goto(ctx.server.url + '/', { waitUntil: 'networkidle' });
  const csp = res.headers()['content-security-policy'];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.ok(await page.locator('.orbit-card').count() >= 12);
  assert.deepEqual(errors, []);
  await context.close();
});

test('physics: a card can be picked up and thrown, comes back home, and a plain click still opens it', async () => {
  const { page, context, errors } = await open(ctx, '/');
  await settled(page);
  const card = page.locator('.orbit-card:not([hidden])').nth(2);
  const home = await card.boundingBox();
  const s = { x: home.x + home.width / 2, y: home.y + home.height / 2 };
  const dir = s.x < 720 ? 1 : -1;
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(s.x + dir * i * 20, s.y + (s.y < 450 ? 1 : -1) * i * 12); await page.waitForTimeout(16); }
  assert.equal(await card.evaluate((el) => el.classList.contains('held')), true, 'held while dragging');
  const held = await card.boundingBox();
  assert.ok(Math.hypot(held.x - home.x, held.y - home.y) > 80, 'follows the pointer');
  await page.mouse.up();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('dialog[open]').count(), 0, 'a throw is not a click');
  await page.mouse.move(5, 5);
  await page.waitForTimeout(3500);
  const back = await card.boundingBox();
  // Its slot has moved on along the ring (about 15px a second) while it was away, so allow for that.
  const off = Math.hypot(back.x - home.x, back.y - home.y);
  assert.ok(off < 110 && off < Math.hypot(held.x - home.x, held.y - home.y), `returns home (off by ${Math.round(off)}px)`);
  // Hovering pauses the motion, as it does for a person; then a plain click opens the card.
  let box = await card.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(900);
  box = await card.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForSelector('dialog[open] h2');
  assert.deepEqual(errors, []);
  await context.close();
});

// Shortest distance from the menu button's centre to each visible card's box, minus the button's radius.
const navClearance = (page) => page.evaluate(() => {
  const b = document.querySelector('.menu-toggle').getBoundingClientRect();
  const cx = b.left + b.width / 2, cy = b.top + b.height / 2, r = b.width / 2;
  return Math.min(...[...document.querySelectorAll('.orbit-card:not([hidden])')].map((c) => {
    const k = c.getBoundingClientRect();
    return Math.hypot(Math.max(k.left - cx, 0, cx - k.right), Math.max(k.top - cy, 0, cy - k.bottom)) - r;
  }));
});

test('physics: cards bounce off the menu button and never pass under it, even when thrown at it', async () => {
  const { page, context, errors } = await open(ctx, '/');
  await settled(page);
  for (let i = 0; i < 6; i++) { assert.ok(await navClearance(page) > -2, 'no card overlaps the menu button'); await page.waitForTimeout(500); }
  // Throw the nearest card straight at the button.
  const nav = await page.locator('.menu-toggle').boundingBox();
  const target = { x: nav.x + nav.width / 2, y: nav.y + nav.height / 2 };
  const boxes = await page.locator('.orbit-card:not([hidden])').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  const near = boxes.map((b, i) => [Math.hypot(b.x - target.x, b.y - target.y), i]).filter(([d]) => d > 200).sort((a, b) => a[0] - b[0])[0][1];
  const s = boxes[near];
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(s.x + ((target.x - s.x) * i) / 10, s.y + ((target.y - s.y) * i) / 10); await page.waitForTimeout(16); }
  assert.ok(await navClearance(page) > -2, 'a held card is kept clear of the button');
  await page.mouse.up();
  for (let i = 0; i < 8; i++) { { const c = await navClearance(page); assert.ok(c > -2, `a thrown card bounces off (${c.toFixed(1)})`); }; await page.waitForTimeout(100); }
  assert.deepEqual(errors, []);
  await context.close();
});

test('small delights: the full stop glows, hints type into the search, a background click ripples the cards; none with reduced motion', async () => {
  const { page, context, errors } = await open(ctx, '/');
  await settled(page);
  assert.equal(await page.locator('h1').innerText(), 'AI for\nteachers.');
  assert.equal(await page.locator('h1 .dot').count(), 1);
  await page.waitForFunction(() => /^Try “/.test(document.querySelector('#q').placeholder), null, { timeout: 8000 });
  const before = await positions(page);
  await page.mouse.click(1100, 600);
  await page.locator('.ripple').waitFor({ state: 'attached' });
  await page.waitForTimeout(250);
  assert.ok(moved(before, await positions(page)) > 8, 'nearby cards are pushed');
  await page.waitForFunction(() => !document.querySelector('.ripple'));
  assert.equal(await page.locator('dialog[open]').count(), 0, 'a background click opens nothing');
  // Typing stops the hints for good.
  await page.locator('#q').fill('rubrics');
  await page.waitForTimeout(400);
  assert.doesNotMatch(await page.locator('#q').getAttribute('placeholder'), /^Try/);
  assert.deepEqual(errors, []);
  await context.close();

  const still = await open(ctx, '/', { reducedMotion: 'reduce' });
  await still.page.waitForTimeout(5000);
  assert.doesNotMatch(await still.page.locator('#q').getAttribute('placeholder'), /^Try/);
  await still.page.mouse.click(1100, 600);
  assert.equal(await still.page.locator('.ripple').count(), 0);
  await still.context.close();
});
