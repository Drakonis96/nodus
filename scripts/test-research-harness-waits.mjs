import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/** Top-level arguments of the call that starts at `open` (the index of its "("). */
function callArguments(source, open) {
  const args = [];
  let depth = 0, start = open + 1, quote = null;
  for (let index = open; index < source.length; index++) {
    const char = source[index];
    if (quote) { if (char === '\\') index++; else if (char === quote) quote = null; continue; }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if ('([{'.includes(char)) depth++;
    else if (')]}'.includes(char)) { depth--; if (depth === 0) { args.push(source.slice(start, index).trim()); return args; } }
    else if (char === ',' && depth === 1) { args.push(source.slice(start, index).trim()); start = index + 1; }
  }
  return args;
}

// page.waitForFunction(fn, arg, options): an options object in the second position is
// passed to the page function as its argument and the wait keeps Playwright's 30 s default.
test('research harnesses give waitForFunction its options, not its argument', () => {
  const scripts = path.join(import.meta.dirname);
  const files = [...fs.readdirSync(scripts).filter(name => /research|zotero-nodus-product/.test(name) && name.endsWith('.mjs') && name !== path.basename(import.meta.filename)).map(name => path.join(scripts, name)),
    ...fs.readdirSync(path.join(scripts, 'lib')).filter(name => name.startsWith('research-') && name.endsWith('.mjs')).map(name => path.join(scripts, 'lib', name))];
  const misplaced = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\.waitForFunction\(/g)) {
      const args = callArguments(source, match.index + match[0].length - 1);
      if (args.length === 2 && /^\{[^}]*\btimeout\b/.test(args[1])) misplaced.push(`${path.relative(scripts, file)}:${source.slice(0, match.index).split('\n').length}`);
    }
  }
  assert.deepEqual(misplaced, []);
});

test('the scan flags an options object passed as the page function argument', () => {
  const source = "await page.waitForFunction(() => Boolean(x, y), { timeout: 60000 }); await page.waitForFunction(e => e, handle, { timeout: 1 });";
  const found = [...source.matchAll(/\.waitForFunction\(/g)].map(match => callArguments(source, match.index + match[0].length - 1));
  assert.deepEqual(found.map(args => args.length), [2, 3]);
});
