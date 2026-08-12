// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { installRuntimeHooks, repoRoot, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const flag = '--electron-browser-connector-live-suite';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), flag)) process.exit(0);

const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-browser-live-'));
const userData = path.join(scratch, 'profile');
const backups = path.join(scratch, 'backups');
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);
const settings = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
const library = require(path.join(repoRoot, 'electron/library/libraryService.ts'));
const capture = require(path.join(repoRoot, 'electron/browser-connector/libraryCapture.ts'));

try {
  settings.updateSettings({ autoBackupFolder: backups, browserConnectorEnabled: true });
  const result = await capture.saveBrowserCapture({
    pageUrl: 'https://dialnet.unirioja.es/servlet/articulo?codigo=9012474',
    metadataSource: 'highwire',
    metadata: {
      title: 'Análisis cuantitativo de los diarios de pioneros durante las migraciones al oeste americano (1840-1860). Una propuesta metodológica',
      itemType: 'journal-article', creators: [{ creatorType: 'author', firstName: 'Jorge', lastName: 'Pérez Burgueño', fieldMode: 0 }],
      date: '2023', year: 2023, publicationTitle: 'Vínculos de Historia', issue: '12', pages: '388-407',
      url: 'https://dialnet.unirioja.es/servlet/articulo?codigo=9012474', isbn: [], issn: ['2254-6901'], tags: [],
    },
    attachments: [{
      url: 'https://dialnet.unirioja.es/servlet/articulo?codigo=9012474&orden=0&info=link',
      title: 'Full text PDF', fileName: 'full-text.pdf', mimeType: 'application/pdf', role: 'original', resolveFullText: true,
    }],
  });
  assert.equal(result.pendingUploads.length, 0, result.warnings.join('\n'));
  assert.equal(result.attachmentCount, 1);
  let stored = library.getGlobalLibraryItem(result.itemId);
  assert.equal(stored.attachments[0].mimeType, 'application/pdf');
  assert.equal(stored.attachments[0].role, 'original');
  const pdfPath = library.globalLibraryAttachmentPath(stored.id, stored.attachments[0].id);
  assert.ok((await stat(pdfPath)).size > 4_000_000);
  assert.ok((await readFile(pdfPath)).subarray(0, 1024).includes(Buffer.from('%PDF-')));

  const deadline = Date.now() + 90_000;
  while (stored && ['pending', 'processing'].includes(stored.extraction?.status) && Date.now() < deadline) {
    await delay(100);
    stored = library.getGlobalLibraryItem(result.itemId);
  }
  assert.ok(['ready', 'needs-review'].includes(stored?.extraction?.status), stored?.extraction?.error ?? 'The PDF reader was not prepared.');
  const root = library.getGlobalLibraryStatus().root;
  assert.ok(root && stored.files?.reader);
  const folder = encodeURIComponent(stored.storageId).replace(/\./g, '%2E');
  const markdown = await readFile(path.join(root, folder, stored.files.reader), 'utf8');
  assert.match(markdown, /An[aá]lisis cuantitativo/i);
  assert.doesNotMatch(markdown, /catalogue snapshot, not the paper/i);
  console.log(`Live Dialnet landing-page resolution stored a verified PDF and prepared ${stored.files.reader}.`);
} finally {
  library.closeGlobalLibrary();
  await rm(scratch, { recursive: true, force: true });
}
