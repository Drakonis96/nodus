import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Each vault type repaints the app's indigo accent into its own colour by overriding the
// utility classes in index.css (`.docencia .bg-indigo-600 { … }`). That trick has one
// blind spot, and the teaching vault shipped with it: Tailwind emits a dark utility as
// `.dark .dark\:bg-indigo-600`, so a rule written against `.bg-indigo-600` never matches
// an element whose class is `dark:bg-indigo-600`. The remap silently did nothing and the
// surface stayed blue in dark mode — the kind of miss that is invisible in review because
// the stylesheet *looks* like it covers the colour.
//
// This test closes that gap: for every accent utility the app uses behind `dark:`, if a
// vault declares a base remap for that same utility, it must also declare the dark
// variant. Deliberately NOT asserted: that every `dark:` accent has a remap at all —
// plenty are neutral or semantic (emerald for success, amber for warnings) and must stay
// their own colour.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(repoRoot, 'src', 'index.css'), 'utf8');

const VAULTS = ['genealogy', 'estudio', 'docencia', 'databases'];
const unescape = (s) => s.replace(/\\/g, '');

/** Base remaps: `.docencia .bg-indigo-600 { … }` → key `docencia|bg-indigo-600`. */
const baseRemaps = new Set();
for (const m of css.matchAll(/^\.(genealogy|estudio|docencia|databases) \.([^\s{]+?)(?::hover)?\s*\{/gm)) {
  baseRemaps.add(`${m[1]}|${unescape(m[2])}`);
}

/** Dark remaps, in either selector order (`.docencia.dark …` / `.dark.docencia …`). */
const darkRemaps = new Set();
for (const m of css.matchAll(/^\.(?:(\w+)\.dark|dark\.(\w+)) \.([^\s{]+?)(?::hover)?\s*\{/gm)) {
  darkRemaps.add(`${m[1] ?? m[2]}|${unescape(m[3])}`);
}

/** Accent utilities the renderer actually uses behind a `dark:` prefix. */
const usedDark = new Set(
  execFileSync(
    'grep',
    ['-rhoE', 'dark:(hover:)?(bg|text|border|ring)-(indigo|teal)-[0-9]+(/[0-9]+)?', 'src/', '--include=*.tsx'],
    { cwd: repoRoot, encoding: 'utf8' },
  ).trim().split('\n'),
);

test('every vault accent remap also covers its dark: variant', () => {
  const missing = [];
  for (const vault of VAULTS) {
    for (const darkUtil of [...usedDark].sort()) {
      const util = darkUtil.slice('dark:'.length);
      if (!baseRemaps.has(`${vault}|${util}`)) continue; // vault does not theme this utility
      if (darkRemaps.has(`${vault}|${darkUtil}`)) continue;
      missing.push(`.${vault} remaps ${util} but not ${darkUtil}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `Vault accents that stay indigo in dark mode:\n  ${missing.join('\n  ')}\n\n` +
      'Add `.<vault>.dark .<escaped dark utility> { … }` next to the generated block in ' +
      'src/index.css, copying the declaration from the vault\'s own base rule.',
  );
});

test('no vault is missing an indigo remap its siblings all declare', () => {
  // All four vaults repaint the same default indigo accent, so the utility sets should
  // match. When one lags behind, that utility keeps rendering blue in that vault only —
  // how `.estudio` ended up with indigo borders on panels every other vault had themed.
  // Scoped to indigo: the teal remaps are docencia-only by design (it reuses study views).
  const perVault = new Map(VAULTS.map((vault) => [vault, new Set()]));
  for (const key of baseRemaps) {
    const [vault, util] = key.split('|');
    if (util.includes('indigo-')) perVault.get(vault).add(util);
  }
  const everywhere = [...new Set([...perVault.values()].flatMap((s) => [...s]))];
  const gaps = [];
  for (const util of everywhere.sort()) {
    const without = VAULTS.filter((vault) => !perVault.get(vault).has(util));
    if (without.length && without.length < VAULTS.length - 1) {
      gaps.push(`${util} is remapped by every vault except ${without.join(', ')}`);
    }
  }
  assert.deepEqual(gaps, [], `Accent utilities missing from some vaults:\n  ${gaps.join('\n  ')}`);
});

test('themed vaults recolour the shared .input focus ring', () => {
  // `.input` bakes `focus:border-indigo-500` into its own rule via @apply, so it lands as
  // `.input:focus` and no utility-class remap can reach it. Each vault needs an explicit
  // override or every form field flashes indigo inside an otherwise themed surface.
  const missing = VAULTS.filter((vault) => !new RegExp(`^\\.${vault} \\.input:focus\\s*\\{`, 'm').test(css));
  assert.deepEqual(missing, [], `Vaults with an indigo focus ring: ${missing.join(', ')}`);
});
