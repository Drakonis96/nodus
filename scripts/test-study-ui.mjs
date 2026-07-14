import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('study vault uses its teal header logo and the shared dock accent', async () => {
  const [app, logo, dock] = await Promise.all([
    read('src/App.tsx'),
    read('src/assets/nodus-logo-teal.svg'),
    read('src/dockIcon.ts'),
  ]);
  assert.match(app, /import nodusLogoTeal/);
  assert.match(app, /isEstudio \? nodusLogoTeal/);
  assert.match(app, /data-vault-logo=.*isEstudio \? 'estudio'/s);
  assert.match(logo, /#0f766e/i);
  assert.match(dock, /type === 'estudio'\) return '#0f766e'/);
});

test('study searches reserve icon space through the common input contract', async () => {
  const [view, css] = await Promise.all([
    read('src/views/StudyOrganizationView.tsx'),
    read('src/index.css'),
  ]);
  assert.match(view, /input input-with-leading-icon w-full/);
  assert.match(css, /\.input\.input-with-leading-icon\s*\{[^}]*padding-left:/s);
  assert.doesNotMatch(view, /className="input w-full pl-/);
});

test('study actions use renderer dialogs and the sidebar has no onboarding spacer', async () => {
  const [view, editor, sidebar] = await Promise.all([
    read('src/views/StudyOrganizationView.tsx'),
    read('src/components/editor/StudyEditor.tsx'),
    read('src/components/StudySidebar.tsx'),
  ]);
  assert.doesNotMatch(`${view}\n${editor}`, /window\.prompt/);
  for (const testId of ['study-create-course', 'study-create-subject', 'study-create-topic', 'study-create-folder', 'study-create-document']) {
    assert.match(view, new RegExp(`data-testid="${testId}"`));
  }
  assert.match(view, /data-testid="study-create-dialog"/);
  assert.match(editor, /TextInputModal/);
  assert.doesNotMatch(sidebar, /Crea tu primer curso para empezar/);
  assert.match(sidebar, /data-testid="study-sidebar-organization" className="mt-2 flex flex-col gap-1"/);
  assert.doesNotMatch(sidebar, /study-sidebar-organization" className="[^"]*flex-1/);
});
