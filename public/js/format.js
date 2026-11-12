const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// US style: "Oct 20, 2026". Publication dates may be YYYY, YYYY-MM or YYYY-MM-DD; unknown stays unknown.
export function formatPublished(value) {
  if (!value) return null;
  const [y, m, d] = value.split('-');
  if (!m) return y;
  if (!d) return `${MONTHS[Number(m) - 1]} ${y}`;
  return `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`;
}

export function formatAdded(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`;
}

// The single date shown on a card: the verified publication date, otherwise when it was added here.
export function cardDate(r) {
  const published = formatPublished(r.published_at);
  if (published) return published;
  const added = formatAdded(r.added_at);
  return added ? `Added ${added}` : null;
}

// Mirrors KINDS in src/lib/taxonomy.mjs: the broad kind shown on cards, with an icon and an action word.
export const KINDS = [
  { slug: 'guides', name: 'Guide', icon: 'guide', action: 'Open guide', formats: ['guidance', 'framework', 'toolkit', 'template', 'checklist', 'glossary'] },
  { slug: 'lessons', name: 'Lessons', icon: 'lessons', action: 'Open lessons', formats: ['lessons', 'collection'] },
  { slug: 'courses', name: 'Course', icon: 'course', action: 'Open course', formats: ['course'] },
  { slug: 'tools', name: 'Tool', icon: 'tool', action: 'Try it', formats: ['interactive tool'] },
  { slug: 'videos', name: 'Video', icon: 'play', action: 'Watch', formats: ['video'] },
  { slug: 'podcasts', name: 'Podcast', icon: 'listen', action: 'Listen', formats: ['podcast'] },
  { slug: 'research', name: 'Research', icon: 'research', action: 'Read the report', formats: ['report', 'research paper'] },
  { slug: 'laws', name: 'Legislation', icon: 'law', action: 'Read the text', formats: ['legislation', 'tracker'] }
];
export const kindFor = (r) => KINDS.find((k) => k.formats.includes(String(r.format ?? '').toLowerCase())) ?? null;


export function plural(n, one, many = `${one}s`) {
  return `${Number(n).toLocaleString('en-US')} ${n === 1 ? one : many}`;
}
