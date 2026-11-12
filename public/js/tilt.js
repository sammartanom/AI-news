// Cards lean toward the pointer, a few degrees at most, and settle back when it leaves. Works for
// the home cards and for resources shown as a grid. Mouse only, and never with reduced motion.
const SELECTOR = '.orbit-card, [data-layout="grid"] .rows > .row';
const still = matchMedia('(prefers-reduced-motion: reduce)');

export function initTilt() {
  let current = null;
  const reset = (el) => { el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); el.style.removeProperty('--gx'); el.style.removeProperty('--gy'); };
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || still.matches) return;
    let el = e.target.closest?.(SELECTOR);
    if (el?.closest('.constellation.moving')) el = null; // js/orbit.js tilts its own moving cards
    if (current && current !== el) reset(current);
    current = el;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    const max = el.classList.contains('orbit-card') ? 6 : 3;
    el.style.setProperty('--rx', `${(-py * max).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${(px * max).toFixed(2)}deg`);
    el.style.setProperty('--gx', `${(-px * 6).toFixed(1)}px`); // the shadow falls away from the raised side
    el.style.setProperty('--gy', `${(-py * 6).toFixed(1)}px`);
  }, { passive: true });
  document.addEventListener('pointerleave', () => { if (current) reset(current); current = null; });
}
