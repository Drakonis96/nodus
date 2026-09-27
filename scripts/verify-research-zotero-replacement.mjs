import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';

/** Real disposable Zotero: the attachment file is replaced in Zotero's own
 * storage after Nodus imported it (same Zotero item and version, new bytes).
 * Called by verify-zotero-nodus-product with --replace-attachment. */
export async function verifyZoteroAttachmentReplacement(page, root, corpus, documents, index = 2) {
  // An unprepared source: the read must go to the Zotero original, not to an index.
  const entry = corpus.items[index];
  const source = documents.find(document => document.origin.itemKey === entry.key);
  assert.ok(source, 'the unprepared synthetic source was imported');
  const preparation = (await page.evaluate(() => window.nodus.getResearchPreparationInventory())).documents.find(document => document.id === source.id)?.preparation;
  assert.equal(preparation?.lexical, 'missing', 'this source has no prepared index');
  const notebook = await page.evaluate(id => window.nodus.saveResearchNotebook({ name: 'Replaced attachment', mode: 'fixed', sources: [{ kind: 'library-item', id }], exclusions: [] }), source.id);
  const zoteroFile = fs.realpathSync(entry.attachment.path);
  assert.ok(zoteroFile.startsWith(`${root}${path.sep}zotero${path.sep}`), 'only the disposable Zotero data directory is modified');
  const original = fs.readFileSync(zoteroFile);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText('CHANGED99 replaced the original measurement.\nThis replacement must never be cited as the imported revision.', { x: 40, y: 700, size: 12, font });
  const replacement = await pdf.save();
  const localItem = await page.evaluate(id => window.nodus.getGlobalLibraryItem(id), source.id);
  const copied = localItem.attachments.find(item => item.sourceKey === entry.attachment.key);
  const copiedPath = path.join(root, 'library/nodus-library', encodeURIComponent(localItem.storageId).replaceAll('.', '%2E'), copied.relativePath);
  const settle = promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, error: String(error?.message ?? error) }));
  const report = { documentPreparationBefore: preparation.lexical, zoteroFile: path.relative(root, zoteroFile), knownSha256: copied.sha256 ?? null };
  // Force the original path: Nodus's own copy is made temporarily unavailable.
  fs.renameSync(copiedPath, `${copiedPath}.temporarily-unavailable`);
  try {
    fs.writeFileSync(zoteroFile, replacement);
    const automatic = await settle(page.evaluate(input => window.nodus.readResearchDocument(input), { notebookId: notebook.id, documentId: source.id, operation: { kind: 'pages', from: 1 } }));
    report.automaticReadAfterReplacement = automatic.ok ? { evidence: automatic.value.evidence.map(item => ({ id: item.id.split(':')[0], text: item.text.slice(0, 120) })), limitations: automatic.value.limitations ?? null } : automatic;
    assert.ok(!JSON.stringify(automatic).includes('CHANGED99'), 'replaced bytes are never returned as evidence');
    const manual = await settle(page.evaluate(id => window.nodus.connectResearchZotero({ notebookId: id, mode: 'managed' }), notebook.id));
    report.manualConnectAfterReplacement = manual.ok ? { state: manual.value.state, error: manual.value.error ?? null } : manual;
    if (manual.ok && manual.value.state === 'connected') {
      const text = await settle(page.evaluate(input => window.nodus.readResearchZotero(input), { notebookId: notebook.id, documentId: source.id, operation: 'fulltext', attachmentKey: entry.attachment.key }));
      report.manualFulltextAfterReplacement = text.ok ? { text: JSON.stringify(text.value).slice(0, 160) } : text;
      assert.ok(!JSON.stringify(text).includes('CHANGED99'), 'a manual connection cannot read replaced bytes either');
    }
    // Restoring the imported bytes restores access: the guard is a revision check.
    fs.writeFileSync(zoteroFile, original);
    const restored = await settle(page.evaluate(input => window.nodus.readResearchDocument(input), { notebookId: notebook.id, documentId: source.id, operation: { kind: 'pages', from: 1 } }));
    report.readAfterRestore = restored.ok ? { hasOriginalMarker: restored.value.evidence.some(item => item.text.includes('east field')), evidenceIds: restored.value.evidence.map(item => item.id.split(':')[0]) } : restored;
    assert.ok(restored.ok && report.readAfterRestore.hasOriginalMarker, 'the unchanged original is readable again');
  } finally {
    fs.writeFileSync(zoteroFile, original);
    fs.renameSync(`${copiedPath}.temporarily-unavailable`, copiedPath);
    fs.writeFileSync(path.join(root, 'artifacts/zotero-replacement.json'), JSON.stringify(report, null, 2));
  }
  return report;
}
