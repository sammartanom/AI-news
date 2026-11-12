// Preferences and the saved library. Browser storage is optional: everything works (without
// persistence) if it is unavailable.
const PREFIX = 'signal:';

export const storage = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* ignore */ }
  },
  remove(key) {
    try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
  }
};

export const AUDIENCES = ['Everyone', 'Teachers', 'Administrators', 'Families', 'Students'];

// List or card grid, remembered per page. The grid page opens as cards; other lists as a list.
const LAYOUT_DEFAULTS = { grid: 'grid' };
const layoutKey = (page) => `layout:${page}`;
const storedLayout = (page) => {
  const v = storage.get(layoutKey(page), null);
  return v === 'grid' || v === 'list' ? v : LAYOUT_DEFAULTS[page] ?? 'list';
};

export const state = {
  config: null,
  audience: AUDIENCES.includes(storage.get('audience')) ? storage.get('audience') : 'Everyone',
  page: 'home',
  layout: 'list',
  theme: ['light', 'dark'].includes(localStorage_safe('theme')) ? localStorage_safe('theme') : 'auto'
};

function localStorage_safe(k) {
  try { return JSON.parse(localStorage.getItem(PREFIX + k)); } catch { return null; }
}

export function setAudience(a) {
  state.audience = AUDIENCES.includes(a) ? a : 'Everyone';
  storage.set('audience', state.audience);
}

export function setTheme(t) {
  state.theme = t;
  if (t === 'auto') { delete document.documentElement.dataset.theme; storage.remove('theme'); }
  else { document.documentElement.dataset.theme = t; storage.set('theme', t); }
}

// Phones always show cards, with no switch; the remembered choice applies on wider screens.
const phone = matchMedia('(max-width: 719px)');
export function applyLayout(page = state.page) {
  state.page = page;
  state.layout = phone.matches ? 'grid' : storedLayout(page);
  document.documentElement.dataset.layout = state.layout;
}
phone.addEventListener('change', () => applyLayout());
export function setLayout(layout) {
  state.layout = layout === 'grid' ? 'grid' : 'list';
  document.documentElement.dataset.layout = state.layout;
  storage.set(layoutKey(state.page), state.layout);
}
