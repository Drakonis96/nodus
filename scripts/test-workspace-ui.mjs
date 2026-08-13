// El Espacio de trabajo: la sección que unifica Notas, Escritura y Proyectos en la bóveda
// académica.
//
// Comprueba las tres promesas que se le hicieron a esta vista y que un refactor podría
// romper sin que ningún tipo se queje: que reutiliza de verdad la Biblioteca (su tira de
// pestañas, su cabecera, sus paneles) en vez de imitarla; que el editor es el MISMO de
// Estudio y Docencia y no una segunda implementación; y que la unificación es exclusiva
// de la bóveda académica, también cuando la sección conserva el nombre Notas.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource, assertApiMethods, assertChannelsWired } from './ipc-channel-census.mjs';

test('the Workspace unifies notes, ideas and collections in one Library-shaped view', async () => {
  const view = await readSource('src/views/WorkspaceView.tsx');
  const tabs = await readSource('src/components/library/LibraryWorkspaceTabs.tsx');

  for (const marker of [
    'workspace-view', 'workspace-header', 'workspace-create-note', 'workspace-create-idea',
    'workspace-create-collection', 'workspace-collections-pane', 'workspace-item-list',
    'workspace-search', 'workspace-kind-filter', 'workspace-scope-all', 'workspace-scope-unfiled',
    'workspace-tag-filter', 'workspace-scope-trash', 'workspace-select-all', 'workspace-table-header',
    'workspace-bulk-actions', 'workspace-context-menu', 'workspace-item-tags',
  ]) {
    assert.match(view, new RegExp(`data-testid="${marker}"`), `the Workspace exposes ${marker}`);
  }

  // Los dos iconos acordados: la nota y la bombilla.
  assert.match(view, /KIND_ICON: Record<WorkspaceItemKind, string> = \{ note: 'notebook', idea: 'bulb' \}/,
    'notes use the note icon and ideas the lightbulb');

  // La tira de pestañas es LA de la Biblioteca, no una copia.
  assert.match(view, /import \{ WorkspaceTabStrip \} from '\.\.\/components\/library\/LibraryWorkspaceTabs'/,
    'the Workspace reuses the Library tab strip instead of writing its own');
  assert.match(tabs, /export function WorkspaceTabStrip/, 'the strip is shared, not duplicated');
  assert.match(view, /homeTestId="workspace-tab-home"/, 'the Workspace itself is the fixed first tab');
  assert.match(view, /tabs=\{openTabs\.map\(\(note\) => \(\{ key: note\.id, title: note\.title, icon: KIND_ICON\[itemKind\(note\)\] \}\)\)\}/,
    'every open note or idea gets a tab, so several stay open at once');
  assert.match(view, /\$\{active \? 'hidden' : ''\}/, 'the browser stays mounted behind an open document');

  // Y la cabecera y los paneles son los de la Biblioteca.
  for (const shared of ['library-theme-canvas', 'library-header-bar', 'library-theme-panel', 'library-catalog-scroll']) {
    assert.match(view, new RegExp(shared), `the Workspace reuses the Library surface class ${shared}`);
  }
});

test('the Workspace catalogue has Library-grade tags, bulk actions, context actions and recoverable trash', async () => {
  const [view, repo, migration] = await Promise.all([
    readSource('src/views/WorkspaceView.tsx'), readSource('electron/db/notesRepo.ts'), readSource('electron/db/migrations.ts'),
  ]);

  assert.match(view, /type="checkbox"[\s\S]{0,240}workspace-select-all|workspace-select-all[\s\S]{0,240}type="checkbox"/, 'the catalogue can select every visible row');
  assert.match(view, /onContextMenu=\{\(event\)/, 'rows expose the same right-click gesture as the global Library');
  for (const action of ['workspace-bulk-tag', 'workspace-bulk-move', 'workspace-bulk-trash', 'workspace-bulk-restore', 'workspace-bulk-delete-permanently']) {
    assert.match(view, new RegExp(`data-testid="${action}"`), `bulk actions expose ${action}`);
  }
  assert.match(view, /patchNoteTags/, 'tags are editable both in details and in bulk');
  assert.match(view, /getNotesTree\(true\)/, 'the Workspace deliberately requests trash while other note consumers do not');
  assert.match(view, /trashNoteFolder/, 'removing a collection preserves its contents in trash');

  assert.match(migration, /ALTER TABLE notes ADD COLUMN tags_json TEXT NOT NULL DEFAULT '\[\]'/, 'tags persist in the vault');
  assert.match(migration, /ALTER TABLE notes ADD COLUMN trashed_at TEXT/, 'soft deletion persists in the vault');
  assert.match(repo, /export function trashNotes/, 'items have a soft-delete repository operation');
  assert.match(repo, /export function restoreNotes/, 'items can be restored');
  assert.match(repo, /UPDATE notes SET folder_id = NULL, trashed_at = \?/, 'collection deletion detaches items before the FK cascade');

  assertApiMethods(assert, ['patchNoteTags', 'trashNotes', 'restoreNotes', 'deleteNotesPermanently', 'trashNoteFolder']);
  assertChannelsWired(assert, ['notes:tags:patch', 'notes:trash', 'notes:restore', 'notes:deletePermanently', 'notes:folders:trash']);
});

test('the Workspace edits notes and ideas with the Study and Teaching editor', async () => {
  const view = await readSource('src/views/WorkspaceView.tsx');
  const port = await readSource('src/components/editor/documentPort.ts');
  const editor = await readSource('src/components/editor/StudyEditor.tsx');

  assert.match(view, /import\('\.\.\/components\/editor\/StudyEditor'\)/, 'it is literally the Study editor');
  assert.match(view, /port=\{workspaceNotePort\}/, 'only the row it saves to is injected');
  assert.match(view, /showTabs=\{false\}/, 'the editor drops its own tabs because the Workspace provides them');

  // Sin puerto, el editor sigue siendo el de Estudio: Estudio y Docencia no cambian.
  assert.match(editor, /const port = portProp \?\? \(studyDocumentPort as EditorDocumentPort\)/,
    'the study behaviour remains the default, so existing call sites are untouched');
  assert.match(editor, /showTabs \? \(/, 'the tab strip is optional but still the default');
  assert.match(editor, /data-testid="editor-title"/, 'without tabs the title stays editable in a title bar');
  assert.match(view, /onTestimonyLink=\{onTestimonyLink\}/, 'testimonial notes preserve their interview deep links');
  assert.match(editor, /onTestimonyLink=\{onTestimonyLink\}/, 'the shared preview forwards testimony links to Markdown');

  // El puerto cubre todo lo que el editor necesita, incluido el registro de mejoras.
  for (const method of ['loadEditorData', 'save', 'restoreVersion', 'createAnnotation', 'updateAnnotation', 'improveTarget', 'listLinkTargets', 'linkHref']) {
    assert.match(port, new RegExp(`${method}[(:]`), `the port covers ${method}`);
  }
  assert.match(port, /improveTarget: \(noteId\) => \(\{ noteId \}\)/, 'an improvement on a note is logged against the note');
  assert.match(port, /improveTarget: \(documentId\) => \(\{ documentId \}\)/, 'an improvement on a study document is logged against the document');
  assert.doesNotMatch(editor, /window\.nodus\.(getStudyDocEditorData|updateStudyDoc|restoreStudyDocVersion|createStudyAnnotation|updateStudyAnnotation)\(/,
    'the editor no longer reaches for a study-specific channel directly');
});

test('notes, ideas and collections link to library items, and the links persist', async () => {
  const view = await readSource('src/views/WorkspaceView.tsx');
  const repo = await readSource('electron/db/workspaceRepo.ts');
  const migrations = await readSource('electron/db/migrations.ts');

  assert.match(migrations, /CREATE TABLE workspace_library_links[\s\S]*owner_kind[\s\S]*IN \('note','collection'\)/,
    'both a document and a collection can own links');
  assert.match(migrations, /PRIMARY KEY \(owner_kind, owner_id, library_item_id, scope\)/,
    'the same item cannot be linked twice within one scope');
  assert.doesNotMatch(migrations, /library_item_id TEXT NOT NULL REFERENCES/,
    'no foreign key to the library: global items live in another database');

  assert.match(view, /ownerKind="note"/, 'a note or idea can be linked');
  assert.match(view, /ownerKind="collection"/, 'a collection can be linked too');
  assert.match(view, /listWorksPage[\s\S]{0,200}listGlobalLibraryItems/, 'the picker searches both library scopes at once');
  assert.match(repo, /pruneWorkspaceLibraryLinks/, 'links whose owner disappeared are swept');

  assertApiMethods(assert, [
    'getWorkspaceNoteEditorData', 'updateWorkspaceNote', 'restoreWorkspaceNoteVersion',
    'createWorkspaceAnnotation', 'updateWorkspaceAnnotation', 'deleteWorkspaceAnnotation',
    'listWorkspaceLibraryLinks', 'listAllWorkspaceLibraryLinks',
    'addWorkspaceLibraryLink', 'removeWorkspaceLibraryLink',
  ]);
  assertChannelsWired(assert, [
    'workspace:editor:data', 'workspace:editor:update', 'workspace:editor:restore',
    'workspace:annotation:create', 'workspace:annotation:update', 'workspace:annotation:delete',
    'workspace:library:list', 'workspace:library:all', 'workspace:library:add', 'workspace:library:remove',
  ]);
});

test('every vault uses the Workspace experience without losing its own section name', async () => {
  const [navigation, vaultTypes, registry, app] = await Promise.all([
    readSource('src/navigation.ts'), readSource('shared/vaultTypes.ts'),
    readSource('src/app/views/corpus.tsx'), readSource('@shell'),
  ]);

  assert.match(navigation, /\{ id: 'workspace', label: 'Espacio de trabajo', icon: 'notebook', group: 'create' \}/,
    'the Workspace is a sidebar section of the writing group');
  assert.match(vaultTypes, /workspace: \['academic'\]/, 'only the academic route is named Workspace');
  for (const replaced of ['writing', 'projects', 'notes']) {
    const scoped = new RegExp(`${replaced}: \\[(?!'academic')`);
    assert.match(vaultTypes, scoped, `${replaced} is no longer offered in the academic vault`);
    assert.match(vaultTypes, new RegExp(`${replaced}: \\[[^\\]]*'genealogy'`), `${replaced} survives untouched elsewhere`);
  }
  assert.match(registry, /workspace: \(\{ navigate, noteTarget, settings \}\)/, 'the academic Workspace is routable');
  assert.match(registry, /notes:[\s\S]*<WorkspaceView[\s\S]*title="Notas"/,
    'general Notes routes reuse the same Workspace catalogue, tabs and editor');
  assert.match(registry, /isPrimarySources[\s\S]*<PrimarySourcesNotesView/,
    'primary sources keeps its evidence-aware note implementation');
  assert.match(app, /setView\(isAcademic \? 'workspace' : 'notes'\)/,
    'opening a note from search lands wherever that vault keeps its notes');
});
