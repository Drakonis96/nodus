import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('..', import.meta.url).pathname;
const view = fs.readFileSync(`${root}/src/serverWeb/PersonalViews.tsx`, 'utf8');
const types = fs.readFileSync(`${root}/src/serverWeb/types.ts`, 'utf8');
const store = fs.readFileSync(`${root}/server/lib/userArtifacts.mjs`, 'utf8');

test('Workspace server has a private artifact-backed parity surface', () => {
  assert.match(view, /export function PrivateNotesServerView/);
  assert.match(view, /workspace-collection/);
  assert.match(view, /workspace-server-create-collection/);
  assert.match(view, /workspace-server-markdown-editor/);
  assert.match(view, /workspace-server-markdown-preview/);
  assert.match(view, /workspace-server-bulk-actions/);
  assert.match(view, /workspace-server-scope-trash/);
  assert.match(view, /serverWorkspacePublished/);
  assert.match(view, /api\.updateArtifact/);
  assert.match(view, /api\.deleteArtifact/);
});

test('Workspace private collections are a supported isolated artifact kind', () => {
  assert.match(types, /UserArtifactKind = .*workspace-collection/);
  assert.match(store, /workspace-note', 'workspace-collection'/);
});

test('Published Workspace rows remain read-only and are not mutated through Electron APIs', () => {
  assert.match(view, /published: true/);
  assert.match(view, /serverWorkspacePublished\(active\)/);
  assert.doesNotMatch(view, /window\.nodus\.(createNote|moveNote|trashNotes|deleteNotesPermanently)/);
});
