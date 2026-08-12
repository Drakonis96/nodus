// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-library-metadata-live-suite')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-library-metadata-live-'));
installRuntimeHooks(path.join(scratch, 'profile'));
const require = createRequire(import.meta.url);
let fullTextDirectory = null;
let closeGlobalLibrary = null;

try {
  const { resolveLibraryMetadata } = require(path.join(repoRoot, 'electron/library/libraryMetadataResolver.ts'));
  const { downloadLibraryFullText } = require(path.join(repoRoot, 'electron/library/libraryFullText.ts'));
  const doi = await resolveLibraryMetadata('doi', 'https://doi.org/10.1038/s41586-020-2649-2');
  assert.ok(doi.candidates[0]?.metadata.title);
  assert.equal(doi.candidates[0]?.metadata.doi?.toLowerCase(), '10.1038/s41586-020-2649-2');
  const isbn = await resolveLibraryMetadata('isbn', '978-0-306-40615-7');
  assert.ok(isbn.candidates[0]?.metadata.title);
  assert.ok(isbn.candidates[0]?.metadata.isbn?.some((value) => value.replace(/[^0-9X]/gi, '') === '9780306406157'));
  const requested = await resolveLibraryMetadata('doi', 'https://doi.org/10.18239/vdh_2023.12.21');
  assert.equal(requested.candidates[0]?.metadata.doi, '10.18239/vdh_2023.12.21');
  assert.ok(requested.candidates[0]?.fullTextLinks?.some((entry) => entry.mimeType === 'application/pdf'));
  const fullText = await downloadLibraryFullText(requested.candidates[0]);
  assert.equal(fullText.status, 'downloaded');
  assert.ok(fullText.filePath && fullText.temporaryDirectory);
  fullTextDirectory = fullText.temporaryDirectory;
  assert.ok((await stat(fullText.filePath)).size > 100_000);
  assert.ok((await readFile(fullText.filePath)).subarray(0, 1024).includes(Buffer.from('%PDF-')));

  const backupFolder = path.join(scratch, 'backups');
  await mkdir(backupFolder, { recursive: true });
  require(path.join(repoRoot, 'electron/db/appPrefs.ts')).writeGlobalPrefsRaw({ autoBackupFolder: backupFolder });
  const libraryService = require(path.join(repoRoot, 'electron/library/libraryService.ts'));
  closeGlobalLibrary = libraryService.closeGlobalLibrary;
  const imported = await libraryService.importGlobalLibraryIdentifier('doi', '10.18239/vdh_2023.12.21');
  assert.equal(imported.fullText.status, 'downloaded');
  assert.equal(imported.item.attachments.length, 1);
  assert.equal(imported.item.attachments[0].mimeType, 'application/pdf');
  const storedFile = libraryService.globalLibraryAttachmentPath(imported.item.id, imported.item.attachments[0].id);
  assert.ok(storedFile.startsWith(path.join(backupFolder, 'nodus-library')));
  assert.ok((await readFile(storedFile)).subarray(0, 1024).includes(Buffer.from('%PDF-')));
  const extractionDeadline = Date.now() + 60_000;
  let prepared = libraryService.getGlobalLibraryItem(imported.item.id);
  while (prepared && ['pending', 'processing'].includes(prepared.extraction?.status) && Date.now() < extractionDeadline) {
    await delay(50);
    prepared = libraryService.getGlobalLibraryItem(imported.item.id);
  }
  assert.ok(['ready', 'needs-review'].includes(prepared?.extraction?.status), prepared?.extraction?.error ?? 'The clean reading version was not prepared.');
  const repeated = await libraryService.importGlobalLibraryIdentifier('doi', '10.18239/vdh_2023.12.21');
  assert.equal(repeated.item.id, imported.item.id);
  assert.equal(repeated.created, false);
  assert.equal(repeated.fullText.status, 'already-present');
  assert.equal(repeated.item.attachments.length, 1);
  console.log(`Live DOI, ISBN, full-text recovery, and isolated Library import passed (${fullText.sourceUrl}).`);
} finally {
  closeGlobalLibrary?.();
  if (fullTextDirectory) await rm(fullTextDirectory, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
}
