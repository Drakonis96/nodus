// Deep Research — bulk download as one zip.
//
// Bundles the real exporter and drives it against stubbed edges: the save dialog,
// the drafts table and the Chromium printer. What is worth pinning here is not
// "a zip appears" but the three things that are silently wrong otherwise:
//
//  - a zip entry OVERWRITES its namesake, so two reports sharing a title must not
//    share a file name;
//  - a report whose PDF fails must leave NOTHING behind — not even the Markdown
//    that had already rendered — while still being named in `failed`;
//  - dismissing the dialog must write nothing at all.
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

const tmp = await mkdtemp(path.join(root, 'node_modules', '.nodus-dr-archive-'));
test.after(async () => { await rm(tmp, { recursive: true, force: true }); });

/** The stubs read this at call time, so each test can rewire the edges it cares about. */
const hooks = {
  savePath: path.join(tmp, 'informes.zip'),
  drafts: new Map(),
  pdf: async () => (await (await PDFDocument.create()).save()).buffer,
};
globalThis.__nodusArchiveHooks = hooks;

let stubCount = 0;
/** Replace a module specifier with inline source, in its own namespace so filters cannot collide. */
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

const outfile = path.join(tmp, 'archive.mjs');
await build({
  entryPoints: [path.join(root, 'electron/export/writingWorkshopExport.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  // adm-zip and pdf-lib are CommonJS; bundling them into ESM turns their internal
  // require() calls into a runtime error. Left external, node loads them normally.
  packages: 'external',
  alias: { '@shared': path.join(root, 'shared') },
  plugins: [
    virtual(/^electron$/, `
      const hooks = globalThis.__nodusArchiveHooks;
      export const app = { getPath: () => hooks.savePath.replace(/[^/]*$/, '') };
      export const dialog = {
        showSaveDialog: async () => hooks.savePath
          ? { canceled: false, filePath: hooks.savePath }
          : { canceled: true, filePath: undefined },
      };
      export class BrowserWindow {}
    `),
    virtual(/writingDraftsRepo$/, `
      export const getWritingWorkshopDraft = (id) => globalThis.__nodusArchiveHooks.drafts.get(id) ?? null;
    `),
    virtual(/decorativeImagesRepo$/, `
      export const getDecorativeImage = () => null;
      export const getDecorativeImageData = () => null;
    `),
    virtual(/htmlToPdf$/, `
      export const htmlToPdfBytes = async (html) => Buffer.from(await globalThis.__nodusArchiveHooks.pdf(html));
    `),
  ],
  logLevel: 'silent',
});
const { exportDeepResearchArchive } = await import(pathToFileURL(outfile).href);

function savedDraft(id, title, body = 'Cuerpo del informe.') {
  return {
    id,
    title,
    brief: { kind: 'deep_research', objective: `Objetivo de ${title}`, language: 'es' },
    selection: {},
    model: null,
    image: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    draft: {
      title,
      abstract: `Resumen de ${title}.`,
      draftMarkdown: `## Sección\n\n${body}`,
      outline: [{ title: 'Sección', purpose: 'Explicar.', keyClaims: ['Una afirmación'], sources: [] }],
      matrix: [],
      nextSteps: [],
      bibliography: [],
      stats: { selectedWorks: 1 },
      brief: { kind: 'deep_research', objective: `Objetivo de ${title}`, language: 'es' },
      selection: {},
      generatedAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

function seed(...drafts) {
  hooks.drafts = new Map(drafts.map((draft) => [draft.id, draft]));
  return drafts.map((draft) => draft.id);
}

const entries = (zipPath) => new AdmZip(zipPath).getEntries().map((entry) => entry.entryName).sort();

test('a markdown archive holds one file per report, with the report inside it', async () => {
  const ids = seed(savedDraft('a', 'Primer informe', 'Frase reconocible.'), savedDraft('b', 'Segundo informe'));
  hooks.savePath = path.join(tmp, 'md.zip');
  const result = await exportDeepResearchArchive({ ids, format: 'markdown' });

  assert.equal(result.path, hooks.savePath);
  assert.equal(result.count, 2);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(entries(hooks.savePath), ['primer-informe.md', 'segundo-informe.md']);
  const first = new AdmZip(hooks.savePath).readAsText('primer-informe.md');
  assert.match(first, /# Primer informe/);
  assert.match(first, /Frase reconocible\./);
});

test('reports that share a title get distinct entries instead of overwriting each other', async () => {
  const ids = seed(
    savedDraft('a', 'Informe sin título', 'Contenido A.'),
    savedDraft('b', 'Informe sin título', 'Contenido B.'),
    savedDraft('c', 'Informe sin título', 'Contenido C.')
  );
  hooks.savePath = path.join(tmp, 'collide.zip');
  const result = await exportDeepResearchArchive({ ids, format: 'markdown' });

  assert.equal(result.count, 3);
  const names = entries(hooks.savePath);
  assert.equal(names.length, 3, `expected three distinct entries, got ${names.join(', ')}`);
  const zip = new AdmZip(hooks.savePath);
  const bodies = names.map((name) => zip.readAsText(name));
  for (const marker of ['Contenido A.', 'Contenido B.', 'Contenido C.']) {
    assert.ok(bodies.some((body) => body.includes(marker)), `${marker} is missing from the archive`);
  }
});

test('both formats produce a .md and a real .pdf per report', async () => {
  const ids = seed(savedDraft('a', 'Informe doble'));
  hooks.savePath = path.join(tmp, 'both.zip');
  const result = await exportDeepResearchArchive({ ids, format: 'both' });

  assert.equal(result.count, 1);
  assert.deepEqual(entries(hooks.savePath), ['informe-doble.md', 'informe-doble.pdf']);
  const pdf = new AdmZip(hooks.savePath).getEntry('informe-doble.pdf').getData();
  assert.equal(pdf.subarray(0, 4).toString('latin1'), '%PDF');
});

test('a report whose PDF fails is reported and leaves no half-written pair behind', async () => {
  const ids = seed(savedDraft('a', 'Informe bueno'), savedDraft('b', 'Informe roto'));
  hooks.savePath = path.join(tmp, 'partial.zip');
  hooks.pdf = async (html) => {
    if (html.includes('Informe roto')) throw new Error('la impresora falló');
    return (await (await PDFDocument.create()).save()).buffer;
  };
  try {
    const result = await exportDeepResearchArchive({ ids, format: 'both' });

    assert.equal(result.count, 1);
    assert.deepEqual(result.failed, [{ title: 'Informe roto', reason: 'la impresora falló' }]);
    assert.deepEqual(entries(hooks.savePath), ['informe-bueno.md', 'informe-bueno.pdf']);
  } finally {
    hooks.pdf = async () => (await (await PDFDocument.create()).save()).buffer;
  }
});

test('progress is reported around every report, ending on the total', async () => {
  const ids = seed(savedDraft('a', 'Uno'), savedDraft('b', 'Dos'));
  hooks.savePath = path.join(tmp, 'progress.zip');
  const seen = [];
  await exportDeepResearchArchive({ ids, format: 'markdown' }, (done, total) => seen.push([done, total]));

  assert.deepEqual(seen, [[0, 2], [1, 2], [1, 2], [2, 2]]);
});

test('dismissing the save dialog writes nothing and resolves to null', async () => {
  const ids = seed(savedDraft('a', 'Informe'));
  const wouldBe = path.join(tmp, 'never.zip');
  hooks.savePath = '';
  const result = await exportDeepResearchArchive({ ids, format: 'markdown' });

  assert.equal(result, null);
  assert.equal(fs.existsSync(wouldBe), false);
  hooks.savePath = path.join(tmp, 'informes.zip');
});

test('a selection of ids that no longer exist is an error, not an empty zip', async () => {
  seed(savedDraft('a', 'Informe'));
  hooks.savePath = path.join(tmp, 'ghost.zip');
  await assert.rejects(
    () => exportDeepResearchArchive({ ids: ['gone-1', 'gone-2'], format: 'markdown' }),
    /No hay informes que descargar/
  );
  assert.equal(fs.existsSync(hooks.savePath), false);
});
