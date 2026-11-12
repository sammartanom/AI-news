import { h, fill } from '../dom.js';
import { api } from '../api.js';
import { openResource } from '../dialog.js';
import { cardDate } from '../format.js';
import { startOrbit } from '../orbit.js';
import { openDigest, openPath, PATHS, lastRole, ROLE_AUDIENCE } from '../panel.js';
import { icon } from '../icons.js';

// Example searches the box types out by itself while it is empty: a hint of what works.
const HINTS = [
  'AI literacy lessons for grade 5',
  'using AI to give students feedback',
  'AI and academic integrity',
  'chatbot activities for high school English',
  'research on AI tutoring',
  'how to talk to parents about chatbots'
];

// Types each hint into the placeholder, waits, and moves on. Stops for good once someone types,
// and never runs with reduced motion.
function typeHints(input, ctx) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let base = input.placeholder;
  let n = 0;
  let timer = 0;
  let stopped = false;
  const stop = () => { stopped = true; clearTimeout(timer); input.placeholder = base; };
  const wait = (ms, fn) => { timer = setTimeout(() => { if (!stopped) fn(); }, ms); };
  const next = () => {
    if (input.value) return wait(2000, next);
    const text = `Try \u201c${HINTS[n++ % HINTS.length]}\u201d`;
    let i = 0;
    const tick = () => {
      if (input.value) { input.placeholder = base; return wait(2000, next); }
      input.placeholder = text.slice(0, ++i);
      if (i < text.length) wait(38 + Math.random() * 40, tick);
      else wait(2600, () => { input.placeholder = base; wait(2200, next); });
    };
    tick();
  };
  input.addEventListener('input', stop, { once: true });
  ctx.onLeave(stop);
  wait(3500, next);
  return { setBase: (b) => { base = b; } };
}

const ROLE_ICONS = { 'teacher-start': 'lessons', classroom: 'compass', integrity: 'award' };

export async function homeView(root, ctx) {
  const role = lastRole(); // remembered on this device when someone opens a reading path
  const input = h('input', { id: 'q', name: 'q', type: 'search', placeholder: 'Search resources on AI for teachers', autocomplete: 'off', maxlength: '300', enterkeyhint: 'search' });
  const form = h('form', { class: 'search', role: 'search', action: '/grid', method: 'get' },
    h('label', { for: 'q', class: 'sr' }, 'Search resources'),
    input,
    h('button', { class: 'btn btn-primary btn-search', type: 'submit' }, icon('zap', 18), h('span', {}, 'Search'))
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q) ctx.navigate(`/grid?q=${encodeURIComponent(q)}`);
  });
  const constellation = h('div', { class: 'constellation', 'aria-label': 'Selected resources', role: 'list' });
  const center = h('div', { class: 'center' });
  // Phones show the cards as a straight shelf that scrolls sideways, under this small header.
  const browseAll = h('a', { class: 'browse-all', href: '/grid', 'data-link': '', 'aria-label': 'See all resources' }, h('span', {}, 'See all'), icon('arrow', 16));
  const browseText = h('span', {}, 'Browse all resources');
  const browseLink = h('a', { class: 'home-browse', href: '/grid', 'data-link': '' }, icon('grid', 16), browseText, icon('arrow', 14));
  const shelfHead = h('div', { class: 'shelf-head' }, h('h2', { class: 'shelf-title' }, 'Worth a look'), browseAll);
  fill(root, 
    h('section', { class: 'hero' },
      constellation,
      fill(center,
        // The weekly digest reads as news, above the heading; the reading paths are a choice of
        // role, below the search. Different shapes keep the two from being mistaken for each other.
        h('button', { type: 'button', class: 'digest-open', onclick: () => openDigest() }, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), h('span', {}, 'This week, summarized'), icon('arrow', 14)),
        h('h1', { id: 'page-title', tabindex: '-1' }, h('span', {}, 'AI for'), h('br'), h('span', {}, 'teachers', h('span', { class: 'dot' }, '.'))),
        form,
        h('nav', { class: 'start-paths', 'aria-label': 'Reading paths for teachers' },
          PATHS.map((p) => h('button', { type: 'button', class: 'start-path', 'data-last': role === p.id ? '' : null, title: role === p.id ? `Your last reading path: ${p.label}` : `Reading path: ${p.label}`, onclick: () => openPath(p.id) }, icon(ROLE_ICONS[p.id], 16), h('span', {}, p.short)))),
        // A plain way into Browse from the home page, for anyone who misses the menu.
        browseLink
      ),
      shelfHead
    )
  );
  ctx.title('AI for teachers');
  const hints = typeHints(input, ctx);
  if (matchMedia('(pointer: fine)').matches) input.focus({ preventScroll: true }); // no keyboard pop-up on touch devices
  // Featured resources first (for the remembered role, if there is one), then other editors'
  // picks, newest first, so the field is full of the best of the library.
  const forRole = `&audience=${encodeURIComponent(role ? ROLE_AUDIENCE[role] : 'Teachers')}`; // teachers first by default
  const [featured, recent] = await Promise.allSettled([
    api.get(`/api/featured?limit=12${forRole}`, { signal: ctx.signal }),
    api.get('/api/resources?sort=recommended&limit=50', { signal: ctx.signal })
  ]);
  if (ctx.signal.aborted) return;
  const seen = new Set();
  const resources = [...(featured.value?.resources ?? []), ...(recent.value?.resources ?? [])].filter((r) => !seen.has(r.id) && seen.add(r.id));
  if (recent.value?.total) {
    input.placeholder = `Search ${recent.value.total.toLocaleString('en-US')} resources`;
    hints?.setBase(input.placeholder);
    browseAll.setAttribute('aria-label', `See all ${recent.value.total.toLocaleString('en-US')} resources`);
    browseText.textContent = `Browse all ${recent.value.total.toLocaleString('en-US')} resources`;
  }
  if (!resources.length) return; // the search box works without the cards; stay quiet about it
  fill(constellation, ...resources.slice(0, 60).map((r) => {
    const card = h('a', { class: 'orbit-card', role: 'listitem', href: `/?r=${encodeURIComponent(r.id)}`, 'data-open': r.id },
      h('span', { class: 'name' }, r.title),
      h('span', { class: 'pub' }, h('span', { class: 'src' }, r.publisher), cardDate(r) ? h('span', { class: 'date num' }, cardDate(r)) : null)
    );
    card.addEventListener('click', (e) => { e.preventDefault(); openResource(r.id); });
    return card;
  }));
  ctx.onLeave(startOrbit(constellation, center));
}
