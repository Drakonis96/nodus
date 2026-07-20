// F0 — PDF Presenter library, exercised end to end. The pure model/reducers
// (@shared/presenterTypes) and the filesystem layer (electron/toolkit/presenter/
// library.ts) are esbuild-bundled and driven directly; every assertion is on real
// behaviour — bytes actually copied, JSON round-tripped, the original untouched —
// never mere file existence.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-presenter-'));

function bundle(entry) {
  const out = path.join(outDir, `${path.basename(entry).replace(/\W+/g, '_')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [
      path.join(repoRoot, entry),
      '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
      `--alias:@shared=${path.join(repoRoot, 'shared')}`,
      `--outfile=${out}`,
    ],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  return require(out);
}

const types = bundle('shared/presenterTypes.ts');
const lib = bundle('electron/toolkit/presenter/library.ts');

test.after(() => rm(outDir, { recursive: true, force: true }));

// ── Pure model / reducers ─────────────────────────────────────────────────────
test('normalizeLibrary tolerates legacy array and fills missing fields', () => {
  const legacy = types.normalizeLibrary([{ id: 'a', name: 'A' }]);
  assert.equal(legacy.presentations.length, 1);
  assert.deepEqual(legacy.folders, []);
  assert.deepEqual(legacy.presentations[0].notes, {});
  assert.deepEqual(legacy.presentations[0].videos, {});
  assert.equal(legacy.presentations[0].totalPages, 0);
  assert.deepEqual(types.normalizeLibrary(null), { presentations: [], folders: [] });
});

test('queryPresentations filters by folder + accent-insensitive search and sorts', () => {
  const base = types.emptyLibrary();
  const withAll = [
    { id: '1', name: 'Canción', createdAt: '2026-01-01T00:00:00Z', folder: 'f1', totalPages: 1, notes: {}, videos: {} },
    { id: '2', name: 'Zebra', createdAt: '2026-03-01T00:00:00Z', folder: '', totalPages: 1, notes: {}, videos: {} },
    { id: '3', name: 'Alpha', createdAt: '2026-02-01T00:00:00Z', folder: 'f1', totalPages: 1, notes: {}, videos: {} },
  ].reduce((acc, p) => types.upsertPresentation(acc, p), base);

  // Accent/case-insensitive: "cancion" matches "Canción".
  assert.deepEqual(types.queryPresentations(withAll, { search: 'cancion' }).map((p) => p.id), ['1']);
  // Folder filter.
  assert.deepEqual(types.queryPresentations(withAll, { folder: 'f1', sort: 'name-asc' }).map((p) => p.id), ['3', '1']);
  // recent-added is newest first by createdAt.
  assert.deepEqual(types.queryPresentations(withAll, { sort: 'recent-added' }).map((p) => p.id), ['2', '3', '1']);
  assert.deepEqual(types.queryPresentations(withAll, { sort: 'name-desc' }).map((p) => p.id), ['2', '1', '3']);
});

test('removeFolder re-homes its presentations to the root instead of deleting them', () => {
  let l = types.addFolder(types.emptyLibrary(), { id: 'f1', name: 'F', createdAt: 'x' });
  l = types.upsertPresentation(l, { id: '1', name: 'P', createdAt: 'x', folder: 'f1', totalPages: 0, notes: {}, videos: {} });
  const after = types.removeFolder(l, 'f1');
  assert.equal(after.folders.length, 0);
  assert.equal(after.presentations.length, 1);
  assert.equal(after.presentations[0].folder, '');
});

test('reducers never mutate their input', () => {
  const l = types.upsertPresentation(types.emptyLibrary(), { id: '1', name: 'P', createdAt: 'x', folder: '', totalPages: 0, notes: {}, videos: {} });
  const renamed = types.renamePresentation(l, '1', 'Q');
  assert.equal(l.presentations[0].name, 'P'); // original untouched
  assert.equal(renamed.presentations[0].name, 'Q');
  assert.notEqual(l, renamed);
});

test('setNote sets and clears a per-slide note', () => {
  const p = { id: '1', name: 'P', createdAt: 'x', folder: '', totalPages: 3, notes: {}, videos: {} };
  const withNote = types.setNote(p, 2, 'hola');
  assert.equal(withNote.notes['2'], 'hola');
  assert.equal(types.noteCount(withNote), 1);
  const cleared = types.setNote(withNote, 2, '   ');
  assert.equal(cleared.notes['2'], undefined);
  assert.equal(types.noteCount(cleared), 0);
  assert.deepEqual(p.notes, {}); // input untouched
});

// ── Filesystem layer ──────────────────────────────────────────────────────────
test('importPdf copies the file, registers it, and leaves the original untouched', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-presenter-lib-'));
  const srcDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-presenter-src-'));
  const src = path.join(srcDir, 'Mi Charla.pdf');
  const bytes = Buffer.from('%PDF-1.4 fake but distinctive bytes', 'utf-8');
  fs.writeFileSync(src, bytes);

  assert.deepEqual(lib.readLibrary(dir), { presentations: [], folders: [] });

  const p = lib.importPdf(dir, src);
  assert.equal(p.name, 'Mi Charla');
  assert.equal(p.fileName, 'Mi Charla.pdf');
  assert.equal(p.totalPages, 0);

  // The copy exists and matches the source bytes...
  assert.deepEqual(lib.readPdfBytes(dir, p.id), bytes);
  // ...and the ORIGINAL is untouched (golden rule of the Toolkit).
  assert.deepEqual(fs.readFileSync(src), bytes);
  assert.ok(fs.existsSync(src));

  // It was persisted (a fresh read sees it).
  assert.equal(lib.readLibrary(dir).presentations.length, 1);

  // A second import yields a distinct id + file.
  const p2 = lib.importPdf(dir, src);
  assert.notEqual(p.id, p2.id);
  assert.equal(lib.readLibrary(dir).presentations.length, 2);

  await rm(dir, { recursive: true, force: true });
  await rm(srcDir, { recursive: true, force: true });
});

test('deletePresentation removes the entry and the copy, and is idempotent', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-presenter-del-'));
  const src = path.join(dir, 'seed.pdf');
  fs.writeFileSync(src, Buffer.from('x'));
  const p = lib.importPdf(dir, src);
  const copy = lib.pdfPath(dir, p.id);
  assert.ok(fs.existsSync(copy));

  lib.deletePresentation(dir, p.id);
  assert.equal(lib.readLibrary(dir).presentations.length, 0);
  assert.equal(fs.existsSync(copy), false);
  // Idempotent: deleting again does not throw.
  lib.deletePresentation(dir, p.id);

  await rm(dir, { recursive: true, force: true });
});

test('readLibrary recovers from a corrupt meta file instead of throwing', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-presenter-corrupt-'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'library.json'), '{ this is not json');
  assert.deepEqual(lib.readLibrary(dir), { presentations: [], folders: [] });
  await rm(dir, { recursive: true, force: true });
});
