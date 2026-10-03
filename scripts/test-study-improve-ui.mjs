import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('study improvement previews the selection and commits it to the editor history', async () => {
  const [editor, dialog, stylesheet] = await Promise.all([
    read('src/components/editor/StudyEditor.tsx'),
    read('src/components/editor/StudyImproveDialog.tsx'),
    read('src/index.css'),
  ]);
  assert.match(editor, /testId: 'study-improve-toggle'/);
  assert.match(editor, /resolveImproveSelection/);
  assert.match(editor, /createPortal/);
  assert.match(editor, /selectionToolbar/);
  assert.match(editor, /data-testid="study-selection-tools-divider"/);
  assert.match(editor, /data-testid="study-selection-text-color"/);
  assert.match(editor, /data-testid="study-selection-heading"/);
  assert.doesNotMatch(editor, /data-testid="study-improve-selection-toolbar"/);
  assert.match(editor, /data-testid=\{`study-quick-improve-/);
  assert.match(editor, /runQuickImprovement/);
  assert.match(editor, /requestAnimationFrame\(flush\)/);
  assert.match(editor, /addToHistory: commitToHistory/);
  assert.match(editor, /if \(improveCancelled\.current\) return;/);
  assert.match(editor, /replaceImprovedSelection\(base, target, result\.text, true\)/);
  assert.match(editor, /closeHistory: commitToHistory/);
  assert.match(editor, /data-testid="study-improve-streaming"/);
  assert.match(editor, /testId: 'study-editor-undo'/);
  assert.match(editor, /testId: 'study-editor-redo'/);
  assert.match(editor, /data-testid="study-synonyms-toggle"/);
  assert.match(editor, /name="aiSynonyms"/);
  assert.doesNotMatch(stylesheet, /\.study-milkdown \.milkdown-toolbar \.study-synonyms-trigger\s*\{[^}]*\b(?:border|background)\s*:/, 'the idle synonyms action must not have persistent framed styling');
  assert.match(editor, /studyStyleIcon/);
  assert.doesNotMatch(editor, /style\.icon\s*\|\|\s*['"]✦|fontSize:\s*size/);
  assert.match(editor, /data-testid="study-synonyms-panel"/);
  assert.match(editor, /study-synonyms-option/);
  assert.match(editor, /data-testid="study-synonyms-regenerate"/);
  assert.match(editor, /Historial de esta apertura/);
  assert.match(editor, /previousAlternatives/);
  assert.match(editor, /studySentenceContext/);
  assert.match(editor, /suggestStudySynonyms/);
  assert.match(editor, /study-improve-undo[^]*runEditorHistory\('undo'\)/);
  assert.doesNotMatch(editor, /improveUndo|undoImprovement/);
  assert.doesNotMatch(editor, /event\.key\.toLowerCase\(\) === 'z'/);
  assert.match(editor, /El original permanece intacto/);
  assert.doesNotMatch(dialog, /Transformación libre/);
  assert.doesNotMatch(dialog, /Conservar significado/);
});

test('the compact prompt manager creates prompts and limits the toolbar to four', async () => {
  const dialog = await read('src/components/editor/StudyImproveDialog.tsx');
  assert.match(dialog, /const TOOLBAR_LIMIT = 4/);
  assert.match(dialog, /studyImproveToolbarStyleIds/);
  assert.match(dialog, /createStudyStyle/);
  assert.match(dialog, /validateStudyStylePrompt/);
  assert.match(dialog, /study-style-editor/);
  assert.match(dialog, /study-prompt-title/);
  assert.match(dialog, /study-prompt-text/);
  assert.match(dialog, /IconEmojiPicker/);
  assert.match(dialog, /allowEmoji=\{false\}/);
  assert.match(dialog, /studyStyleIcon/);
  assert.match(dialog, /selected\.description/);
  assert.match(dialog, /máximo de cuatro prompts/);
  assert.doesNotMatch(dialog, /diffWordsWithSpace/);
  assert.doesNotMatch(dialog, /duplicateStudyStyle|archiveStudyStyle|importStudyStyles|exportStudyStyles/);
});

test('only user prompts can be edited or deleted, and deleting asks first', async () => {
  const [dialog, repo] = await Promise.all([
    read('src/components/editor/StudyImproveDialog.tsx'),
    read('electron/db/studyStylesRepo.ts'),
  ]);
  // Controls stay visible, but presets remain read-only.
  for (const action of ['edit', 'delete']) {
    assert.match(dialog, new RegExp(`data-testid="study-prompt-${action}"[^>]*disabled=\\{busy \\|\\| selected\\.builtIn\\}`));
  }
  assert.match(dialog, /data-testid="study-prompt-edit"/);
  assert.match(dialog, /data-testid="study-prompt-delete"/);
  assert.match(dialog, /updateStudyStyle\(editing\.id/);
  // Deleting goes through the confirmation modal, never straight from the button.
  assert.match(dialog, /setPendingDeletion\(selected\)/);
  assert.match(dialog, /<ConfirmModal[^]*danger[^]*onConfirm=\{\(\) => void deletePrompt\(pendingDeletion\)\}/);
  assert.doesNotMatch(dialog, /onClick=\{\(\) => void deletePrompt\(selected\)\}/);
  // A deleted prompt cannot stay pinned to the writing toolbar.
  assert.match(dialog, /deleteStudyStyle\(style\.id\)[^]*studyImproveToolbarStyleIds: nextIds/);
  // The presets are the app's own, so the repository refuses to touch them at all.
  assert.match(repo, /if \(current\.builtIn\) throw new Error\('Los estilos predefinidos se duplican antes de editarlos\.'\)/);
  assert.match(repo, /export function deleteStudyStyle[^]*current\.builtIn[^]*Solo se pueden eliminar estilos personalizados/);
  // Editing must not be a way around the prompt guard that creation enforces.
  assert.match(repo, /export function updateStudyStyle[^]*validateStudyStylePrompt[^]*sustituir las reglas/);
});
