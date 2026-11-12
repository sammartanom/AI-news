// Resource cards circle the heading and search on nested, level ellipses that reach past the edges
// of the screen, so the whole hero is filled and cards drift in and out at the sides. Every ring
// turns at the same angular speed, so the arrangement keeps its shape: cards are spaced once and
// the spacing is checked over a full turn. Layering is fixed per ring, like looking into a gentle
// funnel: outer rings are nearer (a little larger, in front), inner rings farther. Because the
// order never changes, a card never pops over or under its neighbour. Within that, cards near the
// top of a ring are slightly quieter and side cards turn a little toward the centre.
// The cards are physical: each springs toward its spot on the rings, bumps the cards it touches,
// parts around the pointer, and can be picked up and thrown. The menu button sits in a soft
// cushion: drifting cards glide around it, thrown cards bounce off, none pass underneath. Below 720px the CSS grid takes over
// and this does nothing. With reduced motion the cards are
// placed once and stay put.

const SPEED = 14;     // px per second, measured on the middle ring: a slow, visible drift
const GAP = 44;       // clear space around the heading and search
const SPACING = 1.22; // distance between neighbours on a ring, in card widths
const OVERLAP = 0.3;  // how far cards on neighbouring rings may tuck under each other
const SAMPLES = 96;   // positions checked over one turn

export function startOrbit(field, center) {
  const hero = field.parentElement;
  const NS = 'http://www.w3.org/2000/svg';
  const paths = document.createElementNS(NS, 'svg');
  paths.setAttribute('class', 'orbit-paths');
  paths.setAttribute('aria-hidden', 'true');
  field.append(paths);
  const cards = [...field.querySelectorAll('.orbit-card')];
  const small = matchMedia('(max-width: 719px)');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let slots = [];
  let geo = null;
  let elapsed = 0;
  let last = null;
  let raf = 0;
  let hover = false;
  let pace = 1;
  let stopped = false;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  const baseRot = cards.map((c, i) => (((i * 37) % 9) - 4) * 0.18);
  cards.forEach((c, i) => {
    c.style.setProperty('--r', `${baseRot[i]}deg`);
    c.style.setProperty('--n', String(i));
  });

  const depthOf = (t) => (Math.sin(t) + 1) / 2;    // 0 at the top of a ring, 1 at the bottom
  let ringCount = 1;
  const ringScale = (ring) => 0.88 + (0.16 * ring) / Math.max(1, ringCount - 1);
  const scaleOf = (ring, d) => ringScale(ring) * (0.97 + 0.05 * d);

  function measure() {
    if (small.matches || !cards.length) { geo = null; return; }
    const hr = hero.getBoundingClientRect();
    const cr = center.getBoundingClientRect();
    const cw = cards[0].offsetWidth;
    const ch = Math.max(...cards.map((c) => c.offsetHeight));
    const W = hr.width, H = hr.height;
    const x0 = cr.left - hr.left + cr.width / 2;
    const y0 = cr.top - hr.top + cr.height / 2;
    const maxScale = 1.04 * 1.02;
    const hw = (cw * maxScale) / 2, hh = (ch * maxScale) / 2;
    // The block cards must stay out of: heading and search, plus the gap, plus half a card.
    const bx = cr.width / 2 + GAP + hw, by = cr.height / 2 + GAP + hh;

    // Inner ring: the smallest ellipse with the heading's proportions that clears the block all
    // the way round (an ellipse that clears the sides can still clip the corners).
    let k = 1;
    for (; k < 3; k += 0.02) {
      const rx = bx * k, ry = by * k;
      let clear = true;
      for (let i = 0; i < 72 && clear; i++) {
        const a = (i / 72) * Math.PI * 2;
        if (Math.abs(rx * Math.cos(a)) < bx && Math.abs(ry * Math.sin(a)) < by) clear = false;
      }
      if (clear) break;
    }
    const rings = [];
    let rx = bx * k, ry = by * k;
    // Keep adding rings until one passes beyond the corners, so the edges are always filled.
    const cx = Math.max(x0, W - x0) + hw, cy = Math.max(y0, H - y0) + hh;
    for (let i = 0; i < 7; i++) {
      rings.push({ rx, ry });
      if ((cx / rx) ** 2 + (cy / ry) ** 2 <= 1) break;
      rx += cw * 0.92 + 18;
      ry += ch * 0.78 + 14;
    }
    ringCount = rings.length;
    const mid = rings[Math.floor(rings.length / 2)];
    const omega = SPEED / ((mid.rx + mid.ry) / 2);
    geo = { x0, y0, cw, ch, W, H, rings, omega, cr: { x: cr.left - hr.left, y: cr.top - hr.top, width: cr.width, height: cr.height } };

    // Even spacing by arc length, staggered between rings. Outer rings spend part of each turn
    // off screen, so they get their share of cards only after the inner rings are filled.
    const lengthOf = (r) => Math.PI * (3 * (r.rx + r.ry) - Math.sqrt((3 * r.rx + r.ry) * (r.rx + 3 * r.ry)));
    const wanted = rings.map((r) => Math.max(1, Math.floor(lengthOf(r) / (cw * SPACING))));
    let supply = cards.length;
    const counts = wanted.map((n) => { const take = Math.min(n, supply); supply -= take; return take; });
    const candidates = [];
    rings.forEach((r, ri) => {
      const n = counts[ri];
      for (let j = 0; j < n; j++) {
        // Positions are spread by arc length, not by angle, so the long sides are not sparse.
        candidates.push({ ring: ri, theta: arcAngle(r, (j + (ri % 2) * 0.5) / n) });
      }
    });

    // Drop any card that would ever crowd another during a full turn. The rings turn together, so
    // one turn covers every arrangement that will ever be seen.
    const keep = [];
    const pos = (s, phase) => {
      const r = rings[s.ring];
      const t = s.theta + phase;
      const sc = scaleOf(s.ring, depthOf(t));
      return { x: r.rx * Math.cos(t), y: r.ry * Math.sin(t), hw: (cw * sc) / 2, hh: (ch * sc) / 2 };
    };
    for (const c of candidates) {
      let ok = true;
      for (let i = 0; i < SAMPLES && ok; i++) {
        const phase = (i / SAMPLES) * Math.PI * 2;
        const p = pos(c, phase);
        for (const o of keep) {
          const q = pos(o, phase);
          // Same ring: never touch. Neighbouring rings: may tuck under by OVERLAP of a card.
          const k = o.ring === c.ring ? 1 : 1 - OVERLAP;
          if (Math.abs(p.x - q.x) < (p.hw + q.hw) * k + 4 && Math.abs(p.y - q.y) < (p.hh + q.hh) * k + 4) { ok = false; break; }
        }
      }
      if (ok) keep.push(c);
    }
    slots = keep.map((s, i) => ({ ...s, i, card: cards[i] }));
    cards.forEach((c, i) => { c.hidden = i >= slots.length; });

    paths.setAttribute('viewBox', `0 0 ${W} ${H}`);
    paths.replaceChildren(...rings.map((r) => {
      const e = document.createElementNS(NS, 'ellipse');
      for (const [key, v] of Object.entries({ cx: x0, cy: y0, rx: r.rx, ry: r.ry })) e.setAttribute(key, String(v));
      return e;
    }));
  }

  // The angle at a given fraction of an ellipse's length, so cards sit evenly along it.
  function arcAngle(r, fraction) {
    const steps = 240;
    const lens = [0];
    for (let i = 1; i <= steps; i++) {
      const a0 = ((i - 1) / steps) * Math.PI * 2, a1 = (i / steps) * Math.PI * 2;
      lens.push(lens[i - 1] + Math.hypot(r.rx * (Math.cos(a1) - Math.cos(a0)), r.ry * (Math.sin(a1) - Math.sin(a0))));
    }
    const target = (((fraction % 1) + 1) % 1) * lens[steps];
    let i = 1;
    while (i < steps && lens[i] < target) i++;
    const f = (target - lens[i - 1]) / (lens[i] - lens[i - 1] || 1);
    return ((i - 1 + f) / steps) * Math.PI * 2 - Math.PI / 2; // start at the top
  }

  // ---------- Physics ----------
  // Each card is a body pulled by a spring toward its spot on the turning rings. On top of that:
  // cards that actually collide push apart and trade a little momentum, the pointer leaves a soft
  // wake, and a card can be picked up, thrown into the others, and left to find its way home.
  const K = 26;                         // spring toward home (per s^2)
  const DAMP = 2 * Math.sqrt(K) * 0.62; // just under critical: a small, friendly overshoot
  const WAKE = 150;                     // pointer wake radius, px
  const WAKE_FORCE = 2600;              // px/s^2 at the centre of the wake
  const BODY = 0.68;                    // collision box, as a share of the card (rings tuck under at rest)
  const BOUNCE = 0.35;
  // The menu button sits in a soft cushion: a card that drifts into it is eased aside by a spring,
  // so it glides around the button rather than being shoved, and a fast throw still bounces off.
  // The cushion is a little wider than the clear space, so cards rest just short of the button.
  const NAV_CLEAR = 6;                  // space that is never crossed, px
  const NAV_CUSHION = 26;               // where the cushion starts, px from the button's edge
  const NAV_K = 320;                    // cushion stiffness (per s^2); much stiffer than the pull home
  const NAV_DAMP = 2 * Math.sqrt(NAV_K + K) * 0.35; // damping inside the cushion: one soft bounce
  const NAV_LIFT = 1.08;                // room for a card's lean, turn and hover lift
  const MAX_V = 2600;
  // A hovered card makes room: the cards round it fan out from its centre, the nearest most, and
  // any it would touch at its lifted size ease back until there is PART_GAP of clear space. They
  // drift home when the pointer leaves.
  const PART_GAP = 18;                  // clear space around a hovered card, px
  const PART_K = 140;                   // how firmly touching neighbours make room (per s^2), against K home
  const PART_FAN = 28;                  // how far the nearest neighbours lean away, px
  const PART_FAN_K = 120;               // extra stiffness of the fan spring (per s^2), so it settles quickly
  const PART_REACH = 2;                 // fan reach, in touching distances (1 = edges meet)
  const mouse = { x: -1e4, y: -1e4, inside: false };
  let drag = null;                      // { s, dx, dy, x, y, vx, vy, moved, t }
  let nav = null;                       // the menu button as a circle on the hero, measured each frame
  let suppressClick = false;

  function homeOf(s) {
    const r = geo.rings[s.ring];
    const t = s.theta + geo.omega * elapsed;
    const depth = depthOf(t);
    const reach = 4 + 4 * s.ring + 4 * depth;
    return { x: geo.x0 + r.rx * Math.cos(t) + pointer.x * reach, y: geo.y0 + r.ry * Math.sin(t) + pointer.y * reach * 0.7, t, depth, ex: r.rx * Math.cos(t), r };
  }

  // The menu button is fixed to the window, so its place on the hero changes as the page scrolls.
  // Measured once a frame. It stays solid while the menu is open, so nothing jumps when it closes.
  function navObstacle() {
    const btn = document.querySelector('.menu-toggle');
    const r = btn?.getBoundingClientRect();
    if (!r?.width) return null;
    const hr = hero.getBoundingClientRect();
    return { x: r.left - hr.left + r.width / 2, y: r.top - hr.top + r.height / 2, r: Math.max(r.width, r.height) / 2 };
  }

  // Where a card's box is relative to the button: the distance from the button's edge to the
  // nearest point of the box (negative when they overlap) and the direction to push the card. The
  // direction comes from the nearest point, or from the centres once the button is inside the box,
  // so it turns smoothly as a card slides past.
  function navContact(b) {
    const grow = NAV_LIFT * (b.grow ?? 1); // b.hw is the resting size; a lifted or held card is drawn larger
    const hw = b.hw * grow, hh = b.hh * grow;
    const dx = Math.max(b.x - hw - nav.x, 0, nav.x - b.x - hw) * Math.sign(b.x - nav.x);
    const dy = Math.max(b.y - hh - nav.y, 0, nav.y - b.y - hh) * Math.sign(b.y - nav.y);
    const d = Math.hypot(dx, dy);
    if (d > 0.5) return { gap: d - nav.r, nx: dx / d, ny: dy / d };
    const cx = b.x - nav.x, cy = b.y - nav.y, c = Math.hypot(cx, cy) || 1;
    // Inside: how far the card must still travel along that line to clear the button.
    const along = Math.min(hw / Math.max(Math.abs(cx / c), 1e-3), hh / Math.max(Math.abs(cy / c), 1e-3));
    return { gap: c - along - nav.r, nx: cx / c, ny: cy / c };
  }

  // The cushion's push (as acceleration) and the hard limit. A held card is only kept clear.
  function pushFromNav(b, dt, held) {
    if (!nav) return;
    const k = navContact(b);
    if (!held && k.gap < NAV_CUSHION) {
      const vn = b.vx * k.nx + b.vy * k.ny;
      const a = NAV_K * (NAV_CUSHION - k.gap) - (vn < 0 ? NAV_DAMP * vn : 0);
      b.vx += k.nx * a * dt; b.vy += k.ny * a * dt;
    }
    if (k.gap < NAV_CLEAR) {
      const push = NAV_CLEAR - k.gap;
      b.x += k.nx * push; b.y += k.ny * push;
      const vn = b.vx * k.nx + b.vy * k.ny;
      if (!held && vn < 0) { b.vx -= 1.4 * vn * k.nx; b.vy -= 1.4 * vn * k.ny; } // a hard hit: bounce back at 40%
    }
  }

  function step(dt) {
    const { cw, ch, cr } = geo;
    const lifted = drag ? [] : slots.filter((x) => x.lift > 0.02 && x.body); // usually one; two while hover passes between cards
    for (const s of slots) {
      const b = s.body;
      if (drag?.s === s) continue;
      const home = homeOf(s);
      let ax = K * (home.x - b.x) - DAMP * b.vx;
      let ay = K * (home.y - b.y) - DAMP * b.vy;
      if (mouse.inside && !drag && !hover) { // no wake while a card is hovered: the field rests while you read
        const dx = b.x - mouse.x, dy = b.y - mouse.y;
        const d = Math.hypot(dx, dy);
        if (d < WAKE && d > 0.01) {
          const f = WAKE_FORCE * (1 - d / WAKE) ** 2;
          ax += (dx / d) * f; ay += (dy / d) * f;
        }
      }
      for (const l of lifted) {
        if (l === s) continue;
        const h = l.body, grow = 1 + 0.12 * l.lift;
        const dx = b.x - h.x, dy = b.y - h.y;
        const ox = h.hw * grow + b.hw + PART_GAP - Math.abs(dx);
        const oy = h.hh * grow + b.hh + PART_GAP - Math.abs(dy);
        // Distance in touching distances, so a card beside it moves sideways, one above it moves
        // up, and a corner card moves out diagonally.
        const q = Math.hypot(dx / (h.hw + b.hw), dy / (h.hh + b.hh));
        if (q >= PART_REACH || q < 1e-3) continue;
        const nx = dx / (h.hw + b.hw) / q, ny = dy / (h.hh + b.hh) / q;
        const w = Math.min(1, (PART_REACH - q) / (PART_REACH - 1));
        const touching = ox > 0 && oy > 0;
        // The fan moves the card's resting spot out by up to PART_FAN, on a stiffer spring than
        // the pull home (K + kx) so it settles in about half a second; a card it would touch is
        // pushed further, until the gap is clear.
        const reach = w * w * (3 - 2 * w) * l.lift;
        const kx = PART_FAN_K * reach;
        const off = PART_FAN * reach;
        const along = (b.x - home.x) * nx + (b.y - home.y) * ny; // how far it already sits out
        let f = (K + kx) * off - kx * along;
        if (touching) f += PART_K * Math.min(ox, oy) * l.lift;
        ax += nx * f; ay += ny * f;
        // Damp a parting card to just under critical for the stiffer pull, so it glides out and
        // stops rather than bouncing, and the field is still while the card is read.
        const extra = (2 * Math.sqrt(K + kx + (touching ? PART_K * l.lift : 0)) * 0.95 - DAMP) * Math.max(reach, touching ? l.lift : 0);
        const vn = b.vx * nx + b.vy * ny; // only along the push: sideways it keeps its usual spring
        ax -= extra * vn * nx; ay -= extra * vn * ny;
      }
      b.vx += ax * dt; b.vy += ay * dt;
    }
    // Collisions between cards: only real contact counts, so the resting layout never jitters.
    for (let i = 0; i < slots.length; i++) {
      const p = slots[i].body;
      for (let j = i + 1; j < slots.length; j++) {
        const q = slots[j].body;
        const ox = (p.hw + q.hw) * BODY - Math.abs(p.x - q.x);
        const oy = (p.hh + q.hh) * BODY - Math.abs(p.y - q.y);
        if (ox <= 0 || oy <= 0) continue;
        const pinnedP = drag?.s === slots[i], pinnedQ = drag?.s === slots[j];
        const wp = pinnedP ? 0 : pinnedQ ? 1 : 0.5, wq = pinnedQ ? 0 : pinnedP ? 1 : 0.5;
        if (ox < oy) {
          const sx = Math.sign(p.x - q.x) || 1;
          p.x += sx * ox * wp; q.x -= sx * ox * wq;
          const rel = p.vx - q.vx;
          if (rel * sx < 0) { const imp = -(1 + BOUNCE) * rel / 2; p.vx += imp * (wp ? 1 : 0); q.vx -= imp * (wq ? 1 : 0); }
        } else {
          const sy = Math.sign(p.y - q.y) || 1;
          p.y += sy * oy * wp; q.y -= sy * oy * wq;
          const rel = p.vy - q.vy;
          if (rel * sy < 0) { const imp = -(1 + BOUNCE) * rel / 2; p.vy += imp * (wp ? 1 : 0); q.vy -= imp * (wq ? 1 : 0); }
        }
      }
    }
    // The heading and search are solid: cards bounce off them rather than slide underneath.
    const bx0 = cr.x, by0 = cr.y, bx1 = cr.x + cr.width, by1 = cr.y + cr.height;
    for (const s of slots) {
      const b = s.body;
      if (drag?.s === s) continue;
      const ox = Math.min(b.x + b.hw - bx0, bx1 - (b.x - b.hw));
      const oy = Math.min(b.y + b.hh - by0, by1 - (b.y - b.hh));
      if (ox > 0 && oy > 0) {
        if (ox < oy) { const sx = b.x < (bx0 + bx1) / 2 ? -1 : 1; b.x += sx * ox; if (b.vx * sx < 0) b.vx *= -BOUNCE; }
        else { const sy = b.y < (by0 + by1) / 2 ? -1 : 1; b.y += sy * oy; if (b.vy * sy < 0) b.vy *= -BOUNCE; }
      }
      b.vx = Math.max(-MAX_V, Math.min(MAX_V, b.vx)); b.vy = Math.max(-MAX_V, Math.min(MAX_V, b.vy));
      pushFromNav(b, dt, false);
      b.x += b.vx * dt; b.y += b.vy * dt;
    }
    if (drag) pushFromNav(drag.s.body, dt, true);
  }

  // Hover lift, pick-up and tilt are eased here, in the same frame as the motion, rather than by
  // CSS transitions: a transition restarted every frame lags behind the position and the card
  // visibly shakes. `amount` is the share of the way to the target covered this frame.
  function ease(s, amount) {
    const card = s.card;
    const held = drag?.s === s && card.classList.contains('held');
    const lifted = !held && !field.classList.contains('holding') && card.matches(':hover, :focus-visible');
    s.lift += ((lifted ? 1 : 0) - s.lift) * amount;
    s.hold += ((held ? 1 : 0) - s.hold) * amount;
    // Tilt toward the pointer while it is over the card, measured on the card's untransformed box.
    let tx = 0, ty = 0;
    if (lifted && mouse.inside && card.matches(':hover')) {
      tx = Math.max(-0.5, Math.min(0.5, (mouse.x - s.body.x) / (2 * s.body.hw)));
      ty = Math.max(-0.5, Math.min(0.5, (mouse.y - s.body.y) / (2 * s.body.hh)));
    }
    s.tx += (tx - s.tx) * amount; s.ty += (ty - s.ty) * amount;
  }

  function paint(amount = 1) {
    if (!geo) return;
    const { cw } = geo;
    for (const s of slots) {
      const home = homeOf(s);
      const b = s.body;
      const scale = scaleOf(s.ring, home.depth);
      b.hw = (cw * scale) / 2; b.hh = (b.h * scale) / 2;
      const st = s.card.style;
      st.translate = `${(b.x - cw / 2).toFixed(1)}px ${(b.y - b.h / 2).toFixed(1)}px`;
      st.setProperty('--ds', scale.toFixed(3));
      const moving = raf !== 0;
      if (moving) ease(s, amount);
      const flat = 1 - (moving ? s.lift : 0);
      if (moving) {
        const drawn = (scale + (1.12 - scale) * s.lift) * (1 + 0.08 * s.hold);
        b.grow = drawn / scale;
        st.scale = drawn.toFixed(4);
        st.rotate = `${(baseRot[s.i] * (1 - Math.max(s.lift, s.hold))).toFixed(3)}deg`;
        st.setProperty('--rx', `${(-s.ty * 6).toFixed(2)}deg`);
        st.setProperty('--ry', `${(s.tx * 6).toFixed(2)}deg`);
        st.setProperty('--gx', `${(-s.tx * 6).toFixed(1)}px`);
        st.setProperty('--gy', `${(-s.ty * 6).toFixed(1)}px`);
      }
      const near = ringCount > 1 ? s.ring / (ringCount - 1) : 1;
      st.setProperty('--do', (0.88 + 0.06 * near + 0.06 * home.depth).toFixed(3)); // a light fog that keeps small text readable (WCAG AA)
      st.zIndex = drag?.s === s ? '400' : String(10 + s.ring * 10); // fixed per ring; a held card is on top
      // Momentum shows as a little wobble: cards lean into their motion and settle flat.
      const spin = Math.max(-14, Math.min(14, b.vx * 0.012));
      const pitch = Math.max(-10, Math.min(10, -b.vy * 0.01));
      st.setProperty('--spin', `${spin.toFixed(2)}deg`);
      st.setProperty('--lean', `${(((1 - home.depth) * 6 + pitch) * flat).toFixed(2)}deg`);
      st.setProperty('--turn', `${(-(home.ex / home.r.rx) * 8 * flat).toFixed(2)}deg`);
      st.setProperty('--blur', '0px');
      st.setProperty('--d', (0.35 + 0.65 * near).toFixed(3));
    }
  }

  function place() {
    for (const s of slots) {
      const home = homeOf(s);
      s.body = { x: home.x, y: home.y, vx: 0, vy: 0, h: s.card.offsetHeight, hw: geo.cw / 2, hh: s.card.offsetHeight / 2 };
      s.lift ??= 0; s.hold ??= 0; s.tx ??= 0; s.ty ??= 0;
    }
    nav = navObstacle();
    if (nav) for (const s of slots) for (let i = 0; i < 4; i++) pushFromNav(s.body, 0, true); // start (and, with reduced motion, stay) clear of it
  }

  function frame(now) {
    if (stopped) return;
    if (last !== null && !document.hidden) {
      // Ease to a stop on hover and back up afterwards, rather than freezing and lurching.
      pace += ((hover && !drag ? 0 : 1) - pace) * 0.08;
      if (pace < 0.002) pace = 0;
      const dt = Math.min(now - last, 50) / 1000;
      elapsed += dt * pace;
      pointer.x += (pointer.tx - pointer.x) * 0.035 * pace;
      pointer.y += (pointer.ty - pointer.y) * 0.035 * pace;
      const n = Math.max(1, Math.ceil(dt / (1 / 120)));
      nav = navObstacle();
      for (let i = 0; i < n; i++) step(dt / n);
    }
    const amount = last === null ? 1 : 1 - Math.exp(-Math.min(now - last, 50) / 90); // about 0.3s to settle
    last = now;
    hero.style.backgroundPosition = `calc(50% + ${(pointer.x * -3).toFixed(1)}px) calc(50% + ${(pointer.y * -3).toFixed(1)}px)`; // the farthest layer moves least, the other way
    paint(amount);
    raf = requestAnimationFrame(frame);
  }

  function setup() {
    cancelAnimationFrame(raf);
    raf = 0;
    last = null;
    field.classList.remove('moving');
    for (const c of cards) { c.style.scale = ''; c.style.rotate = ''; for (const v of ['--rx', '--ry', '--gx', '--gy']) c.style.removeProperty(v); }
    if (small.matches) {
      for (const c of cards) { c.style.translate = ''; c.style.zIndex = ''; for (const v of ['--ds', '--do', '--lean', '--turn', '--blur', '--d', '--spin']) c.style.removeProperty(v); c.hidden = false; }
      paths.replaceChildren();
      field.classList.add('ready');
      return;
    }
    measure();
    if (geo) place();
    paint();
    field.classList.add('ready');
    if (!still.matches) { field.classList.add('moving'); raf = requestAnimationFrame(frame); }
  }

  const setHover = (on) => { hover = on; field.toggleAttribute('data-paused', on); };
  field.addEventListener('pointerover', (e) => { if (e.target.closest('.orbit-card')) setHover(true); });
  field.addEventListener('pointerout', (e) => { if (!e.relatedTarget?.closest?.('.orbit-card')) setHover(false); });
  field.addEventListener('focusin', () => setHover(true));
  field.addEventListener('focusout', (e) => { if (!field.contains(e.relatedTarget)) setHover(false); });
  const onPointer = (e) => {
    if (e.pointerType !== 'mouse') return;
    pointer.tx = Math.max(-1, Math.min(1, (e.clientX / innerWidth) * 2 - 1));
    pointer.ty = Math.max(-1, Math.min(1, (e.clientY / innerHeight) * 2 - 1));
  };
  hero.addEventListener('pointermove', onPointer);

  // Pick up, drag and throw. A press that barely moves is still a click and opens the card.
  let hoverCard = null;
  field.addEventListener('pointerover', (e) => { hoverCard = e.target.closest?.('.orbit-card') ?? null; });
  field.addEventListener('pointerout', (e) => { if (!e.relatedTarget?.closest?.('.orbit-card')) hoverCard = null; });
  const local = (e) => { const r = hero.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  field.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.orbit-card');
    if (!card || !geo || still.matches || e.button !== 0) return;
    const s = slots.find((x) => x.card === card);
    if (!s) return;
    const p = local(e);
    drag = { s, dx: s.body.x - p.x, dy: s.body.y - p.y, x: p.x, y: p.y, moved: 0, t: performance.now(), id: e.pointerId };
    s.body.vx = 0; s.body.vy = 0;
  });
  // A click on empty background sends a soft ripple through the cards: a fading ring, and a push
  // outward that fades with distance. The springs bring every card home again.
  const RIPPLE = 380;
  const onRipple = (e) => {
    if (!geo || still.matches || e.button !== 0 || drag) return;
    if (e.target.closest('.orbit-card, .center, a, button, input, .menu-toggle, dialog, nav')) return;
    const p = local(e);
    for (const s of slots) {
      const b = s.body;
      const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy);
      if (d > RIPPLE || d < 1) continue;
      const kick = 520 * (1 - d / RIPPLE) ** 1.5;
      b.vx += (dx / d) * kick; b.vy += (dy / d) * kick;
    }
    const ring = document.createElement('span');
    ring.className = 'ripple';
    ring.setAttribute('aria-hidden', 'true');
    ring.style.left = `${p.x}px`; ring.style.top = `${p.y}px`;
    hero.append(ring);
    ring.addEventListener('animationend', () => ring.remove());
  };
  hero.addEventListener('pointerdown', onRipple);
  const onDragMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = local(e);
    const now = performance.now();
    const dt = Math.max(1, now - drag.t) / 1000;
    drag.moved += Math.hypot(p.x - drag.x, p.y - drag.y);
    if (drag.moved > 6 && !drag.s.card.classList.contains('held')) {
      drag.s.card.classList.add('held');
      field.classList.add('holding');
      try { drag.s.card.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    const b = drag.s.body;
    // Follow the pointer; the velocity is smoothed so a flick throws as hard as it looks.
    const vx = (p.x - drag.x) / dt, vy = (p.y - drag.y) / dt;
    b.vx = b.vx * 0.6 + vx * 0.4; b.vy = b.vy * 0.6 + vy * 0.4;
    b.x = p.x + drag.dx; b.y = p.y + drag.dy;
    drag.x = p.x; drag.y = p.y; drag.t = now;
  };
  const onDragEnd = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.moved > 6) {
      suppressClick = true;
      // A held card that has not moved for a moment is set down, not thrown.
      if (performance.now() - drag.t > 80) { drag.s.body.vx = 0; drag.s.body.vy = 0; }
    }
    drag.s.card.classList.remove('held');
    field.classList.remove('holding');
    drag = null;
  };
  addEventListener('pointermove', onDragMove);
  addEventListener('pointerup', onDragEnd);
  addEventListener('pointercancel', onDragEnd);
  field.addEventListener('click', (e) => { if (suppressClick) { e.preventDefault(); e.stopPropagation(); suppressClick = false; } }, true);
  field.addEventListener('dragstart', (e) => e.preventDefault()); // no ghost image of the link
  hero.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { const p = local(e); mouse.x = p.x; mouse.y = p.y; mouse.inside = true; } });
  hero.addEventListener('pointerleave', () => { mouse.inside = false; });

  const ro = new ResizeObserver(() => { measure(); if (geo) place(); paint(); });
  ro.observe(hero);
  ro.observe(center);
  small.addEventListener('change', setup);
  still.addEventListener('change', setup);
  document.fonts?.ready.then(() => { if (!stopped) { measure(); if (geo) place(); paint(); } });
  setup();

  return () => {
    stopped = true;
    paths.remove();
    cancelAnimationFrame(raf);
    ro.disconnect();
    hero.removeEventListener('pointermove', onPointer);
    hero.removeEventListener('pointerdown', onRipple);
    removeEventListener('pointermove', onDragMove);
    removeEventListener('pointerup', onDragEnd);
    removeEventListener('pointercancel', onDragEnd);
    small.removeEventListener('change', setup);
    still.removeEventListener('change', setup);
  };
}
