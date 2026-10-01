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

const folder = (id, parentId = null) => ({ id, parentId, name: id, icon: 'folder', color: '#6366f1', createdAt: 'x' });
const deck = (id, folderId = null) => ({ id, folderId, name: id, fileName: `${id}.pdf`, createdAt: 'x', totalPages: 2, notes: { '1': 'Notas conservadas' }, videos: { '2': { url: 'https://youtu.be/example', x: 0, y: 0, w: 40, h: 30 } } });

test('legacy tags and older folders migrate without losing memberships or notes', () => {
  for (const [collection, membership] of [['tags', 'tag'], ['folders', 'folder']]) {
    const migrated = types.normalizeLibrary({ [collection]: [{ id: 'f1', name: 'Curso', createdAt: 'x' }], presentations: [{ ...deck('a'), folderId: undefined, [membership]: 'f1' }] });
    assert.deepEqual(migrated.folders, [{ ...folder('f1'), name: 'Curso' }]);
    assert.equal(migrated.presentations[0].folderId, 'f1');
    assert.equal(migrated.presentations[0].tag, undefined);
    assert.deepEqual(migrated.presentations[0].notes, deck('a').notes);
    assert.deepEqual(types.queryPresentations(migrated, { folderId: 'f1' }).map(p => p.id), ['a']);
    assert.deepEqual(types.normalizeLibrary(migrated), migrated);
  }
});

test('normalization repairs invalid parents, cycles, orphan decks and unsafe colors', () => {
  const raw = { folders: [folder('a', 'b'), folder('b', 'a'), { ...folder('c', 'missing'), color: 'red;display:none', icon: '<script>' }, folder('a')], presentations: [deck('p', 'missing')] };
  const normalized = types.normalizeLibrary(raw);
  assert.equal(normalized.folders.length, 3);
  assert.equal(normalized.folders[2].parentId, null);
  assert.equal(normalized.folders[2].color, '#6366f1');
  assert.equal(normalized.folders[2].icon, 'folder');
  assert.equal(normalized.presentations[0].folderId, null);
  for (const f of normalized.folders) assert.ok(types.folderPath(normalized, f.id).length <= 3);
  assert.equal(raw.folders[0].parentId, 'b');
});

test('folder queries distinguish the main library, direct children and all presentations', () => {
  const l = { folders: [folder('f1'), folder('sub', 'f1')], presentations: [
    { ...deck('1', 'f1'), name: 'Canción', createdAt: '2026-01-01' },
    { ...deck('2'), name: 'Zebra', createdAt: '2026-03-01' },
    { ...deck('3', 'f1'), name: 'Alpha', createdAt: '2026-02-01' }, deck('4', 'sub'),
  ] };
  assert.deepEqual(types.queryPresentations(l, { folderId: 'f1', search: 'cancion' }).map(p => p.id), ['1']);
  assert.deepEqual(types.queryPresentations(l, { folderId: 'f1', sort: 'name-asc' }).map(p => p.id), ['3', '1']);
  assert.deepEqual(types.queryPresentations(l, { folderId: null }).map(p => p.id), ['2']);
  assert.equal(types.queryPresentations(l).length, 4);
  assert.equal(types.folderCount(l, 'f1'), 2);
  assert.equal(types.folderCount(l, 'f1', true), 3);
  assert.deepEqual(types.folderPath(l, 'sub').map(f => f.id), ['f1', 'sub']);
  assert.deepEqual(types.queryPresentations(l, { sort: 'recent-added' }).slice(1).map(p => p.id), ['2', '3', '1']);
  assert.deepEqual(types.queryPresentations(l, { folderId: 'f1', sort: 'name-desc' }).map(p => p.id), ['1', '3']);
});

test('recursive search reaches nested decks from the main library and respects folder boundaries', () => {
  const l = { folders: [folder('course'), folder('unit', 'course'), folder('chapter', 'unit'), folder('other')], presentations: [
    { ...deck('root'), name: 'Fotografía: introducción' },
    { ...deck('course', 'course'), name: 'Fotografía: teoría' },
    { ...deck('unit', 'unit'), name: 'Fotografía: cámara' },
    { ...deck('chapter', 'chapter'), name: 'Fotografía: retrato' },
    { ...deck('other', 'other'), name: 'Fotografía: archivo' },
    { ...deck('unrelated', 'chapter'), name: 'Pintura' },
  ] };
  const ids = q => types.queryPresentations(l, q).map(p => p.id).sort();
  assert.deepEqual(ids({ folderId: null, search: 'FOTOGRAFIA', recursive: true }), ['chapter', 'course', 'other', 'root', 'unit']);
  assert.deepEqual(ids({ folderId: 'course', search: 'fotografia', recursive: true }), ['chapter', 'course', 'unit']);
  assert.deepEqual(ids({ folderId: 'unit', search: 'fotografia', recursive: true }), ['chapter', 'unit']);
  assert.deepEqual(ids({ folderId: null }), ['root']);
  assert.deepEqual(ids({ folderId: 'course', search: 'fotografia' }), ['course']);
});

test('folders can be created, styled and nested without cycles or input mutation', () => {
  const original = types.addFolder(types.emptyLibrary(), folder('a'));
  const nested = types.addFolder(original, folder('b', 'a'));
  const styled = types.updateFolder(nested, 'b', { name: '  Seminario  ', icon: 'book', color: '#059669', parentId: null });
  assert.equal(styled.folders[1].name, 'Seminario');
  assert.equal(styled.folders[1].icon, 'book');
  assert.equal(styled.folders[1].color, '#059669');
  assert.equal(styled.folders[1].parentId, null);
  assert.equal(nested.folders[1].parentId, 'a');
  assert.equal(original.folders.length, 1);
  assert.equal(types.updateFolder(nested, 'a', { parentId: 'b' }), nested);
  assert.equal(types.updateFolder(nested, 'a', { parentId: 'a' }), nested);
  assert.equal(types.addFolder(nested, folder('orphan', 'missing')), nested);
  assert.equal(types.addFolder(nested, folder('a')), nested);
});

test('moving a deck to a folder and back preserves its notes and videos', () => {
  const l = { folders: [folder('a'), folder('b')], presentations: [deck('1', 'a')] };
  const moved = types.assignFolder(l, '1', 'b');
  assert.equal(moved.presentations[0].folderId, 'b');
  assert.deepEqual(moved.presentations[0].notes, l.presentations[0].notes);
  assert.deepEqual(moved.presentations[0].videos, l.presentations[0].videos);
  assert.equal(types.assignFolder(moved, '1', null).presentations[0].folderId, null);
  assert.equal(types.assignFolder(l, '1', 'missing'), l);
  assert.equal(l.presentations[0].folderId, 'a');
});

test('folder removal applies the policy to the entire subtree and spares unrelated decks', () => {
  const l = { folders: [folder('a'), folder('child', 'a'), folder('other')], presentations: [deck('a', 'a'), deck('child', 'child'), deck('root'), deck('other', 'other')] };
  const kept = types.removeFolder(l, 'a', 'move-to-root');
  assert.deepEqual(kept.folders.map(f => f.id), ['other']);
  assert.equal(kept.presentations.length, 4);
  assert.equal(kept.presentations[1].folderId, null);
  assert.deepEqual(kept.presentations[1].notes, l.presentations[1].notes);
  const deleted = types.removeFolder(l, 'a', 'delete-presentations');
  assert.deepEqual(deleted.presentations.map(p => p.id), ['root', 'other']);
  assert.equal(l.folders.length, 3);
  assert.equal(l.presentations[1].folderId, 'child');
  assert.equal(types.removeFolder(l, 'missing', 'delete-presentations'), l);
});

test('reducers never mutate their input', () => {
  const l = types.upsertPresentation(types.emptyLibrary(), { id: '1', name: 'P', createdAt: 'x', folderId: null, totalPages: 0, notes: {}, videos: {} });
  const renamed = types.renamePresentation(l, '1', 'Q');
  assert.equal(l.presentations[0].name, 'P'); // original untouched
  assert.equal(renamed.presentations[0].name, 'Q');
  assert.notEqual(l, renamed);
});

test('setNote sets and clears a per-slide note', () => {
  const p = { id: '1', name: 'P', createdAt: 'x', folderId: null, totalPages: 3, notes: {}, videos: {} };
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

test('converted imports keep the original presentation name and extracted notes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-presenter-converted-'));
  const generatedPdf = path.join(dir, 'converted.pdf');
  fs.writeFileSync(generatedPdf, Buffer.from('%PDF-1.4 generated'));

  const p = lib.importPdf(dir, generatedPdf, new Date('2026-07-22T10:00:00Z'), {
    originalFileName: 'Seminario.PPTX',
    notes: { '1': 'Primera nota' },
  });
  assert.equal(p.name, 'Seminario');
  assert.equal(p.fileName, 'Seminario.PPTX');
  assert.deepEqual(p.notes, { '1': 'Primera nota' });
  assert.deepEqual(lib.readPdfBytes(dir, p.id), Buffer.from('%PDF-1.4 generated'));

  await rm(dir, { recursive: true, force: true });
});

// The "Download PDF" button is readPdfBytes + a save dialog, so what the user gets
// is exactly the bytes the library holds — and the library copy must survive it.
test('readPdfBytes hands back the exact deck bytes and leaves the library copy in place', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-presenter-download-'));
  const srcDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-presenter-download-src-'));
  const src = path.join(srcDir, 'Clase 1.pdf');
  const bytes = Buffer.from('%PDF-1.7 the deck the user downloads', 'utf-8');
  fs.writeFileSync(src, bytes);
  const p = lib.importPdf(dir, src);

  // What the download handler writes out, byte for byte.
  const downloaded = lib.readPdfBytes(dir, p.id);
  assert.deepEqual(downloaded, bytes);

  // Downloading is a read: the shelf still has the deck afterwards.
  assert.ok(fs.existsSync(lib.pdfPath(dir, p.id)));
  assert.equal(lib.readLibrary(dir).presentations.length, 1);
  assert.deepEqual(lib.readPdfBytes(dir, p.id), bytes);

  // A deck whose copy is gone yields null, which the UI reports instead of
  // writing an empty file.
  assert.equal(lib.readPdfBytes(dir, 'does-not-exist'), null);

  await rm(dir, { recursive: true, force: true });
  await rm(srcDir, { recursive: true, force: true });
});

test('readLibrary recovers from a corrupt meta file instead of throwing', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-presenter-corrupt-'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'library.json'), '{ this is not json');
  assert.deepEqual(lib.readLibrary(dir), { presentations: [], folders: [] });
  await rm(dir, { recursive: true, force: true });
});

for (const mode of ['move-to-root', 'delete-presentations']) {
  test(`filesystem folder deletion (${mode}) persists its policy and never touches originals`, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-presenter-folders-'));
    const source = path.join(dir, 'original.pdf');
    fs.writeFileSync(source, '%PDF-1.4 source stays');
    try {
      const first = lib.importPdf(dir, source), child = lib.importPdf(dir, source), loose = lib.importPdf(dir, source);
      const data = { folders: [folder('a'), folder('child', 'a')], presentations: [ { ...first, folderId: 'a', notes: { '1': 'Keep me' } }, { ...child, folderId: 'child' }, loose ] };
      lib.writeLibrary(dir, data);
      assert.throws(() => lib.deleteFolder(dir, 'a', 'invalid'));
      assert.equal(lib.readLibrary(dir).folders.length, 2);
      const result = lib.deleteFolder(dir, 'a', mode);
      assert.deepEqual(lib.readLibrary(dir), result);
      assert.equal(result.folders.length, 0);
      assert.equal(fs.readFileSync(source, 'utf8'), '%PDF-1.4 source stays');
      assert.equal(fs.existsSync(lib.pdfPath(dir, loose.id)), true);
      for (const p of [first, child]) assert.equal(fs.existsSync(lib.pdfPath(dir, p.id)), mode === 'move-to-root');
      if (mode === 'move-to-root') {
        assert.equal(result.presentations.length, 3);
        assert.equal(result.presentations[0].folderId, null);
        assert.equal(result.presentations[0].notes['1'], 'Keep me');
      } else assert.deepEqual(result.presentations.map(p => p.id), [loose.id]);
      assert.deepEqual(lib.deleteFolder(dir, 'a', mode), result);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}
