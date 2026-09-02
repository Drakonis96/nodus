import assert from 'node:assert/strict';
import test from 'node:test';
import { THEMES, contrast } from '../src/theme/themes.mjs';

// Sanity floor on the curated palettes. Not a full audit — a guard against a
// palette edit that makes something unreadable.

for (const theme of THEMES) {
  const { n, a } = theme.tokens;
  test(`${theme.id}: dark surfaces`, () => {
    assert.ok(contrast(n[100], n[950]) >= 4.5, `body text ${contrast(n[100], n[950]).toFixed(2)}:1`);
    assert.ok(contrast(n[300], n[900]) >= 3, `muted text on card ${contrast(n[300], n[900]).toFixed(2)}:1`);
  });
  test(`${theme.id}: light surfaces`, () => {
    // Light mode mirrors the ramp: body text = n[900] on n[50]; muted text
    // (text-neutral-400 → n[600]) on a card (n[100]); border = n[200].
    assert.ok(contrast(n[900], n[50]) >= 4.5, `body text ${contrast(n[900], n[50]).toFixed(2)}:1`);
    assert.ok(contrast(n[600], n[100]) >= 3, `muted text ${contrast(n[600], n[100]).toFixed(2)}:1`);
    assert.ok(contrast(n[900], n[100]) >= 4.5, `card body text ${contrast(n[900], n[100]).toFixed(2)}:1`);
  });
  test(`${theme.id}: accent buttons (white label)`, () => {
    for (const mode of ['dark', 'light']) {
      assert.ok(contrast('#ffffff', a[mode][700]) >= 4.5, `${mode} .btn-primary ${contrast('#ffffff', a[mode][700]).toFixed(2)}:1`);
      assert.ok(contrast('#ffffff', a[mode][600]) >= 3.8, `${mode} bg-indigo-600 ${contrast('#ffffff', a[mode][600]).toFixed(2)}:1`);
    }
  });
  test(`${theme.id}: accent text on pale surface (light mode)`, () => {
    assert.ok(contrast(a.light[300], '#ffffff') >= 4.5, `text-indigo-300 ${contrast(a.light[300], '#ffffff').toFixed(2)}:1`);
    assert.ok(contrast(a.light[400], '#ffffff') >= 3.5, `text-indigo-400 ${contrast(a.light[400], '#ffffff').toFixed(2)}:1`);
    assert.ok(contrast(a.light[600], '#ffffff') >= 4.5, `text-indigo-600 ${contrast(a.light[600], '#ffffff').toFixed(2)}:1`);
  });
}
