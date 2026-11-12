import { h, safeHref, debounce, fill } from './dom.js';
import { api } from './api.js';
import { formatPublished, formatAdded, kindFor } from './format.js';
import { icon } from './icons.js';
import { isSaved, toggleSave, saveLabel, noteFor, setNote, syncInfo } from './library.js';
import { slideClosed, keepOpen } from './slide.js';

const dlg = () => document.getElementById('dialog');
const body = () => document.getElementById('detail');
let opener = null;
let currentId = null;

function setParam(id, push) {
  const u = new URL(location.href);
  if (id) u.searchParams.set('r', id); else u.searchParams.delete('r');
  history[push ? 'pushState' : 'replaceState'](history.state, '', u);
}

export async function openResource(id, { fromUrl = false } = {}) {
  const d = dlg();
  if (!d) return;
  keepOpen(d);
  if (!d.open) opener = document.activeElement; // keep the first opener when moving between related resources
  currentId = id;
  fill(body(), h('p', { class: 'muted' }, 'Loading'));
  if (!d.open) d.showModal();
  if (!fromUrl) setParam(id, true);
  try {
    const { resource } = await api.get(`/api/resources/${encodeURIComponent(id)}`);
    if (currentId !== id) return;
    render(resource);
  } catch (e) {
    fill(body(), 
      h('h2', { tabindex: '-1', id: 'dlg-title' }, e.status === 404 ? 'Resource not found' : 'Could not load this resource'),
      h('p', {}, e.status === 404 ? 'It may have been removed.' : e.message)
    );
  }
}

export function closeResource() {
  const d = dlg();
  if (d?.open) d.close();
}

export function initDialog() {
  const d = dlg();
  slideClosed(d);
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); // backdrop
  d.addEventListener('close', () => {
    currentId = null;
    if (new URL(location.href).searchParams.has('r')) setParam(null, false);
    if (opener && document.contains(opener)) opener.focus();
    opener = null;
  });
  window.addEventListener('popstate', () => {
    const id = new URL(location.href).searchParams.get('r');
    if (!id && d.open) d.close();
    else if (id && !d.open) openResource(id, { fromUrl: true });
  });
  const id = new URL(location.href).searchParams.get('r');
  if (id) openResource(id, { fromUrl: true });
}

// The resource view, kept to what helps someone decide whether to open it: what it is and who
// published it, a short brief, the actions, why it is here, related reading and a private note.
function render(r) {
  const published = formatPublished(r.published_at);
  const href = safeHref(r.url);
  const kind = kindFor(r);
  const root = body();
  const forWhom = r.audiences.filter((a) => a !== 'Everyone');
  const meta = [
    published ? `Published ${published}` : `Added ${formatAdded(r.added_at)}`,
    r.reading_minutes ? `${r.reading_minutes} min read` : null,
    forWhom.length ? `For ${forWhom.join(', ').toLowerCase()}` : null
  ].filter(Boolean).join(' · ');
  fill(root,
    h('p', { class: 'kicker' }, icon(kind?.icon ?? 'article', 16), h('span', {}, kind?.name ?? r.format ?? 'Article'), h('span', { class: 'kicker-sep', 'aria-hidden': 'true' }, '·'), h('span', { class: 'kicker-pub' }, r.publisher),
      r.pick ? h('span', { class: 'kicker-pick', title: 'Chosen or reviewed by an editor' }, icon('award', 15), 'Editor’s pick') : null),
    h('h2', { id: 'dlg-title', tabindex: '-1' }, r.title),
    h('p', { class: 'meta num' }, meta),
    lawStatus(r),
    briefCard(r),
    actions(r, href),
    r.link_status === 'broken' ? h('p', { class: 'flag fine', role: 'status' }, 'This link did not work when it was last checked.') : null,
    r.why || r.best_for ? h('section', { class: 'sec why' }, h('h3', {}, 'Why it’s here'),
      r.why ? h('p', {}, r.why) : null,
      r.best_for ? h('p', { class: 'best' }, h('span', {}, 'Best for '), r.best_for) : null) : null,
    r.pick ? null : h('p', { class: 'fine unreviewed', 'data-unreviewed': '' }, 'Found automatically. Not yet reviewed by an editor.'),
    topicLinks(r),
    h('div', { class: 'rel-slot', 'data-id': r.id }),
    noteBox(r)
  );
  lazyRelated(r);
  root.querySelector('#dlg-title').focus();
}

// Laws and trackers change. Say when the status was last confirmed, and flag it once that is
// more than 90 days ago, so nobody relies on a stale status.
const STALE_DAYS = 90;
function lawStatus(r) {
  if (kindFor(r)?.slug !== 'laws') return null;
  const checked = r.status_checked_at ? formatAdded(r.status_checked_at) : null;
  if (!checked) return h('p', { class: 'law-status fine' }, icon('info', 15), h('span', {}, 'Laws change. Check the official source for the current status.'));
  const stale = Date.now() - Date.parse(r.status_checked_at) > STALE_DAYS * 86400000;
  return h('p', { class: `law-status fine ${stale ? 'stale' : 'checked'}` }, icon(stale ? 'alert' : 'check', 15),
    h('span', {}, stale ? `Status last checked ${checked}. It may have changed since; check the official source.` : `Status checked ${checked}.`));
}

// Topics link to Browse, filtered to that topic.
function topicLinks(r) {
  if (!r.topics?.length) return null;
  return h('nav', { class: 'topic-links', 'aria-label': 'Topics' }, icon('tag', 15),
    r.topics.map((slug, i) => h('a', { href: `/grid?topic=${encodeURIComponent(slug)}`, 'data-link': '', onclick: () => closeResource() }, r.topic_labels?.[i] ?? slug)));
}

// The brief: the AI-written description when there is one (asked for if it has not been written
// yet), otherwise an editor-approved summary or the publisher's own description, shortened.
function briefCard(r) {
  const text = h('p', { class: 'brief-text' });
  const note = h('p', { class: 'brief-note' });
  const chip = h('span', { class: 'ai-chip', title: 'Written by an AI model' }, 'AI');
  const label = h('span', {}, 'In brief');
  const card = h('section', { class: 'brief', 'aria-labelledby': 'brief-h' }, h('h3', { id: 'brief-h' }, label, chip), text, note);
  const show = (brief, basis) => {
    card.classList.remove('loading');
    card.removeAttribute('aria-busy');
    text.textContent = brief;
    note.textContent = basis === 'page' ? 'Written by AI from the publisher’s page. Check the source.' : 'Written by AI from the listing, not the full page. Check the source.';
  };
  const fallback = () => {
    const words = r.summary || r.description;
    if (!words) { card.remove(); return; }
    card.classList.remove('loading');
    card.removeAttribute('aria-busy');
    chip.remove();
    label.textContent = r.summary ? 'Summary' : 'From the publisher';
    text.textContent = words.length > 280 ? `${words.slice(0, 280).replace(/\s+\S*$/, '')}…` : words;
    note.remove();
  };
  if (r.brief) { show(r.brief, r.brief_basis); return card; }
  card.classList.add('loading');
  card.setAttribute('aria-busy', 'true');
  fill(text, h('span', { class: 'skel' }), h('span', { class: 'skel' }), h('span', { class: 'skel short' }));
  note.textContent = 'Writing a short description';
  api.get(`/api/resources/${encodeURIComponent(r.id)}/brief`, { timeout: 25000 }).then(({ brief, basis }) => {
    if (currentId !== r.id) return;
    if (brief) show(brief, basis); else fallback();
  }).catch(() => { if (currentId === r.id) fallback(); });
  return card;
}

function actions(r, href) {
  const saveBtn = h('button', { class: 'btn', type: 'button', 'aria-pressed': String(isSaved(r.id)) });
  const paintSave = () => fill(saveBtn, icon('bookmark', 18), h('span', {}, saveLabel(isSaved(r.id))));
  paintSave();
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try { await toggleSave(r.id); } catch { /* ignore: state is unchanged */ }
    saveBtn.disabled = false;
    saveBtn.setAttribute('aria-pressed', String(isSaved(r.id)));
    paintSave();
  });
  const copyBtn = h('button', { class: 'btn btn-quiet btn-icon', type: 'button', 'aria-label': 'Copy link to this resource', title: 'Copy link' }, icon('link', 18));
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/?r=${encodeURIComponent(r.id)}`);
      copyBtn.setAttribute('aria-label', 'Link copied');
      fill(copyBtn, icon('check', 18));
      setTimeout(() => { copyBtn.setAttribute('aria-label', 'Copy link to this resource'); fill(copyBtn, icon('link', 18)); }, 1600);
    } catch { /* clipboard refused: nothing to do */ }
  });
  return h('div', { class: 'actions' },
    href ? h('a', { class: 'btn btn-primary', href, target: '_blank', rel: 'noopener noreferrer' }, h('span', {}, kindFor(r)?.action ?? 'View original'), icon('external', 18)) : null,
    saveBtn,
    copyBtn
  );
}

function noteBox(r) {
  const ta = h('textarea', { id: 'note', rows: '2', maxlength: '3000', placeholder: 'Add a private note', 'aria-label': 'Your note', 'aria-describedby': 'note-hint' });
  const status = h('span', { role: 'status' });
  const hint = h('p', { class: 'fine', id: 'note-hint' }, `${syncInfo().on ? 'Encrypted and synced.' : 'Kept on this device.'} No student information. `, status);
  const save = debounce(() => {
    setNote(r.id, ta.value);
    status.textContent = 'Note saved.';
  }, 600);
  ta.addEventListener('input', () => { status.textContent = ''; save(); });
  ta.value = noteFor(r.id);
  return h('div', { class: 'note-box' }, ta, hint);
}

// "Read with this" and related resources load after the dialog is shown.
function lazyRelated(r) {
  const slot = body().querySelector('.rel-slot');
  const load = async () => {
    try {
      const { curated, similar } = await api.get(`/api/resources/${encodeURIComponent(r.id)}/related?limit=5`);
      if (currentId !== r.id) return;
      fill(slot, 
        // Editor-paired reading first, then similar resources, as one row of pills.
        curated.length || similar.length ? [h('h3', {}, 'Related'), h('ul', { class: 'pills' },
          curated.map((c) => relItem(c.label, c.resource, c.note)), similar.map((s) => relItem(s.label, s.resource)))] : null
      );
    } catch { /* related resources are optional */ }
  };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { io.disconnect(); load(); } }, { root: dlg() });
    io.observe(slot);
  } else load();
}

// A related resource as a pill: the title, with how it relates, the publisher and any editor's
// note in its tooltip.
function relItem(label, resource, note) {
  const about = [`${label} · ${resource.publisher}`, note].filter(Boolean).join('. ');
  const b = h('button', { type: 'button', class: 'pill', title: `${resource.title}\n${about}` }, resource.title);
  b.addEventListener('click', () => openResource(resource.id, { fromUrl: false }));
  return h('li', { class: 'rel' }, b);
}
