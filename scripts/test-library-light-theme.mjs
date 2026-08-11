import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const libraryComponents = await readdir(path.join(repoRoot, 'src/components/library'));
const sourcePaths = [
  'src/views/GlobalLibraryView.tsx',
  'src/views/LibraryDocumentReader.tsx',
  ...libraryComponents.filter((file) => file.endsWith('.tsx')).map((file) => `src/components/library/${file}`),
];
const [css, ...sources] = await Promise.all([
  readFile(path.join(repoRoot, 'src/index.css'), 'utf8'),
  ...sourcePaths.map((file) => readFile(path.join(repoRoot, file), 'utf8')),
]);

// The Library was authored dark-first. Every dark surface used by this feature
// must therefore have an explicit light selector, including interactive states;
// otherwise Tailwind's original charcoal colour leaks into light mode.
const utilities = new Set(sources.join('\n').match(/(?:hover:)?(?:bg-(?:neutral|indigo|red|amber|emerald)-(?:900|950)|border-(?:neutral|indigo|red|amber|emerald)-(?:700|800|900))(?:\/[0-9]+)?/g) ?? []);
for (const utility of [...utilities].sort()) {
  const escaped = utility.replaceAll(':', '\\:').replaceAll('/', '\\/');
  const selector = `.light .${escaped}${utility.startsWith('hover:') ? ':hover' : ''}`;
  assert.ok(css.includes(selector), `Library light mode is missing ${selector}`);
}

for (const semanticSelector of [
  '.light .library-theme,',
  '.light .library-theme-canvas,',
  '.light .library-theme-panel',
  '.light .library-reader-empty-card',
  '.light .library-reader-empty-icon',
]) assert.ok(css.includes(semanticSelector), `missing semantic Library surface ${semanticSelector}`);

console.log(`Library light-theme coverage passed for ${utilities.size} dark utilities`);
