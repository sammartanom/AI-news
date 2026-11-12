// Reads what a single web page says about itself, so an editor can add a static link without
// retyping it: title, publisher, publication date and a likely format. Only metadata the page
// states is returned; nothing is guessed except the format, which the editor confirms.
import { safeFetch } from './safe-fetch.mjs';
import { stripHtml } from '../lib/text.mjs';
import { hostOf } from '../lib/url.mjs';

const fetchOf = (env) => env.__fetch ?? globalThis.fetch;
const VIDEO_HOSTS = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/;

function metaContent(html, ...names) {
  for (const name of names) {
    const re = new RegExp(`<meta\\s[^>]*(?:property|name|itemprop)\\s*=\\s*["']${name.replace(/[.:]/g, '\\$&')}["'][^>]*>`, 'i');
    const tag = html.match(re)?.[0];
    const value = tag?.match(/content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i);
    const text = stripHtml(value?.[1] ?? value?.[2] ?? '', 400);
    if (text) return text;
  }
  return null;
}

// The first datePublished in JSON-LD, if any.
function jsonLdDate(html) {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const hit = m[1].match(/"datePublished"\s*:\s*"([^"]+)"/);
    if (hit) return hit[1];
  }
  return null;
}

const isoDay = (v) => {
  if (!v) return null;
  const m = String(v).match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return null;
  return [m[1], m[2], m[3]].filter(Boolean).join('-');
};

// "Guide to AI | Example Org" -> "Guide to AI" when the suffix is the site's name.
export function cleanTitle(title, site, host = '') {
  if (!title) return null;
  const parts = title.split(/\s+[|\u2013\u2014-]\s+/);
  if (parts.length > 1) {
    const last = parts.at(-1).toLowerCase().replace(/[^a-z0-9]/g, '');
    const names = [site, host.replace(/^www\./, '').split('.')[0]].filter(Boolean).map((n) => n.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (last && names.some((n) => n.includes(last) || last.includes(n))) return parts.slice(0, -1).join(' - ').trim();
  }
  return title.trim();
}

export function parsePageMeta(html, url) {
  const host = hostOf(url);
  const site = metaContent(html, 'og:site_name', 'application-name', 'publisher');
  const rawTitle = metaContent(html, 'og:title', 'twitter:title', 'citation_title') ?? stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '', 300);
  const type = (metaContent(html, 'og:type') ?? '').toLowerCase();
  const published = isoDay(metaContent(html, 'article:published_time', 'citation_publication_date', 'citation_date', 'dc.date', 'date') ?? jsonLdDate(html));
  return {
    title: cleanTitle(rawTitle, site, host) || null,
    publisher: site || metaContent(html, 'citation_publisher', 'dc.publisher') || null,
    published_at: published,
    description: metaContent(html, 'og:description', 'description'),
    format: VIDEO_HOSTS.test(host) || type.startsWith('video') ? 'Video' : type.includes('podcast') ? 'Podcast' : metaContent(html, 'citation_title') ? 'Research paper' : null
  };
}

export async function readPageMeta(env, url) {
  const host = hostOf(url);
  const res = await safeFetch(url, {
    env, allowedHosts: [host], fetchImpl: fetchOf(env), allowedTypes: [/html/, /pdf/], accept: 'text/html, application/pdf;q=0.8',
    readBody: true, maxBytes: 2_000_000
  });
  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (type.includes('pdf')) {
    // A PDF's own metadata is unreliable; the editor types the title.
    return { url: res.finalUrl, title: null, publisher: null, published_at: null, description: null, format: 'Report', pdf: true };
  }
  return { url: res.finalUrl, ...parsePageMeta(res.text, res.finalUrl) };
}
