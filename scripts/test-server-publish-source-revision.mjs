import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
require.extensions['.ts'] = function loadTs(module, filename) {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  module._compile(output, filename);
};

test('pre-build fingerprint covers every SQLite projection switch', () => {
  const { publishSourceRevision } = require(path.join(repoRoot, 'electron/serverSync/publishSourceRevision.ts'));
  const base = {
    kind: 'classic',
    includeUserContent: true,
    includePassages: true,
    includeLibraryDocuments: false,
    includeVectors: true,
  };
  const revision = publishSourceRevision('12:3:327', base);
  assert.equal(revision, publishSourceRevision('12:3:327', { ...base }));
  for (const changed of [
    { kind: 'cloudflare' },
    { includeUserContent: false },
    { includePassages: false },
    { includeVectors: false },
  ]) {
    assert.notEqual(publishSourceRevision('12:3:327', { ...base, ...changed }), revision);
  }
  assert.notEqual(publishSourceRevision('13:3:327', base), revision, 'any observed SQLite write invalidates the shortcut');
  assert.equal(
    publishSourceRevision('12:3:327', { ...base, includeLibraryDocuments: true }),
    null,
    'external library files bypass the SQLite-only shortcut',
  );
});
