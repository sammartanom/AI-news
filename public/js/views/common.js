import { h } from '../dom.js';
import { state, setLayout } from '../state.js';
import { icon } from '../icons.js';

export function selectField({ id, label, options, value, onChange, allLabel }) {
  const sel = h('select', { id },
    allLabel ? h('option', { value: '' }, allLabel) : null,
    options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label ?? o.value))
  );
  if (value && !options.some((o) => o.value === value)) sel.append(h('option', { value, selected: true }, value));
  sel.value = value ?? '';
  sel.addEventListener('change', () => onChange(sel.value));
  return h('label', { for: id }, label, sel);
}

export function errorBlock(message, retry) {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const block = h('div', { class: 'error', role: 'alert' }, offline ? icon('offline', 18) : icon('alert', 18), h('p', {}, message), retry ? h('button', { type: 'button', class: 'btn', onclick: retry }, icon('refresh', 16), 'Try again') : null);
  // Coming back online retries by itself.
  if (offline && retry) addEventListener('online', () => { if (document.contains(block)) retry(); }, { once: true });
  return block;
}

export function pageHeader({ title, lede }) {
  return h('header', {},
    h('h1', { tabindex: '-1', id: 'page-title', class: 'sr' }, title),
    lede ? h('p', { class: 'lede' }, lede) : null
  );
}

export const PRIVACY_REMINDER = 'Searches are processed by an AI service. Do not enter student or other confidential information.';

// List or grid. The change morphs each visible resource into its new place where the browser
// supports view transitions, and simply switches otherwise.
export function layoutToggle() {
  const wrap = h('div', { class: 'layout-toggle', role: 'group', 'aria-label': 'Layout' });
  const paint = () => wrap.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layout === state.layout)));
  const choose = (layout) => {
    if (layout === state.layout) return;
    const rows = [...document.querySelectorAll('.rows > .row')].slice(0, 60);
    const swap = () => { setLayout(layout); paint(); };
    if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return swap();
    rows.forEach((r, i) => { r.style.viewTransitionName = `row-${i}`; });
    document.startViewTransition(swap).finished.finally(() => rows.forEach((r) => { r.style.viewTransitionName = ''; }));
  };
  for (const [layout, label] of [['list', 'List view'], ['grid', 'Grid view']]) {
    wrap.append(h('button', { type: 'button', 'data-layout': layout, 'aria-label': label, title: label, 'aria-pressed': String(layout === state.layout), onclick: () => choose(layout) }, icon(layout, 18)));
  }
  return wrap;
}

/**
 * Fades the edges of a sideways-scrolling row, but only on a side that has more to show, so the
 * row reads as "there is more" instead of ending in a hard cut.
 */
export function edgeFade(el) {
  const update = () => {
    const max = el.scrollWidth - el.clientWidth;
    el.toggleAttribute('data-fade-start', max > 1 && el.scrollLeft > 1);
    el.toggleAttribute('data-fade-end', max > 1 && el.scrollLeft < max - 1);
  };
  el.addEventListener('scroll', update, { passive: true });
  if (typeof ResizeObserver === 'function') new ResizeObserver(update).observe(el);
  return update;
}
