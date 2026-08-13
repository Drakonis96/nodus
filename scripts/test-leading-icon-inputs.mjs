import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function tsxFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return tsxFiles(absolute);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [absolute] : [];
  }));
  return nested.flat();
}

test('inputs reserve effective space for leading icons', async () => {
  const offenders = [];
  for (const file of await tsxFiles(path.join(repoRoot, 'src'))) {
    const source = await readFile(file, 'utf8');
    if (/className="input[^\"]*\bpl-\d/.test(source)) offenders.push(path.relative(repoRoot, file));
  }
  assert.deepEqual(
    offenders,
    [],
    'plain pl-* loses to the shared .input padding; use input-with-leading-icon instead'
  );
});

test('the affected shared searches use the leading-icon contract', async () => {
  for (const file of [
    'src/views/WorkspaceView.tsx',
    'src/views/PrimarySourcesNotesView.tsx',
    'src/views/AuthorsView.tsx',
    'src/views/WorldChatView.tsx',
  ]) {
    const source = await readFile(path.join(repoRoot, file), 'utf8');
    assert.match(source, /input input-with-leading-icon/, `${file} reserves room for its search glyph`);
  }
});
