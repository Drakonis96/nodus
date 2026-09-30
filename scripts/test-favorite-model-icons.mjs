import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(repoRoot, 'src/views/ProvidersSettings.tsx'), 'utf8');
const favorites = await readFile(path.join(repoRoot, 'src/components/FavoriteModelAvailability.tsx'), 'utf8');

assert.doesNotMatch(source, /⭐|☆|✕/, 'favorite-model controls use the Nodus icon system, not emoji or glyph characters');
assert.doesNotMatch(favorites, /⭐|☆|✕/, 'favorite chips use the Nodus icon system, not emoji or glyph characters');
assert.match(source, /<FavoriteModelAvailability\s/, 'provider settings render the shared favorite chips');
assert.match(favorites, /<Icon name="star" size=\{12\} className="shrink-0 fill-current text-amber-400"/,
  'favorite chips carry a professional filled star icon');
assert.match(favorites, /<Icon name="x" size=\{10\} \/>/, 'favorite chips use the shared close icon');
assert.match(source, /aria-pressed=\{fav\}[\s\S]*<Icon name="star" size=\{13\} className=\{fav \? 'fill-current' : ''\} \/>/,
  'model rows expose an accessible toggle and fill the icon only when selected');

console.log('Favorite model icon regression test passed.');
