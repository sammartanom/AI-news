// A second, lighter modal for the About note, the privacy notice and the weekly digest. Resources
// opened from the digest stack above it in the resource dialog, and closing them returns here.
// Each opens from a link too: ?about, ?privacy, ?digest and ?path=<preset>.
import { h, fill, safeHref } from './dom.js';
import { api } from './api.js';
import { icon } from './icons.js';
import { openResource } from './dialog.js';
import { ABOUT } from './about.js';
import { PRIVACY } from './privacy.js';
import { slideClosed, keepOpen } from './slide.js';

const panel = () => document.getElementById('panel');
const body = () => document.getElementById('panel-body');
let opener = null;

function show(kind, ...children) {
  const d = panel();
  if (!d) return;
  keepOpen(d);
  if (!d.open) opener = document.activeElement;
  d.dataset.kind = kind;
  fill(body(), ...children);
  if (!d.open) d.showModal();
  body().querySelector('h2')?.focus();
}

export function initPanel() {
  const d = panel();
  if (!d) return;
  slideClosed(d);
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.querySelector('.dlg-close').addEventListener('click', () => d.close());
  d.addEventListener('close', () => {
    const u = new URL(location.href);
    if (PARAMS.some((k) => u.searchParams.has(k))) { for (const k of PARAMS) u.searchParams.delete(k); history.replaceState(history.state, '', u); }
    if (opener && document.contains(opener)) opener.focus();
    opener = null;
  });
  const p = new URL(location.href).searchParams;
  if (p.has('about')) openAbout();
  else if (p.has('privacy')) openPrivacy();
  else if (p.get('path')) openPath(p.get('path'));
  else if (p.get('digest') !== null) openDigest(p.get('digest') || undefined);
}

const PARAMS = ['digest', 'about', 'privacy', 'path'];

// Reading paths: a short sequence for one kind of reader, built from resources a person chose.
// Mirrors PATH_PRESETS in src/discovery/paths.mjs.
export const PATHS = [
  { id: 'teacher-start', short: 'Start here', label: 'Teacher starting with AI literacy' },
  { id: 'classroom', short: 'Classroom', label: 'Teacher using AI for planning, feedback and lessons' },
  { id: 'integrity', short: 'Integrity', label: 'Teacher handling student AI use and academic integrity' }
];

const PATH_ALIASES = { 'new-principal': 'teacher-start', 'district-policy': 'teacher-start', leader: 'teacher-start', family: 'teacher-start' }; // old links

// The role someone last chose is remembered on this device only, to order the home page for them.
const ROLE_KEY = 'signal:role';
export const ROLE_AUDIENCE = { 'teacher-start': 'Teachers', classroom: 'Teachers', integrity: 'Teachers' };
export function lastRole() {
  try { const r = localStorage.getItem(ROLE_KEY); return ROLE_AUDIENCE[r] ? r : null; } catch { return null; }
}
function rememberRole(id) {
  try { localStorage.setItem(ROLE_KEY, id); } catch { /* storage blocked: nothing to remember */ }
}

export async function openPath(id) {
  id = PATH_ALIASES[id] ?? id;
  const preset = PATHS.find((x) => x.id === id);
  if (!preset) return;
  rememberRole(id);
  show('path', head('route', preset.label, 'A short reading path, from first steps to action.'), h('p', { class: 'muted digest-wait', role: 'status' }, 'Choosing resources'));
  try {
    const d = await api.get(`/api/paths?preset=${encodeURIComponent(id)}`, { timeout: 30000 });
    if (panel()?.dataset.kind !== 'path' || !panel().open) return;
    const steps = d.stages.filter((s) => s.resources.length);
    const link = h('button', { type: 'button', class: 'link' }, 'Copy link to this path');
    link.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(`${location.origin}/?path=${id}`); link.textContent = 'Link copied'; } catch { /* clipboard refused */ }
    });
    fill(body(),
      head('route', preset.label, steps.length ? `${steps.length} steps, from first steps to action. Start at the top.` : 'A short reading path, from first steps to action.'),
      steps.length
        ? h('ol', { class: 'path-steps' }, steps.map((s, i) => h('li', {},
          h('p', { class: 'path-step' }, h('span', { class: 'path-n num', 'aria-hidden': 'true' }, String(i + 1)), h('span', {}, s.name)),
          h('ul', { class: 'digest-items' }, s.resources.map(item)))))
        : h('p', {}, 'No matching resources yet.'),
      h('p', { class: 'doc-foot' }, link, h('span', { 'aria-hidden': 'true' }, '\u00b7'), h('a', { class: 'link', href: `/grid?audience=${encodeURIComponent(d.audience ?? '')}`, 'data-link': '', onclick: () => panel().close() }, 'Browse everything for this audience'))
    );
    body().querySelector('h2')?.focus();
  } catch {
    fill(body(), head('route', preset.label, ''), h('p', { class: 'error', role: 'alert' }, 'This path could not be loaded. Try again in a moment.'));
  }
}

// The shared head of the About and Privacy modals: an icon, the title and a one-line lede.
function head(glyph, title, lede) {
  return h('header', { class: 'doc-head' },
    h('span', { class: 'doc-glyph', 'aria-hidden': 'true' }, icon(glyph, 20)),
    h('h2', { id: 'panel-title', tabindex: '-1' }, title),
    h('p', { class: 'doc-lede' }, lede));
}

export function openAbout() {
  const href = safeHref(ABOUT.link?.href);
  const initials = ABOUT.author.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const privacy = h('button', { type: 'button', class: 'link' }, 'Privacy');
  privacy.addEventListener('click', () => openPrivacy());
  const digest = h('button', { type: 'button', class: 'link' }, 'This week, summarized');
  digest.addEventListener('click', () => openDigest());
  show('about',
    head('zap', ABOUT.title, ABOUT.lede),
    h('div', { class: 'byline' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials),
      h('span', {}, h('strong', {}, safeHref(ABOUT.author.url) ? h('a', { class: 'byline-name', href: safeHref(ABOUT.author.url), target: '_blank', rel: 'noopener' }, ABOUT.author.name) : ABOUT.author.name), h('span', { class: 'role' }, ABOUT.author.role))),
    h('div', { class: 'doc-body' }, ABOUT.paragraphs.map((p) => h('p', {}, p))),
    h('ul', { class: 'points', 'aria-label': 'How it works' }, ABOUT.points.map((pt) =>
      h('li', {}, h('span', { class: 'point-icon', 'aria-hidden': 'true' }, icon(pt.icon, 18)), h('span', {}, h('strong', {}, pt.title), h('span', {}, pt.text))))),
    h('p', { class: 'doc-foot' }, digest, h('span', { 'aria-hidden': 'true' }, '\u00b7'), privacy,
      donateLink() ? [h('span', { 'aria-hidden': 'true' }, '\u00b7'), donateLink()] : null,
      href && ABOUT.link.label ? [h('span', { 'aria-hidden': 'true' }, '\u00b7'), h('a', { class: 'link', href, target: '_blank', rel: 'noopener noreferrer' }, ABOUT.link.label)] : null)
  );
}

// The donate link, or null when it is switched off in js/about.js. A plain click opens the donate
// overlay; a modified click (new tab) follows the link to the donate dialog on sammartano.science.
export function donateLink(cls = 'link', before) {
  const href = safeHref(ABOUT.donate?.href);
  if (!href || !ABOUT.donate.label) return null;
  const a = h('a', { class: cls, href, target: '_blank', rel: 'noopener' }, ABOUT.donate.label);
  a.addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !ABOUT.donate.embed) return;
    e.preventDefault();
    before?.();
    openDonate();
  });
  return a;
}

// The sammartano.science donate dialog in a full-window frame, the way that site opens it for its
// simulations: the frame is transparent and the dialog brings its own backdrop and close button.
// The dialog posts `donate-closed` when it closes; Escape also closes it. Everything behind it is
// inert while it is open. Returns false when there is nothing to open.
let donateFrame = null;
export function openDonate() {
  const src = safeHref(ABOUT.donate?.embed);
  if (!src) return false;
  if (donateFrame) return true;
  // A modal dialog would sit above the frame, so the About note closes first, at once (no slide).
  let back = document.activeElement;
  for (const d of document.querySelectorAll('dialog[open]')) { if (d.contains(back)) back = opener ?? back; HTMLDialogElement.prototype.close.call(d); }
  const origin = new URL(src).origin;
  const held = [...document.body.children].filter((n) => !n.inert && !/^(SCRIPT|STYLE|LINK)$/.test(n.tagName));
  const f = h('iframe', { class: 'donate-frame', src, title: 'Donate', allow: 'payment' });
  let watchdog = 0;
  const end = () => {
    clearTimeout(watchdog);
    f.remove(); donateFrame = null;
    removeEventListener('message', onMessage); removeEventListener('keydown', onKey, true);
    for (const n of held) n.inert = false;
    if (back?.isConnected) back.focus({ preventScroll: true });
  };
  const onMessage = (e) => { if (e.origin === origin && e.source === f.contentWindow && e.data?.type === 'donate-closed') end(); };
  const onKey = (e) => { if (e.key === 'Escape') end(); };
  addEventListener('message', onMessage);
  addEventListener('keydown', onKey, true);
  for (const n of held) n.inert = true;
  // If the donate page never loads (offline, blocked), take the frame away and open it in a tab.
  watchdog = setTimeout(() => { end(); window.open(safeHref(ABOUT.donate.href), '_blank', 'noopener'); }, 10000);
  f.addEventListener('load', () => clearTimeout(watchdog), { once: true });
  document.body.append(f);
  donateFrame = f;
  f.focus();
  return true;
}

export function openPrivacy() {
  show('privacy',
    head('lock', PRIVACY.title, PRIVACY.lede),
    h('p', { class: 'callout', role: 'note' }, icon('alert', 18), h('span', {}, PRIVACY.warning)),
    h('div', { class: 'doc-sections' }, PRIVACY.sections.map((sec) => h('section', { class: 'doc-sec' },
      h('h3', {}, h('span', { class: 'point-icon', 'aria-hidden': 'true' }, icon(sec.icon, 16)), sec.title),
      sec.text.map((t) => h('p', {}, t)))))
  );
}

const fmt = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export async function openDigest(id) {
  show('digest', h('h2', { id: 'panel-title', tabindex: '-1' }, 'This week'), h('p', { class: 'muted digest-wait', role: 'status' }, 'Gathering the week’s resources'));
  try {
    const { digest } = await api.get(`/api/digest${id ? `?id=${encodeURIComponent(id)}` : ''}`, { timeout: 60000 });
    if (panel()?.dataset.kind !== 'digest' || !panel().open) return;
    fill(body(), renderDigest(digest));
    body().querySelector('h2')?.focus();
  } catch (e) {
    fill(body(), h('h2', { id: 'panel-title', tabindex: '-1' }, 'This week'), h('p', { class: 'error', role: 'alert' }, e.status === 404 ? 'That digest is no longer available.' : 'The digest could not be loaded. Try again in a moment.'));
  }
}

function item(r) {
  const b = h('button', { type: 'button', class: 'digest-item' }, h('span', { class: 'name' }, r.title), h('span', { class: 'src' }, r.publisher), r.why ? h('span', { class: 'why' }, r.why) : null);
  b.addEventListener('click', () => openResource(r.id));
  return h('li', {}, b);
}

function mailtoFor(d) {
  const lines = [
    ...d.overview, '',
    'Worth your time:',
    ...d.picks.flatMap((r, i) => [`${i + 1}. ${r.title} (${r.publisher})`, `   ${r.url}`]),
    '', `The full digest: ${location.origin}/?digest=${d.id}`,
    'Summarized by an AI model from titles and publishers; check the sources.'
  ];
  let text = lines.join('\n');
  if (text.length > 1800) text = `${text.slice(0, 1780)}\n…`;
  return `mailto:?subject=${encodeURIComponent(`This week in AI and education: ${d.headline}`)}&body=${encodeURIComponent(text)}`;
}

function renderDigest(d) {
  const feed = `${location.origin}/feed.xml`;
  const copy = h('button', { type: 'button', class: 'btn btn-quiet' }, icon('copy', 16), h('span', {}, 'Copy feed link'));
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(feed); copy.lastChild.textContent = 'Copied'; } catch { copy.lastChild.textContent = feed; }
  });
  const empty = !d.picks.length;
  // Email: opens the reader's own mail app with the digest written out, to send to colleagues.
  const mail = empty ? null : h('a', { class: 'btn btn-quiet', href: mailtoFor(d) }, icon('mail', 16), h('span', {}, 'Email this digest'));
  return [
    h('p', { class: 'digest-kicker num' }, `Signal weekly · ${fmt(d.period_start)} – ${fmt(d.period_end)}`),
    h('h2', { id: 'panel-title', tabindex: '-1' }, empty ? 'A quiet week' : d.headline),
    empty ? h('p', { class: 'digest-lede' }, 'Nothing new was published this week. The next digest arrives in a few days.') : d.overview.map((p) => h('p', { class: 'digest-lede' }, p)),
    empty ? null : h('section', { class: 'digest-picks' }, h('h3', {}, 'Worth your time'), h('ol', { class: 'digest-items' }, d.picks.map(item))),
    h('div', { class: 'digest-sub' },
      h('p', {}, h('strong', {}, 'Get it every week. '), 'Add the feed to any reader, such as Feedly, Inoreader, Outlook or NetNewsWire.'),
      h('div', { class: 'actions' },
        h('a', { class: 'btn btn-primary', href: '/feed.xml', type: 'application/rss+xml' }, icon('rss', 16), h('span', {}, 'Subscribe')),
        copy, mail)
    ),
    empty ? null : h('p', { class: 'fine' }, d.generated
      ? `Summarized by an AI model from the titles and publishers of ${d.item_count} resources published this week. It has not read the articles, so open the sources before relying on it.`
      : `A roundup of ${d.item_count} resources published this week.`)
  ];
}
