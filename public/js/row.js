import { h } from './dom.js';
import { cardDate, kindFor } from './format.js';
import { isSaved, toggleSave, saveLabel } from './library.js';
import { openResource } from './dialog.js';
import { icon } from './icons.js';

function saveButton(r) {
  const label = () => `${saveLabel(isSaved(r.id))}: ${r.title}`;
  const b = h('button', { class: 'save', type: 'button', 'aria-pressed': String(isSaved(r.id)), 'aria-label': label(), title: saveLabel(isSaved(r.id)) }, icon('bookmark', 18));
  b.addEventListener('click', async () => {
    b.disabled = true;
    b.classList.remove('pop');
    try { if (await toggleSave(r.id)) { void b.offsetWidth; b.classList.add('pop'); } } catch (e) { b.title = e.message; }
    b.disabled = false;
    b.setAttribute('aria-pressed', String(isSaved(r.id)));
    b.setAttribute('aria-label', label());
    b.title = saveLabel(isSaved(r.id));
  });
  return b;
}

// Non-articles say what they are: a video, a course, lessons. Articles stay unmarked.
function kindTag(r) {
  const k = kindFor(r);
  return k ? h('span', { class: 'kind', 'data-kind': k.slug }, icon(k.icon, 15), k.name) : null;
}

// Chosen by hand or reviewed by an editor: a quiet mark, explained in its tooltip and to screen readers.
export const pickMark = (r, size = 15) => (r.pick ? h('span', { class: 'pick', title: 'Editor’s pick: chosen or reviewed by an editor' }, icon('award', size), h('span', { class: 'sr' }, 'Editor’s pick')) : null);

/** One resource in a list: title, source and date. Everything else is in the dialog. */
export function resourceRow(r) {
  const open = h('button', { type: 'button', 'data-open': r.id }, r.title);
  open.addEventListener('click', () => openResource(r.id));
  return h('li', { class: 'row', 'data-id': r.id },
    h('div', { class: 'body' },
      h('h3', {}, open),
      h('p', { class: 'by' }, r.pick || kindFor(r) ? h('span', { class: 'tagline' }, pickMark(r), kindTag(r)) : null, h('span', { class: 'pub' }, r.publisher), cardDate(r) ? h('span', { class: 'date num' }, cardDate(r)) : null)
    ),
    saveButton(r)
  );
}

export function rowList(resources) {
  return h('ol', { class: 'rows' }, resources.map((r) => resourceRow(r)));
}
