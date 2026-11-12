import { h, announce, fill } from '../dom.js';
import { api } from '../api.js';
import { plural, formatPublished, formatAdded } from '../format.js';
import { resourceRow } from '../row.js';
import { errorBlock, pageHeader } from './common.js';
import { icon } from '../icons.js';
import { qrSvg } from '../qr.js';
import { passkeySupport } from '../vault.js';
import * as L from '../library.js';

export async function savedView(root, ctx) {
  const vault = h('section', { class: 'vault', 'aria-labelledby': 'vault-title' });
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const body = h('div', {});
  fill(root, h('div', { class: 'page' }, pageHeader({ title: 'Saved' }), vault, status, body));
  ctx.title('Saved');

  // A private link arrives as /saved#key=...; take it out of the address bar straight away.
  const fromLink = new URLSearchParams(location.hash.slice(1)).get('key');
  if (fromLink) history.replaceState(history.state, '', location.pathname + location.search);
  const support = await passkeySupport();
  let showDevice = false;
  let pending = fromLink && fromLink !== L.privateLink()?.split('#key=')[1] ? fromLink : null;

  const run = (btn, fn, done) => async () => {
    btn.disabled = true;
    try { await fn(); if (done) announce(done); } catch (e) { flash(e.message, true); }
    btn.disabled = false;
    paintVault();
  };
  let message = null;
  const flash = (text, bad = false) => { message = { text, bad }; paintVault(); announce(text); };

  function paintVault() {
    const info = L.syncInfo();
    const note = message ? h('p', { class: `vault-msg${message.bad ? ' bad' : ''}`, role: message.bad ? 'alert' : 'status' }, message.text) : null;
    message = null;
    if (pending) return fill(vault, joinCard(note));
    vault.dataset.state = info.on ? 'on' : 'off';
    if (!info.on) return fill(vault, offCard(note));
    fill(vault, onCard(info, note));
  }

  function joinCard(note) {
    const open = h('button', { class: 'btn btn-primary', type: 'button' }, icon('key', 18), 'Open saves here');
    open.addEventListener('click', run(open, async () => { await L.openLink(pending); pending = null; }, 'Your saves are open on this device.'));
    vault.dataset.state = 'join';
    return [
      h('div', { class: 'vault-glyph' }, icon('lock', 22)),
      h('div', { class: 'vault-main' },
        h('h2', { id: 'vault-title' }, 'Open saves from a private link?'),
        h('p', {}, L.syncInfo().on ? 'This device already syncs a set of saves. Opening the link switches to the linked saves, and adds what is saved here to them.' : 'What is already saved here will be added to them.'),
        note,
        h('div', { class: 'vault-actions' }, open, h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => { pending = null; paintVault(); } }, 'Not now')))
    ];
  }

  function offCard(note) {
    const actions = h('div', { class: 'vault-actions' });
    if (support !== 'no') {
      const pk = h('button', { class: 'btn btn-primary', type: 'button' }, icon('fingerprint', 18), 'Protect with a passkey');
      pk.addEventListener('click', run(pk, L.addPasskey, 'Passkey added. Your saves are encrypted and synced.'));
      actions.append(pk);
    }
    const link = h('button', { class: 'btn', type: 'button' }, icon('link', 18), support === 'no' ? 'Sync with a private link' : 'Use a private link');
    link.addEventListener('click', run(link, async () => { await L.useLink(); showDevice = true; }, 'Private link ready.'));
    actions.append(link);
    const existing = support !== 'no' ? h('button', { class: 'link', type: 'button' }, 'Already set up on another device? Open with your passkey') : null;
    existing?.addEventListener('click', run(existing, L.openWithPasskey, 'Your saves are open on this device.'));
    return [
      h('div', { class: 'vault-glyph' }, icon('lock', 22)),
      h('div', { class: 'vault-main' },
        h('h2', { id: 'vault-title' }, 'Keep your saves on every device'),
        h('p', {}, 'No account, no email. Your saves and notes are encrypted in this browser before they are stored, and only your passkey or private link can open them.'),
        note, actions, existing ? h('p', { class: 'vault-alt' }, existing) : null)
    ];
  }

  function onCard(info, note) {
    const label = { syncing: 'Syncing', synced: 'Synced', offline: 'Offline, will sync when you are back', error: 'Could not sync', idle: 'Ready' }[info.status] ?? 'Ready';
    const toggle = h('button', { class: 'btn', type: 'button', 'aria-expanded': String(showDevice), 'aria-controls': 'vault-device' }, icon('qr', 18), 'Add a device');
    toggle.addEventListener('click', () => { showDevice = !showDevice; paintVault(); });
    const addPk = info.via === 'link' && support !== 'no' ? h('button', { class: 'btn', type: 'button' }, icon('fingerprint', 18), 'Add a passkey') : null;
    addPk?.addEventListener('click', run(addPk, L.addPasskey, 'Passkey added.'));
    const more = h('details', { class: 'vault-more' }, h('summary', {}, 'Manage'),
      h('div', { class: 'vault-manage' },
        h('p', { class: 'fine' }, 'Remove from this device clears the saves here; they stay on your other devices. Delete everywhere removes the encrypted copy for good, and your other devices clear theirs the next time they open.'),
        h('div', { class: 'vault-actions' },
          h('button', { class: 'btn', type: 'button', onclick: async () => {
            if (info.via === 'link' && !confirm('Keep your private link somewhere safe first: it is the only way to open these saves again. Remove them from this device?')) return;
            await L.forget(); flash('Removed from this device.');
          } }, 'Remove from this device'),
          h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => {
            if (!confirm('Delete your saves and notes from every device? This cannot be undone.')) return;
            try { await L.forget({ everywhere: true }); flash('Deleted everywhere.'); } catch (e) { flash(e.message, true); }
          } }, 'Delete everywhere'))));
    return [
      h('div', { class: 'vault-glyph on' }, icon(info.via === 'passkey' ? 'fingerprint' : 'lock', 22)),
      h('div', { class: 'vault-main' },
        h('h2', { id: 'vault-title' }, info.via === 'passkey' ? 'Protected by your passkey' : 'Synced with a private link'),
        h('p', { class: 'vault-status', 'data-status': info.status }, h('span', { class: 'dot', 'aria-hidden': 'true' }), `Encrypted · ${label}`),
        note,
        h('div', { class: 'vault-actions' }, toggle, addPk),
        showDevice ? deviceCard(info) : null,
        more)
    ];
  }

  function deviceCard(info) {
    const url = L.privateLink();
    const copy = h('button', { class: 'btn', type: 'button' }, icon('copy', 18), 'Copy link');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); copy.replaceChildren(icon('check', 18), 'Copied'); announce('Link copied'); }
      catch { flash('Copy did not work here. Scan the code instead.', true); }
      setTimeout(() => copy.isConnected && copy.replaceChildren(icon('copy', 18), 'Copy link'), 2000);
    });
    const share = navigator.share ? h('button', { class: 'btn', type: 'button', onclick: () => navigator.share({ title: 'My saved resources', url }).catch(() => {}) }, icon('share', 18), 'Share') : null;
    return h('div', { class: 'vault-device', id: 'vault-device' },
      h('div', { class: 'qr-frame' }, qrSvg(url, { label: 'QR code with your private link' })),
      h('div', {},
        h('h3', {}, 'Scan with your phone'),
        h('p', {}, info.via === 'passkey'
          ? 'Or, on a device signed in to the same Apple, Google or Microsoft account, choose “Open with your passkey” on the Saved page.'
          : 'Point the camera at the code, or send yourself the link.'),
        h('div', { class: 'vault-actions' }, copy, share),
        h('p', { class: 'fine' }, 'Anyone with this link can see and change your saves. Treat it like a password.')));
  }

  async function load() {
    const ids = L.savedIds();
    if (!ids.length) { status.textContent = ''; fill(body, h('div', { class: 'empty saved-empty' }, icon('bookmark', 28), h('div', {}, h('p', {}, 'Nothing saved yet. Tap the bookmark on any resource to keep it here.'),
      h('p', { class: 'saved-next' }, h('a', { class: 'link', href: '/grid', 'data-link': '' }, 'Browse editors’ picks'), h('span', { 'aria-hidden': 'true' }, ' · '), h('a', { class: 'link', href: '/?path=teacher-start', 'data-link': '' }, 'Start a reading path'))))); return; }
    status.textContent = 'Loading';
    try {
      const found = [];
      for (let i = 0; i < ids.length; i += 50) found.push(...(await api.get(`/api/resources/batch?ids=${ids.slice(i, i + 50).map(encodeURIComponent).join(',')}`, { signal: ctx.signal })).resources);
      const order = new Map(ids.map((id, i) => [id, i]));
      found.sort((a, b) => order.get(a.id) - order.get(b.id));
      status.textContent = plural(found.length, 'saved resource');
      announce(status.textContent);
      fill(body,
        h('ol', { class: 'rows' }, found.map((r) => {
          const li = resourceRow(r);
          const note = L.noteFor(r.id);
          if (note) li.firstChild.append(h('p', { class: 'row-note' }, note.slice(0, 200) + (note.length > 200 ? '…' : '')));
          return li;
        })),
        shareBox(found),
        h('div', { class: 'inline-links export' }, h('button', { type: 'button', id: 'export-md', onclick: () => download('saved-resources.md', markdown('Saved', found.map((r) => ({ resource: r, note: L.noteFor(r.id) || null })))) }, 'Export as Markdown'))
      );
    } catch (e) {
      if (ctx.signal.aborted) return;
      status.textContent = '';
      fill(body, errorBlock(e.message, load));
    }
  }

  // Re-render the list when saves change, here or on another device, but not on every keystroke.
  let last = JSON.stringify(L.savedIds());
  const onChange = () => { const now = JSON.stringify(L.savedIds()); if (now !== last) { last = now; load(); } };
  const onSync = () => paintVault();
  document.addEventListener('signal:saved', onChange);
  document.addEventListener('signal:sync', onSync);
  ctx.onLeave(() => { document.removeEventListener('signal:saved', onChange); document.removeEventListener('signal:sync', onSync); });
  paintVault();
  load();
}

// ---------- Shared lists ----------
// A shared list travels inside its link (after the #), so the server never sees or stores it:
// a name, the resource ids in order and, if the sender chooses, their notes.
const MAX_SHARED = 60;
const toB64 = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

export function shareLink(name, items, withNotes) {
  const data = { t: name.slice(0, 120), i: items.slice(0, MAX_SHARED).map((r) => r.id) };
  if (withNotes) {
    const n = {};
    for (const r of items.slice(0, MAX_SHARED)) { const note = L.noteFor(r.id); if (note) n[r.id] = note.slice(0, 400); }
    if (Object.keys(n).length) data.n = n;
  }
  return `${location.origin}/shared#d=${toB64(JSON.stringify(data))}`;
}

export function readShared(hash) {
  try {
    const d = JSON.parse(fromB64(new URLSearchParams(hash.slice(1)).get('d') ?? ''));
    const ids = (Array.isArray(d.i) ? d.i : []).filter((x) => typeof x === 'string' && x.length <= 64).slice(0, MAX_SHARED);
    if (!ids.length) return null;
    const notes = d.n && typeof d.n === 'object' ? Object.fromEntries(Object.entries(d.n).filter(([k, v]) => ids.includes(k) && typeof v === 'string').map(([k, v]) => [k, v.slice(0, 400)])) : {};
    return { name: typeof d.t === 'string' && d.t.trim() ? d.t.trim().slice(0, 120) : 'Shared resources', ids, notes };
  } catch { return null; }
}

function shareBox(found) {
  const name = h('input', { id: 'share-name', type: 'text', maxlength: '120', value: 'Resources for our team' });
  const notes = h('input', { id: 'share-notes', type: 'checkbox' });
  const out = h('p', { class: 'fine share-out', role: 'status' });
  const copy = h('button', { type: 'button', class: 'btn btn-primary' }, icon('link', 16), h('span', {}, 'Copy link'));
  copy.addEventListener('click', async () => {
    const url = shareLink(name.value.trim() || 'Shared resources', found, notes.checked);
    try { await navigator.clipboard.writeText(url); out.textContent = 'Link copied. Anyone with it can see this list.'; } catch { out.textContent = url; }
  });
  const send = navigator.share ? h('button', { type: 'button', class: 'btn' }, icon('share2', 16), h('span', {}, 'Share')) : null;
  send?.addEventListener('click', () => navigator.share({ title: name.value.trim() || 'Shared resources', url: shareLink(name.value.trim() || 'Shared resources', found, notes.checked) }).catch(() => {}));
  const box = h('details', { class: 'share-box' },
    h('summary', {}, icon('share2', 16), h('span', {}, 'Share this list')),
    h('div', { class: 'share-body' },
      h('label', { for: 'share-name' }, 'List name'), name,
      h('label', { class: 'check' }, notes, 'Include my notes'),
      h('div', { class: 'actions' }, copy, send),
      h('p', { class: 'fine' }, `The list is inside the link, so nothing is stored on this site.${found.length > MAX_SHARED ? ` The first ${MAX_SHARED} resources are shared.` : ''} Do not include student information in notes you share.`),
      out));
  return box;
}

// The page a shared link opens: the list, read only, with a way to save it.
export async function sharedView(root, ctx) {
  const shared = readShared(location.hash);
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const body = h('div', {});
  fill(root, h('div', { class: 'page' },
    h('header', {}, h('p', { class: 'kicker-line' }, 'Shared list'), h('h1', { id: 'page-title', tabindex: '-1', class: 'shared-title' }, shared?.name ?? 'Shared list')),
    status, body));
  ctx.title(shared?.name ?? 'Shared list');
  if (!shared) { fill(body, h('p', { class: 'empty' }, 'This link does not contain a list. Ask for the link again.')); return; }
  status.textContent = 'Loading';
  try {
    const found = (await api.get(`/api/resources/batch?ids=${shared.ids.map(encodeURIComponent).join(',')}`, { signal: ctx.signal })).resources;
    const order = new Map(shared.ids.map((id, i) => [id, i]));
    found.sort((a, b) => order.get(a.id) - order.get(b.id));
    status.textContent = `${plural(found.length, 'resource')}${found.length < shared.ids.length ? ` (${shared.ids.length - found.length} no longer available)` : ''}`;
    const saveAll = h('button', { type: 'button', class: 'btn btn-primary' }, icon('bookmark', 16), h('span', {}, 'Save all to my list'));
    const paint = () => {
      const left = found.filter((r) => !L.isSaved(r.id)).length;
      saveAll.disabled = !left;
      saveAll.lastChild.textContent = left ? `Save all to my list (${left})` : 'All saved';
    };
    saveAll.addEventListener('click', async () => {
      saveAll.disabled = true;
      for (const r of found) if (!L.isSaved(r.id)) { try { await L.toggleSave(r.id); } catch { /* keep going */ } }
      paint();
      announce('Saved to your list.');
    });
    paint();
    fill(body,
      h('div', { class: 'shared-actions' }, saveAll, h('a', { class: 'btn', href: '/saved', 'data-link': '' }, 'Open my saved list')),
      h('ol', { class: 'rows' }, found.map((r) => {
        const li = resourceRow(r);
        const note = shared.notes[r.id];
        if (note) li.firstChild.append(h('p', { class: 'row-note' }, note));
        return li;
      })),
      h('div', { class: 'inline-links export' }, h('button', { type: 'button', onclick: () => download('shared-resources.md', markdown(shared.name, found.map((r) => ({ resource: r, note: shared.notes[r.id] || null })))) }, 'Export as Markdown')));
    const onChange = () => paint();
    document.addEventListener('signal:saved', onChange);
    ctx.onLeave(() => document.removeEventListener('signal:saved', onChange));
  } catch (e) {
    if (ctx.signal.aborted) return;
    status.textContent = '';
    fill(body, errorBlock(e.message, () => sharedView(root, ctx)));
  }
}

function markdown(name, items) {
  const out = [`# ${name}`, ''];
  for (const { resource: r, note } of items) {
    out.push(`## ${r.title}`, `${r.publisher}${r.format ? ' · ' + r.format : ''}`, r.url, '');
    out.push(`Published: ${formatPublished(r.published_at) ?? 'Unknown'}${r.added_at ? ` · Added: ${formatAdded(r.added_at)}` : ''}`);
    if (r.why) out.push(`Why included: ${r.why}`);
    if (note) out.push('', `Note: ${note}`);
    out.push('');
  }
  return out.join('\n');
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
