import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-canonical-inventory')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-canonical-inventory-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = name => require(path.join(repoRoot, name));
const db = load('electron/db/database.ts').getDb();
try {
  for (const [id, key] of [['traditional', 'DUPL0001'], ['group-work', 'groups:47:DUPL0001']])
    db.prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,item_type,source_type) VALUES(?,?,?,'[]','book','text')").run(id, key, id);
  const userId = load('electron/db/settingsRepo.ts').getSettings().zoteroUserId || '0';
  const library = load('electron/library/libraryService.ts');
  const item = { id: 'global-canonical', metadata: { title: 'Synthetic work', creators: [], itemType: 'book' }, collectionIds: [], attachments: [],
    sourceIdentities: [{ source: 'zotero', libraryType: 'user', libraryId: userId, itemKey: 'DUPL0001' }] };
  library.listGlobalLibraryItems = () => ({ items: [{ id: item.id }], total: 1 });
  library.getGlobalLibraryItem = () => item;
  library.listGlobalLibraryVaultLinks = () => [];
  library.listGlobalLibraryCollections = () => [];
  const inventory = load('electron/ai/researchCorpusInventory.ts').researchCorpusInventory();
  assert.equal(inventory.documents.length, 2);
  assert.equal(inventory.documents.find(document => document.id === item.id).workId, 'traditional');
  assert.ok(inventory.documents.some(document => document.workId === 'group-work'), 'same item key in another library is distinct');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM works').get().n, 2, 'correspondence does not migrate or duplicate traditional works');
  console.log('Canonical Global/traditional correspondence and Zotero library namespace isolation passed.');
} finally { load('electron/db/database.ts').closeDb(); fs.rmSync(root, { recursive: true, force: true }); }
