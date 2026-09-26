/** Real Electron: a Global Library attachment is replaced while its preparation
 * is in flight. Text-only preparation; no credentials and no model calls. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createResearchApp, writeSyntheticPdfs, addPdfItems, waitFor, inventoryOf } from './lib/research-app-harness.mjs';

const harness = await createResearchApp();
const report = { root: harness.root, proof: harness.proof, modelCalls: 0, completed: false };
try {
  const { app, page } = await harness.launch();
  await harness.prepareProfile(page);
  const [oldFile] = await writeSyntheticPdfs(harness.root, { documents: 1, pages: 200, prefix: 'OLDREV' });
  const [newFile] = await writeSyntheticPdfs(harness.root, { documents: 1, pages: 4, prefix: 'NEWREV' });
  const [id] = await addPdfItems(app, page, [oldFile]);
  const notebook = await page.evaluate(id => window.nodus.saveResearchNotebook({ name: 'Replacement', mode: 'fixed', sources: [{ kind: 'library-item', id }], exclusions: [] }), id);
  const before = await page.evaluate(id => window.nodus.getGlobalLibraryItem(id), id);
  await page.evaluate(id => window.nodus.prepareResearchDocuments([id]), id);
  // Replace while the old revision's request is running and unpublished.
  const running = await waitFor(async () => {
    const [document] = await inventoryOf(page, [id]);
    return document.preparation.lexical === 'missing' && document.preparation.status === 'running' && document;
  }, { timeoutMs: 60000, intervalMs: 50 });
  report.replacedWhile = running ? running.preparation.status : 'not observed';
  await app.evaluate(({ dialog }, filename) => { globalThis.replaceDialog = dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, newFile);
  await page.evaluate(({ id, attachmentId }) => window.nodus.replaceGlobalLibraryAttachment(id, attachmentId), { id, attachmentId: before.attachments[0].id });
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.replaceDialog; });
  const after = await page.evaluate(id => window.nodus.getGlobalLibraryItem(id), id);
  report.attachment = { before: before.attachments.map(item => item.sha256 ?? item.id), after: after.attachments.map(item => item.sha256 ?? item.id) };
  // Let the in-flight job finish or be fenced, then observe what became current.
  await new Promise(resolve => setTimeout(resolve, 15000));
  const settled = (await inventoryOf(page, [id]))[0].preparation;
  const search = async marker => (await page.evaluate(input => window.nodus.searchResearchNotebook(input.id, input.marker), { id: notebook.id, marker })).evidence.filter(item => item.text.includes(marker));
  report.afterReplacement = { lexical: settled.lexical, status: settled.status, reason: settled.reason ?? null, oldMarkerHits: (await search('OLDREV1P3')).length, newMarkerHits: (await search('NEWREV1P2')).length };
  assert.notEqual(settled.lexical, 'ready', 'text of the replaced bytes is never published as the current revision');
  // The obsolete request neither fails the new file nor blocks it: it needs preparation.
  assert.ok(!['failed', 'blocked'].includes(settled.status) && settled.reason === null, 'a replaced attachment is shown as not yet prepared, not as an extraction failure');
  // The user prepares the new revision; only its text becomes current.
  await page.evaluate(id => window.nodus.prepareResearchDocuments([id]), id);
  const ready = await waitFor(async () => (await inventoryOf(page, [id]))[0].preparation.lexical === 'ready', { timeoutMs: 180000 });
  const oldHits = await search('OLDREV1P3'), newHits = await search('NEWREV1P2');
  report.afterRepreparation = { ready: !!ready, oldMarkerHits: oldHits.length, newMarkerHits: newHits.length, newRevisions: [...new Set(newHits.map(item => item.revision))] };
  assert.ok(ready, 'the replacement is prepared on request');
  assert.equal(oldHits.length, 0, 'the replaced text is no longer current evidence');
  assert.ok(newHits.length > 0, 'the new text is searchable');
  const currentRevision = (await inventoryOf(page, [id]))[0].revision;
  report.afterRepreparation.currentRevision = currentRevision;
  assert.ok(newHits.every(item => item.revision === currentRevision), 'new evidence carries the current revision');
  report.completed = true;
} finally {
  await harness.close();
  fs.writeFileSync(path.join(harness.root, 'artifacts/attachment-replacement.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ root: harness.root, completed: report.completed, replacedWhile: report.replacedWhile, afterReplacement: report.afterReplacement, afterRepreparation: report.afterRepreparation }));
}
