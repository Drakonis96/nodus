// Runs both real PDF translation modes through the production preload + IPC stack.
// Usage:
//   NODUS_TRANSLATE_VERIFY_USERDATA=/path/to/profile \
//   node scripts/verify-toolkit-translate-real-pdf.mjs input.pdf output-dir [language]
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const inputPath = path.resolve(process.argv[2] || '');
const outputRoot = path.resolve(process.argv[3] || path.join(repoRoot, 'tmp', 'pdfs', 'example-real'));
const targetLanguage = process.argv[4] || 'fr';
const userData = process.env.NODUS_TRANSLATE_VERIFY_USERDATA;
const translateImageText = process.env.NODUS_TRANSLATE_VERIFY_IMAGE_TEXT === '1';
const pruneHistory = process.env.NODUS_TRANSLATE_VERIFY_PRUNE_HISTORY === '1';
assert.ok(process.argv[2], 'Pass an input PDF path.');
assert.ok(userData, 'Set NODUS_TRANSLATE_VERIFY_USERDATA to a profile with a configured model.');

await Promise.all([
  mkdir(path.join(outputRoot, 'facsimile'), { recursive: true }),
  mkdir(path.join(outputRoot, 'reflow'), { recursive: true }),
]);

const childEnv = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
};
delete childEnv.ELECTRON_RUN_AS_NODE;

let app;
const reports = [];
try {
  app = await electron.launch({ executablePath: require('electron'), args: [repoRoot, '--no-sandbox'], env: childEnv });
  const page = await app.firstWindow();
  page.setDefaultTimeout(60_000);
  await page.waitForFunction(() => typeof window.nodus?.runTranslateJob === 'function');
  const settings = await page.evaluate(() => window.nodus.getSettings());
  assert.ok(settings.synthesisModel?.provider && settings.synthesisModel?.model, 'The profile has no synthesis model.');
  if (pruneHistory) {
    await page.evaluate(async () => {
      const entries = await window.nodus.listTranslateHistory();
      await Promise.all(entries.map((entry) => window.nodus.removeTranslateHistory(entry.id, false)));
    });
  }

  for (const mode of ['facsimile', 'reflow']) {
    let lastBucket = -1;
    const result = await page.evaluate(async ({ inputPath, outputDir, targetLanguage, model, mode, translateImageText }) => {
      const progress = [];
      const result = await window.nodus.runTranslateJob({
        inputKind: 'files', inputPaths: [inputPath], sourceLanguage: 'English', targetLanguage,
        model, outputFormat: 'pdf', pdfMode: mode, translateImageText,
        glossary: '', outputDir, openFolderOnDone: false,
      }, { onProgress: (event) => progress.push(event) });
      return { result, progress };
    }, { inputPath, outputDir: path.join(outputRoot, mode), targetLanguage, model: settings.synthesisModel, mode, translateImageText });
    for (const event of result.progress) {
      const bucket = Math.floor(event.pct * 10);
      if (bucket > lastBucket) {
        lastBucket = bucket;
        process.stdout.write(`[real-pdf] ${mode} ${Math.round(event.pct * 100)}% ${event.message}\n`);
      }
    }
    assert.equal(result.result.cancelled, false, `${mode} translation was cancelled`);
    assert.equal(result.result.outputs.length, 1, `${mode} produces one output`);
    reports.push({ mode, model: settings.synthesisModel, ...result.result.outputs[0] });
  }
  await writeFile(path.join(outputRoot, 'report.json'), `${JSON.stringify(reports, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
} finally {
  if (app) await app.close().catch(() => undefined);
}
