// Small DOM helpers. Elements are built with the DOM API, never from HTML strings, so text from
// the database is always inserted as text.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

// Like replaceChildren, but accepts strings, nulls and nested arrays the way h() does.
export function fill(el, ...children) {
  const nodes = [];
  const walk = (c) => {
    if (Array.isArray(c)) c.forEach(walk);
    else if (c !== null && c !== undefined && c !== false) nodes.push(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(walk);
  el.replaceChildren(...nodes);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const clear = (el) => { el.replaceChildren(); return el; };

// Only https links are ever rendered as hrefs.
export function safeHref(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

let announceTimer;
export function announce(message) {
  const live = document.getElementById('live');
  if (!live) return;
  clearTimeout(announceTimer);
  live.textContent = '';
  announceTimer = setTimeout(() => { live.textContent = message; }, 50);
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
