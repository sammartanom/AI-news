export const STOPWORDS = new Set((
  'a an and are as at be but by can do does for from has have how i if in into is it its me my of on or our should so ' +
  'than that the their them then there these they this to us was we were what when where which who why will with you your ' +
  'about give show tell find need want know understand also any some more most very just'
).split(' '));

// Words that appear in nearly every Signal record. Dropping them keeps keyword matching specific.
export const DOMAIN_STOPWORDS = new Set(['ai', 'artificial', 'intelligence', 'education', 'educational', 'school', 'schools']);

export function words(s) {
  return String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? [];
}

export function queryTerms(q, { dropDomain = true } = {}) {
  const all = words(q).map((w) => w.replace(/'s$/, ''));
  const kept = all.filter((w) => !STOPWORDS.has(w) && (w.length > 1 || /\d/.test(w)));
  const specific = dropDomain ? kept.filter((w) => !DOMAIN_STOPWORDS.has(w)) : kept;
  // If dropping domain words leaves nothing (e.g. "AI in education"), keep them.
  return specific.length ? specific : kept;
}

const ARTICLES = new Set(['a', 'an', 'the']);

// Normalized title used for duplicate detection.
export function titleKey(title) {
  const w = words(title).filter((x) => x.length > 0);
  while (w.length && ARTICLES.has(w[0])) w.shift();
  return w.join(' ');
}

export function titleTokens(title) {
  return new Set(words(title).filter((w) => !STOPWORDS.has(w) && w.length > 1));
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…' };

// Reduces untrusted markup to plain text. Nothing here is ever rendered as HTML.
export function stripHtml(input, max = 2000) {
  let s = String(input ?? '');
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  s = s.replace(/<(script|style)[\s\S]*?<\/\1\s*>/gi, ' ');
  s = s.replace(/<[^>]*>/g, ' ');
  s = s.replace(/&amp;(#x[0-9a-f]+|#\d+|[a-z]+);/gi, '&$1;'); // feeds that escape entities twice
  s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 31 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
  s = s.replace(/<[^>]*>/g, ' '); // entities may have decoded into tags
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[\u200b-\u200d\u2060\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

export const clip = (s, n) => (s == null ? s : String(s).slice(0, n));

// Accepts RFC 822 and ISO 8601. Returns YYYY-MM-DD, or null when absent, unparseable or implausible.
export function parseDateLoose(value, now = Date.now()) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  let y, m, d;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/);
  if (iso) {
    [, y, m, d] = iso.map(Number);
  } else {
    const t = Date.parse(raw);
    if (!Number.isFinite(t)) return null;
    const dt = new Date(t);
    y = dt.getUTCFullYear();
    m = dt.getUTCMonth() + 1;
    d = dt.getUTCDate();
  }
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  if (y < 1990) return null;
  if (check.getTime() > now + 36 * 3600 * 1000) return null; // future dates are not publication dates
  return check.toISOString().slice(0, 10);
}

export function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const v = JSON.parse(value ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function parseJsonObject(value) {
  try {
    const v = JSON.parse(value ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

// FTS5 and LIKE helper: escapes a user term so it is always a quoted literal.
export const ftsQuote = (term) => '"' + String(term).replace(/"/g, '""') + '"';

export async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
