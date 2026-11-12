// A small QR code encoder: byte mode, error correction level M, versions 1 to 10 (up to 213
// bytes, plenty for a link). It follows the structure of Project Nayuki's reference
// implementation (MIT). Returns a square boolean matrix; qrSvg draws it with the DOM.

const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26]; // level M, by version
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

const rawModules = (v) => {
  let n = (16 * v + 128) * v + 64;
  if (v >= 2) { const a = Math.floor(v / 7) + 2; n -= (25 * a - 10) * a - 55; if (v >= 7) n -= 36; }
  return n;
};
const dataCodewords = (v) => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[v] * BLOCKS[v];
const bit = (x, i) => ((x >>> i) & 1) !== 0;

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
  return z;
}
function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
    root = gfMul(root, 0x02);
  }
  return r;
}
function rsRemainder(data, divisor) {
  const r = divisor.map(() => 0);
  for (const b of data) {
    const f = b ^ r.shift();
    r.push(0);
    divisor.forEach((c, i) => { r[i] ^= gfMul(c, f); });
  }
  return r;
}

function encodeData(bytes, v) {
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4);
  put(bytes.length, v < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = dataCodewords(v) * 8;
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; out.length < dataCodewords(v); pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

function withEcc(data, v) {
  const blocks = BLOCKS[v];
  const eccLen = ECC_PER_BLOCK[v];
  const raw = Math.floor(rawModules(v) / 8);
  const short = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const div = rsDivisor(eccLen);
  const all = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < short ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < short) dat.push(0);
    all.push(dat.concat(ecc));
  }
  const out = [];
  for (let i = 0; i < all[0].length; i++) {
    all.forEach((b, j) => { if (i !== shortLen - eccLen || j >= short) out.push(b[i]); });
  }
  return out;
}

function alignmentPositions(v, size) {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2;
  const step = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
];

function build(v, codewords, mask) {
  const size = v * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(x, y, d !== 2 && d !== 4);
    }
  }
  const al = alignmentPositions(v, size);
  al.forEach((ax, i) => al.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));

  // Format bits: level M (00) and the mask, BCH-protected.
  const data = mask; // (0 << 3) | mask
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const f = ((data << 10) | rem) ^ 0x5412;
  for (let i = 0; i <= 5; i++) set(8, i, bit(f, i));
  set(8, 7, bit(f, 6)); set(8, 8, bit(f, 7)); set(7, 8, bit(f, 8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(f, i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(f, i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(f, i));
  set(8, size - 8, true);

  if (v >= 7) {
    let r = v;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (v << 12) | r;
    for (let i = 0; i < 18; i++) { const a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, bit(b, i)); set(c, a, bit(b, i)); }
  }

  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (fn[y][x]) continue;
        if (i < codewords.length * 8) { m[y][x] = bit(codewords[i >>> 3], 7 - (i & 7)); i++; }
        if (MASKS[mask](x, y)) m[y][x] = !m[y][x];
      }
    }
  }
  return m;
}

// Penalty rules from the specification, so the chosen mask scans well.
function penalty(m) {
  const size = m.length;
  let p = 0;
  const lines = [...m, ...m[0].map((_, x) => m.map((row) => row[x]))];
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else { if (run >= 5) p += run - 2; run = 1; }
    }
    const s = line.map((d) => (d ? 1 : 0)).join('');
    for (const pat of ['10111010000', '00001011101']) for (let k = s.indexOf(pat); k !== -1; k = s.indexOf(pat, k + 1)) p += 40;
  }
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = m[y][x];
    if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
  }
  const dark = m.flat().filter(Boolean).length;
  p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  return p;
}

export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let v = 1;
  while (v <= 10 && dataCodewords(v) < bytes.length + (v < 10 ? 2 : 3)) v++;
  if (v > 10) throw new RangeError('Too long for a QR code');
  const codewords = withEcc(encodeData(bytes, v), v);
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const m = build(v, codewords, mask);
    const score = penalty(m);
    if (!best || score < best.score) best = { m, score };
  }
  return best.m;
}

// The matrix as one SVG path, with the four-module quiet zone the standard asks for.
export function qrSvg(text, { label } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const m = qrMatrix(text);
  const n = m.length + 8;
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: `0 0 ${n} ${n}`, class: 'qr', role: 'img', 'aria-label': label ?? 'QR code', 'shape-rendering': 'crispEdges' })) svg.setAttribute(k, v);
  const bg = document.createElementNS(NS, 'rect');
  for (const [k, v] of Object.entries({ width: n, height: n, class: 'qr-bg' })) bg.setAttribute(k, String(v));
  let d = '';
  m.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + 4} ${y + 4}h1v1h-1z`; }));
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('class', 'qr-fg');
  svg.append(bg, path);
  return svg;
}
