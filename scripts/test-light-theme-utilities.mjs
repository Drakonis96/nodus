import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = await readFile(path.join(repoRoot, 'src/index.css'), 'utf8');

const requiredLightOverrides = [
  '.light .bg-neutral-950\\/25',
  '.light .bg-neutral-950\\/70',
  '.light .bg-indigo-950\\/40',
  '.light .hover\\:bg-neutral-900\\/80:hover',
  '.light .ring-indigo-700\\/60',
  '.light .border-neutral-900',
  '.light .bg-cyan-950\\/30',
  '.light .border-cyan-900',
  '.light .text-cyan-200',
  '.light .bg-neutral-800\\/80',
  '.light .bg-neutral-800\\/50',
  '.light .bg-indigo-900\\/40',
  '.light .hover\\:bg-neutral-900\\/70:hover',
  '.light .hover\\:bg-neutral-700:hover',
  '.light .bg-violet-950\\/15',
  '.light .text-amber-200',
  '.light .bg-red-950\\/20',
  '.light .border-red-900\\/50',
  '.light .bg-teal-900\\/30',
  '.light .text-teal-300',
  '.light .bg-indigo-900\\/30',
  '.light .bg-indigo-950\\/15',
  '.light .bg-emerald-950\\/20',
  '.light .text-emerald-200',
  // The document profile's alert: the title used the plain tone, the body and the issues
  // used the /80 and /70 opacity variants, and none of the three was in the table.
  '.light .text-amber-200\\/70',
  '.light .text-amber-200\\/80',
  '.light .text-amber-300\\/90',
  '.light .border-amber-700\\/60',
  '.light .border-amber-600',
  '.light .bg-amber-950\\/20',
  // The footer strip: bg-neutral-900/30 was not among the opacities the table listed.
  '.light .bg-neutral-900\\/30',
];

for (const selector of requiredLightOverrides) {
  assert.ok(css.includes(selector), `missing light-mode override for ${selector}`);
}

// The list above is hand-written, and that is how the document-profile alert shipped a
// yellow-on-yellow banner: a surface built later used shades of a family the table had only
// covered for the shades the app happened to use first.
//
// Two rules are machine-checked here, and they are the two that produce an unreadable panel
// rather than a merely different one: a light TEXT tone (50–300 of any family) on white, and a
// dark NEUTRAL surface (800–950) under dark text. Coloured SURFACES are not swept: 444 of
// them are still unmapped across 140 files, most of them inside views that are dark on
// purpose, and boiling that ocean needs its own pass.
import { readdir, readFile as readFileText } from 'node:fs/promises';
const walk = async (dir) => {
  const entries = await readdir(path.join(repoRoot, dir), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await walk(relative));
    else if (/\.tsx?$/.test(entry.name)) files.push(relative);
  }
  return files;
};
const sources = await Promise.all((await walk('src')).map((file) => readFileText(path.join(repoRoot, file), 'utf8')));
const patterns = [
  // Light text: invisible on a white surface.
  /(?:^|[\s"'`])(text-(?:neutral|amber|red|emerald|cyan|indigo|violet|sky|blue|green|orange|rose|teal|pink|purple)-(?:50|100|200|300)(?!\d)(?:\/[0-9]+)?)/g,
  // Dark neutral surfaces: they keep a charcoal background under dark text.
  /(?:^|[\s"'`])((?:bg|border|ring)-(?:neutral|slate|zinc|stone|gray)-(?:800|900|950)(?!\d)(?:\/[0-9]+)?)/g,
];
const uncovered = new Set();
for (const source of sources) {
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const utility = match[1];
      if (!css.includes(`.light .${utility.replaceAll('/', '\\/')}`)) uncovered.add(utility);
    }
  }
}
assert.deepEqual(
  [...uncovered].sort(), [],
  `light mode has no override for: ${[...uncovered].sort().join(', ')} — a dark-first tone used by a ` +
  'component must be remapped in src/index.css under .light, or it renders pale on pale'
);

console.log('light theme utility overrides test passed');
