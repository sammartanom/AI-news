// Filter palette: one field that takes filters as tokens. Type anything ("assess", "teachers",
// "topic: data") and matching options appear grouped by kind, with how many resources each has.
// Arrow keys move, Enter applies, Backspace on an empty field removes the last filter. On a phone
// the open palette fills the screen. It is an ARIA combobox with a grouped listbox.
import { h, fill } from './dom.js';
import { icon } from './icons.js';

let uid = 0;

/**
 * groups: [{ key, label, options: [{ value, label, n }] }]
 * value: { key: value } (current filters); onChange(key, value | ''); onSearch(text)
 */
export function filterPalette({ groups, value, onChange, onSearch, placeholder = matchMedia('(max-width: 719px)').matches ? 'Filter resources' : 'Filter by topic, format, audience or source' }) {
  const id = `pal-${++uid}`;
  const current = { ...value };
  let open = false;
  let active = -1;
  let shown = [];

  const input = h('input', {
    id: 'fq', type: 'text', role: 'combobox', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'done',
    'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': `${id}-list`, 'aria-describedby': `${id}-hint`, placeholder
  });
  const tokens = h('div', { class: 'pal-tokens' });
  const list = h('div', { class: 'pal-list', id: `${id}-list`, role: 'listbox', 'aria-label': 'Filters' });
  const done = h('button', { class: 'pal-done', type: 'button', onclick: () => close(true) }, 'Done');
  const clear = h('button', { class: 'pal-clear', type: 'button', 'aria-label': 'Clear all filters', title: 'Clear all filters', onclick: () => { for (const k of Object.keys(current)) if (current[k]) set(k, ''); input.focus(); } }, icon('x', 16));
  const bar = h('div', { class: 'pal-bar', onclick: (e) => { if (e.target === bar || e.target === tokens) input.focus(); } },
    h('span', { class: 'pal-icon', 'aria-hidden': 'true' }, icon('filter', 20)),
    tokens,
    h('label', { for: 'fq', class: 'sr' }, 'Filter resources'),
    input,
    h('kbd', { class: 'pal-kbd', 'aria-hidden': 'true' }, '/'),
    clear, done);
  const root = h('div', { class: 'palette' }, bar, list,
    h('p', { class: 'sr', id: `${id}-hint` }, 'Type to find filters. Use the arrow keys to choose and Enter to apply. Backspace removes the last filter.'));

  const labelOf = (key, v) => groups.find((g) => g.key === key)?.options.find((o) => o.value === v)?.label ?? v;
  const groupOf = (key) => groups.find((g) => g.key === key);

  function paintTokens() {
    const active = groups.filter((g) => current[g.key]);
    fill(tokens, active.map((g) => h('span', { class: 'pal-token' },
      h('span', { class: 'k' }, g.short ?? g.label), h('span', { class: 'v' }, g.boolean ? '' : labelOf(g.key, current[g.key])),
      h('button', { type: 'button', 'aria-label': `Remove ${g.label}${g.boolean ? '' : ': ' + labelOf(g.key, current[g.key])}`, onclick: (e) => { e.stopPropagation(); set(g.key, ''); input.focus(); } }, icon('x', 14)))));
    root.classList.toggle('has-tokens', active.length > 0);
    input.placeholder = active.length ? 'Add a filter' : placeholder;
  }

  function set(key, v) {
    current[key] = v;
    paintTokens();
    onChange(key, v);
  }

  // Matches every word of the query against the option, its group, or "group: option".
  function matches(q) {
    const m = /^\s*([a-z ]+?)\s*:\s*(.*)$/i.exec(q);
    const only = m ? groups.find((g) => [g.key, g.label.toLowerCase(), (g.short ?? '').toLowerCase()].includes(m[1].toLowerCase())) : null;
    const text = (only ? m[2] : q).trim().toLowerCase();
    const words = text.split(/\s+/).filter(Boolean);
    const out = [];
    for (const g of groups) {
      if (only && g !== only) continue;
      const scored = [];
      for (const o of g.options) {
        if (current[g.key] === o.value) continue;
        const hay = `${o.label} ${g.label}`.toLowerCase();
        if (words.length && !words.every((w) => hay.includes(w))) continue;
        const label = o.label.toLowerCase();
        const score = !words.length ? o.n ?? 0 : (label.startsWith(text) ? 1000 : label.split(/\W+/).some((w) => w.startsWith(words[0])) ? 500 : 0) + (o.n ?? 0);
        scored.push({ g, o, score });
      }
      scored.sort((a, b) => b.score - a.score);
      const limit = only ? 50 : words.length ? 6 : g.peek ?? 4;
      if (scored.length) out.push({ g, items: scored.slice(0, limit), more: scored.length - limit });
    }
    return { groups: out, text: (only ? m[2] : q).trim() };
  }

  function paintList() {
    const q = input.value;
    const { groups: found, text } = matches(q);
    shown = [];
    const nodes = found.map(({ g, items, more }) => {
      const hid = `${id}-g-${g.key}`;
      return h('div', { role: 'group', 'aria-labelledby': hid, class: 'pal-group' },
        h('div', { class: 'pal-head', id: hid, role: 'presentation' }, g.label, more > 0 ? h('button', { type: 'button', tabindex: '-1', class: 'pal-more', onmousedown: (e) => e.preventDefault(), onclick: () => { input.value = `${g.short ?? g.label}: ${text}`; paintList(); input.focus(); } }, `+${more}`) : null),
        items.map(({ o }) => option(g, o)));
    });
    if (text && onSearch) {
      const i = shown.length;
      shown.push({ search: text });
      nodes.push(h('div', { role: 'group', 'aria-label': 'Search', class: 'pal-group' },
        h('div', { role: 'option', id: `${id}-o-${i}`, class: 'pal-opt pal-search', 'aria-selected': 'false', onmousedown: (e) => e.preventDefault(), onclick: () => pick(i) },
          icon('search', 16), h('span', {}, `Search for “${text}”`))));
    }
    if (!nodes.length) nodes.push(h('p', { class: 'pal-empty' }, 'No filters match.'));
    fill(list, nodes);
    setActive(text && shown.length ? 0 : -1);
  }

  function option(g, o) {
    const i = shown.length;
    shown.push({ g, o });
    return h('div', { role: 'option', id: `${id}-o-${i}`, class: 'pal-opt', 'aria-selected': 'false', onmousedown: (e) => e.preventDefault(), onclick: () => pick(i), onmousemove: () => { if (active !== i) setActive(i, false); } },
      h('span', { class: 'pal-k' }, g.short ?? g.label), h('span', { class: 'pal-v' }, g.boolean ? g.label : o.label), o.n != null ? h('span', { class: 'pal-n num' }, String(o.n)) : null);
  }

  function setActive(i, scroll = true) {
    active = i;
    list.querySelectorAll('[role=option]').forEach((el) => el.setAttribute('aria-selected', String(el.id === `${id}-o-${i}`)));
    const el = i >= 0 ? list.querySelector(`#${id}-o-${i}`) : null;
    if (el) { input.setAttribute('aria-activedescendant', el.id); if (scroll) el.scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  }

  function pick(i) {
    const s = shown[i];
    if (!s) return;
    if (s.search) { close(false); onSearch(s.search); return; }
    input.value = '';
    set(s.g.key, s.o.value);
    paintList();
    input.focus();
  }

  function show() {
    if (open) return;
    open = true;
    root.classList.add('open');
    document.body.classList.add('palette-open');
    input.setAttribute('aria-expanded', 'true');
    paintList();
  }
  function close(blur) {
    if (!open) return;
    open = false;
    root.classList.remove('open');
    document.body.classList.remove('palette-open');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    if (blur) input.blur();
  }

  input.addEventListener('focus', show);
  input.addEventListener('input', () => { show(); paintList(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      show();
      if (!shown.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(active < 0 ? (step > 0 ? 0 : shown.length - 1) : (active + step + shown.length) % shown.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0) pick(active);
      else if (!input.value.trim()) close(true);
    } else if (e.key === 'Escape') {
      if (input.value) { input.value = ''; paintList(); } else close(true);
      e.stopPropagation();
    } else if (e.key === 'Backspace' && !input.value) {
      const last = groups.filter((g) => current[g.key]).at(-1);
      if (last) { e.preventDefault(); set(last.key, ''); paintList(); }
    } else if (e.key === 'Tab') close(false);
  });
  root.addEventListener('focusout', (e) => { if (!root.contains(e.relatedTarget)) close(false); });
  document.addEventListener('pointerdown', (e) => { if (open && !root.contains(e.target)) close(false); }, { capture: true });

  paintTokens();
  return { el: root, groupOf };
}
