// AI OCR — the processing manager + the filesystem store, with a MOCK model and MOCK
// rasterizer (no AI, no canvas/pdfjs). Asserts: the happy path persists pages + a
// transcript, retryable errors are retried, non-retryable errors mark the page (once),
// page concurrency is bounded, unfinished docs resume, and a single page reprocesses.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const bundleDir = await mkdtemp(path.join(repoRoot, 'node_modules', '.nodus-aiocr-mgr-'));
const esbuild = (entry, out) => execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, entry),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
    `--alias:@shared=${path.join(repoRoot, 'shared')}`,
    `--outfile=${path.join(bundleDir, out)}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' },
);
esbuild('electron/toolkit/aiOcr/store.ts', 'store.cjs');
esbuild('electron/toolkit/aiOcr/manager.ts', 'manager.cjs');
const { createOcrStore } = require(path.join(bundleDir, 'store.cjs'));
const { createOcrManager } = require(path.join(bundleDir, 'manager.cjs'));

const tmpDirs = [];
async function freshStore() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-aiocr-store-'));
  tmpDirs.push(dir);
  return createOcrStore(path.join(dir, 'ai-ocr'));
}
function fakeSource(kind = 'pdf') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-aiocr-src-'));
  tmpDirs.push(dir);
  const p = path.join(dir, `src.${kind === 'pdf' ? 'pdf' : 'png'}`);
  fs.writeFileSync(p, Buffer.from('dummy source bytes'));
  return p;
}
const options = { outputMode: 'structured', processingMode: 'ocr', removeReferences: true };
const model = { provider: 'openai', model: 'gpt' };
const noSleep = () => Promise.resolve();

/** A mock rasterizer that emits `pages` fake page images. */
function fakePdfRasterizer(pageCount) {
  return async (_src, _opts, onPage, signal) => {
    const out = [];
    for (let i = 1; i <= pageCount; i++) {
      if (signal?.cancelled) break;
      const page = { pageNumber: i, mediaType: 'image/jpeg', buffer: Buffer.from(`img${i}`), width: 100, height: 140 };
      out.push(page);
      if (onPage) await onPage(page, i, pageCount);
    }
    return out;
  };
}
const fakeImageRasterizer = async () => ({ pageNumber: 1, mediaType: 'image/jpeg', buffer: Buffer.from('img'), width: 100, height: 140 });

async function waitFor(fn, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('waitFor timed out');
}

let counter = 0;
const nextId = () => `doc-${++counter}`;

test.after(async () => {
  await rm(bundleDir, { recursive: true, force: true });
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true });
});

test('happy path: rasterizes, OCRs every page, writes a transcript', async () => {
  const store = await freshStore();
  const manager = createOcrManager({
    store,
    rasterizePdf: fakePdfRasterizer(3),
    rasterizeImage: fakeImageRasterizer,
    ocrPage: async () => ({ result: { blankPage: false, blocks: [{ text: 'Texto de página', label: 'MAIN_TEXT' }] }, mode: 'structured' }),
    sleep: noSleep,
  });
  const id = nextId();
  await manager.createDocument({ id, name: 'Doc', sourcePath: fakeSource(), sourceKind: 'pdf', model, options });
  await waitFor(() => store.readDoc(id)?.status === 'done');
  const doc = store.readDoc(id);
  assert.equal(doc.pageCount, 3);
  assert.ok(doc.pages.every((p) => p.status === 'done'), 'all pages done');
  assert.equal(doc.pages[0].mode, 'structured');
  const transcript = store.readTranscript(id);
  assert.equal((transcript.match(/Texto de página/g) || []).length, 3, 'transcript has all pages');
  assert.equal(store.listDocs().find((s) => s.id === id).doneCount, 3, 'index reflects progress');
});

test('retryable failure is retried then succeeds', async () => {
  const store = await freshStore();
  let calls = 0;
  const manager = createOcrManager({
    store,
    rasterizePdf: fakePdfRasterizer(1),
    rasterizeImage: fakeImageRasterizer,
    ocrPage: async () => {
      calls++;
      if (calls === 1) throw new Error('rate limit exceeded');
      return { result: { blankPage: false, blocks: [{ text: 'ok', label: 'MAIN_TEXT' }] }, mode: 'structured' };
    },
    sleep: noSleep,
    maxRetries: 2,
  });
  const id = nextId();
  await manager.createDocument({ id, name: 'Retry', sourcePath: fakeSource(), sourceKind: 'pdf', model, options });
  await waitFor(() => store.readDoc(id)?.status === 'done');
  assert.equal(calls, 2, 'called twice (one retry)');
  assert.equal(store.readDoc(id).pages[0].status, 'done');
});

test('non-retryable failure marks the page error without retrying', async () => {
  const store = await freshStore();
  let calls = 0;
  const manager = createOcrManager({
    store,
    rasterizePdf: fakePdfRasterizer(1),
    rasterizeImage: fakeImageRasterizer,
    ocrPage: async () => { calls++; throw new Error('invalid api key'); },
    sleep: noSleep,
    maxRetries: 3,
  });
  const id = nextId();
  await manager.createDocument({ id, name: 'Fail', sourcePath: fakeSource(), sourceKind: 'pdf', model, options });
  await waitFor(() => store.readDoc(id)?.status === 'error');
  assert.equal(calls, 1, 'not retried for a deterministic error');
  const doc = store.readDoc(id);
  assert.equal(doc.pages[0].status, 'error');
  assert.match(doc.pages[0].lastError, /invalid api key/);
});

test('page concurrency stays within the configured limit', async () => {
  const store = await freshStore();
  let current = 0;
  let peak = 0;
  const manager = createOcrManager({
    store,
    rasterizePdf: fakePdfRasterizer(6),
    rasterizeImage: fakeImageRasterizer,
    ocrPage: async () => {
      current++;
      peak = Math.max(peak, current);
      await new Promise((r) => setTimeout(r, 10));
      current--;
      return { result: { blankPage: false, blocks: [{ text: 'x', label: 'MAIN_TEXT' }] }, mode: 'structured' };
    },
    sleep: noSleep,
    concurrency: 2,
  });
  const id = nextId();
  await manager.createDocument({ id, name: 'Conc', sourcePath: fakeSource(), sourceKind: 'pdf', model, options });
  await waitFor(() => store.readDoc(id)?.status === 'done');
  assert.ok(peak <= 2, `peak concurrency ${peak} within limit`);
  assert.ok(peak >= 2, 'actually ran pages in parallel');
});

test('resume picks up a document left mid-flight by a crash', async () => {
  const store = await freshStore();
  const id = nextId();
  // Simulate a crash: a doc with an already-rendered page stuck in "processing".
  store.writeSource(id, 'source.pdf', Buffer.from('x'));
  store.writePageImage(id, 'page_0001.jpg', Buffer.from('img1'));
  store.putDoc({
    id, name: 'Resumed', sourceFile: 'source.pdf', sourceKind: 'pdf', status: 'processing',
    model, options, pageCount: 1,
    pages: [{ index: 0, status: 'processing', imageFile: 'page_0001.jpg', mediaType: 'image/jpeg' }],
    createdAt: 1, updatedAt: 1, error: null,
  });
  const manager = createOcrManager({
    store,
    rasterizePdf: fakePdfRasterizer(1),
    rasterizeImage: fakeImageRasterizer,
    ocrPage: async () => ({ result: { blankPage: false, blocks: [{ text: 'recuperado', label: 'MAIN_TEXT' }] }, mode: 'structured' }),
    sleep: noSleep,
  });
  await manager.resume();
  await waitFor(() => store.readDoc(id)?.status === 'done');
  const doc = store.readDoc(id);
  assert.equal(doc.pages[0].status, 'done', 'the stuck page was reset and completed');
  assert.match(store.readTranscript(id), /recuperado/);
});

test('reprocessPage re-runs OCR for a single page', async () => {
  const store = await freshStore();
  let text = 'primera versión';
  const manager = createOcrManager({
    store,
    rasterizePdf: fakePdfRasterizer(2),
    rasterizeImage: fakeImageRasterizer,
    ocrPage: async () => ({ result: { blankPage: false, blocks: [{ text, label: 'MAIN_TEXT' }] }, mode: 'structured' }),
    sleep: noSleep,
  });
  const id = nextId();
  await manager.createDocument({ id, name: 'Re', sourcePath: fakeSource(), sourceKind: 'pdf', model, options });
  await waitFor(() => store.readDoc(id)?.status === 'done');
  text = 'segunda versión';
  await manager.reprocessPage(id, 0);
  await waitFor(() => store.readDoc(id)?.status === 'done' && store.readPageResult(id, 0).blocks[0].text === 'segunda versión');
  assert.equal(store.readPageResult(id, 0).blocks[0].text, 'segunda versión', 'page 0 re-OCRd');
  assert.equal(store.readPageResult(id, 1).blocks[0].text, 'primera versión', 'page 1 untouched');
});

test('editPage saves a manual edit and reverts to the OCR text', async () => {
  const store = await freshStore();
  const manager = createOcrManager({
    store,
    rasterizePdf: fakePdfRasterizer(3),
    rasterizeImage: fakeImageRasterizer,
    ocrPage: async () => ({ result: { blankPage: false, blocks: [{ text: 'Texto OCR', label: 'MAIN_TEXT' }] }, mode: 'structured' }),
    sleep: noSleep,
  });
  const id = nextId();
  await manager.createDocument({ id, name: 'Edit', sourcePath: fakeSource(), sourceKind: 'pdf', model, options });
  await waitFor(() => store.readDoc(id)?.status === 'done');

  await manager.editPage(id, 1, 'PÁGINA EDITADA');
  assert.equal(store.readDoc(id).pages[1].editedText, 'PÁGINA EDITADA');
  let transcript = store.readTranscript(id);
  assert.match(transcript, /PÁGINA EDITADA/, 'the edit shows in the transcript');
  assert.equal((transcript.match(/Texto OCR/g) || []).length, 2, 'the edited page no longer shows the OCR text');

  await manager.editPage(id, 1, null);
  assert.equal(store.readDoc(id).pages[1].editedText, null, 'null reverts the edit');
  transcript = store.readTranscript(id);
  assert.doesNotMatch(transcript, /PÁGINA EDITADA/);
  assert.equal((transcript.match(/Texto OCR/g) || []).length, 3, 'revert restores the OCR text');
});

test('editPage rejects an unknown page index', async () => {
  const store = await freshStore();
  const manager = createOcrManager({
    store,
    rasterizePdf: fakePdfRasterizer(1),
    rasterizeImage: fakeImageRasterizer,
    ocrPage: async () => ({ result: { blankPage: false, blocks: [{ text: 'x', label: 'MAIN_TEXT' }] }, mode: 'structured' }),
    sleep: noSleep,
  });
  const id = nextId();
  await manager.createDocument({ id, name: 'X', sourcePath: fakeSource(), sourceKind: 'pdf', model, options });
  await waitFor(() => store.readDoc(id)?.status === 'done');
  await assert.rejects(() => manager.editPage(id, 9, 'nope'), /no existe/);
});

test('splitColumns OCRs each column single-column and merges in reading order', async () => {
  const store = await freshStore();
  const singleColumnFlags = [];
  const manager = createOcrManager({
    store,
    rasterizePdf: fakePdfRasterizer(1),
    rasterizeImage: fakeImageRasterizer,
    ocrPage: async (image, opts) => {
      singleColumnFlags.push(opts.singleColumn === true);
      const tag = Buffer.from(image.base64, 'base64').toString('utf8');
      return { result: { blankPage: false, blocks: [{ text: tag, label: 'MAIN_TEXT' }] }, mode: 'structured' };
    },
    splitColumns: async () => [
      { base64: Buffer.from('IZQUIERDA').toString('base64'), mediaType: 'image/jpeg' },
      { base64: Buffer.from('DERECHA').toString('base64'), mediaType: 'image/jpeg' },
    ],
    sleep: noSleep,
  });
  const id = nextId();
  await manager.createDocument({ id, name: 'Cols', sourcePath: fakeSource(), sourceKind: 'pdf', model, options: { ...options, splitColumns: true } });
  await waitFor(() => store.readDoc(id)?.status === 'done');
  const result = store.readPageResult(id, 0);
  assert.deepEqual(result.blocks.map((b) => b.text), ['IZQUIERDA', 'DERECHA'], 'left then right');
  assert.ok(singleColumnFlags.length === 2 && singleColumnFlags.every(Boolean), 'each column ran single-column');
});

test('splitColumns detection failure falls back to the whole page', async () => {
  const store = await freshStore();
  let calls = 0;
  const manager = createOcrManager({
    store,
    rasterizePdf: fakePdfRasterizer(1),
    rasterizeImage: fakeImageRasterizer,
    ocrPage: async () => { calls++; return { result: { blankPage: false, blocks: [{ text: 'entera', label: 'MAIN_TEXT' }] }, mode: 'structured' }; },
    splitColumns: async () => { throw new Error('canvas decode failed'); },
    sleep: noSleep,
  });
  const id = nextId();
  await manager.createDocument({ id, name: 'FB', sourcePath: fakeSource(), sourceKind: 'pdf', model, options: { ...options, splitColumns: true } });
  await waitFor(() => store.readDoc(id)?.status === 'done');
  assert.equal(calls, 1, 'OCRs the whole page once when column detection fails');
  assert.equal(store.readPageResult(id, 0).blocks[0].text, 'entera');
});
