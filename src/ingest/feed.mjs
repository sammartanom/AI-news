import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { stripHtml, parseDateLoose } from '../lib/text.mjs';

export class FeedError extends Error {}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: false, // entities are never expanded
  htmlEntities: false,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => ['item', 'entry', 'link'].includes(name)
});

const textOf = (x) => {
  if (x == null) return '';
  if (typeof x === 'string') return x;
  if (typeof x === 'number') return String(x);
  if (Array.isArray(x)) return textOf(x[0]);
  return typeof x['#text'] === 'string' ? x['#text'] : '';
};

function atomLink(links) {
  const list = Array.isArray(links) ? links : links ? [links] : [];
  const alt = list.find((l) => l?.['@_href'] && (!l['@_rel'] || l['@_rel'] === 'alternate'));
  return alt?.['@_href'] ?? null;
}

/**
 * Parses RSS 2.0, RSS 1.0 (RDF) and Atom. DTDs and entity declarations are rejected outright.
 * Dates: only publication fields are used (RSS pubDate/dc:date, Atom published). Atom "updated"
 * is a modification time and is ignored. Items whose date is missing or implausible get null.
 */
export function parseFeed(xml, { maxItems = 100, now = Date.now(), maxBytes = 2_000_000 } = {}) {
  if (typeof xml !== 'string' || !xml.trim()) throw new FeedError('Empty feed');
  if (xml.length > maxBytes) throw new FeedError('Feed too large');
  if (/<!DOCTYPE|<!ENTITY|<!ELEMENT|<!ATTLIST/i.test(xml)) throw new FeedError('DTD and entity declarations are not accepted');
  const valid = XMLValidator.validate(xml);
  if (valid !== true) throw new FeedError('Malformed XML');
  let doc;
  try { doc = parser.parse(xml); } catch { throw new FeedError('Malformed XML'); }

  let kind;
  let entries;
  if (doc.feed) { kind = 'atom'; entries = doc.feed.entry ?? []; }
  else if (doc.rss?.channel) { kind = 'rss'; entries = doc.rss.channel.item ?? []; }
  else if (doc['rdf:RDF']) { kind = 'rdf'; entries = doc['rdf:RDF'].item ?? []; }
  else throw new FeedError('Not an RSS or Atom feed');

  const items = [];
  let skipped = 0;
  for (const e of entries.slice(0, maxItems)) {
    const title = stripHtml(textOf(e.title), 300);
    let link;
    if (kind === 'atom') link = atomLink(e.link);
    else {
      const l = e.link;
      link = (Array.isArray(l) ? l.map(textOf).find(Boolean) : textOf(l)) || null;
      const guid = e.guid;
      if (!link && guid && (typeof guid === 'string' || guid['@_isPermaLink'] !== 'false')) link = textOf(guid);
    }
    if (!title || !link) { skipped++; continue; }
    const rawDate = kind === 'atom' ? textOf(e.published) : textOf(e.pubDate) || textOf(e['dc:date']);
    const desc = textOf(e.description) || textOf(e.summary) || textOf(e['content:encoded']);
    items.push({
      title,
      link: String(link).trim(),
      guid: textOf(e.guid) || textOf(e.id) || null,
      published_at: parseDateLoose(rawDate, now) ?? (rawDate ? null : journalDate(desc, now)),
      excerpt: desc ? stripHtml(desc, 400) : null
    });
  }
  return { kind, items, skipped };
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * Journal feeds (ScienceDirect and others) give no item date, only a line in the description:
 * "Publication date: Available online 22 October 2026" (a real date) or "Publication date:
 * December 2026" (the issue). An issue month that has not arrived yet only says the year, because
 * the article is already online; an issue in a later year says nothing we can trust.
 */
export function journalDate(desc, now = Date.now()) {
  const text = stripHtml(String(desc ?? ''), 600);
  const m = text.match(/Publication date:\s*(?:Available online\s+)?(?:(\d{1,2})\s+)?([A-Za-z]+)\s+(\d{4})/i);
  if (!m) return null;
  const month = MONTH_NAMES.indexOf(m[2].toLowerCase()) + 1;
  if (!month) return null;
  const year = Number(m[3]);
  if (m[1]) return parseDateLoose(`${year}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`, now);
  const today = new Date(now);
  const [ty, tm] = [today.getUTCFullYear(), today.getUTCMonth() + 1];
  if (year < 1990 || year > ty) return null;
  if (year === ty && month > tm) return String(year);
  return `${year}-${String(month).padStart(2, '0')}`;
}
