import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-doctypes-'));
const bundle = path.join(outDir, 'archiveDocTypes.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/archiveDocTypes.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);
const dt = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

test('every doc type is well-formed and unique', () => {
  const ids = new Set();
  for (const def of dt.ARCHIVE_DOC_TYPES) {
    assert.ok(def.id && def.label && def.category, `${def.id} complete`);
    assert.ok(Array.isArray(def.fields) && def.fields.length > 0, `${def.id} has fields`);
    assert.ok(!ids.has(def.id), `${def.id} unique`);
    ids.add(def.id);
  }
  // The genealogical staples the user asked for are present.
  for (const id of ['birth_record', 'death_record', 'marriage_record', 'diary', 'memoirs', 'photograph', 'database']) {
    assert.ok(ids.has(id), `${id} present`);
  }
});

test('lookup + grouping by category', () => {
  assert.equal(dt.getArchiveDocType('birth_record').label, 'Partida de nacimiento');
  assert.equal(dt.getArchiveDocType('nope'), null);
  assert.equal(dt.getArchiveDocType(null), null);
  assert.equal(dt.isArchiveDocType('diary'), true);
  assert.equal(dt.isArchiveDocType('xxx'), false);

  const groups = dt.archiveDocTypesByCategory();
  const vital = groups.find((g) => g.category === 'vital');
  assert.ok(vital.types.some((t) => t.id === 'birth_record'));
  // No empty groups leak through.
  assert.ok(groups.every((g) => g.types.length > 0));
});

test('sanitizeDocMetadata keeps defined fields, drops empties + unknown keys', () => {
  const clean = dt.sanitizeDocMetadata('birth_record', {
    persona: '  Juan Pérez  ',
    padre: 'Pedro',
    madre: '   ', // empty after trim → dropped
    inventado: 'x', // not a field of this type → dropped
  });
  assert.deepEqual(clean, { persona: 'Juan Pérez', padre: 'Pedro' });
  assert.deepEqual(dt.sanitizeDocMetadata('unknown', { a: 'b' }), {});
  assert.deepEqual(dt.sanitizeDocMetadata(null, { a: 'b' }), {});
});
