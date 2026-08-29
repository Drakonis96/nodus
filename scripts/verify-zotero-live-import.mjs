// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Live end-to-end check of the Zotero import against the Zotero running on THIS
 * machine. Not part of `npm test`: it needs a real Zotero 7+ with its local API on,
 * and what it asserts depends on the library it finds.
 *
 * It READS Zotero (the local API is read-only anyway) and writes ONLY into a fresh
 * temporary directory — never the user's vault, never their library root.
 *
 * Run:  node scripts/verify-zotero-live-import.mjs [--keys A,B,C]
 *
 * Without --keys it picks its own subjects: entries carrying two PDFs, entries whose
 * filenames are long enough to have thrown ENAMETOOLONG, and entries with `linked_url`
 * bookmarks. Those are the three shapes that used to lose files silently.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-zotero-live-verify')) process.exit(0);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-zotero-live-'));
const userData = path.join(scratch, 'user-data');
installRuntimeHooks(userData);
const require = createRequire(import.meta.url);

const MAX_NAME_BYTES = 255;
const TEMP_SUFFIX_BYTES = 56;

try {
  const zotero = require(path.join(repoRoot, 'electron/zotero/zoteroClient.ts'));
  const { LibraryDiskStore } = require(path.join(repoRoot, 'electron/library/libraryStorage.ts'));
  const { LibraryCatalog } = require(path.join(repoRoot, 'electron/library/libraryCatalog.ts'));
  const { importZoteroLibraries } = require(path.join(repoRoot, 'electron/library/zoteroLibraryImport.ts'));

  const ping = await zotero.ping();
  if (!ping.ok) {
    console.log(`SKIP: Zotero's local API is not answering (${ping.reason}). Open Zotero and retry.`);
    process.exit(0);
  }
  const library = { ...zotero.PERSONAL_LIBRARY };
  console.log(`Zotero is up. Reading ${library.name}…`);

  const all = await zotero.libraryItems(library, { includeStandaloneFiles: true });
  const references = all.items.filter((entry) => entry.itemType !== 'attachment');
  const standalone = all.items.filter((entry) => entry.itemType === 'attachment');
  console.log(`  ${references.length} references, ${standalone.length} standalone files\n`);

  const argKeys = process.argv.find((value) => value.startsWith('--keys='))?.slice(7).split(',').filter(Boolean);
  let subjects;
  if (argKeys?.length) {
    subjects = references.filter((entry) => argKeys.includes(entry.itemKey));
  } else {
    // Pick the three shapes that used to lose files, and stop as soon as each is covered.
    const multi = [];
    const long = [];
    const linked = [];
    for (const entry of references) {
      const attachments = await zotero.itemAttachments(library.id, entry.key, library);
      const pdfs = attachments.filter((a) => a.contentType === 'application/pdf');
      if (pdfs.length >= 2 && multi.length < 2) multi.push(entry);
      if (attachments.some((a) => encodeURIComponent(a.filename ?? '').length + 9 + 47 > MAX_NAME_BYTES) && long.length < 3) long.push(entry);
      if (attachments.some((a) => a.linkMode === 'linked_url') && linked.length < 2) linked.push(entry);
      if (multi.length >= 2 && long.length >= 3 && linked.length >= 2) break;
    }
    subjects = [...new Map([...multi, ...long, ...linked].map((entry) => [entry.key, entry])).values()];
  }
  assert.ok(subjects.length, 'no subjects found in this library');
  console.log(`Importing ${subjects.length} real entries:`);
  for (const entry of subjects) console.log(`  ${entry.itemKey}  ${entry.title.slice(0, 62)}`);

  // Everything below is the real client. Only the item page is narrowed, so the
  // collections, children, /file redirects, hashing and copying are all genuine.
  const narrowed = (options = {}) => ({
    libraries: async () => [library],
    libraryVersion: zotero.libraryVersion,
    allCollections: zotero.allCollections,
    libraryItems: async (lib, opts = {}) => {
      const page = await zotero.libraryItems(lib, { ...opts, ...options });
      const keys = new Set(subjects.map((entry) => entry.key));
      const items = page.items.filter((entry) => keys.has(entry.key)
        || (options.includeStandaloneFiles && entry.itemType === 'attachment' && standalonePicks.has(entry.key)));
      return { ...page, items, total: items.length };
    },
    deletedSince: zotero.deletedSince,
    itemAttachments: zotero.itemAttachments,
    attachmentFilePath: zotero.attachmentFilePath,
    itemNotes: zotero.itemNotes,
  });
  const standalonePicks = new Set(standalone.slice(0, 3).map((entry) => entry.key));

  // ---- Pass 1: default settings (standalone files left out) --------------------
  const store = new LibraryDiskStore(path.join(scratch, 'library'), 'zotero-live-verify-0001');
  const catalog = new LibraryCatalog(path.join(userData, 'library', 'catalog.sqlite'));
  const events = [];
  const report = await importZoteroLibraries({
    requestId: 'live-1', store, catalog, client: narrowed(), onProgress: (value) => events.push(value),
  });

  console.log('\n--- pass 1: defaults ---');
  console.log(`  items created        : ${report.itemsCreated}`);
  console.log(`  attachments copied   : ${report.attachmentsCopied}`);
  console.log(`  link-only (bookmarks): ${report.attachmentsLinkOnly}`);
  console.log(`  unavailable          : ${report.attachmentsUnavailable}`);
  console.log(`  standalone skipped   : ${report.itemsStandaloneSkipped}`);
  console.log(`  failures             : ${report.failures.length}`);
  for (const failure of report.failures) console.log(`      ! ${failure.code}: ${failure.message.slice(0, 90)}`);

  assert.equal(report.failures.length, 0, 'a healthy library imports with no failures');
  assert.equal(report.itemsCreated, subjects.length);
  assert.ok(report.attachmentsCopied > 0, 'files were actually copied');

  let longest = 0;
  let checked = 0;
  for (const entry of subjects) {
    const stored = store.findItemBySourceIdentity({ source: 'zotero', libraryType: 'user', libraryId: '0', itemKey: entry.itemKey });
    assert.ok(stored, `${entry.itemKey} reached the store`);
    for (const attachment of stored.attachments) {
      const onDisk = path.join(store.itemFolder(stored.storageId), attachment.relativePath);
      assert.ok(existsSync(onDisk), `file present on disk: ${attachment.fileName}`);
      const bytes = Buffer.byteLength(path.basename(attachment.relativePath));
      longest = Math.max(longest, bytes);
      assert.ok(bytes <= MAX_NAME_BYTES - TEMP_SUFFIX_BYTES,
        `${bytes} bytes leaves room for the temporary file: ${path.basename(attachment.relativePath)}`);
      checked += 1;
    }
    if (stored.attachments.length) {
      assert.ok(stored.files.original, `${entry.itemKey} has a primary file chosen`);
      assert.ok(existsSync(path.join(store.itemFolder(stored.storageId), stored.files.original)));
      const original = stored.attachments.find((a) => a.relativePath === stored.files.original);
      assert.ok(!/supplement|supporting[\s_-]+information|appendix|annex/i.test(`${original.title} ${original.fileName}`),
        `the primary file is not a supplement: ${original.fileName}`);
    }
  }
  console.log(`  ${checked} files verified on disk; longest stored name ${longest} bytes (budget ${MAX_NAME_BYTES - TEMP_SUFFIX_BYTES})`);

  const phases = [...new Set(events.map((value) => value.phase))];
  assert.ok(phases.includes('notes'), 'the notes pass reported itself');
  assert.ok(phases.includes('attachments'), 'the file pass reported itself');
  assert.ok(events.every((value, index) => index === 0 || value.percent >= events[index - 1].percent), 'progress never goes backwards');
  assert.equal(events.at(-1).phase, 'complete');
  assert.equal(events.at(-1).percent, 100);
  const band = events.filter((value) => value.phase === 'attachments').map((value) => value.percent);
  console.log(`  progress phases      : ${phases.join(' → ')}`);
  console.log(`  attachments band     : ${Math.min(...band)}% → ${Math.max(...band)}% over ${new Set(band).size} distinct steps`);
  catalog.close();

  // ---- Pass 2: standalone files opted in ---------------------------------------
  const store2 = new LibraryDiskStore(path.join(scratch, 'library-2'), 'zotero-live-verify-0002');
  const catalog2 = new LibraryCatalog(path.join(userData, 'library', 'catalog2.sqlite'));
  const report2 = await importZoteroLibraries({
    requestId: 'live-2', selection: { includeStandaloneFiles: true }, store: store2, catalog: catalog2, client: narrowed({ includeStandaloneFiles: true }),
  });
  console.log('\n--- pass 2: standalone files opted in ---');
  console.log(`  items created        : ${report2.itemsCreated} (${subjects.length} references + ${standalonePicks.size} standalone)`);
  console.log(`  standalone skipped   : ${report2.itemsStandaloneSkipped}`);
  console.log(`  failures             : ${report2.failures.length}`);
  assert.equal(report2.failures.length, 0);
  assert.equal(report2.itemsStandaloneSkipped, 0, 'nothing is skipped once the option is on');
  assert.equal(report2.itemsCreated, subjects.length + standalonePicks.size, 'the parentless files became works of their own');
  for (const key of standalonePicks) {
    const raw = standalone.find((entry) => entry.key === key);
    const stored = store2.findItemBySourceIdentity({ source: 'zotero', libraryType: 'user', libraryId: '0', itemKey: raw.itemKey });
    assert.ok(stored, `standalone ${raw.itemKey} reached the store`);
    assert.equal(stored.attachments.length, 1, 'its file was resolved from the item itself');
    assert.ok(existsSync(path.join(store2.itemFolder(stored.storageId), stored.files.original)));
    console.log(`  ok  ${raw.itemKey}  ${stored.attachments[0].fileName.slice(0, 58)}`);
  }
  catalog2.close();

  console.log('\nLive Zotero import verified end to end against the real library.');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
