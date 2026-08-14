// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-v4-release-'));

try {
  const [main, recovery, backup, readerPlugin, pluginManifest, serverVersion, sourceOffer, citation, guide, acceptance] = await Promise.all([
    read('electron/main.ts'),
    read('electron/recovery/preV4Recovery.ts'),
    read('electron/export/exportImport.ts'),
    read('zotero-plugin/content/sidebar.js'),
    read('zotero-plugin/manifest.json').then(JSON.parse),
    read('server/lib/version.mjs'),
    read('SOURCE_CODE.md'),
    read('CITATION.cff'),
    read('docs/global-library.md'),
    read('docs/global-library-acceptance.md'),
  ]);

  const recoveryCall = main.indexOf('await ensurePreV4Recovery');
  const databaseOpen = main.indexOf('getDb(); // open + migrate');
  assert.ok(recoveryCall > 0 && recoveryCall < databaseOpen, 'the verified pre-v4 copy must finish before SQLite migrations begin');
  assert.match(recovery, /sourceDb\.backup\(target\)/, 'pre-v4 databases use SQLite snapshots that include WAL state');
  assert.match(recovery, /quick_check/, 'the pre-v4 database is verified before its completion marker');
  assert.match(recovery, /atomicWriteJson\(path\.join\(stagingRoot, 'recovery\.json'\)[\s\S]+fs\.renameSync\(stagingRoot, snapshotPath\)[\s\S]+atomicWriteJson\(markerPath\(userDataDirectory\)/, 'the completed snapshot is renamed before its trusted marker is written');

  assert.match(backup, /addGlobalLibraryFiles\(files\)/, 'v4 full-state backups contain nodus-library');
  assert.match(backup, /stageGlobalLibraryRestore/, 'global Library restore is staged before replacement');
  assert.match(backup, /const supportedVersions = \[1, 2, 3, 4, 5, 6\]/, 'Nodus 4 still opens released 3.x backup formats');
  assert.match(backup, /if \(!descriptor\) return null/, 'a 3.x backup without a Global Library preserves the current local one');

  assert.equal(pluginManifest.version, '4.1.1');
  assert.match(readerPlugin, /X-Nodus-Zotero-Protocol": "4"/);
  assert.match(readerPlugin, /capabilities\.globalLibrary/, 'plugin v4 omits v4-only Library controls with desktop v3');
  assert.match(readerPlugin, /\/api\/z\/chat/, 'ordinary plugin chat remains available across protocol versions');

  const compatibilityBundle = path.join(scratch, 'compatibility.mjs');
  execFileSync(path.join(root, 'node_modules/esbuild/bin/esbuild'), [
    path.join(root, 'electron/serverSync/serverCompatibility.ts'), '--bundle', '--platform=node', '--format=esm', `--outfile=${compatibilityBundle}`,
  ], { cwd: root, stdio: 'pipe' });
  const { negotiateRemoteMutationLimits, LEGACY_SERVER_MUTATION_LIMITS } = await import(pathToFileURL(compatibilityBundle).href);
  assert.deepEqual(negotiateRemoteMutationLimits({ api: 'v1', version: '3.2.7' }), LEGACY_SERVER_MUTATION_LIMITS, 'desktop v4 accepts the sparse Server 3.2.7 capability response');
  assert.deepEqual(negotiateRemoteMutationLimits({ maxMutationBytes: -1, maxMutationBatch: '100' }), LEGACY_SERVER_MUTATION_LIMITS, 'invalid optional fields fail safely to legacy operation sizes');
  assert.deepEqual(negotiateRemoteMutationLimits({ maxMutationBytes: 1024, maxMutationBatchBytes: 4096, maxMutationBatch: 12 }), {
    maxMutationBytes: 1024, maxMutationBatchBytes: 4096, maxMutationBatch: 12,
  });

  assert.match(serverVersion, /export const NODUS_VERSION = '4\.1\.1'/);
  assert.match(serverVersion, /tree\/v\$\{NODUS_VERSION\}/);
  assert.match(sourceOffer, /archive\/refs\/tags\/v4\.1\.1\.tar\.gz/);
  assert.match(citation, /^date-released: "2026-08-14"$/m);
  for (const phrase of ['pre-v4', '3.2.7', 'may not open', '50,000', '10,000']) {
    assert.match(`${guide}\n${acceptance}`, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `release documentation is missing ${phrase}`);
  }

  console.log('Nodus 4 upgrade, compatibility, source and recovery release test passed');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
