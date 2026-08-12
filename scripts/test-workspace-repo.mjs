// El Workspace por dentro, contra el repositorio real: el editor completo escribiendo
// sobre una NOTA (historial, comentarios anclados, fragmentos bloqueados, enlaces entre
// notas) y los enlaces persistentes con la biblioteca.
//
// Lo que importa aquí es que una nota se comporte exactamente como un documento de
// estudio, porque el editor es literalmente el mismo componente y no puede saber cuál de
// los dos tiene delante.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-workspace-repo-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-workspace-repo.mjs'), '--electron-workspace-repo-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-workspace-repo-'));
installRuntimeHooks(root);

try {
  const notes = require(path.join(repoRoot, 'electron/db/notesRepo.ts'));
  const workspace = require(path.join(repoRoot, 'electron/db/workspaceRepo.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));

  assert.ok(SCHEMA_VERSION >= 130, 'the Workspace needs schema v130 or later');
  assert.equal(getDb().pragma('user_version', { simple: true }), SCHEMA_VERSION);

  // ── Colecciones y notas ────────────────────────────────────────────────────────
  const collection = notes.createNoteFolder({ name: 'Capítulo primero' });
  assert.equal(collection.sourceRef, null, 'a collection the user made has no provenance');
  const note = notes.createNote({ title: 'Nota inicial', content: '# Nota inicial\n\nPrimer cuerpo.', folderId: collection.id });
  const other = notes.createNote({ title: 'Nota vecina', content: 'Cuerpo vecino.' });

  // ── Historial ──────────────────────────────────────────────────────────────────
  let data = workspace.getWorkspaceNoteEditorData(note.id);
  assert.deepEqual(data.versions, [], 'a fresh note has no history');
  assert.equal(data.style.fontFamily, 'serif', 'the default page style is the editor default');
  assert.equal(data.spellcheckLanguage, 'es-ES');

  const complex = `# Nota inicial\n\nTexto **fuerte**, una tabla y un enlace [[Nota vecina|la vecina]].\n\n| a | b |\n| --- | --- |\n| 1 | 2 |`;
  const saved = workspace.updateWorkspaceNote(note.id, {
    title: 'Nota revisada',
    contentMarkdown: complex,
    style: { fontFamily: 'sans', fontSize: 19 },
    customDictionary: ['Milkdown', 'Nodus'],
    reason: 'manual',
  });
  assert.equal(saved.content, complex, 'clean Markdown round-trips exactly');
  assert.equal(saved.title, 'Nota revisada');

  data = workspace.getWorkspaceNoteEditorData(note.id);
  assert.equal(data.versions.length, 1, 'the previous state is kept as a version');
  assert.equal(data.versions[0].contentMarkdown, '# Nota inicial\n\nPrimer cuerpo.', 'the version holds the text as it was');
  assert.equal(data.style.fontFamily, 'sans', 'the page style is persisted per note');
  assert.deepEqual(data.customDictionary, ['Milkdown', 'Nodus']);

  // Saving the identical content again must not grow the history.
  workspace.updateWorkspaceNote(note.id, { title: 'Nota revisada', contentMarkdown: complex, reason: 'autosave' });
  assert.equal(workspace.getWorkspaceNoteEditorData(note.id).versions.length, 1, 'an unchanged save adds no version');

  // ── Enlaces entre notas, leídos del texto ──────────────────────────────────────
  assert.deepEqual(
    data.outgoingLinks.map((link) => [link.targetRef, link.targetDocumentId, link.linkText]),
    [['Nota vecina', other.id, 'la vecina']],
    'a wiki link resolves to the note it names'
  );
  assert.deepEqual(
    workspace.getWorkspaceNoteEditorData(other.id).backlinks.map((link) => link.sourceDocumentId),
    [note.id],
    'the linked note sees the backlink'
  );

  // ── Restaurar una versión ──────────────────────────────────────────────────────
  const restored = workspace.restoreWorkspaceNoteVersion(note.id, data.versions[0].id);
  assert.equal(restored.content, '# Nota inicial\n\nPrimer cuerpo.', 'restoring brings the old text back');
  assert.equal(
    workspace.getWorkspaceNoteEditorData(note.id).versions.length, 2,
    'restoring archives the text it replaced, so nothing is lost either way'
  );

  // ── Comentarios anclados y fragmentos bloqueados ───────────────────────────────
  const annotation = workspace.createWorkspaceAnnotation(note.id, {
    from: 2, to: 14, selectedText: 'Nota inicial', comment: 'Revisar el título.', locked: true,
  });
  assert.equal(workspace.getWorkspaceNoteEditorData(note.id).annotations.length, 1);
  assert.throws(
    () => workspace.updateWorkspaceNote(note.id, { title: 'Nota', contentMarkdown: 'Se ha borrado todo.' }),
    /fragmento bloqueado/,
    'a save that would erase a locked fragment is refused'
  );
  assert.equal(
    notes.getNote(note.id).content, '# Nota inicial\n\nPrimer cuerpo.',
    'the refused save left the note untouched'
  );
  workspace.updateWorkspaceAnnotation(annotation.id, { locked: false, resolved: true });
  const resolved = workspace.getWorkspaceNoteEditorData(note.id).annotations[0];
  assert.equal(resolved.locked, false);
  assert.ok(resolved.resolvedAt, 'resolving stamps the moment');
  workspace.updateWorkspaceNote(note.id, { title: 'Nota', contentMarkdown: 'Ahora sí.' });

  // ── Enlaces con la biblioteca ──────────────────────────────────────────────────
  workspace.addWorkspaceLibraryLink({ ownerKind: 'note', ownerId: note.id, libraryItemId: 'lib-1', label: 'Un artículo' });
  workspace.addWorkspaceLibraryLink({ ownerKind: 'note', ownerId: note.id, libraryItemId: 'lib-2', scope: 'vault', label: 'Un libro' });
  workspace.addWorkspaceLibraryLink({ ownerKind: 'collection', ownerId: collection.id, libraryItemId: 'lib-1', label: 'Un artículo' });
  assert.equal(workspace.listWorkspaceLibraryLinks('note', note.id).length, 2, 'a note links to several library items');
  assert.equal(workspace.listWorkspaceLibraryLinks('collection', collection.id).length, 1, 'a collection links too');

  // The same item in two scopes is two links; the same item twice in one scope is one.
  workspace.addWorkspaceLibraryLink({ ownerKind: 'note', ownerId: note.id, libraryItemId: 'lib-1', label: 'Título corregido' });
  const links = workspace.listWorkspaceLibraryLinks('note', note.id);
  assert.equal(links.length, 2, 'linking the same item again does not duplicate it');
  assert.equal(links.find((link) => link.libraryItemId === 'lib-1').label, 'Título corregido', 'it updates the stored label');

  workspace.removeWorkspaceLibraryLink('note', note.id, 'lib-2', 'vault');
  assert.equal(workspace.listWorkspaceLibraryLinks('note', note.id).length, 1);

  // A link whose owner disappears is swept; a link whose library item disappears is NOT
  // — a broken reference must still be shown as broken rather than erasing the record.
  assert.equal(workspace.listAllWorkspaceLibraryLinks().length, 2);
  notes.deleteNote(note.id);
  assert.equal(workspace.pruneWorkspaceLibraryLinks(), 1, 'links of a deleted note are swept');
  assert.equal(workspace.listAllWorkspaceLibraryLinks().length, 1, 'the collection link survives');

  // ── Borrado en cascada ─────────────────────────────────────────────────────────
  assert.equal(
    getDb().prepare('SELECT COUNT(*) AS c FROM note_versions WHERE note_id = ?').get(note.id).c, 0,
    'deleting a note takes its history with it'
  );
  assert.equal(
    getDb().prepare('SELECT COUNT(*) AS c FROM note_annotations WHERE note_id = ?').get(note.id).c, 0,
    'deleting a note takes its comments with it'
  );

  closeDb();
  console.log('Workspace repo test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}
