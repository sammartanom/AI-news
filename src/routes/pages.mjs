// The app's HTML pages, with the head written for each URL. The site is a single page app, but
// search engines and link previews (Slack, Teams, iMessage, LinkedIn, Facebook, X) read the HTML
// before any script runs, so the title, description, canonical URL, Open Graph and X card tags,
// JSON-LD and a plain-text fallback are filled in here from the URL: a shared resource (?r=),
// reading path (?path=), digest (?digest), About, Privacy, Browse (with a type or a search) and
// Saved. Also robots.txt and sitemap.xml. The page itself is public/index.html; everything between
// <!--meta--> and <!--/meta--> in it is replaced, and so is its <noscript> fallback.
import { route } from '../router.mjs';
import { getPublished } from '../repo/resources.mjs';
import { KINDS } from '../lib/taxonomy.mjs';
import { PATH_PRESETS, PATH_ALIASES } from '../discovery/paths.mjs';
import { latestDigest, digestView } from '../discovery/digest.mjs';
import { cached } from './util.mjs';

export const SITE = 'AI for teachers';
export const DISTRICT = 'Pleasantville Union Free School District';
// The name link previews and search results show for the whole site.
export const SITE_NAME = `Pleasantville UFSD \u00b7 ${SITE}`;
export const DESCRIPTION = 'A curated, searchable library of articles, research, guidance, lessons, courses and tools on AI in the classroom, for Pleasantville UFSD teachers.';
// The site-wide headers from public/_headers ("/*"). Static assets get them from that file; pages
// the Worker writes set them here too, in case the asset response does not carry them. A unit
// test keeps the two in step.
export const PAGE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};
const IMAGE = { path: '/og.png', width: 1200, height: 630, alt: 'AI for teachers: a curated, searchable library on AI in the classroom for Pleasantville UFSD teachers' };

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// JSON inside <script>: escape what could close the tag or start a comment.
const ldJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), n * 0.6)).replace(/[\s,;:.\u2014-]+$/, '')}\u2026`;
};
const titled = (t) => (t && t !== SITE ? `${t} \u00b7 ${SITE}` : SITE_NAME);

/** What the head says for one URL. Unknown ids fall back to the home page's description. */
export async function pageMeta(env, url) {
  const origin = url.origin;
  const p = url.searchParams;
  const base = { title: SITE_NAME, description: DESCRIPTION, canonical: `${origin}${url.pathname === '/' ? '/' : url.pathname}`, type: 'website', robots: 'index, follow, max-image-preview:large', ld: [], fallback: null };

  if (url.pathname === '/saved') return { ...base, title: titled('Saved'), description: 'Resources you saved on this device.', robots: 'noindex, follow' };

  if (url.pathname === '/grid') {
    const kind = KINDS.find((k) => k.slug === p.get('kind'));
    const q = (p.get('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (q) return { ...base, title: titled(`\u201c${q}\u201d`), description: `Resources on AI for teachers matching \u201c${q}\u201d.`, canonical: `${origin}/grid`, robots: 'noindex, follow' };
    if (kind) {
      return { ...base, title: titled(kind.name), canonical: `${origin}/grid?kind=${kind.slug}`,
        description: `${kind.name} on AI in the classroom for Pleasantville UFSD teachers, chosen from trusted sources and searchable in plain language.` };
    }
    return { ...base, title: titled('Browse'), description: 'Browse every resource on AI for teachers: articles, research, guidance, lessons, courses, tools, videos, podcasts, and laws and policy.' };
  }

  if (url.pathname !== '/') return base;

  const id = p.get('r');
  if (id) {
    const r = await getPublished(env, id.slice(0, 128)).catch(() => null);
    if (!r) return { ...base, robots: 'noindex, follow' };
    const description = clip(r.why || r.brief || r.summary || r.description || `${r.format ?? 'Resource'} from ${r.publisher}.`, 200);
    const canonical = `${origin}/?r=${encodeURIComponent(r.id)}`;
    const ld = {
      '@context': 'https://schema.org',
      '@type': /research|report/i.test(r.format ?? '') ? 'ScholarlyArticle' : /video/i.test(r.format ?? '') ? 'VideoObject' : /course/i.test(r.format ?? '') ? 'Course' : 'CreativeWork',
      name: r.title, description, url: canonical, sameAs: r.url,
      ...(r.publisher ? { publisher: { '@type': 'Organization', name: r.publisher } } : {}),
      ...(r.author ? { author: { '@type': 'Person', name: r.author } } : {}),
      ...(r.published_at && /^\d{4}-\d{2}-\d{2}/.test(r.published_at) ? { datePublished: r.published_at.slice(0, 10) } : {}),
      ...(r.topic_labels?.length ? { keywords: r.topic_labels.join(', ') } : {}),
      ...(r.audiences?.length ? { audience: r.audiences.map((a) => ({ '@type': 'EducationalAudience', educationalRole: a })) } : {}),
      isAccessibleForFree: true,
      inLanguage: r.language || 'en'
    };
    return {
      ...base, title: titled(r.title), description, canonical, type: 'article', ld: [ld],
      article: { published: r.published_at && /^\d{4}-\d{2}-\d{2}/.test(r.published_at) ? r.published_at.slice(0, 10) : null, publisher: r.publisher, tags: r.topic_labels ?? [] },
      fallback: { heading: r.title, text: [description, r.publisher ? `From ${r.publisher}.` : null].filter(Boolean).join(' '), link: { href: r.url, label: 'Open the original' } }
    };
  }

  const pathId = p.get('path');
  if (pathId) {
    const preset = PATH_PRESETS.find((x) => x.id === (PATH_ALIASES[pathId] ?? pathId));
    if (preset) {
      const description = `A short reading path for a ${preset.label.charAt(0).toLowerCase()}${preset.label.slice(1)}: a few chosen resources on AI in the classroom, from first steps to action.`;
      return { ...base, title: titled(preset.label), description, canonical: `${origin}/?path=${preset.id}`, fallback: { heading: preset.label, text: description } };
    }
  }

  if (p.has('digest')) {
    const want = p.get('digest');
    const row = want ? await env.DB.prepare('SELECT * FROM digests WHERE id = ?').bind(want.slice(0, 64)).first().catch(() => null) : await latestDigest(env).catch(() => null);
    const d = row ? await digestView(env, row).catch(() => null) : null;
    if (d) {
      const description = clip(d.overview?.[0] || d.headline || 'The week\u2019s most useful new resources on AI for teachers.', 200);
      return { ...base, title: titled(d.headline || 'This week in AI for teachers'), description, canonical: `${origin}/?digest=${encodeURIComponent(d.id)}`, type: 'article',
        fallback: { heading: d.headline || 'This week', text: description } };
    }
  }
  if (p.has('about')) return { ...base, title: titled('About'), description: 'Why this library exists, who keeps it, and how resources are gathered, searched and summarized.', canonical: `${origin}/?about` };
  if (p.has('privacy')) return { ...base, title: titled('Privacy'), description: 'What this site stores, what it never collects, and how saved lists stay on your device.', canonical: `${origin}/?privacy` };
  if (p.has('q')) return { ...base, robots: 'noindex, follow' };

  return {
    ...base,
    ld: [{
      '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: `${origin}/`, description: DESCRIPTION, inLanguage: 'en',
      publisher: { '@type': 'EducationalOrganization', name: DISTRICT },
      audience: { '@type': 'EducationalAudience', educationalRole: 'teacher' },
      potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${origin}/grid?q={search_term_string}` }, 'query-input': 'required name=search_term_string' }
    }]
  };
}

/** The <head> tags for a page, in the order crawlers expect. */
export function headTags(meta, origin) {
  const image = `${origin}${IMAGE.path}`;
  const tags = [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}">`,
    `<meta name="robots" content="${esc(meta.robots)}">`,
    `<link rel="canonical" href="${esc(meta.canonical)}">`,
    `<meta property="og:site_name" content="${esc(SITE_NAME)}">`,
    `<meta property="og:locale" content="en_US">`,
    `<meta property="og:type" content="${esc(meta.type)}">`,
    `<meta property="og:title" content="${esc(meta.title)}">`,
    `<meta property="og:description" content="${esc(meta.description)}">`,
    `<meta property="og:url" content="${esc(meta.canonical)}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    `<meta property="og:image:type" content="image/png">`,
    `<meta property="og:image:width" content="${IMAGE.width}">`,
    `<meta property="og:image:height" content="${IMAGE.height}">`,
    `<meta property="og:image:alt" content="${esc(IMAGE.alt)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(meta.title)}">`,
    `<meta name="twitter:description" content="${esc(meta.description)}">`,
    `<meta name="twitter:image" content="${esc(image)}">`,
    `<meta name="twitter:image:alt" content="${esc(IMAGE.alt)}">`
  ];
  if (meta.article?.published) tags.push(`<meta property="article:published_time" content="${esc(meta.article.published)}">`);
  if (meta.article?.publisher) tags.push(`<meta property="article:author" content="${esc(meta.article.publisher)}">`);
  for (const t of meta.article?.tags ?? []) tags.push(`<meta property="article:tag" content="${esc(t)}">`);
  for (const ld of meta.ld) tags.push(`<script type="application/ld+json">${ldJson(ld)}</script>`);
  return tags.join('\n');
}

/** The plain fallback shown without JavaScript: the same heading and text a reader would see. */
export function fallbackHtml(meta) {
  const f = meta.fallback ?? { heading: SITE, text: meta.description };
  const link = f.link ? `<p><a href="${esc(f.link.href)}" rel="noopener">${esc(f.link.label)}</a></p>` : '';
  return `<noscript><div class="page"><h1>${esc(f.heading)}</h1><p>${esc(f.text)}</p>${link}<p>Search and browse need JavaScript.</p></div></noscript>`;
}

export function renderPage(html, meta, origin) {
  return html
    .replace(/<!--meta-->[\s\S]*?<!--\/meta-->/, `<!--meta-->\n${headTags(meta, origin)}\n<!--/meta-->`)
    .replace(/<noscript>[\s\S]*?<\/noscript>/, fallbackHtml(meta));
}

// The page from static assets, with its head written for this URL. Headers from the asset (the
// CSP and the rest of public/_headers) are kept; the length and validators change with the body.
async function page(c) {
  const asset = await c.env.ASSETS.fetch(new Request(new URL('/', c.url), { headers: { accept: 'text/html' } }));
  if (!asset.ok) return asset;
  const meta = await pageMeta(c.env, c.url);
  const headers = new Headers(asset.headers);
  for (const h of ['content-length', 'etag', 'last-modified']) headers.delete(h);
  for (const [k, v] of Object.entries(PAGE_HEADERS)) if (!headers.has(k)) headers.set(k, v);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
  if (/noindex/.test(meta.robots)) headers.set('x-robots-tag', 'noindex');
  return new Response(renderPage(await asset.text(), meta, c.url.origin), { status: 200, headers });
}

for (const path of ['/', '/grid', '/saved']) route('GET', path, (c) => (c.url.searchParams.has('r') || c.url.searchParams.has('digest') ? cached(c, 300, () => page(c)) : page(c)));

route('GET', '/robots.txt', (c) => new Response(
  ['User-agent: *', 'Allow: /', 'Disallow: /api/', 'Disallow: /editor/', 'Disallow: /login', 'Disallow: /saved', '', `Sitemap: ${c.url.origin}/sitemap.xml`, ''].join('\n'),
  { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } }));

// Every public page worth finding: home, Browse and each type, the reading paths, About, and
// every published resource with the date it last changed.
route('GET', '/sitemap.xml', (c) => cached(c, 3600, async () => {
  const o = c.url.origin;
  const day = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
  const rows = (await c.env.DB.prepare("SELECT id, COALESCE(updated_at, added_at) AS changed FROM resources WHERE status = 'published' ORDER BY changed DESC").all()).results;
  const newest = day(rows[0]?.changed);
  const urls = [
    { loc: `${o}/`, lastmod: newest, priority: '1.0' },
    { loc: `${o}/grid`, lastmod: newest, priority: '0.9' },
    ...KINDS.map((k) => ({ loc: `${o}/grid?kind=${k.slug}`, priority: '0.7' })),
    ...PATH_PRESETS.map((p) => ({ loc: `${o}/?path=${p.id}`, priority: '0.7' })),
    { loc: `${o}/?about`, priority: '0.3' },
    ...rows.map((r) => ({ loc: `${o}/?r=${encodeURIComponent(r.id)}`, lastmod: day(r.changed), priority: '0.6' }))
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) =>
    `<url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<priority>${u.priority}</priority></url>`).join('\n')}\n</urlset>\n`;
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}));
