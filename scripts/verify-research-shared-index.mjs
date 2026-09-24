/** Real Electron: two academic vaults prepare the same Global Library document at
 * once, then one withdraws while the other still wants it. Simulated embedding
 * upstream behind the real proxy; nothing leaves the machine. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createResearchApp, simulatedUpstream, writeSyntheticPdfs, addPdfItems, waitFor, inventoryOf } from './lib/research-app-harness.mjs';

const embedded = [];
let slow = true;
const upstream = simulatedUpstream((provider, body) => {
  if (provider !== 'openrouter') return null;
  embedded.push(...(Array.isArray(body.input) ? body.input : [body.input]));
  return slow ? { hangMs: 1200 } : null;
});
const harness = await createResearchApp({ provider: upstream });
const report = { root: harness.root, proof: harness.proof, simulatedUpstream: true, completed: false };
try {
  const { app, page } = await harness.launch();
  await harness.prepareProfile(page);
  await harness.simulatedKeys(page);
  const vaultA = await page.evaluate(() => window.nodus.getActiveVault());
  const created = await page.evaluate(() => window.nodus.createVault({ name: 'Second reader', type: 'academic', aiModel: { provider: 'deepseek', model: 'deepseek-flash' }, embeddingProvider: 'openrouter', embeddingModel: 'baai/bge-m3' }));
  const vaultB = created.id ?? created.vault?.id;
  const [shared] = await addPdfItems(app, page, await writeSyntheticPdfs(harness.root, { documents: 1, pages: 60, prefix: 'SHARED' }));
  for (const vault of [vaultA.id, vaultB]) await page.evaluate(({ ids, vault }) => window.nodus.linkGlobalLibraryItemsToVault(ids, vault), { ids: [shared], vault });
  const switchTo = id => page.evaluate(id => window.nodus.switchVault(id), id);

  // Both vaults ask for the document while the first preparation is in flight.
  await page.evaluate(id => window.nodus.prepareResearchDocuments([id]), shared);
  await waitFor(async () => ['running', 'queued'].includes((await inventoryOf(page, [shared]))[0].preparation.embeddings) || (await inventoryOf(page, [shared]))[0].preparation.lexical === 'ready', { timeoutMs: 60000 });
  const switched = await switchTo(vaultB);
  assert.ok(switched.ok, switched.message);
  await page.evaluate(id => window.nodus.prepareResearchDocuments([id]), shared);
  const progressB = await page.evaluate(() => window.nodus.getResearchPreparationProgress());
  report.campaignsVisibleInB = progressB.campaigns.length;

  // Vault A withdraws; vault B's interest must keep the shared work alive.
  assert.ok((await switchTo(vaultA.id)).ok);
  await page.evaluate(id => window.nodus.cancelResearchDocuments([id]), shared);
  report.afterCancelInA = (await inventoryOf(page, [shared]))[0].preparation;
  slow = false;
  assert.ok((await switchTo(vaultB)).ok);
  const ready = await waitFor(async () => (await inventoryOf(page, [shared]))[0].preparation.embeddings === 'ready', { timeoutMs: 240000 });
  const inB = (await inventoryOf(page, [shared]))[0].preparation;
  report.readyInB = { ready: !!ready, lexical: inB.lexical, embeddings: inB.embeddings, passages: inB.passages };
  assert.ok(ready, 'the vault that kept its interest receives the complete shared index');
  const notebook = await page.evaluate(id => window.nodus.saveResearchNotebook({ name: 'Shared', mode: 'fixed', sources: [{ kind: 'library-item', id }], exclusions: [] }), shared);
  const hit = await page.evaluate(id => window.nodus.searchResearchNotebook(id, 'SHARED1P7'), notebook.id);
  report.searchInB = hit.evidence.filter(item => item.text.includes('SHARED1P7')).length;
  report.searchEvidence = hit.evidence.filter(item => item.text.includes('SHARED1P7')).map(item => ({ id: item.id, revision: item.revision, locator: item.locator, provenance: item.provenance }));
  // Overlapping chunks may both hold the marker; they must come from one index and never repeat.
  const ids = report.searchEvidence.map(item => item.id);
  assert.ok(ids.length > 0 && new Set(ids).size === ids.length, 'no passage is returned twice');
  assert.equal(new Set(ids.map(id => id.split(':')[0])).size, 1, 'every hit comes from the single shared index');
  assert.ok((await switchTo(vaultA.id)).ok);
  const inA = (await inventoryOf(page, [shared]))[0].preparation;
  report.viewInA = { lexical: inA.lexical, embeddings: inA.embeddings };
  await harness.close();

  // Store invariants: one revision, no passage embedded twice.
  const store = path.join(harness.root, 'profile/documentary/store.sqlite');
  const copy = path.join(harness.root, 'artifacts/shared-store.sqlite');
  for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(store + suffix)) fs.copyFileSync(store + suffix, copy + suffix);
  const sql = query => JSON.parse(execFileSync('/usr/bin/sqlite3', ['-json', copy, query]).toString() || '[]');
  // A single-vault preparation also keeps two identities: text published first
  // (lexical-first) and text with vectors. Two vaults must not add more.
  const identities = sql(`SELECT identity_json FROM documentary_revisions WHERE document_id='${shared.replaceAll("'", "''")}'`).map(row => JSON.parse(row.identity_json));
  const textOnly = identities.filter(identity => identity.embedding === null).length, withVectors = identities.filter(identity => identity.embedding).length;
  const unique = new Set(embedded).size;
  report.store = { textOnlyIdentities: textOnly, vectorIdentities: withVectors, embeddedInputs: embedded.length, uniqueEmbeddedInputs: unique, passages: inB.passages };
  assert.ok(textOnly <= 1 && withVectors === 1, 'both vaults share the same index identities');
  assert.equal(embedded.length, unique, 'no passage is embedded twice for two interested vaults');
  report.completed = true;
} finally {
  await harness.close();
  fs.writeFileSync(path.join(harness.root, 'artifacts/shared-index.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ root: harness.root, completed: report.completed, afterCancelInA: report.afterCancelInA && { lexical: report.afterCancelInA.lexical, embeddings: report.afterCancelInA.embeddings, status: report.afterCancelInA.status }, readyInB: report.readyInB, viewInA: report.viewInA, store: report.store }));
}
