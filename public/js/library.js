// The saved library: resources and private notes, kept in this browser and, once the visitor turns
// it on, synced as an encrypted blob (see vault.js). Every change carries a timestamp, so two
// devices that changed things offline merge cleanly: the later change to each item wins.
import { storage } from './state.js';
import { keysFrom, seal, unseal, blob, b64u, randomSecret, createPasskey, usePasskey } from './vault.js';

const MAX_ITEMS = 500;
const NOTE_MAX = 3000;
const emit = (name) => document.dispatchEvent(new CustomEvent(name));
export const changed = () => emit('signal:saved');

// ---------- Local library ----------
// { items: { id: savedAt }, gone: { id: removedAt }, notes: { id: { t: text, at } } }, times in ms.
function loadLocal() {
  const lib = storage.get('library', null);
  if (lib && typeof lib === 'object' && lib.items) return clean(lib);
  // Earlier versions kept a plain list of ids and a map of notes.
  const now = Date.now();
  const legacy = storage.get('saved', []);
  const notes = storage.get('notes', {});
  const out = { items: {}, gone: {}, notes: {} };
  if (Array.isArray(legacy)) legacy.filter((x) => typeof x === 'string').slice(0, MAX_ITEMS).forEach((id, i) => { out.items[id] = now - (legacy.length - i); });
  if (notes && typeof notes === 'object') for (const [id, t] of Object.entries(notes)) if (typeof t === 'string' && t) out.notes[id] = { t: t.slice(0, NOTE_MAX), at: now };
  return out;
}

function clean(lib) {
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const out = { items: {}, gone: {}, notes: {} };
  for (const [id, at] of Object.entries(lib.items ?? {})) if (typeof id === 'string' && id.length <= 64) out.items[id] = num(at);
  for (const [id, at] of Object.entries(lib.gone ?? {})) if (typeof id === 'string' && id.length <= 64) out.gone[id] = num(at);
  for (const [id, n] of Object.entries(lib.notes ?? {})) if (n && typeof n.t === 'string') out.notes[id] = { t: n.t.slice(0, NOTE_MAX), at: num(n.at) };
  return out;
}

let lib = loadLocal();
const persist = () => { storage.set('library', lib); storage.remove('saved'); storage.remove('notes'); };
persist();

export const isSaved = (id) => id in lib.items;
export const savedCount = () => Object.keys(lib.items).length;
export const savedIds = () => Object.entries(lib.items).sort((a, b) => b[1] - a[1]).map(([id]) => id);
export const noteFor = (id) => lib.notes[id]?.t ?? '';
export const saveLabel = (saved) => (saved ? 'Saved' : 'Save');

// Returns the new saved state.
export async function toggleSave(id) {
  const now = Date.now();
  if (isSaved(id)) { delete lib.items[id]; lib.gone[id] = now; }
  else {
    if (savedCount() >= MAX_ITEMS) throw new Error(`You can save up to ${MAX_ITEMS} resources.`);
    lib.items[id] = now; delete lib.gone[id];
  }
  persist();
  changed();
  scheduleSync();
  return isSaved(id);
}

export function setNote(id, text) {
  lib.notes[id] = { t: String(text).slice(0, NOTE_MAX), at: Date.now() };
  persist();
  scheduleSync();
}

// Union by latest change. Removal tombstones are kept for a year so a stale device cannot revive
// something deleted elsewhere.
export function merge(a, b) {
  if (!b) return clean(a);
  a = clean(a); b = clean(b);
  const out = { items: {}, gone: {}, notes: {} };
  const ids = new Set([...Object.keys(a.items), ...Object.keys(a.gone), ...Object.keys(b.items), ...Object.keys(b.gone)]);
  const cutoff = Date.now() - 365 * 86400_000;
  for (const id of ids) {
    const saved = Math.max(a.items[id] ?? -1, b.items[id] ?? -1);
    const gone = Math.max(a.gone[id] ?? -1, b.gone[id] ?? -1);
    if (saved > gone) out.items[id] = saved;
    else if (gone > cutoff) out.gone[id] = gone;
  }
  for (const id of new Set([...Object.keys(a.notes), ...Object.keys(b.notes)])) {
    const x = a.notes[id], y = b.notes[id];
    const n = !x ? y : !y ? x : y.at > x.at ? y : x;
    if (n.t || n.at > cutoff) out.notes[id] = n;
  }
  const keep = Object.entries(out.items).sort((p, q) => q[1] - p[1]).slice(0, MAX_ITEMS);
  out.items = Object.fromEntries(keep);
  return out;
}

const canon = (l) => JSON.stringify([l.items, l.gone, l.notes].map((o) => Object.keys(o).sort().map((k) => [k, o[k]])));

// ---------- Sync ----------
// storage 'sync': { s: library secret (base64url), via: 'passkey' | 'link', wrap?: { id, guard } }
let conf = storage.get('sync', null);
if (conf && typeof conf.s !== 'string') conf = null;
export const sync = { status: conf ? 'idle' : 'off', at: null };
const setStatus = (status) => { sync.status = status; if (status === 'synced') sync.at = Date.now(); emit('signal:sync'); };

export const syncInfo = () => ({ on: Boolean(conf), via: conf?.via ?? null, status: sync.status, at: sync.at });
export const privateLink = () => (conf ? `${location.origin}/saved#key=${conf.s}` : null);

let running = null;
let again = false;
let wiped = false;
let timer = 0;
function scheduleSync() {
  if (!conf) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, 700);
}

export function syncNow() {
  if (!conf) return Promise.resolve();
  if (running) { again = true; return running; }
  running = (async () => {
    setStatus('syncing');
    const keys = await keysFrom(b64u.decode(conf.s));
    for (let attempt = 0; attempt < 4; attempt++) {
      let remote = null;
      let version = 0;
      try {
        const r = await blob.get(keys);
        remote = await unseal(keys, r.data);
        version = r.version;
      } catch (e) {
        if (e.status !== 404) throw e;
        // It existed before and is gone now: it was deleted everywhere from another device.
        if (conf.seen) { wiped = true; return; }
      }
      const merged = merge(lib, remote);
      if (canon(merged) !== canon(lib)) { lib = merged; persist(); changed(); }
      if (remote && canon(merged) === canon(clean(remote))) break;
      try { await blob.put(keys, await seal(keys, merged), version); break; } catch (e) { if (e.status !== 409) throw e; }
    }
    if (!conf.seen) { conf.seen = true; storage.set('sync', conf); }
    setStatus('synced');
  })().then(() => { if (wiped) { wiped = false; return forget(); } }).catch((e) => { setStatus(e?.status === 0 ? 'offline' : 'error'); })
    .finally(() => { running = null; if (again) { again = false; syncNow(); } });
  return running;
}

async function connect(secret, via, wrap = null) {
  conf = { s: b64u.encode(secret), via, ...(wrap ? { wrap } : {}) };
  storage.set('sync', conf);
  await syncNow();
  if (sync.status === 'error') throw new Error('Your saves could not be opened. Try again.');
}

// Turn on sync with a private link: a new secret, or the one already in use.
export async function useLink() {
  await connect(conf ? b64u.decode(conf.s) : randomSecret(), conf?.via === 'passkey' ? 'passkey' : 'link', conf?.wrap);
}

// Opens the saves behind a private link on this device, merging what is already here.
export async function openLink(secretText) {
  let secret;
  try { secret = b64u.decode(secretText); } catch { secret = null; }
  if (!secret || secret.length !== 32) throw new Error('This link is incomplete. Copy the whole link and try again.');
  await connect(secret, 'link');
}

// A new passkey protects the current secret (or a new one).
export async function addPasskey() {
  const prf = await createPasskey();
  const secret = conf ? b64u.decode(conf.s) : randomSecret();
  const wrap = await keysFrom(prf, 'passkey');
  const sealed = await seal(wrap, { s: b64u.encode(secret) });
  try { await blob.put(wrap, sealed, 0); }
  catch (e) { if (e.status === 409) await blob.put(wrap, sealed, e.data.version); else throw e; }
  await connect(secret, 'passkey', { id: wrap.id, guard: wrap.guard });
}

// Uses a passkey made on any device to open the saves it protects.
export async function openWithPasskey() {
  const prf = await usePasskey();
  const wrap = await keysFrom(prf, 'passkey');
  let inner;
  try { inner = await unseal(wrap, (await blob.get(wrap)).data); }
  catch (e) { throw new Error(e.status === 404 ? 'No saves are stored for this passkey yet. Set it up first.' : 'Your saves could not be opened. Try again.'); }
  await connect(b64u.decode(inner.s), 'passkey', { id: wrap.id, guard: wrap.guard });
}

// Stops syncing on this device and clears its copy. With everywhere, also deletes the encrypted
// copy (and this passkey's key) from the server, which removes the saves from every device.
export async function forget({ everywhere = false } = {}) {
  if (everywhere && conf) {
    const keys = await keysFrom(b64u.decode(conf.s));
    await blob.del(keys).catch((e) => { if (e.status !== 404) throw e; });
    if (conf.wrap) await blob.del({ id: conf.wrap.id, guard: conf.wrap.guard }).catch(() => {});
  }
  conf = null;
  storage.remove('sync');
  lib = { items: {}, gone: {}, notes: {} };
  persist();
  setStatus('off');
  changed();
}

export function startSync() {
  if (!conf) return;
  syncNow();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  addEventListener('online', () => syncNow());
}
