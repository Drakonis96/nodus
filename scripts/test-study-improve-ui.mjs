import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('study improvement is selection-first, streamed in place and committed to the editor history', async () => {
  const [editor, dialog] = await Promise.all([
    read('src/components/editor/StudyEditor.tsx'),
    read('src/components/editor/StudyImproveDialog.tsx'),
  ]);
  assert.match(editor, /data-testid="study-improve-toggle"/);
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
  assert.match(editor, /replaceAllMarkdown\(base, \{ addToHistory: false \}\)/);
  assert.match(editor, /closeHistory: commitToHistory/);
  assert.match(editor, /data-testid="study-improve-streaming"/);
  assert.match(editor, /bg-teal-50[^]*dark:bg-teal-950/);
  assert.match(editor, /data-testid="study-editor-undo"/);
  assert.match(editor, /data-testid="study-editor-redo"/);
  assert.match(editor, /data-testid="study-synonyms-toggle"/);
  assert.match(editor, /name="thesaurus"/);
  assert.match(editor, /data-testid="study-synonyms-panel"/);
  assert.match(editor, /study-synonyms-option/);
  assert.match(editor, /data-testid="study-synonyms-regenerate"/);
  assert.match(editor, /Historial de esta apertura/);
  assert.match(editor, /previousAlternatives/);
  assert.match(editor, /studySentenceContext/);
  assert.match(editor, /suggestStudySynonyms/);
  assert.doesNotMatch(editor, /study-improve-undo|improveUndo|undoImprovement/);
  assert.doesNotMatch(editor, /event\.key\.toLowerCase\(\) === 'z'/);
  assert.match(editor, /El original permanece intacto/);
  assert.doesNotMatch(dialog, /Transformación libre/);
  assert.doesNotMatch(dialog, /Conservar significado/);
});

test('the compact prompt manager creates prompts and limits the toolbar to four', async () => {
  const dialog = await read('src/components/editor/StudyImproveDialog.tsx');
  assert.match(dialog, /const TOOLBAR_LIMIT = 4/);
  assert.match(dialog, /max-w-2xl/);
  assert.match(dialog, /bg-white[^]*dark:bg-neutral-950/);
  assert.match(dialog, /studyImproveToolbarStyleIds/);
  assert.match(dialog, /createStudyStyle/);
  assert.match(dialog, /validateStudyStylePrompt/);
  assert.match(dialog, /study-style-editor/);
  assert.match(dialog, /study-prompt-title/);
  assert.match(dialog, /study-prompt-text/);
  assert.match(dialog, /IconEmojiPicker/);
  assert.match(dialog, /selected\.description/);
  assert.match(dialog, /máximo de cuatro prompts/);
  assert.doesNotMatch(dialog, /diffWordsWithSpace/);
  assert.doesNotMatch(dialog, /updateStudyStyle|duplicateStudyStyle|archiveStudyStyle|importStudyStyles|exportStudyStyles/);
});
