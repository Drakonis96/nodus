// Virtualised card lists — the row pitch must leave a gap between cards.
//
// `VirtualList` gives every row a slot exactly `itemHeight` tall, so a card whose
// fixed height equals the pitch touches the card above and below it: the reading
// path shipped that way (246 / 246) and its blocks had no separation at all. The
// gaps and ideas lists already reserved 12 px, which is the spacing this locks in.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARD_GAP = 12;

const LISTS = [
  { view: 'src/views/ReadingPathView.tsx', rowConstant: 'READING_ENTRY_ROW_HEIGHT' },
  { view: 'src/views/GapsView.tsx', rowConstant: 'GAP_ROW_HEIGHT' },
  { view: 'src/views/IdeasView.tsx', rowConstant: 'IDEA_ROW_HEIGHT' },
];

/** Resolve `const NAME = 246;` or `const NAME = A + B;` from the view's own constants. */
function readRowHeight(source, name) {
  const numbers = new Map();
  for (const [, key, value] of source.matchAll(/^const (\w+) = (\d+);$/gm)) numbers.set(key, Number(value));
  if (numbers.has(name)) return numbers.get(name);
  const sum = source.match(new RegExp(`^const ${name} = (\\w+) \\+ (\\w+);$`, 'm'));
  assert.ok(sum, `${name} is a number or a sum of two constants`);
  const [, left, right] = sum;
  assert.ok(numbers.has(left) && numbers.has(right), `${name} adds two known constants`);
  return numbers.get(left) + numbers.get(right);
}

for (const { view, rowConstant } of LISTS) {
  test(`${path.basename(view)} separates its cards inside the virtual list`, () => {
    const source = fs.readFileSync(path.join(repoRoot, view), 'utf8');
    const rowHeight = readRowHeight(source, rowConstant);
    const cardHeights = [...source.matchAll(/className=[^\n]*?\bcard\b[^\n]*?h-\[(\d+)px\]/g)].map((m) => Number(m[1]));
    const alsoBeforeCard = [...source.matchAll(/className=[^\n]*?h-\[(\d+)px\][^\n]*?\bcard\b/g)].map((m) => Number(m[1]));
    const heights = [...new Set([...cardHeights, ...alsoBeforeCard])];
    assert.equal(heights.length, 1, `${view} has exactly one fixed card height`);

    assert.ok(
      rowHeight > heights[0],
      `${rowConstant} (${rowHeight}) must exceed the ${heights[0]}px card, or the blocks touch`,
    );
    assert.equal(rowHeight - heights[0], CARD_GAP, 'and the gap matches the other lists');
    assert.match(source, new RegExp(`itemHeight=\\{${rowConstant}\\}`), 'the constant is what drives the pitch');
  });
}
