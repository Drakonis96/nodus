import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('published manuscript rows preserve the Desktop spine without shipping prose in the catalogue', async () => {
  const corpus = await read('server/lib/routes/corpus.mjs');
  const snapshot = await read('electron/serverSync/serverSnapshot.ts');
  const surfaces = await read('src/serverWeb/vaults/index.tsx');
  assert.match(snapshot, /'world_scene_text'/);
  assert.match(snapshot, /'world_chapter_breaks'/);
  assert.match(snapshot, /'world_manuscript_starts'/);
  assert.match(corpus, /head === 'world-scenes'[\s\S]*?manuscript_word_count/);
  assert.match(corpus, /chapter: chapters\.get\(String\(scene\.scene_id\)\)/);
  assert.match(corpus, /book: books\.get\(String\(scene\.scene_id\)\)/);
  assert.match(surfaces, /function ManuscriptCatalogRich/);
  assert.match(surfaces, /data-testid="manuscript-spine"/);
  assert.match(surfaces, /manuscript_word_count/);
  assert.match(surfaces, /Latidos, reglas e hilos/);
});

test('primary-source dossier exposes normalized text/evidence while excluding local file details', async () => {
  const corpus = await read('server/lib/routes/corpus.mjs');
  const surfaces = await read('src/serverWeb/vaults/index.tsx');
  assert.match(corpus, /const textVersions = rows\(snapshot, 'archive_text_versions'\)/);
  assert.match(corpus, /segments: rows\(snapshot, 'archive_text_segments'\)/);
  assert.match(corpus, /const evidence = rows\(snapshot, 'record_evidence'\)/);
  assert.match(corpus, /profile: rows\(snapshot, 'archive_item_profiles'\)/);
  assert.match(corpus, /file_id: _fileId/);
  assert.match(surfaces, /function ArchiveItemDetailRich/);
  assert.match(surfaces, /labels:.*Fuente.*Descripción.*Texto.*Evidencias.*Análisis.*Notas.*Historial/);
  assert.match(surfaces, /data-testid="archive-item-dossier-rich"/);
  assert.match(surfaces, /Versiones de texto/);
  assert.match(surfaces, /Evidencias vinculadas/);
  assert.match(surfaces, /onOpenRecord\?\.\('persons'/);
});

test('editing vault surfaces remain publication-safe and never claim server mutation', async () => {
  const snapshot = await read('electron/serverSync/serverSnapshot.ts');
  const surfaces = await read('src/serverWeb/vaults/index.tsx');
  assert.match(snapshot, /'archive_text_versions', 'archive_text_segments'/);
  assert.doesNotMatch(snapshot, /'archive_item_files'/);
  assert.match(surfaces, /Notas privadas/);
  assert.match(surfaces, /El historial local.*permanecen privados/);
  assert.match(surfaces, /function DatabaseDetail/);
  assert.match(surfaces, /attachments/);
  assert.match(surfaces, /Abrir lector completo/);
  assert.match(surfaces, /onOpenRecord\('testimony-transcripts'/);
});
