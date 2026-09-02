import assert from 'node:assert/strict';
import test from 'node:test';
import { THEMES } from '../src/theme/themes.mjs';

// Sanity floor on the curated palettes: body text on the base surface must clear
// WCAG AA (4.5:1) in both modes, and white on the primary-button accent must clear
// 3:1. Not a full audit — just a guard against a palette edit that makes the app
// unreadable.

function luminance(hex) {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

for (const theme of THEMES) {
  test(`${theme.id}: contrast floor`, () => {
    const { n, a } = theme.tokens;
    // Dark mode: bright text (n-100) on deep surface (n-950).
    assert.ok(ratio(n[100], n[950]) >= 4.5, `dark body text ${ratio(n[100], n[950]).toFixed(2)}:1`);
    // Light mode: dark text (n-900) on pale surface (n-50).
    assert.ok(ratio(n[900], n[50]) >= 4.5, `light body text ${ratio(n[900], n[50]).toFixed(2)}:1`);
    // Primary button label.
    assert.ok(ratio('#ffffff', a.dark[600]) >= 3, `dark button ${ratio('#ffffff', a.dark[600]).toFixed(2)}:1`);
    assert.ok(ratio('#ffffff', a.light[600]) >= 3, `light button ${ratio('#ffffff', a.light[600]).toFixed(2)}:1`);
  });
}
