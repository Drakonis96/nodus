// The databases vault is crimson, but it gets there by remapping Tailwind's indigo utilities
// under a `.databases` root class (src/index.css) rather than by owning a palette. So any
// indigo utility a databases surface uses must have a matching remap, or that one element
// silently renders indigo in an otherwise crimson vault — the kind of bug nobody notices in a
// diff and everybody notices on screen.
//
// This test reads the real view and the real stylesheet: add a new indigo class to a databases
// surface without remapping it and this fails, naming the class.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = await readFile(path.join(repoRoot, 'src/index.css'), 'utf8');

/** Surfaces that render inside the `.databases` root class. */
const DATABASES_SURFACES = [
  'src/views/DatabasesView.tsx',
  'src/views/DatabasesAnalysisView.tsx',
  'src/views/DatabasesChatView.tsx',
  'src/views/DatabasesSearchView.tsx',
  'src/components/DatabasesSidebarExplore.tsx',
];

const UTILITY_RE = /(?<![\w-])((?:hover:)?(?:text|bg|border|ring)-indigo-\d{2,3}(?:\/\d{1,3})?)/g;

/** Whether index.css remaps this utility for the databases vault. */
function isRemapped(utility) {
  const escaped = utility.replace(/\//g, '\\/').replace(/:/g, '\\:');
  if (utility.startsWith('hover:')) {
    return css.includes(`.databases .${escaped.replace('hover\\:', 'hover\\:')}:hover`);
  }
  return css.includes(`.databases .${escaped}`);
}

const missing = [];
for (const file of DATABASES_SURFACES) {
  let source;
  try {
    source = await readFile(path.join(repoRoot, file), 'utf8');
  } catch {
    continue; // a surface that does not exist yet is not a failure
  }
  for (const [, utility] of source.matchAll(UTILITY_RE)) {
    if (!isRemapped(utility)) missing.push(`${file}: ${utility}`);
  }
}

assert.deepEqual(
  [...new Set(missing)],
  [],
  `Indigo utilities used on a databases surface with no .databases remap in src/index.css.\n` +
    `Add a rule (e.g. ".databases .bg-indigo-600\\/15 { background-color: rgba(179,3,51,0.15); }")\n` +
    `or use one of the already-remapped utilities:\n  ${[...new Set(missing)].join('\n  ')}`
);

// The remap only applies under the root class, so the class itself has to keep existing.
assert.match(css, /^\.databases \{/m, '.databases root block present');
assert.match(css, /\.databases \.btn-primary/, 'primary buttons are crimson in the databases vault');

console.log(`Databases theme test passed! (every indigo utility on a databases surface is remapped to crimson)`);
