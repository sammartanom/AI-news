import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeUrl, assertPublicHttpsUrl, extractDoi, hostAllowed, UnsafeUrlError } from '../../src/lib/url.mjs';
import { stripHtml, parseDateLoose, titleKey, queryTerms, jaccard, titleTokens } from '../../src/lib/text.mjs';
import { cleanResourceInput } from '../../src/lib/validate.mjs';
import { HttpError } from '../../src/lib/http.mjs';
import { COLLECTIONS, TOPICS } from '../../src/lib/taxonomy.mjs';
import { freshDb } from '../helpers/d1.mjs';

test('canonicalizeUrl: removes tracking parameters, fragments, default port and trailing slash', () => {
  assert.equal(canonicalizeUrl('https://Example.org/a/?utm_source=x&utm_medium=y&fbclid=1#top'), 'https://example.org/a');
  assert.equal(canonicalizeUrl('https://example.org/a/?utm_source=rss&amp;utm_medium=rss&amp;amp;utm_campaign=feeds'), 'https://example.org/a');
  assert.equal(canonicalizeUrl('https://example.org:443/a'), 'https://example.org/a');
  assert.equal(canonicalizeUrl('https://example.org/'), 'https://example.org/');
});

test('canonicalizeUrl: keeps meaningful parameters and sorts them', () => {
  assert.equal(canonicalizeUrl('https://example.org/watch?v=2&list=a&utm_campaign=z'), 'https://example.org/watch?list=a&v=2');
  assert.equal(canonicalizeUrl('https://example.org/a?open=comments', { stripParams: ['open'] }), 'https://example.org/a');
});

test('canonicalizeUrl: equivalent URLs collapse to one key', () => {
  const a = canonicalizeUrl('https://example.org/post/?utm_source=newsletter');
  const b = canonicalizeUrl('https://EXAMPLE.org/post#section');
  assert.equal(a, b);
});

test('unsafe URLs are refused', () => {
  for (const bad of [
    'http://example.org/a', 'javascript:alert(1)', 'ftp://example.org/a', 'file:///etc/passwd', 'https://user:pw@example.org/',
    'https://localhost/a', 'https://127.0.0.1/a', 'https://10.0.0.5/a', 'https://[::1]/a', 'https://intranet/a', 'https://printer.local/a',
    'https://example.org:8443/a', 'https://2130706433/', 'not a url', ''
  ]) assert.throws(() => assertPublicHttpsUrl(bad), UnsafeUrlError, bad);
});

test('extractDoi finds DOIs in doi.org URLs and text', () => {
  assert.equal(extractDoi('https://doi.org/10.51388/20.500.12265/218'), '10.51388/20.500.12265/218');
  assert.equal(extractDoi('https://doi.org/10.1000/ABC.def'), '10.1000/abc.def');
  assert.equal(extractDoi('see doi:10.1234/xyz-1.'), '10.1234/xyz-1');
  assert.equal(extractDoi('https://example.org/article'), null);
});

test('hostAllowed matches the host and its subdomains only', () => {
  assert.ok(hostAllowed('www.edutopia.org', ['edutopia.org']));
  assert.ok(hostAllowed('edutopia.org', ['edutopia.org']));
  assert.ok(!hostAllowed('evil-edutopia.org', ['edutopia.org']));
  assert.ok(!hostAllowed('edutopia.org.evil.com', ['edutopia.org']));
});

test('stripHtml reduces markup to plain text', () => {
  assert.equal(stripHtml('<p>Hello <b>world</b> &amp; friends</p><script>alert(1)</script>'), 'Hello world & friends');
  assert.equal(stripHtml('Announcing the &amp;quot;AI Agent&amp;quot; plan'), 'Announcing the "AI Agent" plan'); // escaped twice
  assert.equal(stripHtml('&amp;lt;script&amp;gt;x'), 'x');
  assert.equal(stripHtml('\u200bSequential Attention'), 'Sequential Attention');
  assert.equal(stripHtml('&lt;img src=x onerror=alert(1)&gt;'), '');
  assert.equal(stripHtml('<![CDATA[Plain <i>text</i>]]>'), 'Plain text');
  assert.equal(stripHtml('x'.repeat(50), 10).length, 10);
});

test('parseDateLoose: dates are parsed when present and null otherwise', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  assert.equal(parseDateLoose('Tue, 14 Oct 2025 08:00:00 GMT', now), '2025-10-14');
  assert.equal(parseDateLoose('2025-10-14T23:30:00-05:00', now), '2025-10-14'); // the date as written
  assert.equal(parseDateLoose('2025-10-14', now), '2025-10-14');
  assert.equal(parseDateLoose('', now), null);
  assert.equal(parseDateLoose(null, now), null);
  assert.equal(parseDateLoose('sometime last week', now), null);
  assert.equal(parseDateLoose('2025-02-31', now), null);
  assert.equal(parseDateLoose('2031-01-01', now), null); // future
  assert.equal(parseDateLoose('1970-01-01', now), null); // implausible
});

test('titleKey and similarity helpers', () => {
  assert.equal(titleKey('The AI Cheating Crisis, Explained!'), 'ai cheating crisis explained');
  assert.equal(titleKey('AI cheating crisis explained'), titleKey('The AI Cheating Crisis, Explained'));
  assert.ok(jaccard(titleTokens('AI literacy for families toolkit'), titleTokens('AI literacy toolkit for families')) === 1);
  assert.ok(jaccard(titleTokens('AI literacy'), titleTokens('Student privacy')) === 0);
});

test('queryTerms drops question words but keeps domain words if nothing else remains', () => {
  assert.deepEqual(queryTerms('What should parents know about AI and children?'), ['parents', 'children']);
  assert.deepEqual(queryTerms('AI in education'), ['ai', 'education']);
});

test('cleanResourceInput validates and normalizes editor input', () => {
  const ok = cleanResourceInput({ title: ' <b>Title</b> ', audiences: ['Teachers'], collections: ['start-here'], topics: ['Writing', 'writing'], published_at: '2025-03' });
  assert.equal(ok.title, 'Title');
  assert.deepEqual(ok.topics, ['writing']);
  assert.equal(ok.published_at, '2025-03');
  const bad = (o) => assert.throws(() => cleanResourceInput(o), HttpError);
  bad({ audiences: ['Aliens'] });
  bad({ collections: ['nope'] });
  bad({ published_at: '2031-01-01' });
  bad({ published_at: 'last Tuesday' });
  bad({ url: 'http://example.org/x' });
  bad({ title: '' });
  bad({ evidence_type: 'magic' });
  bad({ editorial_priority: 7 });
  bad({ featured: 'yes' });
  assert.equal(cleanResourceInput({ published_at: null }).published_at, null);
});

test('taxonomy constants match the collections and topics seeded by migrations', async () => {
  const db = freshDb();
  const cols = (await db.prepare('SELECT slug, name FROM collections ORDER BY position').all()).results;
  assert.deepEqual(cols, COLLECTIONS.map(({ slug, name }) => ({ slug, name })));
  const topics = (await db.prepare('SELECT slug, name, query FROM topics ORDER BY position').all()).results;
  assert.deepEqual(topics, TOPICS);
});
