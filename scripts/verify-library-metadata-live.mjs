// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-library-metadata-live-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-library-metadata-live-'));
installRuntimeHooks(path.join(scratch, 'profile'));
const require = createRequire(import.meta.url);

try {
  const { resolveLibraryMetadata } = require(path.join(repoRoot, 'electron/library/libraryMetadataResolver.ts'));
  const doi = await resolveLibraryMetadata('doi', 'https://doi.org/10.1038/s41586-020-2649-2');
  assert.ok(doi.candidates[0]?.metadata.title);
  assert.equal(doi.candidates[0]?.metadata.doi?.toLowerCase(), '10.1038/s41586-020-2649-2');
  const isbn = await resolveLibraryMetadata('isbn', '978-0-306-40615-7');
  assert.ok(isbn.candidates[0]?.metadata.title);
  assert.ok(isbn.candidates[0]?.metadata.isbn?.some((value) => value.replace(/[^0-9X]/gi, '') === '9780306406157'));
  console.log('Live DOI and ISBN metadata recovery passed.');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
