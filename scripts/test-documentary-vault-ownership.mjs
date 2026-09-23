import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--documentary-vault-ownership')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-documentary-owners-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
const database = load('electron/db/database.ts');
const registry = load('electron/vaults/vaultRegistry.ts');
const preparation = load('electron/ai/documentaryPreparation.ts');
try {
  const first = registry.getActiveVault();
  const second = registry.createVault('Second academic', 'academic');
  const nonAcademic = registry.createVault('Other engine', 'study');
  const seed = async (vault, title) => registry.withOwningVault(vault.id, () => database.withVaultDatabase(vault.id, () => {
    database.getDb().prepare("INSERT INTO works(nodus_id,zotero_key,title,authors_json,item_type,source_type) VALUES('owned','owned',?,'[]','book','text')").run(title);
    return load('electron/ai/researchCorpusInventory.ts').researchCorpusInventory().documents.find(doc => doc.workId === 'owned');
  }));
  const firstDoc = await seed(first, 'First source');
  const secondDoc = await seed(second, 'Second source');
  assert.notEqual(firstDoc.id, secondDoc.id);
  preparation.setResearchPreparationPaused(true);
  await registry.withOwningVault(first.id, () => database.withVaultDatabase(first.id, () => preparation.prepareResearchDocuments([firstDoc.id], 'text')));
  await registry.withOwningVault(second.id, () => database.withVaultDatabase(second.id, () => preparation.prepareResearchDocuments([secondDoc.id], 'text')));
  const extraction = load('electron/ai/documentaryExtraction.ts');
  load('electron/zotero/zoteroClient.ts').getItem = async () => ({ abstract: '' });
  let releaseFirst, beganFirst;
  const began = new Promise(resolve => { beganFirst = resolve; });
  const gate = new Promise(resolve => { releaseFirst = resolve; });
  const seen = [];
  extraction.extractTraditionalResearchWork = async () => {
    const owner = registry.getActiveVault();
    if (owner.id === first.id) { beganFirst(); await gate; }
    assert.equal(registry.getActiveVault().id, owner.id, 'owner survives an await and an unrelated UI switch');
    assert.equal(database.getDb().name, owner.path);
    const title = database.getDb().prepare("SELECT title FROM works WHERE nodus_id='owned'").get().title;
    seen.push([owner.id, title]);
    return { text: `Evidence ${title}`, sourceMap: {}, parts: [] };
  };
  load('electron/ai/documentaryChunking.ts').documentaryChunks = async text => [{ text, pageLabel: null, pageNumber: null, sourceRef: null }];
  const ai = load('electron/ai/aiClient.ts');
  for (const name of ['embedMany', 'completeText', 'completeTextStream']) ai[name] = async () => { throw new Error(`text-only preparation called ${name}`); };
  preparation.setResearchPreparationPaused(false);
  await began;
  database.closeDb(); registry.setActiveVault(nonAcademic.id);
  assert.equal(registry.getActiveVault().id, nonAcademic.id, 'the UI remains independent');
  releaseFirst();
  const store = preparation.documentaryStore();
  for (let i = 0; i < 100 && store.db.prepare("SELECT COUNT(*) n FROM documentary_requests WHERE state='complete'").get().n < 2; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.deepEqual(seen, [[first.id, 'First source'], [second.id, 'Second source']]);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM documentary_requests WHERE state='complete'").get().n, 2);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM documentary_revisions WHERE lexical_ready=1 AND embedding_ready=0').get().n, 2);
  assert.equal(registry.getActiveVault().id, nonAcademic.id);
  assert.equal(database.getDb().prepare('SELECT COUNT(*) n FROM works').get().n, 0, 'background work did not write the open vault');
  const detached = await registry.withOwningVault(first.id, () => database.withVaultDatabase(first.id, () => new Promise(resolve => {
    registry.withoutOwningVault(() => database.withoutDatabaseContext(() => setImmediate(() => resolve(registry.getActiveVault().id))));
  })));
  assert.equal(detached, nonAcademic.id, 'detached UI callbacks do not retain an owner');
  console.log('Actual documentary queue: two owning vaults, UI switch across extraction await, text-only preparation and scoped DB isolation passed.');
} finally {
  preparation.closeDocumentaryPreparation(); database.closeDb(); fs.rmSync(root, { recursive: true, force: true });
}
