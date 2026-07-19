// Source files must be valid UTF-8 text with no control characters.
//
// A stray NUL byte once reached a shipped-shape source file: TypeScript compiled it
// without complaint, the build succeeded, and it silently broke a lookup key at runtime
// because one side of a comparison had an invisible separator the other did not. `grep`
// stopped matching the file too, which made it hard to even see. Nothing else in the
// pipeline checks for this, so it is checked here.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/**
 * Files that deliberately use a NUL as a composite-key separator inside a template
 * literal — a legitimate idiom, since NUL cannot occur in the data being joined. They
 * are listed rather than exempted by pattern so a NEW one has to be a decision.
 *
 * That distinction is the point: the bug that prompted this test was a NUL in exactly
 * this idiom, but written at only ONE of the two places that built the key, so the
 * lookup silently never matched. If you add a file here, build the key in a single
 * shared function so the two sides cannot drift apart.
 */
const NUL_SEPARATOR_FILES = new Set([
  'electron/db/ideaDedupe.ts',
  'src/views/graph/lod.ts',
  'shared/stats.ts',
  'electron/export/syncPackage.ts',
]);

const ROOTS = ['electron', 'src', 'shared', 'scripts'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js', '.json', '.css', '.html']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-electron', '.git', 'build']);

async function sourceFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(full)));
    else if (EXTENSIONS.has(path.extname(entry.name))) found.push(full);
  }
  return found;
}

test('every source file is clean UTF-8 text', async () => {
  const files = (await Promise.all(ROOTS.map((root) => sourceFiles(path.join(repoRoot, root))))).flat();
  assert.ok(files.length > 100, `found ${files.length} source files to check`);

  const offenders = [];
  for (const file of files) {
    const bytes = await readFile(file);
    const relative = path.relative(repoRoot, file);

    if (bytes.includes(0) && !NUL_SEPARATOR_FILES.has(relative)) {
      offenders.push(`${relative}: contains a NUL byte`);
      continue;
    }
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      offenders.push(`${relative}: is not valid UTF-8`);
      continue;
    }
    // Control characters other than tab, newline and carriage return have no business
    // in source and are invisible in every editor and diff.
    const control = text.match(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/);
    if (control) {
      const index = text.indexOf(control[0]);
      const line = text.slice(0, index).split('\n').length;
      offenders.push(`${relative}:${line}: control character U+${control[0].codePointAt(0).toString(16).padStart(4, '0')}`);
    }
  }

  assert.deepEqual(offenders, [], `Files with invisible characters:\n  ${offenders.join('\n  ')}`);
});
