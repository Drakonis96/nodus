// One report exported from the reader: the format the user picked in the native
// save dialog is what gets written, and a Word export embeds the report's figures
// instead of leaving an asset directory beside it.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { PDFDocument } from 'pdf-lib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');

const tmp = await mkdtemp(path.join(root, 'node_modules', '.nodus-report-export-'));
test.after(async () => { await rm(tmp, { recursive: true, force: true }); });

const hooks = {
  savePath: path.join(tmp, 'informe.docx'),
  lastDialog: null,
  visuals: new Map(),
  // A real PDF: the professional report layout is stamped page by page afterwards.
  pdf: async () => (await (await PDFDocument.create()).save()).buffer,
};
globalThis.__nodusReportExportHooks = hooks;

let stubCount = 0;
const virtual = (filter, contents) => {
  const namespace = `stub-${(stubCount += 1)}`;
  return {
    name: namespace,
    setup(builder) {
      builder.onResolve({ filter }, (args) => ({ path: args.path, namespace }));
      builder.onLoad({ filter: /.*/, namespace }, () => ({ contents, loader: 'js' }));
    },
  };
};

const outfile = path.join(tmp, 'report.mjs');
await build({
  entryPoints: [path.join(root, 'electron/export/writingWorkshopExport.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  alias: { '@shared': path.join(root, 'shared') },
  plugins: [
    virtual(/^electron$/, `
      const hooks = globalThis.__nodusReportExportHooks;
      export const app = { getPath: () => hooks.savePath.replace(/[^/]*$/, '') };
      export const dialog = {
        showSaveDialog: async (options) => {
          hooks.lastDialog = options;
          return hooks.savePath ? { canceled: false, filePath: hooks.savePath } : { canceled: true, filePath: undefined };
        },
      };
      export class BrowserWindow {}
    `),
    virtual(/writingDraftsRepo$/, `
      export const getWritingWorkshopDraft = () => null;
    `),
    virtual(/decorativeImagesRepo$/, `
      export const getDecorativeImage = () => null;
      export const getDecorativeImageData = () => null;
    `),
    virtual(/ai\/documentVisuals$/, `
      export const getDocumentVisuals = (target) => globalThis.__nodusReportExportHooks.visuals.get(target.id) ?? null;
    `),
    virtual(/db\/settingsRepo$/, `
      export const getSettings = () => ({ uiLanguage: 'es' });
    `),
    virtual(/htmlToPdf$/, `
      export const htmlToPdfBytes = async () => globalThis.__nodusReportExportHooks.pdf();
    `),
  ],
  logLevel: 'silent',
});
const { exportWritingWorkshopDraft } = await import(pathToFileURL(outfile).href);

const FIGURE_POSTER = `data:image/png;base64,${Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQz0AEYBxVSF8FANHkAwHsoxvFAAAAAElFTkSuQmCC',
  'base64',
).toString('base64')}`;

const draft = (body = 'Cuerpo del informe.') => ({
  title: 'Informe de prueba',
  abstract: 'Resumen.',
  draftMarkdown: `## Sección\n\n${body}`,
  outline: [{ title: 'Sección', purpose: 'Explicar.', keyClaims: ['Una afirmación'], sources: [] }],
  matrix: [],
  nextSteps: [],
  bibliography: [],
  stats: { selectedWorks: 1 },
  brief: { kind: 'deep_research', objective: 'Objetivo', language: 'es' },
  selection: {},
  generatedAt: '2026-01-01T00:00:00.000Z',
});

const documentXml = (file) => new AdmZip(fs.readFileSync(file)).readAsText('word/document.xml');

test('a Word export writes the document the reader asked for', async () => {
  hooks.savePath = path.join(tmp, 'informe.docx');
  const result = await exportWritingWorkshopDraft({ draft: draft(), format: 'docx' });

  assert.equal(result.path, hooks.savePath);
  assert.match(hooks.lastDialog.defaultPath, /informe-de-prueba\.docx$/);
  assert.deepEqual(hooks.lastDialog.filters[0], { name: 'Word', extensions: ['docx'] }, 'the requested format leads the filter list');
  assert.deepEqual(hooks.lastDialog.filters.map((filter) => filter.extensions[0]).sort(), ['docx', 'md', 'pdf'], 'every format stays reachable from the dialog');
  assert.equal(fs.readFileSync(hooks.savePath).subarray(0, 2).toString('latin1'), 'PK');
  const xml = documentXml(hooks.savePath);
  assert.match(xml, /Informe de prueba/);
  assert.match(xml, /Cuerpo del informe\./);
  assert.equal(fs.existsSync(path.join(tmp, 'informe-assets')), false, 'no asset directory beside a Word export');
});

test('switching the extension in the dialog decides the format, both ways', async () => {
  hooks.savePath = path.join(tmp, 'cambiada.md');
  await exportWritingWorkshopDraft({ draft: draft(), format: 'docx' });
  assert.match(fs.readFileSync(hooks.savePath, 'utf8'), /Cuerpo del informe\./, 'asked for Word, saved as Markdown');

  hooks.savePath = path.join(tmp, 'cambiada.docx');
  await exportWritingWorkshopDraft({ draft: draft(), format: 'markdown' });
  assert.match(documentXml(hooks.savePath), /Cuerpo del informe\./, 'asked for Markdown, saved as Word');

  hooks.savePath = path.join(tmp, 'cambiada.pdf');
  await exportWritingWorkshopDraft({ draft: draft(), format: 'markdown' });
  assert.match(fs.readFileSync(hooks.savePath).subarray(0, 4).toString('latin1'), /^%PDF/, 'asked for Markdown, saved as PDF');
});

test('a report with a figure embeds it in the Word document', async () => {
  hooks.visuals = new Map([['saved-1', {
    blocks: [{ id: 'body:9', field: 'body', index: 9, markdown: 'Cuerpo del informe.' }],
    figures: [{ id: 'f1', blockId: 'body:9', state: 'ready', poster: FIGURE_POSTER, caption: 'Una figura', sources: [] }],
  }]]);
  hooks.savePath = path.join(tmp, 'ilustrado.docx');
  try {
    await exportWritingWorkshopDraft({ draft: draft(), format: 'docx', entityId: 'saved-1' });
    const bytes = fs.readFileSync(hooks.savePath);
    const media = new AdmZip(bytes).getEntries().filter((entry) => !entry.isDirectory && entry.entryName.startsWith('word/media/'));
    assert.equal(media.length, 1, 'the figure is inside the document');
    assert.equal(new AdmZip(bytes).readFile(media[0]).toString('base64'), FIGURE_POSTER.split(',')[1]);
    assert.doesNotMatch(new AdmZip(bytes).readAsText('word/document.xml'), /figure-f1\.png/);
    assert.equal(fs.existsSync(path.join(tmp, 'ilustrado-assets')), false);
  } finally {
    hooks.visuals = new Map();
  }
});

test('the Markdown export still writes its figures beside the file', async () => {
  hooks.visuals = new Map([['saved-1', {
    blocks: [{ id: 'body:9', field: 'body', index: 9, markdown: 'Cuerpo del informe.' }],
    figures: [{ id: 'f1', blockId: 'body:9', state: 'ready', poster: FIGURE_POSTER, caption: 'Una figura', sources: [] }],
  }]]);
  hooks.savePath = path.join(tmp, 'con-figura.md');
  try {
    await exportWritingWorkshopDraft({ draft: draft(), format: 'markdown', entityId: 'saved-1' });
    assert.match(fs.readFileSync(hooks.savePath, 'utf8'), /!\[Una figura\]\(con-figura-assets\/figure-f1\.png\)/);
    assert.equal(fs.existsSync(path.join(tmp, 'con-figura-assets', 'figure-f1.png')), true, 'the asset travels beside the Markdown');
  } finally {
    hooks.visuals = new Map();
  }
});

test('dismissing the dialog writes nothing', async () => {
  hooks.savePath = '';
  const result = await exportWritingWorkshopDraft({ draft: draft(), format: 'docx' });
  assert.equal(result, null);
  hooks.savePath = path.join(tmp, 'informe.docx');
});

test('every export surface offers the Word format', async () => {
  const read = (file) => fs.promises.readFile(path.join(root, file), 'utf8');
  const [shared, research, workshop, database] = await Promise.all([
    read('src/views/writingShared.tsx'),
    read('src/views/DeepResearchView.tsx'),
    read('src/views/WritingWorkshopView.tsx'),
    read('src/views/DatabaseDeepResearchView.tsx'),
  ]);
  assert.match(shared, /choose\('docx'\)/, 'the reader menu');
  assert.match(shared, /onExport: \(format: WritingWorkshopExportFormat\) => void/, 'the action bar takes every format');
  assert.match(research, /\{ value: 'docx', label: 'Word \(\.docx\)'/, 'the bulk download dialog');
  assert.match(workshop, /const exportDraft = async \(format: WritingWorkshopExportFormat\)/, 'the workshop reader');
  assert.match(database, /\["markdown", "pdf", "docx", "zip"\] as const/, 'the database research reader');
});
