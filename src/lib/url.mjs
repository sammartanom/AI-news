const TRACKING_EXACT = new Set([
  'fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid', 'igshid', 'ref_src', 'ref_url', '_hsenc', '_hsmi',
  'mkt_tok', 'oly_enc_id', 'oly_anon_id', 'vero_id', 'vero_conv', 's_cid', 'trk', 'trkcampaign', 'yclid', 'twclid', 'li_fat_id'
]);
const TRACKING_PREFIX = /^(utm_|hsa_|pk_|mtm_|__s$|_ga)/i;

export class UnsafeUrlError extends Error {}

const BLOCKED_HOST = /(^|\.)(localhost|local|internal|localdomain|lan|home|corp|intranet)$/i;

function isIpLiteral(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || /^\[.*\]$/.test(host) || /^0x[0-9a-f]+$/i.test(host) || /^\d+$/.test(host);
}

// Validates a URL we may fetch or store as a resource link. HTTPS only, public hostnames only.
export function assertPublicHttpsUrl(input) {
  let u;
  try {
    u = new URL(String(input).trim());
  } catch {
    throw new UnsafeUrlError('Invalid URL');
  }
  if (u.protocol !== 'https:') throw new UnsafeUrlError('HTTPS URL required');
  if (u.username || u.password) throw new UnsafeUrlError('URL must not contain credentials');
  if (u.port && u.port !== '443') throw new UnsafeUrlError('Non-standard port refused');
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || isIpLiteral(host) || BLOCKED_HOST.test(host)) throw new UnsafeUrlError('Host not allowed');
  if (u.href.length > 2048) throw new UnsafeUrlError('URL too long');
  return u;
}

// Canonical form used for exact-duplicate detection. Keeps the path and meaningful query
// parameters; drops fragments, tracking parameters, default ports and trailing slashes.
export function canonicalizeUrl(input, { stripParams = [] } = {}) {
  const u = assertPublicHttpsUrl(input);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  const extra = new Set(stripParams.map((p) => p.toLowerCase()));
  const kept = [];
  for (const [k, v] of u.searchParams) {
    const lk = k.toLowerCase().replace(/^(amp;)+/, ''); // feeds that escape "&" twice
    if (TRACKING_EXACT.has(lk) || TRACKING_PREFIX.test(lk) || extra.has(lk)) continue;
    kept.push([k, v]);
  }
  kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  u.search = '';
  for (const [k, v] of kept) u.searchParams.append(k, v);
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  return u.href;
}

const DOI_RE = /\b(10\.\d{4,9}\/[^\s"<>?#]+)/i;

export function extractDoi(input) {
  const s = String(input ?? '');
  let candidate = s;
  try {
    const u = new URL(s);
    if (/(^|\.)doi\.org$/i.test(u.hostname)) candidate = decodeURIComponent(u.pathname.slice(1));
  } catch { /* not a URL: scan the text */ }
  const m = candidate.match(DOI_RE);
  return m ? m[1].replace(/[.,;)]+$/, '').toLowerCase() : null;
}

export function hostAllowed(host, allowed) {
  const h = host.toLowerCase();
  return allowed.some((a) => {
    const x = String(a).toLowerCase().replace(/^\*\./, '');
    return h === x || h.endsWith('.' + x);
  });
}

export const hostOf = (url) => {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
};
