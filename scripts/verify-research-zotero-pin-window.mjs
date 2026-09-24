import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';

/** Real disposable Zotero, real Deep Research run, simulated model behind the real
 * proxy. The run pins the Zotero original, then its agent decides to read it; the
 * attachment bytes are replaced exactly between the pin and that read. */
export async function verifyZoteroPinWindow(page, root, corpus, documents, control, index = 2) {
  const entry = corpus.items[index];
  const source = documents.find(document => document.origin.itemKey === entry.key);
  assert.ok(source);
  await page.evaluate(async () => {
    await window.nodus.setApiKey('deepseek', 'simulated-deepseek-key');
    await window.nodus.setApiKey('openrouter', 'simulated-openrouter-key');
  });
  const notebook = await page.evaluate(id => window.nodus.saveResearchNotebook({ name: 'Pin window', mode: 'fixed', sources: [{ kind: 'library-item', id }], exclusions: [] }), source.id);
  const zoteroFile = fs.realpathSync(entry.attachment.path);
  assert.ok(zoteroFile.startsWith(`${root}${path.sep}zotero${path.sep}`));
  const original = fs.readFileSync(zoteroFile);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText('CHANGED99 replaced the original after the run pinned it.', { x: 40, y: 700, size: 12, font });
  const replacement = await pdf.save();
  const localItem = await page.evaluate(id => window.nodus.getGlobalLibraryItem(id), source.id);
  const copied = localItem.attachments.find(item => item.sourceKey === entry.attachment.key);
  const copiedPath = path.join(root, 'library/nodus-library', encodeURIComponent(localItem.storageId).replaceAll('.', '%2E'), copied.relativePath);
  const report = { documentId: source.id, decisions: [] };
  let reached, release;
  const decisionReached = new Promise(resolve => { reached = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  control.behaviour = async (provider, body) => {
    if (provider !== 'deepseek' || !String(body.messages?.[0]?.content ?? '').startsWith('Choose ONE next research action')) return null;
    if (report.decisions.length === 0) {
      report.decisions.push('original');
      reached(); await held;
      return { content: JSON.stringify({ action: 'original', documentId: source.id, from: 1, to: 1 }) };
    }
    report.decisions.push('finish');
    return { content: JSON.stringify({ action: 'finish' }) };
  };
  try {
    const run = page.evaluate(id => window.nodus.generateDeepResearchReport({ notebookId: id, objective: 'What does the east-field source state?',
      deepResearchVersion: 'v2', approach: 'general', language: 'en', sectionLimit: 1, sectionLength: 150, model: { provider: 'deepseek', model: 'deepseek-flash' } }), notebook.id)
      .then(value => ({ ok: true, value }), error => ({ ok: false, error: String(error?.message ?? error) }));
    await decisionReached;
    // The run has pinned the original; now the bytes change before it reads them.
    fs.renameSync(copiedPath, `${copiedPath}.temporarily-unavailable`);
    fs.writeFileSync(zoteroFile, replacement);
    report.replacedAt = 'between pin and read';
    release();
    const result = await run;
    const serialized = JSON.stringify(result);
    report.result = result.ok ? { completed: true, truncated: result.value.draft.stats.truncated, limitations: result.value.draft.researchTraversal?.limitations ?? [],
      partial: result.value.draft.researchTraversal?.partial ?? null, markdown: result.value.draft.draftMarkdown.slice(0, 300) } : result;
    report.replacedTextReturned = serialized.includes('CHANGED99');
    assert.equal(report.replacedTextReturned, false, 'the replaced bytes never reach the report');
    if (result.ok) {
      assert.ok(report.result.limitations.includes('original_revision_changed'), 'the run records that its pinned original changed');
      assert.equal(report.result.partial, true, 'the run is marked partial');
    }
  } finally {
    control.behaviour = null;
    fs.writeFileSync(zoteroFile, original);
    if (fs.existsSync(`${copiedPath}.temporarily-unavailable`)) fs.renameSync(`${copiedPath}.temporarily-unavailable`, copiedPath);
    fs.writeFileSync(path.join(root, 'artifacts/zotero-pin-window.json'), JSON.stringify(report, null, 2));
  }
  return report;
}
