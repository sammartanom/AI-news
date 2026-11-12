// On phones, dialogs slide up when they open and back down when they close. Opening is plain CSS;
// closing needs a moment before the dialog leaves the screen, so close() and Escape are routed
// through here. Wider screens and reduced motion close at once.
const phone = matchMedia('(max-width: 719px)');
const still = matchMedia('(prefers-reduced-motion: reduce)');
const nativeClose = HTMLDialogElement.prototype.close;
const SLIDE_MS = 280;

export function slideClosed(d) {
  d.close = (value) => {
    if (!d.open || d.classList.contains('closing')) return;
    if (!phone.matches || still.matches) { nativeClose.call(d, value); return; }
    d.classList.add('closing');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(d._slide);
      d.removeEventListener('animationend', onEnd);
      if (!d.classList.contains('closing')) return; // reopened while sliding away
      d.classList.remove('closing');
      nativeClose.call(d, value);
    };
    const onEnd = (e) => { if (e.target === d) finish(); };
    d.addEventListener('animationend', onEnd);
    d._slide = setTimeout(finish, SLIDE_MS + 120); // in case the animation never reports back
  };
  d.addEventListener('cancel', (e) => { e.preventDefault(); d.close(); }); // Escape slides too
}

// Opening again while the dialog is sliding away keeps it on screen.
export function keepOpen(d) {
  if (d.classList.contains('closing')) { d.classList.remove('closing'); clearTimeout(d._slide); }
}
