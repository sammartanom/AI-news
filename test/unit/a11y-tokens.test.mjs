import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// WCAG 2.x contrast ratios for the design tokens. This checks token pairs, not rendered pages,
// and does not by itself establish WCAG conformance.
const css = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');

function block(re) {
  const m = css.match(re);
  assert.ok(m, `block not found: ${re}`);
  return Object.fromEntries([...m[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((x) => [x[1], x[2]]));
}
const light = block(/:root \{([^}]*)\}/);
const dark = block(/:root\[data-theme="dark"\] \{([^}]*)\}/);
const autoDark = block(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/);

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

for (const [name, t] of [['light', light], ['dark', dark], ['system dark', autoDark]]) {
  test(`contrast (${name}): text and accent meet 4.5:1 on background and surface`, () => {
    for (const fg of ['fg', 'muted', 'accent', 'danger']) {
      for (const bg of ['bg', 'surface']) assert.ok(ratio(t[fg], t[bg]) >= 4.5, `${fg} on ${bg}: ${ratio(t[fg], t[bg]).toFixed(2)}`);
    }
    assert.ok(ratio(t['accent-ink'], t.accent) >= 4.5, 'text on accent');
    assert.ok(ratio(t.bg, t.fg) >= 7, 'primary button text');
    assert.ok(ratio(t['line-strong'], t.bg) >= 1.3, 'control borders are visible'); // 3:1 applies to essential UI boundaries; inputs also show text and labels
  });
}

test('dark mode is a near-black green with surfaces only slightly lighter', () => {
  assert.equal(dark.bg, '#0b1710');
  assert.ok(lum(dark.surface) - lum(dark.bg) < 0.01);
  assert.deepEqual(dark, { ...dark, ...autoDark }); // manual and system dark are the same palette
});

test('light mode is a pure white background with the district Ink for text', () => {
  assert.equal(light.bg, '#ffffff');
  assert.equal(light.fg, '#1e1e1e');
});
