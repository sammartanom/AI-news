// Finds the feed behind whatever an editor pastes: a feed address, or any page on the site. A page
// is searched for <link rel="alternate"> feeds first, then a few common feed paths on the same site.
import { safeFetch, FetchError } from './safe-fetch.mjs';
import { parseFeed, FeedError } from './feed.mjs';
import { hostOf } from '../lib/url.mjs';
import { stripHtml } from '../lib/text.mjs';

const fetchOf = (env) => env.__fetch ?? globalThis.fetch;
const AI = /\b(AI|A\.I\.|artificial intelligence|chat ?gpt|generative|chatbots?|LLMs?|machine learning|gemini|claude|copilot)\b/i;
const COMMON_PATHS = ['/feed/', '/rss.xml', '/feed.xml', '/atom.xml', '/index.xml', '/rss/'];
const FEED_LINK = /<link\b[^>]*>/gi;

function feedLinks(html, base) {
  const out = [];
  for (const tag of html.match(FEED_LINK) ?? []) {
    if (!/rel=["']?[^"'>]*alternate/i.test(tag) || !/type=["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href || /comments/i.test(href)) continue; // WordPress also lists a comments feed
    try { out.push(new URL(href.replace(/&amp;/g, '&'), base).href); } catch { /* bad href */ }
  }
  return [...new Set(out)];
}

function feedTitle(xml) {
  const m = xml.match(/<(?:channel|feed)\b[^>]*>[\s\S]*?<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripHtml(m[1].replace(/<!\[CDATA\[|\]\]>/g, ''), 120) : null;
}

async function get(env, url, accept) {
  return safeFetch(url, { env, allowedHosts: [hostOf(url)], fetchImpl: fetchOf(env), accept, allowedTypes: [/xml/, /rss/, /atom/, /html/, /text\/plain/] });
}

function asFeed(res) {
  try {
    const feed = parseFeed(res.text);
    return feed.items.length || /<(rss|feed|rdf:RDF)\b/i.test(res.text) ? feed : null;
  } catch (e) { if (e instanceof FeedError) return null; throw e; }
}

/** { feed_url, site_url, title, items, ai_items, sample } or throws FetchError/Error with a plain message. */
export async function findFeed(env, input) {
  let url;
  try { url = new URL(String(input ?? '').trim()); } catch { throw new FetchError('bad_url', 'Enter a full https:// address'); }
  const tried = new Set();
  const attempt = async (u) => {
    if (tried.has(u) || tried.size >= 6) return null;
    tried.add(u);
    try {
      const res = await get(env, u, 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.8');
      return { res, feed: asFeed(res) };
    } catch (e) { if (e instanceof FetchError) return null; throw e; }
  };
  const first = await attempt(url.href);
  if (!first) throw new FetchError('unreachable', 'That address could not be opened');
  let found = first.feed ? { url: first.res.finalUrl, ...first } : null;
  if (!found) {
    const candidates = [...feedLinks(first.res.text, first.res.finalUrl), ...COMMON_PATHS.map((p) => new URL(p, first.res.finalUrl).href)];
    for (const c of candidates) {
      const r = await attempt(c);
      if (r?.feed) { found = { url: r.res.finalUrl, ...r }; break; }
    }
  }
  if (!found) throw new FetchError('no_feed', 'No feed was found on that site. Add its articles one at a time instead');
  const items = found.feed.items;
  const site = new URL(found.url);
  return {
    feed_url: found.url,
    site_url: `${site.protocol}//${site.host}/`,
    title: feedTitle(found.res.text) || site.hostname.replace(/^www\./, ''),
    items: items.length,
    ai_items: items.filter((i) => AI.test(i.title)).length,
    sample: items.slice(0, 5).map((i) => i.title)
  };
}

export const sourceIdFrom = (name) => String(name ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'feed';
