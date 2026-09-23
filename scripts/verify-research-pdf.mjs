import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';

/** Shared by the real source app and native installed-app checks. */
export async function verifyResearchPdf(page, app, root) {
    const notebooks = await page.evaluate(() => window.nodus.listResearchNotebooks());
    let corpusNotebook = notebooks.find(notebook => notebook.name === 'Packaged PDF extraction');
    if (!corpusNotebook) {
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      pdf.addPage().drawText('PACKAGED73 records a synthetic measurement of 73 units.\nThis document is an invented fixture for isolated installation tests.\nIts text must be extracted from the original PDF with its page locator.\nNo abstract, provider call or external source supplies this evidence.', { x: 40, y: 700, size: 12, lineHeight: 18, font });
      const filename = path.join(root, 'fixtures/packaged.pdf');
      fs.writeFileSync(filename, await pdf.save());
      await app.evaluate(({ dialog }, filename) => { globalThis.installerOpenDialog = dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, filename);
      try {
        corpusNotebook = await page.evaluate(async root => {
          await window.nodus.updateSettings({ autoBackupFolder: `${root}/library` });
          const item = await window.nodus.createGlobalLibraryItem({ title: 'Packaged synthetic PDF', itemType: 'report', creators: [] }, []);
          await window.nodus.addGlobalLibraryAttachments(item.id);
          const notebook = await window.nodus.saveResearchNotebook({ name: 'Packaged PDF extraction', mode: 'fixed', sources: [{ kind: 'library-item', id: item.id }], exclusions: [] });
          await window.nodus.prepareResearchDocuments([item.id]);
          return notebook;
        }, root);
      } finally { await app.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.installerOpenDialog; delete globalThis.installerOpenDialog; }); }
    }
    const deadline = Date.now() + 150000;
    let evidence;
    do {
      evidence = (await page.evaluate(id => window.nodus.searchResearchNotebook(id, 'PACKAGED73'), corpusNotebook.id)).evidence;
      if (evidence.some(item => item.provenance === 'source' && item.text.includes('PACKAGED73'))) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    } while (Date.now() < deadline);
    assert.ok(evidence.some(item => item.provenance === 'source' && item.locator.pageNumber === 1 && item.text.includes('PACKAGED73')), 'packaged extraction and retrieval return original PDF evidence');
    return { passed: true, notebookId: corpusNotebook.id, physicalPage: 1, marker: 'PACKAGED73' };
}
