import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const view = fs.readFileSync(new URL('../src/views/ArchiveView.tsx', import.meta.url), 'utf8');
const modal = fs.readFileSync(new URL('../src/components/GenealogyArchiveEntryModal.tsx', import.meta.url), 'utf8');
const ipc = fs.readFileSync(new URL('../electron/ipc.ts', import.meta.url), 'utf8');
const preload = fs.readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8');

test('genealogy Archive uses one add action and one complete ordered modal', () => {
  assert.match(view, /isGenealogy \? \(\s*<ArchiveActionButton label=\{t\('Añadir entrada'\)\} icon="plus"/);
  const columns = ['title', 'description', 'file', 'docType', 'year', 'persons', 'source', 'tags', 'folders', 'text'];
  let cursor = 0;
  for (const id of columns) {
    const next = view.indexOf(`{ id: '${id}'`, cursor);
    assert.ok(next >= cursor, `column ${id} follows the modal order`);
    cursor = next + 1;
  }
  for (const section of ['1. Información básica', '2. Clasificación', '3. Personas y procedencia', '4. Organización', '5. Archivo o referencia', '6. Texto o transcripción']) {
    assert.match(modal, new RegExp(section.replace('.', '\\.')));
  }
  assert.match(modal, /DocTypeForm/);
  assert.match(modal, /personIds/);
  assert.match(modal, /folderIds/);
  assert.match(modal, /extractedText/);
});

test('archive entry attachments accept every file type, drag-drop, and Zotero', () => {
  assert.match(ipc, /archive:chooseEntryFiles[\s\S]*Todos los archivos[\s\S]*extensions: \['\*'\]/);
  assert.match(modal, /getPathForDroppedFile/);
  assert.match(modal, /zoteroLibraries/);
  assert.match(modal, /zoteroItemAttachments/);
  assert.match(ipc, /archive:importZoteroEntry/);
  assert.match(preload, /importZoteroArchiveEntry/);
  assert.match(ipc, /ingestArchiveFile\(filePath/);
});
