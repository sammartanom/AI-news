import { h, announce, fill } from '../dom.js';
import { api, qs } from '../api.js';
import { plural } from '../format.js';
import { rowList } from '../row.js';
import { selectField, errorBlock, pageHeader, layoutToggle, edgeFade, PRIVACY_REMINDER } from './common.js';
import { filterPalette } from '../palette.js';
import { KINDS } from '../format.js';
import { icon } from '../icons.js';
import { state } from '../state.js';
import { askButton } from '../ask.js';

const SORTS = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'newest', label: 'Newest' },
  { value: 'added', label: 'Recently added' },
  { value: 'publisher', label: 'Source' },
  { value: 'format', label: 'Format' },
  { value: 'title', label: 'Title' }
];
const PAGE = 24;
const KEYS = ['audience', 'evidence', 'format', 'topic', 'collection', 'grade', 'publisher', 'reviewed'];

// The one place to browse and search. With a search (?q=), results come from the AI-assisted
// search and are ordered by relevance; the same filters and types narrow them.
export async function gridView(root, ctx) {
  const p = ctx.url.searchParams;
  const view = {
    q: (p.get('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, 300), sort: p.get('sort') || 'recommended', kind: KINDS.some((k) => k.slug === p.get('kind')) || p.get('kind') === 'articles' ? p.get('kind') : '' };
  for (const k of KEYS) view[k] = k === 'reviewed' ? (p.get(k) === '1' ? '1' : '') : p.get(k) || '';
  let offset = 0;
  let runId = 0;
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const sortSlot = h('div', { class: 'sort-slot' });
  const bar = h('div', { class: 'result-bar' }, status, h('div', { class: 'bar-tools' }, sortSlot, layoutToggle()));
  const list = h('div', {});
  const more = h('div', { class: 'more' });
  const paletteSlot = h('div', { class: 'palette-slot' });
  const kindSlot = h('div', { class: 'kinds', role: 'group', 'aria-label': 'Type' });
  const fadeKinds = edgeFade(kindSlot);
  const querySlot = h('div', {});
  const answerSlot = h('div', {});
  const sync = () => history.replaceState(history.state, '', `/grid${qs({ ...view, sort: view.q || view.sort === 'recommended' ? '' : view.sort })}`);
  const sortField = selectField({ id: 'g-sort', label: 'Sort', options: SORTS, value: view.sort, onChange: (v) => { view.sort = v; sync(); load(true); } });

  fill(root, h('div', { class: 'page browse' }, pageHeader({ title: 'All resources' }), paletteSlot, querySlot, kindSlot, bar, answerSlot, list, more));

  const search = (q) => { view.q = q; sync(); paintQuery(); if (types.length > 2) paintKinds(); fill(answerSlot); load(true); };
  // The search in play: what was searched, a way to clear it, and how the AI read it.
  const understood = h('p', { class: 'fine ai-note' });
  function paintQuery() {
    ctx.title(view.q || 'All resources');
    const h1 = root.querySelector('#page-title');
    if (h1) h1.textContent = view.q ? `Results for “${view.q}”` : 'All resources';
    fill(sortSlot, view.q ? null : sortField); // a search is ordered by relevance
    fill(understood);
    fill(querySlot, view.q ? h('div', { class: 'query' },
      h('p', { class: 'query-line' },
        h('span', { class: 'query-label' }, 'Results for'),
        h('strong', { class: 'query-text' }, `“${view.q}”`),
        h('button', { type: 'button', class: 'query-clear', 'aria-label': 'Clear search', title: 'Clear search', onclick: () => search('') }, icon('x', 16)),
        state.config?.answers ? askButton(answerSlot, () => view.q) : null),
      understood,
      h('p', { class: 'fine' }, PRIVACY_REMINDER)) : null);
  }
  function paintUnderstood(info) {
    const u = info?.understood;
    const phrases = u ? [u.rewrite, ...u.expansions].filter(Boolean).slice(0, 4) : [];
    fill(understood, phrases.length ? [
      h('span', {}, 'Also searched for '),
      phrases.map((t, i) => [i ? ', ' : '', h('a', { class: 'link', href: `/grid?q=${encodeURIComponent(t)}`, 'data-link': '' }, t)]),
      info.reranked ? '. Ordered by AI relevance.' : '.'
    ] : info?.reranked ? 'Ordered by AI relevance.' : null);
  }
  paintQuery();
  state.configReady?.then(() => { if (view.q && state.config?.answers && !ctx.signal.aborted) paintQuery(); }); // Ask appears once the config says it is on

  // Filter options come from what is actually in the collection, with counts.
  let facets = null;
  // Results and filter options load side by side; the results do not wait for the options.
  const firstLoad = load(true);
  try { facets = await api.get('/api/facets', { signal: ctx.signal }); } catch { if (ctx.signal.aborted) return; }
  const opts = (rows, label) => (rows ?? []).map((r) => ({ value: r.value, label: label ? label(r) : r.value, n: r.n }));
  const groups = [
    { key: 'audience', label: 'Audience', short: 'For', options: opts(facets?.audiences).filter((o) => o.value !== 'Everyone'), peek: 4 },
    { key: 'topic', label: 'Topic', options: opts(facets?.topics, (t) => t.label ?? t.value), peek: 8 },
    { key: 'evidence', label: 'Type', options: opts(facets?.evidence, (e) => e.label), peek: 4 },
    { key: 'format', label: 'Format', options: opts(facets?.formats), peek: 4 },
    { key: 'collection', label: 'Collection', options: opts(facets?.collections, (c) => c.label), peek: 3 },
    { key: 'grade', label: 'Grade', options: opts(facets?.grades), peek: 3 },
    { key: 'publisher', label: 'Source', options: opts(facets?.publishers), peek: 4 },
    { key: 'reviewed', label: 'Editor’s picks', short: 'Picks', boolean: true, options: [{ value: '1', label: 'Editor’s picks only' }], peek: 1 }
  ].filter((g) => g.options.length);
  const palette = filterPalette({
    groups,
    value: Object.fromEntries(KEYS.map((k) => [k, view[k]])),
    onChange: (k, v) => { view[k] = v; sync(); load(true); },
    onSearch: search
  });
  fill(paletteSlot, palette.el);

  // Quick types: articles, guides, lessons, courses, videos, podcasts, research. Counts come from
  // the format facet, so a type with nothing in it does not appear.
  const counts = { articles: 0 };
  for (const f of facets?.formats ?? []) {
    const k = KINDS.find((x) => x.formats.includes(String(f.value ?? '').toLowerCase()));
    counts[k?.slug ?? 'articles'] = (counts[k?.slug ?? 'articles'] ?? 0) + f.n;
  }
  const types = [{ slug: '', name: 'All', plural: 'All' }, { slug: 'articles', name: 'Articles', icon: 'list' }, ...KINDS.map((k) => ({ ...k, name: { Guide: 'Guides', Course: 'Courses', Tool: 'Tools', Video: 'Videos', Podcast: 'Podcasts', Legislation: 'Laws and policy' }[k.name] ?? k.name }))]
    .filter((t) => !t.slug || counts[t.slug] || view.kind === t.slug);
  const paintKinds = () => { fill(kindSlot, types.map((t) => h('button', { type: 'button', 'aria-pressed': String(view.kind === t.slug), onclick: () => { if (view.kind === t.slug) return; view.kind = t.slug; paintKinds(); sync(); load(true); } },
    t.icon ? icon(t.icon, 16) : null, h('span', {}, t.name), t.slug && !view.q ? h('span', { class: 'n num' }, String(counts[t.slug] ?? 0)) : null))); requestAnimationFrame(fadeKinds); }; // counts are for the whole collection, not a search
  if (types.length > 2) paintKinds();

  async function load(reset) {
    const id = ++runId;
    if (reset) { offset = 0; list.classList.add('loading'); }
    status.textContent = 'Loading';
    try {
      const searching = !!view.q;
      const d = searching
        ? await api.get(`/api/search${qs({ ...view, sort: '', limit: PAGE, offset })}`, { signal: ctx.signal })
        : await api.get(`/api/resources${qs({ ...view, limit: PAGE, offset })}`, { signal: ctx.signal });
      if (id !== runId) return;
      const found = searching ? d.results : d.resources;
      list.classList.remove('loading');
      if (reset) fill(list, found.length ? h('ol', { class: 'rows' }) : searching ? noResults(d.fallback) : noMatches());
      if (found.length) list.querySelector('ol').append(...rowList(found).children);
      offset += found.length;
      if (searching && reset) paintUnderstood(d.ai);
      const note = d.degraded === 'semantic_failed' || d.degraded === 'semantic_unavailable' ? ' Showing keyword matches only.' : d.degraded === 'semantic_skipped' ? ' Too many searches just now, so showing keyword matches only.' : '';
      status.textContent = searching ? `${plural(d.total, 'result')}${note ? `.${note}` : ''}` : plural(d.total, 'resource');
      announce(status.textContent);
      fill(more, offset < d.total ? h('button', { class: 'btn', type: 'button', onclick: () => load(false) }, `Show more (${d.total - offset} left)`) : null);
    } catch (e) {
      if (ctx.signal.aborted || id !== runId) return;
      list.classList.remove('loading');
      status.textContent = '';
      fill(list, errorBlock(e.message, () => load(true)));
    }
  }
  // Empty states always offer a way forward.
  function filtered() { return KEYS.some((k) => view[k]) || !!view.kind; }
  function clearFilters() { ctx.navigate(`/grid${qs({ q: view.q })}`); } // the page repaints from the URL
  function noMatches() {
    return h('div', { class: 'empty-state' },
      h('p', { class: 'empty-title' }, 'Nothing matches all of these filters.'),
      h('p', {}, 'Try removing one, or start again from everything.'),
      filtered() ? h('button', { class: 'btn', type: 'button', onclick: clearFilters }, icon('x', 16), 'Clear filters') : null);
  }
  function noResults(fb) {
    return h('div', { class: 'empty-state' },
      h('p', { class: 'empty-title' }, `Nothing found for “${view.q}”.`),
      h('p', {}, filtered() ? 'Try fewer words, or remove a filter.' : 'Try fewer or different words.'),
      fb?.topics?.length ? [h('p', { class: 'empty-sub' }, 'Topics that may help'),
        h('ul', { class: 'pills' }, fb.topics.map((t) => h('li', {}, h('a', { class: 'pill', href: `/grid?topic=${encodeURIComponent(t.slug)}`, 'data-link': '' }, t.name))))] : null,
      fb?.picks?.length ? [h('p', { class: 'empty-sub' }, 'Editors’ picks to start with'), rowList(fb.picks)] : null,
      filtered() ? h('button', { class: 'btn', type: 'button', onclick: clearFilters }, icon('x', 16), 'Clear filters') : null);
  }
  await firstLoad;
}
