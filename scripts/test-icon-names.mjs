// An icon Nodus does not own draws nothing at all.
//
// `Icon` looks its name up in ICON_PATHS and returns null when it misses, so a
// component that asks for a glyph the set never had does not fail loudly: the button
// still lays out, still clicks, and simply arrives blank. GapsView shipped its
// "Siguiente" that way — no arrow, beside an "Anterior" that had one — and the sweep
// that followed found the same silence in eighteen more places.
//
// The prop is typed `keyof typeof ICON_PATHS | string`, because callers legitimately
// compute a name at runtime, so the compiler has nothing to check here. What can
// still be checked is every name written down as a literal, in the three ways the
// renderer writes one: on the tag, in the branch of a computed name, and in the
// metadata rows that feed `<Icon name={item.icon} />`.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSource } from './ipc-channel-census.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every glyph the renderer can actually draw: the keys of ICON_PATHS. */
function iconSet() {
  const source = readSource('src/components/ui.tsx');
  const start = source.indexOf('const ICON_PATHS');
  const end = source.indexOf('export const ICON_NAMES');
  assert.ok(start >= 0 && end > start, 'ICON_PATHS is no longer where this test reads it');
  const names = [...source.slice(start, end).matchAll(/^ {2}([A-Za-z0-9]+):/gm)].map((match) => match[1]);
  assert.ok(names.length >= 100, `the icon set looks truncated: ${names.length} entries`);
  return new Set(names);
}

/** Every TypeScript source under the given repo-relative roots. */
function sources(...roots) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
      const relative = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(relative);
      else if (/\.tsx?$/.test(entry.name)) found.push({ file: relative, code: readFileSync(path.join(repoRoot, relative), 'utf8') });
    }
  };
  for (const root of roots) walk(root);
  assert.ok(found.length >= 100, `only ${found.length} sources found under ${roots.join(', ')}`);
  return found;
}

/** From an opening bracket, the index of the one that closes it. Quoted text does not nest. */
function closes(code, start, open, close) {
  let depth = 0;
  let quote = '';
  for (let i = start; i < code.length; i++) {
    const character = code[i];
    if (quote) {
      if (character === '\\') i++;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'" || character === '`') quote = character;
    else if (character === open) depth++;
    else if (character === close && --depth === 0) return i;
  }
  return -1;
}

/** Every `<Icon …>` tag, whole. Reading tag by tag is what keeps a multi-line tag —
 * or one sitting inside another element's expression — from being read as its
 * neighbour's, which is how a name could otherwise go unchecked. */
function iconTags(code) {
  const tags = [];
  for (const open of code.matchAll(/<Icon\b/g)) {
    let quote = '';
    let end = -1;
    for (let i = open.index + 5; i >= 0 && i < code.length; i++) {
      const character = code[i];
      if (quote) {
        if (character === '\\') i++;
        else if (character === quote) quote = '';
        continue;
      }
      if (character === '"' || character === "'" || character === '`') quote = character;
      else if (character === '{') i = closes(code, i, '{', '}');
      else if (character === '>') { end = i; break; }
    }
    tags.push({ index: open.index, text: end < 0 ? '' : code.slice(open.index, end + 1) });
  }
  return tags;
}

/** What a tag names: `{ literal }` when written out, `{ expr }` when computed. */
function iconName(tag) {
  const at = tag.text.search(/\sname=/);
  if (at < 0) return null;
  const value = tag.text.slice(at + 6);
  if (value[0] === '"') return { literal: value.slice(1, value.indexOf('"', 1)) };
  if (value[0] !== '{') return null;
  const shut = closes(value, 0, '{', '}');
  return shut < 0 ? null : { expr: value.slice(1, shut) };
}

/** The literals a computed name can resolve TO, as against the ones it tests.
 *
 * The computed form is nearly always a ternary or a fallback — `speaking ? 'x' :
 * 'volume'`, `db.icon || 'table'` — with the icon sitting in a branch. The value being
 * compared (`status === 'running' ? …`) and an argument (`action.includes('thumbnail')`)
 * are not icons and must not be read as ones, so a literal counts only where the token
 * before it hands it a branch. */
function branchLiterals(expr) {
  const names = [];
  for (const literal of expr.matchAll(/['"]([A-Za-z0-9_-]+)['"]/g)) {
    const before = expr.slice(0, literal.index).trimEnd();
    const hands = before === '' || before.endsWith('?') || before.endsWith(':') || before.endsWith('||') || before.endsWith('??') || before.endsWith('&&');
    if (hands) names.push(literal[1]);
  }
  return names;
}

/** `file:line`, so a failure points at the tag instead of describing it. */
function site(file, code, index) {
  return `${file}:${code.slice(0, index).split('\n').length}`;
}

test('every icon a component asks for by name exists in the set', () => {
  const icons = iconSet();
  const unknown = [];
  const unparsed = [];
  let tags = 0;
  for (const { file, code } of sources('src')) {
    for (const tag of iconTags(code)) {
      tags++;
      const name = iconName(tag);
      // A tag this file cannot read is a hole in the check, not a pass.
      if (!name) { unparsed.push(`${site(file, code, tag.index)} ${JSON.stringify(tag.text.slice(0, 60))}`); continue; }
      const asked = name.literal !== undefined ? [name.literal] : branchLiterals(name.expr);
      for (const icon of asked) {
        if (!icons.has(icon)) unknown.push(`${site(file, code, tag.index)} asks for "${icon}"`);
      }
    }
  }
  assert.deepEqual(unparsed, [], '<Icon> tags this test could not read');
  assert.ok(tags >= 500, `only ${tags} <Icon> tags found: the scan is not reaching the views`);
  assert.deepEqual(unknown, [], 'icons that do not exist, and so render as nothing');
});

// Sections, sidebar rows, catalogues and demo rows all carry their glyph as data and
// hand it to `<Icon name={item.icon} />`, which puts the name a whole file away from
// the tag that draws it. shared/ and electron/ hold catalogues of their own.
test('every icon named in metadata exists in the set', () => {
  const icons = iconSet();
  const unknown = [];
  let named = 0;
  for (const { file, code } of sources('src', 'shared', 'electron')) {
    const written = [
      ...code.matchAll(/\sicon="([A-Za-z0-9-]+)"/g),
      ...code.matchAll(/\bicon: ?['"]([A-Za-z0-9-]+)['"]/g),
    ];
    for (const match of written) {
      // `icon: 'icon'` is a column map in electron/db/, not a request for a glyph —
      // and no glyph is named `icon`, so nothing real hides behind this.
      if (match[1] === 'icon') continue;
      named++;
      if (!icons.has(match[1])) unknown.push(`${site(file, code, match.index)} names "${match[1]}"`);
    }
  }
  assert.ok(named >= 200, `only ${named} icon names found in metadata: the scan is not reaching the catalogues`);
  assert.deepEqual(unknown, [], 'metadata pointing at icons that do not exist');
});

// The two premises the checks above rest on: that a miss is silent, so nothing else
// would report it, and that the exported catalogue is these same keys, so a picker
// can never offer a name this test has not seen.
test('a missing icon stays silent, and ICON_NAMES stays the ICON_PATHS keys', () => {
  const ui = readSource('src/components/ui.tsx');
  assert.match(ui, /const path = ICON_PATHS\[name\];\s*\n\s*if \(!path\) return null;/);
  assert.match(ui, /export const ICON_NAMES = Object\.freeze\(Object\.keys\(ICON_PATHS\)\.sort\(\)\)/);
});
