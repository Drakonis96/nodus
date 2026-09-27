import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/** Runs only inside the already verified synthetic Zotero/Electron harness. */
export async function verifyResearchAttachmentReads(page, app, root, documentId) {
  const before = await page.evaluate(id => window.nodus.getGlobalLibraryItem(id), documentId);
  await app.evaluate(({ dialog }, file) => {
    globalThis.researchOriginalOpenDialog = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, path.join(root, 'fixtures/source-2.pdf'));
  let updated;
  try { updated = await page.evaluate(id => window.nodus.addGlobalLibraryAttachments(id), documentId); }
  finally { await app.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.researchOriginalOpenDialog; delete globalThis.researchOriginalOpenDialog; }); }
  const attachment = updated.attachments.find(item => !before.attachments.some(previous => previous.id === item.id));
  assert.ok(attachment, 'supported attachment import creates an independent identity');
  const notebook = await page.evaluate(async id => {
    const notebook = await window.nodus.saveResearchNotebook({ name: 'Independent attachment reads', mode: 'fixed', sources: [{ kind: 'library-item', id }], exclusions: [] });
    await window.nodus.prepareResearchDocuments([id]);
    return notebook;
  }, documentId);
  const deadline = Date.now() + 150000;
  let inventory;
  do {
    inventory = await page.evaluate(() => window.nodus.getResearchPreparationInventory());
    if (inventory.documents.find(item => item.id === documentId)?.preparation.passages >= 2) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  const read = await page.evaluate(input => window.nodus.readResearchDocument(input), {
    notebookId: notebook.id, documentId, operation: { kind: 'pages', from: 1, attachmentId: attachment.id },
  });
  assert.ok(read.evidence.length > 0);
  assert.ok(read.evidence.every(item => item.attachmentId === attachment.id && item.locator.pageNumber === 1));
  assert.ok(read.evidence.some(item => item.text.includes('SOUTH41')));
  assert.ok(read.evidence.every(item => !item.text.includes('NORTH23')));
  const id = `documentary:${read.scopeId}:${read.evidence[0].id}`;
  const citation = await page.evaluate(id => window.nodus.getPassage(id), id);
  assert.equal(citation.attachmentId, attachment.id);
  assert.match(citation.text, /SOUTH41/);
  await assert.rejects(page.evaluate(input => window.nodus.readResearchDocument(input), {
    notebookId: notebook.id, documentId, operation: { kind: 'pages', from: 1, attachmentId: 'foreign-attachment' },
  }), /not_authorized/);
  await page.evaluate(version => {
    localStorage.setItem('nodus.lastSeenVersion', version);
    for (const key of ['nodus.mobileTeaserSeen.3.2.4', 'nodus.platformHighlightsSeen.2026-07', 'nodus.tutorialVideosAnnouncementSeen.2026-07',
      'nodus.pdfPresenterTutorialSeen.e2js_u-05OA', 'nodus.toolkitBetaGuideSeen.2.4.0']) localStorage.setItem(key, '1');
  }, JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8')).version);
  await page.reload();
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent('nodus:open-library-document', { detail })), {
    itemId: documentId, scope: 'global', page: 1, attachmentId: attachment.id,
  });
  const picker = page.getByTestId('library-reader-source-picker').locator('select');
  await picker.waitFor({ timeout: 30000 });
  assert.equal(await picker.inputValue(), attachment.id, 'citation navigation selects its actual attachment');
  await page.screenshot({ path: path.join(root, 'artifacts/attachment-citation.png') });
  const result = { passed: true, notebookId: notebook.id, documentId, attachmentId: attachment.id, read, citation, inventory };
  fs.writeFileSync(path.join(root, 'artifacts/attachment-reads.json'), JSON.stringify(result, null, 2));
  return { passed: true, independentAttachments: updated.attachments.length, physicalPage: 1, marker: 'SOUTH41', foreignAttachmentRejected: true };
}
