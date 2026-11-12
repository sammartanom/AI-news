import { h, fill, $, announce, safeHref } from '/js/dom.js';
import { api, qs, setAuthToken } from '/js/api.js';
import { formatAdded } from '/js/format.js';
import { icon } from '/js/icons.js';

const root = $('#ed');
let config = null;
let tab = 'review';
let counts = null;
let selectedId = null;

const clock = (iso) => { const [hh, mm] = iso.slice(11, 16).split(':').map(Number); return `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`; };
const when = (iso) => (iso ? `${formatAdded(iso)}, ${clock(iso)} UTC` : 'never');
const flash = (el, text, bad = false) => { el.textContent = text; el.className = `ed-msg${bad ? ' ed-flag' : ''}`; announce(text); };

// Editors sign in through Cloudflare Access when it is set up, or with the ADMIN_TOKEN secret when
// it is not. The token only has to be pasted once per device: by default the server swaps it for
// an HttpOnly cookie that keeps this browser signed in for 90 days.
async function boot() {
  let me = null;
  try { me = (await api.get('/api/me')).user; } catch (e) { fill(root, h('p', { class: 'error' }, e.message)); return; }
  if (me && me.role !== 'user') return start({ access: true });
  if (await signedInHere()) return start();
  let saved = null;
  try { saved = sessionStorage.getItem('signal:editor-token'); } catch { /* storage unavailable */ }
  if (saved && (await tryToken(saved))) return start();
  const input = h('input', { id: 'tok', type: 'password', autocomplete: 'current-password', required: true });
  const keep = h('input', { id: 'keep', type: 'checkbox', checked: true });
  const msg = h('p', { class: 'ed-msg', role: 'status' });
  const form = h('form', { class: 'ed-form ed-signin', onsubmit: async (e) => {
    e.preventDefault();
    const token = input.value.trim();
    flash(msg, 'Checking\u2026');
    if (keep.checked) {
      let ok = false;
      try { await api.post('/api/editor/session', { token }); ok = true; } catch { /* not accepted */ }
      if (ok) return start();
    } else if (await tryToken(token)) {
      try { sessionStorage.setItem('signal:editor-token', token); } catch { /* ignore */ }
      return start();
    }
    flash(msg, 'That token was not accepted.', true);
  } },
  // A hidden username lets password managers save and fill the token like any other password.
  h('input', { type: 'text', name: 'username', autocomplete: 'username', value: 'editor', hidden: true, readonly: true, 'aria-hidden': 'true', tabindex: '-1' }),
  h('div', { class: 'ed-field' }, h('label', { for: 'tok' }, 'Editor token'), input, h('span', { class: 'help' }, 'The ADMIN_TOKEN secret set on this Worker. Your password manager can save it.')),
  h('label', { class: 'ed-check', for: 'keep' }, keep, h('span', {}, 'Keep me signed in on this device for 90 days')),
  h('button', { class: 'btn btn-primary', type: 'submit' }, 'Sign in'), msg);
  fill(root, h('h1', {}, 'Editor console'),
    me ? h('p', {}, `${me.email} does not have editor access. Use the editor token instead.`) : h('p', {}, 'Enter the editor token to continue.'),
    form);
}

// Already signed in on this device (the cookie is HttpOnly, so ask the server).
async function signedInHere() {
  try { await api.get('/api/editor/summary'); return true; } catch { return false; }
}

async function tryToken(token) {
  setAuthToken(token);
  try { await api.get('/api/editor/summary'); return true; } catch { setAuthToken(null); return false; }
}

async function signOut() {
  try { await api.del('/api/editor/session'); } catch { /* the cookie may already be gone */ }
  try { sessionStorage.removeItem('signal:editor-token'); } catch { /* ignore */ }
  setAuthToken(null);
  location.reload();
}

async function start({ access = false } = {}) {
  config = await api.get('/api/config');
  document.querySelector('.ed-tabs').hidden = false; // the tabs mean nothing until signed in
  document.querySelector('.ed-bar-end').hidden = false;
  const out = document.querySelector('#signout');
  if (out && !access) { out.hidden = false; out.addEventListener('click', signOut, { once: true }); } // Access sessions sign out through Access
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
  $('#add-open').addEventListener('click', () => openAdd());
  addEventListener('popstate', () => go(fromHash(), { push: false }));
  go(fromHash(), { push: false });
}

const TABS = ['review', 'library', 'feeds', 'activity'];
const fromHash = () => (TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'review');

function go(next, { push = true } = {}) {
  tab = next;
  if (push && location.hash !== `#${tab}`) history.pushState(null, '', `#${tab}`);
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
  selectedId = null;
  if (tab === 'feeds') return feedsTab();
  if (tab === 'activity') return activityTab();
  return listView(tab);
}

async function refreshCounts() {
  try {
    const s = (await api.get('/api/editor/summary')).counts;
    counts = s;
    const el = $('[data-count="review"]');
    if (el) el.textContent = s.indexed ? String(s.indexed) : '';
  } catch { /* counts are a nicety */ }
  return counts;
}

// ---------- Toast with undo ----------
let toastTimer = null;
function toast(text, { undo = null, bad = false } = {}) {
  const el = $('#toast');
  clearTimeout(toastTimer);
  fill(el, h('span', {}, text), undo ? h('button', { type: 'button', class: 'ed-toast-undo', onclick: async () => { el.hidden = true; await undo(); } }, icon('undo', 16), 'Undo') : null,
    h('button', { type: 'button', class: 'ed-toast-x', 'aria-label': 'Dismiss', onclick: () => { el.hidden = true; } }, icon('x', 16)));
  el.classList.toggle('bad', bad);
  el.hidden = false;
  toastTimer = setTimeout(() => { el.hidden = true; }, undo ? 9000 : 5000);
}

// ---------- Review and Library ----------
// Review: what is waiting. Library: what is on the site, and what was removed.
const FILTERS = {
  review: [
    ['waiting', 'All waiting', { status: 'indexed' }, (s) => s.indexed],
    ['duplicates', 'Possible duplicates', { status: 'indexed', flagged: '1' }, (s) => s.flagged_duplicates],
    ['held', 'Held back', { status: 'indexed', held: '1' }, (s) => s.held_back]
  ],
  library: [
    ['all', 'On the site', { status: 'published' }, (s) => s.published],
    ['auto', 'Not reviewed', { status: 'published', auto: '1' }, (s) => s.auto_published],
    ['removed', 'Removed', { status: 'rejected' }, (s) => s.rejected]
  ]
};
const listState = { review: { filter: 'waiting', q: '' }, library: { filter: 'all', q: '' } };

async function listView(kind) {
  const st = listState[kind];
  const filters = FILTERS[kind];
  const params = () => filters.find((f) => f[0] === st.filter)?.[2] ?? filters[0][2];
  const removedView = () => st.filter === 'removed';
  let offset = 0;
  const selected = new Set();

  const chips = h('div', { class: 'ed-chips', role: 'group', 'aria-label': 'Show' });
  const search = h('input', { type: 'search', class: 'ed-search', placeholder: kind === 'review' ? 'Search waiting items' : 'Search the library', 'aria-label': 'Search by title or publisher', value: st.q });
  const total = h('p', { class: 'ed-total muted', role: 'status' });
  const bulk = h('div', { class: 'ed-bulk', hidden: true });
  const list = h('ul', { class: 'ed-list', 'aria-label': kind === 'review' ? 'Waiting for review' : 'Library' });
  const more = h('div', { class: 'ed-more-row' });
  const detail = h('div', { class: 'ed-detail', hidden: true });
  const empty = h('div', { class: 'ed-detail-empty' }, h('p', {}, kind === 'review' ? 'Pick an item to check it, or publish and remove straight from the list.' : 'Pick an item to edit it, or remove it straight from the list.'));
  const pane = h('aside', { class: 'ed-pane', 'aria-label': 'Selected item' }, empty, detail);

  fill(root,
    h('div', { class: 'ed-page-head' }, h('h1', {}, kind === 'review' ? 'Review' : 'Library'), total),
    h('div', { class: 'ed-toolbar' }, chips, search), bulk,
    h('div', { class: 'ed-split' }, h('div', { class: 'ed-list-col' }, list, more), pane));

  let timer = null;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { st.q = search.value.trim(); load(true); }, 250); });

  function paintChips(s) {
    fill(chips, filters.map(([id, label, , n]) => h('button', { type: 'button', 'aria-pressed': String(st.filter === id), onclick: () => { st.filter = id; paintChips(s); load(true); } },
      label, s && n(s) !== undefined ? h('span', { class: 'n num' }, String(n(s) ?? 0)) : null)));
  }

  function paintBulk() {
    bulk.hidden = !selected.size;
    if (!selected.size) return;
    fill(bulk, h('span', {}, `${selected.size} selected`),
      kind === 'review' ? h('button', { class: 'btn', type: 'button', onclick: () => bulkAct('publish') }, icon('check', 16), 'Publish') : null,
      removedView() ? h('button', { class: 'btn', type: 'button', onclick: () => bulkAct('restore') }, icon('undo', 16), 'Restore')
        : h('button', { class: 'btn btn-danger', type: 'button', onclick: () => bulkAct('remove') }, icon('trash', 16), 'Remove'),
      h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => { selected.clear(); list.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = false; }); paintBulk(); } }, 'Clear'));
  }

  async function bulkAct(action) {
    const ids = [...selected];
    let done = 0; let failed = 0;
    for (const id of ids) {
      try { await act(action, id); done++; } catch { failed++; }
    }
    selected.clear();
    await reload();
    const verb = { publish: 'Published', remove: 'Removed', restore: 'Restored' }[action];
    toast(`${verb} ${done} item${done === 1 ? '' : 's'}.${failed ? ` ${failed} could not be ${verb.toLowerCase()}${action === 'publish' ? ': open them to add why they are included and an audience' : ''}.` : ''}`, {
      bad: failed > 0,
      undo: action === 'remove' && done ? async () => { for (const id of ids) await act('restore', id, kind === 'review' ? 'indexed' : 'published').catch(() => {}); await reload(); toast('Put back.'); } : null
    });
  }

  function act(action, id, to) {
    const enc = encodeURIComponent(id);
    if (action === 'publish') return api.post(`/api/editor/resources/${enc}/publish`);
    if (action === 'remove') return api.post(`/api/editor/resources/${enc}/reject`, { reason: 'Removed by an editor' });
    return api.post(`/api/editor/resources/${enc}/restore`, { to: to ?? 'published' });
  }

  async function removeOne(r, li) {
    li.classList.add('leaving');
    try {
      await act('remove', r.id);
      if (selectedId === r.id) closeDetail();
      await reload();
      toast(`Removed “${r.title}”.`, { undo: async () => { await act('restore', r.id, r.status === 'indexed' ? 'indexed' : 'published'); await reload(); toast('Put back.'); } });
    } catch (e) { li.classList.remove('leaving'); toast(e.message, { bad: true }); }
  }

  async function publishOne(r, li) {
    try {
      await act('publish', r.id);
      li.classList.add('leaving');
      await reload();
      toast(`Published “${r.title}”.`);
    } catch (e) {
      if (e.status === 422) { await select(r.id, 'Add why it is included and an audience, then publish.'); return; }
      toast(e.message, { bad: true });
    }
  }

  async function restoreOne(r) {
    try { await act('restore', r.id); await reload(); toast(`Restored “${r.title}”.`); } catch (e) { toast(e.message, { bad: true }); }
  }

  function row(r) {
    const t = itemTag(r);
    const check = h('input', { type: 'checkbox', 'aria-label': `Select ${r.title}`, onchange: (e) => { if (e.target.checked) selected.add(r.id); else selected.delete(r.id); paintBulk(); } });
    const li = h('li', { 'data-id': r.id });
    const open = h('button', { type: 'button', class: 'ed-row-main', 'aria-current': String(r.id === selectedId), onclick: () => select(r.id) },
      h('span', { class: 't' }, r.title),
      h('span', { class: 'm' }, h('span', { class: 'pub' }, r.publisher), h('span', { class: 'when' }, formatAdded(r.added_at ?? r.discovered_at)), t ? h('span', { class: `tag${t.bad ? ' bad' : ''}` }, t.text) : null));
    const actions = h('div', { class: 'ed-row-acts' },
      removedView()
        ? h('button', { type: 'button', class: 'ed-icon-btn', title: 'Restore', 'aria-label': `Restore ${r.title}`, onclick: () => restoreOne(r) }, icon('undo', 18))
        : [kind === 'review' ? h('button', { type: 'button', class: 'ed-icon-btn ok', title: 'Publish', 'aria-label': `Publish ${r.title}`, onclick: () => publishOne(r, li) }, icon('check', 18)) : null,
           h('button', { type: 'button', class: 'ed-icon-btn danger', title: 'Remove', 'aria-label': `Remove ${r.title}`, onclick: () => removeOne(r, li) }, icon('trash', 18))]);
    return fill(li, h('label', { class: 'ed-row-check' }, check), open, actions);
  }

  async function load(reset) {
    if (reset) { offset = 0; selected.clear(); paintBulk(); list.classList.add('loading'); }
    try {
      const d = await api.get(`/api/editor/queue${qs({ ...params(), q: st.q, offset, limit: 40 })}`);
      if (reset) fill(list);
      d.items.forEach((r) => list.append(row(r)));
      offset += d.items.length;
      total.textContent = `${d.total.toLocaleString()} ${st.q ? 'matching' : filters.find((f) => f[0] === st.filter)[1].toLowerCase()}`;
      if (reset && !d.items.length) list.append(h('li', { class: 'ed-empty' }, st.q ? 'Nothing matches that search.' : kind === 'review' ? 'All caught up. Nothing is waiting.' : 'Nothing here.'));
      fill(more, offset < d.total ? h('button', { class: 'btn', type: 'button', onclick: () => load(false) }, `Show more (${(d.total - offset).toLocaleString()} left)`) : null);
    } catch (e) { fill(list, h('li', { class: 'ed-empty error' }, e.message)); }
    list.classList.remove('loading');
  }

  async function reload() { paintChips(await refreshCounts()); await load(true); }

  function closeDetail() {
    selectedId = null;
    detail.hidden = true; empty.hidden = false;
    pane.classList.remove('open');
    document.body.classList.remove('ed-sheet-open');
    list.querySelectorAll('.ed-row-main').forEach((b) => b.setAttribute('aria-current', 'false'));
  }

  async function select(id, notice) {
    selectedId = id;
    list.querySelectorAll('li').forEach((li) => li.querySelector('.ed-row-main')?.setAttribute('aria-current', String(li.dataset.id === id)));
    try {
      const d = await api.get(`/api/editor/resources/${encodeURIComponent(id)}`);
      empty.hidden = true; detail.hidden = false;
      pane.classList.add('open');
      document.body.classList.add('ed-sheet-open');
      renderForm(detail, d, {
        notice,
        close: closeDetail,
        refresh: async (note) => { await reload(); await select(id, note); },
        afterRemove: async (text, undo) => { closeDetail(); await reload(); if (text) toast(text, { undo: undo ? async () => { await undo(); await reload(); toast('Put back.'); } : null }); }
      });
      detail.querySelector('h2')?.focus();
    } catch (e) { toast(e.message, { bad: true }); }
  }

  list.addEventListener('keydown', (e) => {
    if (e.key !== 'j' && e.key !== 'k') return;
    const items = [...list.querySelectorAll('.ed-row-main')];
    const at = items.indexOf(document.activeElement);
    const next = items[Math.max(0, Math.min(items.length - 1, at + (e.key === 'j' ? 1 : -1)))];
    if (next) { e.preventDefault(); next.focus(); next.scrollIntoView({ block: 'nearest' }); }
  });
  addEventListener('keydown', function esc(e) { if (!root.contains(pane)) return removeEventListener('keydown', esc); if (e.key === 'Escape' && pane.classList.contains('open') && !document.querySelector('dialog[open]')) closeDetail(); });

  paintChips(counts);
  await reload();
}

// ---------- Add: an article or a feed ----------
function openAdd(kind = 'article') {
  const dlg = h('dialog', { class: 'ed-dialog', 'aria-labelledby': 'add-title' });
  const body = h('div', {});
  const seg = h('div', { class: 'ed-seg', role: 'tablist', 'aria-label': 'What to add' });
  const paint = (k) => {
    fill(seg, [['article', 'An article or page'], ['feed', 'A feed']].map(([v, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === v), onclick: () => paint(v) }, l)));
    fill(body, k === 'article' ? addArticle(dlg) : addFeed(dlg));
    body.querySelector('input')?.focus();
  };
  fill(dlg, h('div', { class: 'ed-dialog-head' }, h('h2', { id: 'add-title' }, 'Add to the library'), h('button', { type: 'button', class: 'ed-icon-btn', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('x', 20))), seg, body);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  paint(kind);
}

const inputField = (id, label, props = {}, help = null) => h('div', { class: 'ed-field' }, h('label', { for: id }, label), h(props.tag ?? 'input', { id, type: props.tag ? undefined : (props.type ?? 'text'), ...props, tag: undefined, value: props.tag ? undefined : props.value }, props.tag === 'textarea' ? props.value ?? '' : null), help ? h('span', { class: 'help' }, help) : null);

function addArticle(dlg) {
  const msg = h('p', { class: 'ed-msg', role: 'status' });
  const step2 = h('div', {});
  const find = h('form', { class: 'ed-find', onsubmit: async (e) => {
    e.preventDefault();
    fill(step2);
    flash(msg, 'Reading the page…');
    try {
      const d = await api.post('/api/editor/lookup', { url: find.querySelector('#a-url').value.trim() });
      if (d.existing) {
        flash(msg, `Already in the library (${d.existing.status === 'published' ? 'on the site' : d.existing.status === 'rejected' ? 'removed' : 'waiting for review'}): ${d.existing.title}`);
        return;
      }
      flash(msg, d.unreadable ?? (d.title ? 'Check the details, then publish.' : 'The page did not give a title. Fill in the details.'));
      fill(step2, details(d));
      step2.querySelector('#a-why')?.focus();
    } catch (err) { flash(msg, err.message, true); }
  } },
  inputField('a-url', 'Link to the article, guide, video or report', { type: 'url', placeholder: 'https://', required: true, autocomplete: 'off' }),
  h('button', { class: 'btn btn-primary', type: 'submit' }, 'Look it up'));

  function details(d) {
    const format = h('select', { id: 'a-format' }, config.formats.map((f) => h('option', { value: f, selected: f === (d.format ?? 'Article') }, f)));
    const form = h('form', { class: 'ed-form', onsubmit: (e) => { e.preventDefault(); submit(e.submitter?.value === 'review' ? 'review' : 'publish'); } },
      h('div', { class: 'ed-row' }, inputField('a-title', 'Title', { required: true, maxlength: '300', value: d.title ?? '' }), inputField('a-publisher', 'Publisher', { required: true, maxlength: '200', value: d.publisher ?? '' })),
      h('div', { class: 'ed-row' }, h('div', { class: 'ed-field' }, h('label', { for: 'a-format' }, 'Type'), format),
        inputField('a-date', 'Published', { maxlength: '10', placeholder: 'YYYY-MM-DD', value: d.published_at ?? '' }, d.published_at ? 'As the page states it.' : 'Optional.')),
      h('div', { class: 'ed-field', role: 'group', 'aria-label': 'Who it is for' }, h('span', { class: 'l' }, 'Who it is for'),
        h('div', { class: 'ed-checks' }, config.audiences.map((a) => h('label', {}, h('input', { type: 'checkbox', name: 'a-aud', value: a, checked: a === 'Everyone' }), a)))),
      inputField('a-why', 'Why it is worth reading', { tag: 'textarea', rows: '2', maxlength: '300' }, 'One sentence. Needed to publish; leave it empty to save it for review instead.'),
      h('div', { class: 'ed-dialog-actions' },
        h('button', { class: 'btn btn-primary', type: 'submit', value: 'publish' }, 'Publish'),
        h('button', { class: 'btn', type: 'submit', value: 'review' }, 'Save for review')));
    async function submit(mode) {
      const v = (id) => form.querySelector(`#${id}`).value.trim();
      const why = v('a-why');
      if (mode === 'publish' && !why) { flash(msg, 'Add one sentence on why it is worth reading, or choose Save for review.', true); form.querySelector('#a-why').focus(); return; }
      const audiences = [...form.querySelectorAll('[name=a-aud]:checked')].map((x) => x.value);
      try {
        const { resource } = await api.post('/api/editor/resources', {
          url: d.url, title: v('a-title'), publisher: v('a-publisher'), format: format.value, published_at: v('a-date') || undefined,
          audiences: audiences.length ? audiences : ['Everyone'], why: why || undefined, description: d.description || undefined
        });
        if (mode === 'publish') await api.post(`/api/editor/resources/${encodeURIComponent(resource.id)}/publish`);
        dlg.close();
        toast(mode === 'publish' ? `Published “${resource.title}”.` : `Saved “${resource.title}” for review.`);
        go(mode === 'publish' ? 'library' : 'review', { push: true });
      } catch (err) { flash(msg, err.message, true); }
    }
    return form;
  }
  return h('div', {}, find, msg, step2);
}

function addFeed(dlg) {
  const msg = h('p', { class: 'ed-msg', role: 'status' });
  const step2 = h('div', {});
  const find = h('form', { class: 'ed-find', onsubmit: async (e) => {
    e.preventDefault();
    fill(step2);
    flash(msg, 'Looking for the feed…');
    try {
      const f = await api.post('/api/editor/feeds/find', { url: find.querySelector('#f-url').value.trim() });
      if (f.existing) { flash(msg, `Already added as “${f.existing.name}”.`); return; }
      flash(msg, '');
      fill(step2, details(f));
    } catch (err) { flash(msg, err.message, true); }
  } },
  inputField('f-url', 'The website or its feed address', { type: 'url', placeholder: 'https://', required: true, autocomplete: 'off' }, 'Any page on the site works. The feed is found for you.'),
  h('button', { class: 'btn btn-primary', type: 'submit' }, 'Find feed'));

  function details(f) {
    const aiOnly = h('input', { type: 'checkbox', id: 'f-ai', checked: true });
    const review = h('input', { type: 'checkbox', id: 'f-review' });
    const form = h('form', { class: 'ed-form', onsubmit: async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      flash(msg, 'Adding the feed and reading it…');
      try {
        const d = await api.post('/api/editor/feeds', { feed_url: f.feed_url, site_url: f.site_url, name: form.querySelector('#f-name').value.trim(), publisher: form.querySelector('#f-publisher').value.trim(), ai_only: aiOnly.checked, review_first: review.checked });
        dlg.close();
        const n = d.report.new + d.report.flagged;
        toast(`Added “${d.source.name}”. ${n ? `${n} new item${n === 1 ? '' : 's'} ${review.checked ? 'waiting for review' : 'found'}.` : 'Nothing new yet; it is checked every two hours.'}${d.report.error ? ` First read failed: ${d.report.error}` : ''}`, { bad: Boolean(d.report.error) });
        go('feeds');
      } catch (err) { btn.disabled = false; flash(msg, err.message, true); }
    } },
    h('div', { class: 'ed-found' },
      h('p', {}, icon('rss', 16), h('span', { class: 'url' }, f.feed_url)),
      h('p', { class: 'muted' }, `${f.items} recent item${f.items === 1 ? '' : 's'}, ${f.ai_items} about AI.`),
      f.sample.length ? h('ul', {}, f.sample.map((t) => h('li', {}, t))) : null),
    h('div', { class: 'ed-row' }, inputField('f-name', 'Name', { required: true, maxlength: '120', value: f.title }), inputField('f-publisher', 'Publisher', { maxlength: '200', value: f.title }, 'Shown on every item from this feed.')),
    h('label', { class: 'ed-check', for: 'f-ai' }, aiOnly, h('span', {}, 'Only take items about AI')),
    h('label', { class: 'ed-check', for: 'f-review' }, review, h('span', {}, 'Let me review new items before they appear')),
    h('div', { class: 'ed-dialog-actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Add feed')));
    return form;
  }
  return h('div', {}, find, msg, step2);
}

// The one thing worth knowing about an item at a glance, most urgent first.
function itemTag(r) {
  if (r.duplicate_of && !r.duplicate_dismissed) return { text: 'Possible duplicate', bad: true };
  if (r.auto_hold) return { text: 'Held back', bad: true };
  if (['broken', 'blocked', 'error'].includes(r.link_status)) return { text: `Link ${r.link_status}`, bad: true };
  if (r.auto_assessment?.decision === 'needs_review') return { text: 'Needs review' };
  if (r.auto_published) return { text: r.spot_checked_at ? 'Automatic, checked' : 'Automatic' };
  if (r.featured) return { text: 'Featured' };
  return null;
}

function field(label, control) {
  const id = control.id || `c-${Math.random().toString(36).slice(2, 8)}`;
  control.id = id;
  return h('label', { for: id }, label, control);
}

// ---------- Resource form ----------
function renderForm(box, d, { refresh, afterRemove, notice, close }) {
  const r = d.resource;
  const msg = h('p', { class: 'ed-msg', role: 'status' });
  const inputs = {};
  const txt = (name, label, opts = {}) => {
    const el = opts.area ? h('textarea', { id: `e-${name}`, rows: String(opts.rows ?? 3), maxlength: String(opts.max ?? 1000) }) : h('input', { id: `e-${name}`, type: opts.type ?? 'text', maxlength: String(opts.max ?? 300) });
    el.value = r[name] ?? '';
    inputs[name] = el;
    const count = opts.max && opts.counter ? h('span', { class: 'help' }) : null;
    if (count) { const upd = () => { count.textContent = `${el.value.length} of ${opts.max}`; }; el.addEventListener('input', upd); upd(); }
    return h('div', { class: 'ed-field' }, h('label', { for: el.id }, label), el, opts.help ? h('span', { class: 'help' }, opts.help) : null, count);
  };
  const checks = (name, label, options, current) => {
    const boxes = options.map((o) => h('label', {}, h('input', { type: 'checkbox', value: o.value, checked: current.includes(o.value) }), o.label ?? o.value));
    inputs[name] = boxes;
    return h('div', { class: 'ed-field', role: 'group', 'aria-label': label }, h('span', { class: 'l' }, label), h('div', { class: 'ed-checks' }, boxes));
  };
  const select = (name, label, options, current) => {
    const el = h('select', { id: `e-${name}` }, options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(current ?? '') }, o.label)));
    inputs[name] = el;
    return h('div', { class: 'ed-field' }, h('label', { for: el.id }, label), el);
  };
  const flag = (name, label, checked) => {
    const el = h('input', { id: `e-${name}`, type: 'checkbox', checked });
    inputs[name] = el;
    return h('label', {}, el, label);
  };

  const original = safeHref(r.url);
  const prov = r.source_provenance;
  const collect = () => {
    const picked = (name) => inputs[name].filter((b) => b.querySelector('input').checked).map((b) => b.querySelector('input').value);
    const val = (n) => inputs[n].value.trim();
    const list = (n) => val(n).split(',').map((x) => x.trim()).filter(Boolean);
    return {
      title: val('title'), publisher: val('publisher'), url: val('url'), author: val('author') || null, format: val('format'),
      evidence_type: val('evidence_type') || null, audiences: picked('audiences'), collections: picked('collections'),
      topics: list('topics'), grade_bands: picked('grade_bands'), subjects: list('subjects'),
      why: val('why') || null, best_for: val('best_for') || null, editorial_note: val('editorial_note') || null,
      summary: val('summary') || null, summary_generated: inputs.summary_generated.checked, summary_approved: inputs.summary_approved.checked,
      published_at: val('published_at') || null, verification_status: val('verification_status'), verification: val('verification') || null,
      language: val('language') || null, reading_minutes: val('reading_minutes') ? Number(val('reading_minutes')) : null, status_checked_at: val('status_checked_at') || null,
      editorial_priority: Number(val('editorial_priority')), ...(r.status === 'published' ? { featured: inputs.featured.checked } : {})
    };
  };

  const run = async (label, fn) => {
    flash(msg, `${label}…`);
    try { await fn(); } catch (e) { flash(msg, e.message, true); }
  };
  const save = () => run('Saving', async () => {
    const res = await api.patch(`/api/editor/resources/${encodeURIComponent(r.id)}`, collect());
    await refresh('Saved.');
  });
  const publish = () => run('Publishing', async () => {
    await api.patch(`/api/editor/resources/${encodeURIComponent(r.id)}`, collect());
    const res = await api.post(`/api/editor/resources/${encodeURIComponent(r.id)}/publish`);
    await refresh(res.indexing.ok ? 'Published.' : 'Published. Search will catch up within a few hours.');
  });
  const enc = encodeURIComponent(r.id);
  const remove = () => run('Removing', async () => {
    await api.post(`/api/editor/resources/${enc}/reject`, { reason: 'Removed by an editor' });
    await afterRemove(`Removed “${r.title}”.`, () => api.post(`/api/editor/resources/${enc}/restore`, { to: r.status === 'indexed' ? 'indexed' : 'published' }));
  });
  const restore = () => run('Restoring', async () => { await api.post(`/api/editor/resources/${enc}/restore`, { to: 'published' }); await afterRemove(`Restored “${r.title}”.`); });
  const spot = () => run('Saving', async () => { await api.post(`/api/editor/resources/${encodeURIComponent(r.id)}/spot-check`); await refresh('Marked as checked.'); });
  const suggest = () => run('Asking the model', async () => {
    const { suggestion, note } = await api.post(`/api/editor/resources/${encodeURIComponent(r.id)}/suggest`);
    const fillText = (name, v) => { if (v && !inputs[name].value) inputs[name].value = v; };
    fillText('why', suggestion.why_draft);
    fillText('best_for', suggestion.best_for_draft);
    fillText('topics', suggestion.topics.join(', '));
    if (suggestion.evidence_type && !inputs.evidence_type.value) inputs.evidence_type.value = suggestion.evidence_type;
    for (const name of ['audiences', 'collections', 'grade_bands']) {
      const boxes = inputs[name].map((b) => b.querySelector('input'));
      if (!boxes.some((b) => b.checked)) boxes.forEach((b) => { if (suggestion[name].includes(b.value)) b.checked = true; });
    }
    flash(msg, `${note} Nothing is saved until you press Save.`);
  });
  const checkLink = () => run('Checking link', async () => { const res = await api.post(`/api/editor/resources/${encodeURIComponent(r.id)}/check-link`); flash(msg, `Link status: ${res.link_status}${res.http ? ` (HTTP ${res.http})` : ''}.`); });

  const relationBox = h('div', {});
  const paintRelations = (rels) => fill(relationBox,
    rels.length ? h('ul', { class: 'ed-rel list-plain' }, rels.map((x) => h('li', {}, h('span', {}, `${relLabel(x.relation)}: ${x.title} (${x.publisher}${x.status !== 'published' ? `, ${x.status}` : ''})`),
      h('button', { class: 'link', type: 'button', onclick: () => run('Removing', async () => paintRelations((await api.del(`/api/editor/resources/${encodeURIComponent(r.id)}/relations/${encodeURIComponent(x.id)}`)).relations) ) }, 'Remove')))) : h('p', { class: 'muted' }, 'None.'),
    relationForm(r.id, paintRelations, msg));
  paintRelations(d.relations);

  fill(box,
    h('form', { class: 'ed-form', onsubmit: (e) => { e.preventDefault(); save(); } },
      h('header', { class: 'ed-head' },
        h('div', { class: 'ed-head-top' }, h('button', { type: 'button', class: 'ed-icon-btn ed-back', 'aria-label': 'Back to the list', onclick: () => close?.() }, icon('back', 20)),
          h('h2', { tabindex: '-1' }, r.title)),
        h('p', { class: 'muted' }, `${r.publisher} · ${curationText(r)} · found ${when(r.discovered_at)}`,
          original ? [' · ', h('a', { class: 'link', href: original, target: '_blank', rel: 'noopener noreferrer' }, 'View original')] : null)),
      d.duplicate || r.duplicate_of ? h('div', { class: 'ed-warn', role: 'alert' },
        h('strong', {}, 'Possible duplicate. '), r.duplicate_reason ?? '',
        d.duplicate ? h('div', {}, `Existing: ${d.duplicate.title} (${d.duplicate.publisher}, ${d.duplicate.status}) `, h('a', { class: 'link', href: safeHref(d.duplicate.url) ?? '#', target: '_blank', rel: 'noopener noreferrer' }, 'Open')) : null,
        !r.duplicate_dismissed ? h('div', {}, h('button', { class: 'btn', type: 'button', onclick: () => run('Dismissing', async () => { await api.patch(`/api/editor/resources/${encodeURIComponent(r.id)}`, { duplicate_dismissed: true }); await refresh(); }) }, 'Not a duplicate')) : h('div', { class: 'muted' }, 'Warning dismissed.')) : null,
      autoBox(r),
      h('section', { class: 'ed-essentials' },
        txt('why', 'Why included', { area: true, rows: 2, max: 300, counter: true, help: 'One direct sentence on why this belongs. Not a summary.' }),
        txt('best_for', 'Best for', { max: 200 }),
        checks('audiences', 'Audience', config.audiences.map((a) => ({ value: a })), r.audiences),
        checks('collections', 'Collections', config.collections.map((c) => ({ value: c.slug, label: c.name })), r.collections),
        h('div', { class: 'ed-row' },
          txt('topics', 'Topics', { help: 'Comma-separated.' }),
          txt('published_at', 'Original publication date', { help: 'YYYY, YYYY-MM or YYYY-MM-DD, only if seen on the original.' })),
        h('div', { class: 'ed-inline' },
          r.status === 'published' ? flag('featured', 'Featured on the home page', r.featured) : null,
          h('button', { class: 'link', type: 'button', onclick: suggest }, 'Draft empty fields with the model'))),
      h('details', { class: 'ed-more' }, h('summary', {}, 'More details'),
        h('div', { class: 'ed-row' }, txt('title', 'Title'), txt('publisher', 'Publisher')),
        h('div', { class: 'ed-row' }, txt('url', 'URL', { type: 'url', max: 2000 }), txt('author', 'Author', { help: 'Only if verified.' })),
        h('p', { class: 'ed-inline' }, h('button', { class: 'btn', type: 'button', onclick: checkLink }, 'Check link'),
          h('span', { class: `muted${['broken', 'error'].includes(r.link_status) ? ' ed-flag' : ''}` }, `Link ${r.link_status}${r.last_link_check ? `, checked ${when(r.last_link_check)}` : ''}`)),
        h('div', { class: 'ed-row' },
          txt('format', 'Format'),
          select('evidence_type', 'Resource type', [{ value: '', label: 'Not set' }, ...config.evidence_types.map((e) => ({ value: e.slug, label: e.name }))], r.evidence_type),
          select('editorial_priority', 'Priority', [{ value: 0, label: 'Normal' }, { value: 1, label: 'Raised' }, { value: 2, label: 'High' }], r.editorial_priority)),
        checks('grade_bands', 'Grade band', config.grade_bands.map((g) => ({ value: g })), r.grade_bands),
        txt('subjects', 'Subjects', { help: 'Comma-separated.' }),
        txt('editorial_note', 'Editor’s note', { area: true, max: 1200 }),
        txt('summary', 'Summary', { area: true, rows: 3, max: 1500, help: 'Shown, searched and embedded only when approved.' }),
        h('div', { class: 'ed-checks' }, flag('summary_generated', 'AI-generated', r.summary_generated), flag('summary_approved', 'Approved for use', r.summary_approved)),
        h('div', { class: 'ed-row' },
          select('verification_status', 'Verification', [{ value: 'unverified', label: 'Not checked' }, { value: 'checked', label: 'Checked: opened the original' }, { value: 'verified', label: 'Verified: details match the original' }], r.verification_status),
          txt('verification', 'Verification note', { max: 300 })),
        h('div', { class: 'ed-row' }, txt('language', 'Language', { max: 20 }), txt('reading_minutes', 'Minutes to read or watch', { type: 'number' })),
        h('div', { class: 'ed-row' }, txt('status_checked_at', 'Status checked (laws and trackers)', { type: 'date', help: 'The date you last confirmed the status with the official source. Shown to readers.' })),
        h('h3', {}, 'Read with this'), relationBox,
        r.description ? h('p', { class: 'ed-pre' }, `From the feed: ${r.description}`) : null,
        prov ? h('p', { class: 'ed-pre' }, [prov.source_name ? `Source: ${prov.source_name}` : null, prov.discovered_url ? `Found at: ${prov.discovered_url}` : null, prov.matched_terms?.length ? `Matched: ${prov.matched_terms.join(', ')}` : null].filter(Boolean).join('\n')) : null),
      msg,
      h('div', { class: 'ed-actions' },
        r.status === 'indexed' ? h('button', { class: 'btn btn-primary', type: 'button', onclick: publish }, icon('check', 16), 'Publish') : null,
        r.status === 'published' && r.auto_published ? h('button', { class: 'btn', type: 'button', onclick: publish, title: 'Mark it as reviewed: it gets the Editor’s pick mark' }, 'Mark as reviewed') : null,
        r.status === 'published' && r.auto_published && !r.spot_checked_at ? h('button', { class: 'btn btn-quiet', type: 'button', onclick: spot }, 'Looks fine') : null,
        r.status !== 'rejected' ? h('button', { class: r.status === 'indexed' ? 'btn' : 'btn btn-primary', type: 'submit' }, 'Save') : null,
        r.status === 'rejected' ? h('button', { class: 'btn btn-primary', type: 'button', onclick: restore }, icon('undo', 16), 'Restore') : h('button', { class: 'btn btn-danger ed-remove', type: 'button', onclick: remove }, icon('trash', 16), 'Remove'))
    ));
  if (notice) flash(msg, notice);
}

function autoBox(r) {
  const a = r.auto_assessment;
  if (!a && !r.auto_hold) return null;
  const lines = [
    a ? `Decision: ${a.decision === 'published' ? 'published automatically' : 'left for a person'} (${a.mode === 'model' ? `model ${a.model ?? ''}, confidence ${a.confidence ?? 'n/a'}` : 'rules only'}).` : null,
    ...(a?.reasons ?? []),
    a?.applied?.length ? `Filled in automatically: ${a.applied.join(', ')}.` : null,
    r.auto_hold ? `Pulled back: ${r.auto_hold.replace('_', ' ')}.` : null
  ].filter(Boolean);
  return h('div', { class: 'ed-note' }, h('strong', {}, 'Automatic decision'), h('p', {}, lines.join(' ')));
}

const relLabel = (slug) => config.relations.find((x) => x.slug === slug)?.name ?? slug;
const curationText = (r) => (r.status === 'published' && r.auto_published ? 'Published automatically, not reviewed' : { indexed: 'Waiting for review', rejected: 'Removed', curated: 'Curated', featured: 'Curated and featured' }[r.curation] ?? r.curation);

function relationForm(fromId, paint, msg) {
  const search = h('input', { id: 'rel-q', type: 'text', placeholder: 'Search published resources' });
  const results = h('select', { id: 'rel-target', 'aria-label': 'Resource to link' });
  const kind = h('select', { id: 'rel-kind', 'aria-label': 'Relationship' }, config.relations.map((x) => h('option', { value: x.slug }, x.name)));
  const note = h('input', { id: 'rel-note', type: 'text', maxlength: '200', placeholder: 'Note (optional)', 'aria-label': 'Relationship note' });
  search.addEventListener('change', async () => {
    try {
      const d = await api.get(`/api/search${qs({ q: search.value, limit: 10 })}`);
      fill(results, d.results.filter((x) => x.id !== fromId).map((x) => h('option', { value: x.id }, `${x.title} (${x.publisher})`)));
    } catch (e) { flash(msg, e.message, true); }
  });
  return h('div', { class: 'ed-row' }, search, results, kind, note,
    h('button', { class: 'btn', type: 'button', onclick: async () => {
      if (!results.value) return flash(msg, 'Search for a published resource first.', true);
      try { paint((await api.post(`/api/editor/resources/${encodeURIComponent(fromId)}/relations`, { to_id: results.value, relation: kind.value, note: note.value || null })).relations); flash(msg, 'Relationship added.'); } catch (e) { flash(msg, e.message, true); }
    } }, 'Add'));
}

// ---------- Feeds ----------
const ago = (iso) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m} minutes ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 36) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  return formatAdded(iso);
};

function feedStatus(s) {
  if (!s.enabled) return { text: 'Paused', cls: 'off' };
  if (s.consecutive_failures > 0) return { text: 'Having trouble', cls: 'bad' };
  if (!s.auto_publish) return { text: 'Review first', cls: '' };
  return { text: 'Active', cls: 'on' };
}

async function feedsTab() {
  const search = h('input', { type: 'search', class: 'ed-search', placeholder: 'Search feeds', 'aria-label': 'Search feeds' });
  const listEl = h('ul', { class: 'ed-feeds', 'aria-label': 'Feeds' });
  const total = h('p', { class: 'ed-total muted', role: 'status' });
  const msg = h('p', { class: 'ed-msg', role: 'status' });
  let sources = [];
  fill(root,
    h('div', { class: 'ed-page-head' }, h('h1', {}, 'Feeds'), total),
    h('p', { class: 'muted ed-intro' }, 'Every feed is checked every two hours. New items about AI are published automatically and labelled as not reviewed, unless a feed is set to review first.'),
    h('div', { class: 'ed-toolbar' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openAdd('feed') }, icon('plus', 16), 'Add a feed'), search),
    msg, listEl, maintenance());
  search.addEventListener('input', () => paint());

  async function load() {
    try { sources = (await api.get('/api/editor/sources')).sources; paint(); } catch (e) { fill(listEl, h('li', { class: 'ed-empty error' }, e.message)); }
  }
  function paint() {
    const q = search.value.trim().toLowerCase();
    const shown = sources.filter((s) => !q || `${s.name} ${s.publisher} ${s.feed_url}`.toLowerCase().includes(q))
      .sort((a, b) => (b.consecutive_failures > 0) - (a.consecutive_failures > 0) || b.enabled - a.enabled || a.name.localeCompare(b.name));
    const trouble = sources.filter((s) => s.enabled && s.consecutive_failures > 0).length;
    total.textContent = `${sources.filter((s) => s.enabled).length} active, ${sources.filter((s) => !s.enabled).length} paused${trouble ? `, ${trouble} having trouble` : ''}`;
    fill(listEl, shown.length ? shown.map(feedRow) : h('li', { class: 'ed-empty' }, q ? 'No feed matches that search.' : 'No feeds yet. Add one to start collecting.'));
  }
  function feedRow(s) {
    const st = feedStatus(s);
    const more = h('details', { class: 'ed-feed-more' }, h('summary', { 'aria-label': `More for ${s.name}` }, icon('more', 18)),
      h('div', { class: 'ed-menu' },
        h('button', { type: 'button', disabled: !s.enabled, onclick: () => patch(s, { auto_publish: !s.auto_publish }, s.auto_publish ? 'New items will wait for your review.' : 'New items will be published automatically.') }, s.auto_publish ? 'Review new items first' : 'Publish new items automatically'),
        h('button', { type: 'button', onclick: () => patch(s, { require_match: !s.require_match }, s.require_match ? 'Taking every item from this feed.' : 'Taking only items about AI.') }, s.require_match ? 'Take every item, not just AI' : 'Only take items about AI'),
        h('button', { type: 'button', class: 'danger', onclick: () => removeFeed(s) }, icon('trash', 16), 'Remove feed')));
    return h('li', { class: 'ed-feed' },
      h('div', { class: 'ed-feed-main' },
        h('div', { class: 'ed-feed-title' }, h('strong', {}, s.name), h('span', { class: `tag ${st.cls}` }, st.text)),
        h('div', { class: 'muted small' }, `${s.counts.published.toLocaleString()} on the site${s.counts.indexed ? `, ${s.counts.indexed} waiting` : ''} · checked ${ago(s.last_checked)}`),
        s.last_error && s.consecutive_failures > 0 ? h('div', { class: 'ed-flag small' }, plainError(s.last_error)) : null),
      h('div', { class: 'ed-feed-acts' },
        h('button', { type: 'button', class: 'btn', 'aria-label': `Check ${s.name} now`, disabled: !s.enabled, onclick: (e) => runOne(s, e.currentTarget) }, icon('refresh', 16), h('span', {}, 'Check now')),
        h('button', { type: 'button', class: 'btn', 'aria-label': `${s.enabled ? 'Pause' : 'Resume'} ${s.name}`, onclick: () => patch(s, s.enabled ? { enabled: false } : { review_status: 'verified', enabled: true }, s.enabled ? `Paused “${s.name}”.` : `Resumed “${s.name}”.`) }, icon(s.enabled ? 'pause' : 'play', 16), h('span', {}, s.enabled ? 'Pause' : 'Resume')),
        more));
  }
  async function patch(s, body, text) {
    try { await api.patch(`/api/editor/sources/${encodeURIComponent(s.id)}`, body); toast(text); await load(); } catch (e) { toast(e.message, { bad: true }); }
  }
  async function runOne(s, btn) {
    btn.disabled = true;
    try {
      const { report: r } = await api.post(`/api/editor/sources/${encodeURIComponent(s.id)}/run`);
      toast(r.error ? `${s.name}: ${plainError(r.error)}` : `${s.name}: ${r.new + r.flagged} new, ${r.duplicates} already here, ${r.filtered} skipped as not about AI.`, { bad: Boolean(r.error) });
      await load();
    } catch (e) { toast(e.message, { bad: true }); btn.disabled = false; }
  }
  async function removeFeed(s) {
    if (!confirm(`Remove “${s.name}”? It stops being checked. The ${s.counts.published} items it already added stay on the site.`)) return;
    try { await api.del(`/api/editor/sources/${encodeURIComponent(s.id)}`); toast(`Removed “${s.name}”.`); await load(); } catch (e) { toast(e.message, { bad: true }); }
  }
  load();
}

const plainError = (e) => {
  const t = String(e ?? '');
  if (/429/.test(t)) return 'The site is limiting requests; it will be tried again.';
  if (/403|blocked/i.test(t)) return 'The site refused the request.';
  if (/404/.test(t)) return 'The feed address no longer works. Remove it or add the new address.';
  if (/timeout|timed out/i.test(t)) return 'The site was too slow to answer.';
  return t.replace(/^[a-z_]+: /, '');
};

// The jobs that normally run on a schedule, for when you want them now.
function maintenance() {
  const msg = h('p', { class: 'ed-msg', role: 'status' });
  const job = (label, help, fn, text) => h('div', { class: 'ed-job' }, h('div', {}, h('strong', {}, label), h('span', { class: 'muted small' }, help)),
    h('button', { class: 'btn', type: 'button', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; flash(msg, `${label}…`); try { flash(msg, text(await fn())); } catch (err) { flash(msg, err.message, true); } b.disabled = false; } }, 'Run'));
  return h('details', { class: 'ed-more ed-maint' }, h('summary', {}, 'Run scheduled jobs now'),
    job('Check every feed', 'Normally every two hours.', () => api.post('/api/editor/ingest?force=1'), (d) => `Checked ${d.reports.length} feeds.`),
    job('Collect older posts', 'Reads back catalogues a page at a time.', () => api.post('/api/editor/archive'), (d) => d.reports.length ? `Read ${d.reports.length} pages: ${d.reports.reduce((n, r) => n + r.new, 0)} new items.` : 'Every back catalogue has been read.'),
    job('Sort waiting items', 'Publishes what passes the checks, holds the rest.', () => api.post('/api/editor/triage'), (d) => `${d.triage.published} published, ${d.triage.needs_review} left for review.`),
    job('Update search', 'Makes new items findable by meaning.', () => api.post('/api/editor/reindex'), (d) => `Updated ${d.indexed}. ${d.remaining ?? 0} remaining.`),
    job('Check links', 'Finds links that no longer work.', () => api.post('/api/editor/maintenance'), (d) => `Checked ${d.links.checked} links: ${d.links.broken} broken.`),
    msg);
}

// ---------- Activity ----------
// Downloads every catalogue table as one JSON file, fetched a page at a time.
function backupBox() {
  const msg = h('p', { class: 'ed-msg', role: 'status' });
  const btn = h('button', { class: 'btn', type: 'button' }, 'Download a backup');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const out = { exported_at: new Date().toISOString(), tables: {} };
      const { tables } = await api.get('/api/editor/export?table=resources&limit=1');
      for (const t of tables) {
        out.tables[t] = [];
        for (let offset = 0; offset !== null;) {
          flash(msg, `Copying ${t}: ${out.tables[t].length} rows`);
          const page = await api.get(`/api/editor/export?table=${t}&offset=${offset}&limit=200`);
          out.tables[t].push(...page.rows);
          offset = page.next;
        }
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
      const a = h('a', { href: url, download: `signal-backup-${out.exported_at.slice(0, 10)}.json` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      flash(msg, `Backup downloaded: ${Object.entries(out.tables).map(([t, r]) => `${r.length} ${t.replace(/_/g, ' ')}`).join(', ')}.`);
    } catch (e) { flash(msg, `The backup failed: ${e.message}`, true); }
    btn.disabled = false;
  });
  return h('section', { class: 'ed-backup' },
    h('h2', {}, 'Backup'),
    h('p', {}, 'Download the whole catalogue (resources, sources, links between resources, topic pins and digests) as one file. Visitors\u2019 encrypted saves are not included. Cloudflare also keeps 7 days of point-in-time history for the database.'),
    btn, msg);
}

async function activityTab() {
  fill(root, h('h1', {}, 'Activity'), h('p', { class: 'status', role: 'status' }, 'Loading'));
  try {
    const [runs, audit] = await Promise.all([api.get('/api/editor/ingestion'), api.get('/api/editor/audit?limit=100')]);
    fill(root, h('h1', {}, 'Activity'),
      backupBox(),
      h('h2', {}, 'Recent ingestion runs'),
      runs.runs.length ? h('table', { class: 'ed-table' }, h('thead', {}, h('tr', {}, ['Started', 'Source', 'Result', 'New', 'Flagged', 'Known', 'Filtered'].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', {}, runs.runs.map((r) => h('tr', {}, h('td', { class: 'num' }, when(r.started_at)), h('td', {}, r.source ?? ''), h('td', {}, r.status, r.error ? h('div', { class: 'ed-flag' }, r.error) : null), h('td', {}, String(r.new_count)), h('td', {}, String(r.flagged_count)), h('td', {}, String(r.duplicate_count)), h('td', {}, String(r.filtered_count)))))) : h('p', { class: 'empty' }, 'No runs yet.'),
      h('h2', {}, 'Editor actions'),
      audit.entries.length ? h('table', { class: 'ed-table' }, h('thead', {}, h('tr', {}, ['When', 'Who', 'Action', 'Item'].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', {}, audit.entries.map((e) => h('tr', {}, h('td', { class: 'num' }, when(e.at)), h('td', {}, e.actor), h('td', {}, `${e.action} ${e.entity}`), h('td', { class: 'url' }, e.entity_id ?? ''))))) : h('p', { class: 'empty' }, 'Nothing yet.'));
  } catch (e) { fill(root, h('h1', {}, 'Activity'), h('p', { class: 'error' }, e.message)); }
}

boot();
