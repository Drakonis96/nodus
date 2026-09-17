// The "save to notes" dialog, rendered for real. The study vault keeps its own notes
// (`study_docs`, shown under "Apuntes y materiales"), a different store from the
// workspace notes the dialog writes by default, so the click path that files an
// answer there — pick the destination, choose where it goes, save, open — is
// exercised against a stubbed preload bridge instead of asserted from source.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-save-study-note-'));
// The bundle lives outside the repo, so it needs a way back to the shared React.
await symlink(path.join(repoRoot, 'node_modules'), path.join(outDir, 'node_modules'));
const bundle = path.join(outDir, 'SaveToNotesModal.cjs');
execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
  path.join(repoRoot, 'src/components/SaveToNotesModal.tsx'),
  '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
  '--loader:.tsx=tsx', '--jsx=automatic', `--tsconfig=${path.join(repoRoot, 'tsconfig.json')}`,
  // The component must share the renderer's React, not carry its own copy.
  '--external:react', '--external:react/jsx-runtime', '--external:react-dom', '--external:react-dom/client',
  `--outfile=${bundle}`,
], { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] });

test.after(() => rm(outDir, { recursive: true, force: true }));

const WORKSPACE = {
  academicYears: [],
  courses: [{ id: 'course-1', name: 'Historia' }],
  subjects: [{ id: 'subject-1', courseId: 'course-1', name: 'Contemporánea' }],
  topics: [{ id: 'topic-1', subjectId: 'subject-1', folderId: 'folder-1', name: 'Revoluciones' }],
  folders: [{ id: 'folder-1', subjectId: 'subject-1', courseId: 'course-1', name: 'Unidad 1' }],
  documents: [],
  placements: [],
  tags: [],
  documentTags: [],
  templates: [],
};

const EMPTY_WORKSPACE = { ...WORKSPACE, courses: [], subjects: [], topics: [], folders: [] };

/** Render the real component in jsdom against a stub of the preload bridge. */
async function renderModal({ workspace = WORKSPACE, ...props } = {}) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://nodus.test/' });
  for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (!(key in globalThis)) globalThis[key] = dom.window[key];
  }
  // Node has its own Event, and jsdom refuses to dispatch a foreign one.
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.navigator = dom.window.navigator;
  globalThis.Event = dom.window.Event;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const calls = { notes: [], documents: [], opened: [], workspaceEvents: 0 };
  dom.window.addEventListener('nodus:study-workspace-changed', () => { calls.workspaceEvents += 1; });
  dom.window.nodus = {
    getNotesTree: async () => ({ folders: [] }),
    listProjects: async () => [],
    createNoteFolder: async () => ({ id: 'folder-new', name: 'Nueva', parentId: null }),
    getStudyWorkspace: async () => workspace,
    createStudyDocument: async (input) => {
      calls.documents.push(input);
      return { id: 'document-1', title: input.title, kind: input.kind, contentMarkdown: input.contentMarkdown };
    },
    createNote: async (input) => {
      calls.notes.push(input);
      return { id: 'note-1', title: input.title, kind: input.kind };
    },
    addProjectLink: async () => undefined,
  };

  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const act = React.act ?? require('react-dom/test-utils').act;
  const { SaveToNotesModal } = require(bundle);
  const container = dom.window.document.getElementById('root');
  const root = createRoot(container);
  const click = async (element) => act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  const choose = async (testId, value) => {
    const select = container.querySelector(`[data-testid="${testId}"]`);
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set;
    await act(async () => {
      setter.call(select, value);
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
  };
  await act(async () => {
    root.render(React.createElement(SaveToNotesModal, {
      content: '# Tema 2\n\nLa respuesta que el usuario leyó.',
      defaultTitle: 'Tema 2',
      kind: 'assistant',
      destinationLabel: 'Espacio de trabajo',
      onClose: () => undefined,
      ...props,
    }));
  });
  return { container, click, choose, calls };
}

test('an answer is saved as a study note in the subject the user picks', async () => {
  const opened = [];
  const { container, click, choose, calls } = await renderModal({
    studyDocument: { onOpenSavedDocument: (id) => opened.push(id) },
  });
  assert.equal(calls.documents.length, 0, 'nothing is written before the user saves');

  await click(container.querySelector('[data-testid="save-note-destination-study"]'));
  await choose('save-note-study-subject', 'subject-1');
  const save = container.querySelector('[data-testid="save-note-save"]');
  assert.equal(save.disabled, false, 'a chosen subject enables the save');
  await click(save);

  assert.equal(calls.notes.length, 0, 'the workspace note store is left alone');
  assert.equal(calls.documents.length, 1);
  const [document] = calls.documents;
  assert.equal(document.kind, 'apunte');
  assert.deepEqual(document.placement, { courseId: 'course-1', subjectId: 'subject-1', folderId: null, topicId: null });
  assert.ok(document.contentMarkdown.startsWith('# Tema 2\n\nLa respuesta que el usuario leyó.'), 'the answer is stored unchanged');
  assert.match(document.contentMarkdown, /\*\*Procedencia:\*\*/);
  assert.equal(calls.workspaceEvents, 1, 'the vault is told to refresh its workspace');

  const destination = container.querySelector('[data-testid="save-note-destination"]');
  assert.ok(container.querySelector('[data-testid="save-note-success"]'), 'the confirmation stays on screen');
  assert.match(destination.textContent, /Historia/);
  assert.match(destination.textContent, /Contemporánea/);

  await click(container.querySelector('[data-testid="save-note-open"]'));
  assert.deepEqual(opened, ['document-1'], 'the saved note can be opened where the vault lists it');
});

test('the study destination files the note in the folder and topic it was given', async () => {
  const { container, click, choose, calls } = await renderModal({ studyDocument: {} });
  await click(container.querySelector('[data-testid="save-note-destination-study"]'));
  assert.equal(container.querySelector('[data-testid="save-note-save"]').disabled, true, 'no subject, no save');
  await choose('save-note-study-subject', 'subject-1');
  await choose('save-note-study-folder', 'folder-1');
  await choose('save-note-study-topic', 'topic-1');
  await click(container.querySelector('[data-testid="save-note-save"]'));
  assert.equal(calls.documents.length, 1);
  assert.deepEqual(calls.documents[0].placement, { courseId: 'course-1', subjectId: 'subject-1', folderId: 'folder-1', topicId: 'topic-1' });
  assert.match(container.querySelector('[data-testid="save-note-destination"]').textContent, /Unidad 1/);
});

test('the workspace note stays the default and is still what saves when nothing is chosen', async () => {
  const { container, click, calls } = await renderModal({ studyDocument: {} });
  assert.ok(container.querySelector('[data-testid="save-note-destination-note"]'), 'both destinations are offered');
  await click(container.querySelector('[data-testid="save-note-save"]'));
  assert.equal(calls.notes.length, 1, 'the default destination keeps writing a workspace note');
  assert.equal(calls.documents.length, 0);
  assert.equal(calls.notes[0].folderId, null);
  assert.equal(calls.notes[0].kind, 'assistant');
  assert.ok(container.querySelector('[data-testid="save-note-success"]'));
});

test('a vault with no courses explains the empty destination instead of offering a dead end', async () => {
  const { container, click, calls } = await renderModal({ studyDocument: {}, workspace: EMPTY_WORKSPACE });
  await click(container.querySelector('[data-testid="save-note-destination-study"]'));
  assert.match(container.textContent, /Aún no hay cursos/);
  assert.equal(container.querySelector('[data-testid="save-note-save"]').disabled, true);
  assert.equal(calls.documents.length, 0);
});

test('a dialog without the study destination is unchanged', async () => {
  const { container, click, calls } = await renderModal();
  assert.equal(container.querySelector('[data-testid="save-note-destination-study"]'), null, 'no switch is rendered');
  assert.ok(container.querySelector('[data-testid="save-note-save"]'), 'the plain save is there');
  await click(container.querySelector('[data-testid="save-note-save"]'));
  assert.equal(calls.notes.length, 1);
  assert.equal(calls.documents.length, 0);
});
