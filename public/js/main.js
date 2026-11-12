import { h, $, fill } from './dom.js';
import { icon } from './icons.js';
import { initTilt } from './tilt.js';
import { api } from './api.js';
import { state, setTheme, applyLayout } from './state.js';
import { savedCount, startSync } from './library.js';
import { initDialog, closeResource } from './dialog.js';
import { initPanel, openAbout, openPrivacy, donateLink } from './panel.js';
import { homeView } from './views/home.js';
import { gridView } from './views/grid.js';
import { savedView, sharedView } from './views/saved.js';

const app = $('#app');
const SITE = 'AI for teachers';
const routes = [
  [/^\/$/, homeView, 'home'],
  [/^\/grid$/, gridView, 'grid'],
  [/^\/saved$/, savedView, 'saved'],
  [/^\/shared$/, sharedView, 'shared']
];

let controller = null;
let leaveHooks = [];
let menuOpen = false;
let currentKey;
let firstRender = true;

export function navigate(to, { replace = false } = {}) {
  const url = new URL(to, location.origin);
  if (url.origin !== location.origin) { location.href = to; return; }
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
  render();
}

async function render() {
  controller?.abort();
  for (const f of leaveHooks) f();
  leaveHooks = [];
  controller = new AbortController();
  closeResource();
  let url = new URL(location.href);
  // Search results live on the browse page; old /search links land there with their query.
  if (/^\/search\/?$/.test(url.pathname)) {
    url = new URL(`/grid${url.search}${url.hash}`, location.origin);
    history.replaceState(history.state, '', url);
  }
  const path = url.pathname.replace(/\/+$/, '') || '/';
  let match = null;
  for (const [re, view, key] of routes) {
    const m = re.exec(path);
    if (m) { match = { view, key, params: m.slice(1) }; break; }
  }
  currentKey = match?.key;
  lastView = viewKey(location.href);
  document.body.classList.toggle('is-home', currentKey === 'home');
  applyLayout(currentKey ?? 'other');
  setMenu(false);
  renderHeader();
  const ctx = { url, params: match?.params ?? [], signal: controller.signal, navigate, title: (t) => { document.title = t === SITE ? `Pleasantville UFSD \u00b7 ${SITE}` : `${t} \u00b7 ${SITE}`; }, onLeave: (f) => leaveHooks.push(f) };
  try {
    if (!match) {
      fill(app, h('div', { class: 'page' }, h('h1', { id: 'page-title', tabindex: '-1' }, 'Page not found'), h('p', { class: 'lede' }, h('a', { class: 'link', href: '/', 'data-link': '' }, 'Go to search'))));
      document.title = 'Not found';
    } else {
      await match.view(app, ctx);
    }
  } catch (e) {
    if (controller.signal.aborted) return;
    console.error(e);
    fill(app, h('div', { class: 'page' }, h('h1', { id: 'page-title', tabindex: '-1' }, 'Something went wrong'), h('p', { class: 'lede' }, 'Reload the page to try again.')));
  }
  // On client-side navigation, move focus to the new page's heading so keyboard and screen reader
  // users start at the top of the new content. Not on first load, which would skip the skip link.
  if (!firstRender && currentKey !== 'home') {
    window.scrollTo(0, 0);
    $('#page-title', app)?.focus({ preventScroll: true });
  }
  firstRender = false;
}

// No top bar. A home mark on inner pages and one menu button that opens a full-screen menu. On
// phones a floating dock at the bottom, within thumb reach, replaces the menu button.
const PAGES = [['/', 'Home', 'home', 'home'], ['/grid', 'Browse', 'grid', 'browse'], ['/saved', 'Saved', 'saved', 'bookmark']];
let lastCount = null;

function renderHeader() {
  const header = $('#top');
  const link = (href, label, key) => h('a', { href, 'data-link': '', 'aria-current': currentKey === key ? 'page' : null, onclick: () => setMenu(false) }, label);
  const count = savedCount();
  const themeIcon = { auto: 'auto', light: 'sun', dark: 'moon' }[state.theme];
  const nav = h('nav', { id: 'nav', 'aria-label': 'Primary', class: menuOpen ? 'open' : '' },
    h('div', { class: 'nav-links' },
      link('/', 'Search', 'home'),
      link('/grid', 'Browse', 'grid'),
      link('/saved', count ? `Saved ${count}` : 'Saved', 'saved')
    ),
    menuSearch(),
    h('div', { class: 'nav-foot' },
      h('button', { type: 'button', id: 'theme', 'aria-label': `Theme: ${state.theme}. Change theme.`, onclick: () => { setTheme({ auto: 'light', light: 'dark', dark: 'auto' }[state.theme]); renderHeader(); $('#theme')?.focus(); } }, icon(themeIcon, 18), h('span', {}, state.theme[0].toUpperCase() + state.theme.slice(1))),
      h('button', { type: 'button', class: 'about-link', onclick: () => { setMenu(false); openAbout(); } }, 'About'),
      h('button', { type: 'button', class: 'about-link', onclick: () => { setMenu(false); openPrivacy(); } }, 'Privacy'),
      donateLink('about-link donate-link', () => setMenu(false))
    )
  );
  const toggle = h('button', { type: 'button', class: 'menu-toggle', 'aria-label': 'Menu', 'aria-expanded': String(menuOpen), 'aria-controls': 'nav', onclick: () => { setMenu(!menuOpen); $('.menu-toggle')?.focus(); } }, icon('menu', 22), icon('close', 22));
  const bump = lastCount !== null && count > lastCount;
  lastCount = count;
  const dock = h('nav', { class: 'dock', 'aria-label': 'Quick' },
    PAGES.map(([href, label, key, ic]) => h('a', { href, 'data-link': '', 'aria-current': currentKey === key && !menuOpen ? 'page' : null, class: key === 'saved' && bump ? 'bump' : null, onclick: () => setMenu(false) },
      icon(ic, 22), h('span', { class: 'dock-label' }, label),
      key === 'saved' && count ? h('span', { class: 'badge num', 'aria-label': `, ${count} saved` }, count > 99 ? '99+' : String(count)) : null)),
    h('button', { type: 'button', class: 'dock-more', 'aria-label': 'Menu', 'aria-expanded': String(menuOpen), 'aria-controls': 'nav', onclick: () => setMenu(!menuOpen) }, icon(menuOpen ? 'close' : 'menu', 22), h('span', { class: 'dock-label' }, 'More')));
  markScrolled();
  fill(header, h('a', { class: 'brand', href: '/', 'data-link': '', 'aria-label': 'Home' }, icon('zap', 22)), toggle, nav, dock);
}

function menuSearch() {
  const input = h('input', { id: 'menu-q', type: 'search', placeholder: 'Search resources', autocomplete: 'off', maxlength: '300', enterkeyhint: 'search' });
  const form = h('form', { class: 'search', role: 'search', onsubmit: (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    setMenu(false);
    navigate(`/grid?q=${encodeURIComponent(q)}`);
  } }, input, h('button', { class: 'btn btn-primary btn-search', type: 'submit' }, icon('zap', 18), h('span', {}, 'Search')));
  return h('div', { class: 'nav-search' }, h('label', { for: 'menu-q', class: 'sr' }, 'Search resources'), form);
}

function setMenu(open) {
  const was = menuOpen;
  menuOpen = open;
  document.body.classList.toggle('menu-open', open);
  $('.menu-toggle')?.setAttribute('aria-expanded', String(open));
  if (was !== open) {
    const more = $('.dock-more');
    more?.setAttribute('aria-expanded', String(open));
    more?.firstElementChild?.replaceWith(icon(open ? 'close' : 'menu', 22));
    document.querySelectorAll('.dock a').forEach((a) => {
      if (open) a.removeAttribute('aria-current');
      else if (PAGES.find(([href]) => href === a.getAttribute('href'))?.[2] === currentKey) a.setAttribute('aria-current', 'page');
    });
  }
  $('#nav')?.classList.toggle('open', open);
  if (open) setTimeout(() => $('#nav a')?.focus({ preventScroll: true }), 60);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuOpen) { setMenu(false); $('.menu-toggle')?.focus(); } });

// The menu button gains a surface once the page scrolls under it; "/" jumps to search.
function markScrolled() { $('#top')?.classList.toggle('scrolled', scrollY > 8); }
addEventListener('scroll', markScrolled, { passive: true });
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea, select, [contenteditable]') || document.getElementById('dialog')?.open) return;
  const q = $('#q') ?? $('#fq');
  if (q) { e.preventDefault(); q.focus(); q.select(); }
});

document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[data-link]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});
// Changes to ?r= or ?digest= only (opening or closing a dialog) are handled by the dialogs.
const viewKey = (href) => { const u = new URL(href); u.searchParams.delete('r'); u.searchParams.delete('digest'); u.searchParams.delete('about'); u.searchParams.delete('privacy'); return u.pathname + u.search; };
let lastView = null;
window.addEventListener('popstate', () => { if (viewKey(location.href) !== lastView) render(); });
document.addEventListener('signal:saved', () => renderHeader());

async function boot() {
  initTilt();
  $('#dialog .dlg-close').addEventListener('click', () => closeResource());
  // The config only switches optional features on, so the first page does not wait for it.
  state.configReady = api.get('/api/config').then((c) => { state.config = c; }, () => { /* optional: features fall back */ });
  await render();
  initDialog();
  initPanel();
  startSync();
}
boot();
