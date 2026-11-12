// Renders the link-preview image (public/og.png, 1200x630) and the app icons (public/icon-180.png,
// public/icon-512.png) from the site's own font and colours. Run after changing the look:
//   node scripts/og-image.mjs
// Needs Playwright with Chromium (see test/e2e/helpers.mjs).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const pub = (p) => fileURLToPath(new URL(`../public/${p}`, import.meta.url));
const font = readFileSync(pub('fonts/Figtree-latin.woff2')).toString('base64');

const ZAP = '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>';
const DOTS = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28'%3E%3Ccircle cx='1' cy='1' r='1.2' fill='%23d6d6d5'/%3E%3C/svg%3E\")";
const base = `@font-face { font-family: Figtree; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 300 900; }
  * { box-sizing: border-box; margin: 0; } body { font-family: Figtree, sans-serif; color: #1e1e1e; -webkit-font-smoothing: antialiased; }`;

// Cards echo the home page: a few real kinds of resource, tilted a little, drifting off the edge.
// Real resources from the library (titles and publishers as published).
const cards = [
  { x: 770, y: 54, r: -3, t: 'AI Guidance for Schools Toolkit', p: 'TeachAI' },
  { x: 990, y: 210, r: 2.5, t: 'AI Literacy Lessons for Grades K\u201312', p: 'Common Sense Education' },
  { x: 760, y: 330, r: 1.5, t: 'Teaching Students to Think Critically About AI', p: 'Harvard Graduate School of Education' },
  { x: 1000, y: 470, r: -2, t: 'AI 101 for Teachers', p: 'Code.org' },
  { x: 560, y: 520, r: -1.5, t: 'K-12 Generative AI Readiness Checklist', p: 'CoSN and Council of the Great City Schools' }
];

const og = `<!doctype html><html><head><style>${base}
  body { width: 1200px; height: 630px; overflow: hidden; position: relative; background: #fff ${DOTS}; }
  .mark { position: absolute; left: 64px; top: 58px; width: 44px; height: 44px; }
  h1 { position: absolute; left: 60px; top: 170px; font-size: 112px; line-height: 0.98; font-weight: 600; letter-spacing: -0.055em; }
  h1 .dot { color: #4e944a; }
  .district { position: absolute; left: 124px; top: 66px; font-size: 24px; font-weight: 600; letter-spacing: -0.01em; color: #2e6a42; }
  p.lede { position: absolute; left: 64px; top: 432px; width: 560px; font-size: 27px; line-height: 1.38; color: #5c5c5b; letter-spacing: -0.01em; }
  .card { position: absolute; width: 236px; padding: 20px 22px 18px; background: #fff; border: 1px solid #e6e6e5; border-radius: 18px;
    box-shadow: 0 1px 2px rgb(16 24 40 / 0.05), 0 18px 36px -18px rgb(16 24 40 / 0.22); }
  .card b { display: block; font-size: 19px; line-height: 1.3; font-weight: 500; letter-spacing: -0.015em; }
  .card span { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 14px; padding-top: 11px; border-top: 1px solid #e6e6e5; font-size: 15px; color: #5c5c5b; }
</style></head><body>
  <svg class="mark" viewBox="0 0 24 24" fill="none" stroke="#2e6a42" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ZAP}</svg>
  <div class="district">Pleasantville UFSD</div>
  ${cards.map((c) => `<div class="card" style="left:${c.x}px;top:${c.y}px;rotate:${c.r}deg"><b>${c.t}</b><span>${c.p}</span></div>`).join('')}
  <h1>AI for<br>teachers<span class="dot">.</span></h1>
  <p class="lede">A curated, searchable library of research, guidance, lessons and tools on AI in the classroom.</p>
</body></html>`;

const icon = (size) => `<!doctype html><html><head><style>${base}
  body { width: ${size}px; height: ${size}px; display: grid; place-items: center; background: #2e6a42; }
  svg { width: ${size * 0.54}px; height: ${size * 0.54}px; }
</style></head><body><svg viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ZAP}</svg></body></html>`;

const browser = await chromium.launch();
const shot = async (html, w, h, file) => {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: pub(file) });
  await page.close();
};
await shot(og, 1200, 630, 'og.png');
await shot(icon(180), 180, 180, 'icon-180.png');
await shot(icon(512), 512, 512, 'icon-512.png');
await browser.close();
console.log('wrote public/og.png, public/icon-180.png, public/icon-512.png');
