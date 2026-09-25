import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// page.waitForFunction(fn, arg, options): an options object in the second position is
// passed to the page function as its argument and the wait keeps Playwright's 30 s default.
test('research harnesses give waitForFunction its options, not its argument', () => {
  const scripts = path.join(import.meta.dirname);
  const files = [...fs.readdirSync(scripts).filter(name => /research|zotero-nodus-product/.test(name) && name.endsWith('.mjs')).map(name => path.join(scripts, name)),
    ...fs.readdirSync(path.join(scripts, 'lib')).filter(name => name.startsWith('research-') && name.endsWith('.mjs')).map(name => path.join(scripts, 'lib', name))];
  const misplaced = files.flatMap(file => fs.readFileSync(file, 'utf8').split('\n').map((line, index) => ({ line, index }))
    .filter(({ line }) => /waitForFunction\((\(\)|[a-z]+) => .*\), \{ ?timeout/.test(line)).map(({ index }) => `${path.relative(scripts, file)}:${index + 1}`));
  assert.deepEqual(misplaced, []);
});
