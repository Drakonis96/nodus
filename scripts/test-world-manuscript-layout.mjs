import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('rules in play reflow their states without crossing a narrow manuscript rail', async () => {
  const rules = await readFile(path.join(repoRoot, 'src/components/world/RulesInPlay.tsx'), 'utf8');

  assert.match(rules, /grid-cols-\[repeat\(auto-fit,minmax\(6rem,1fr\)\)\]/);
  assert.match(rules, /min-h-7 min-w-0 whitespace-normal break-words/);
  assert.match(rules, /min-w-0 rounded border border-neutral-200/);
  assert.match(rules, /flex flex-wrap items-center gap-x-2 gap-y-1/);
  assert.doesNotMatch(rules, /flex shrink-0 gap-0\.5/);
});

test('scene threads give titles, beat text and parties their own readable rows', async () => {
  const threads = await readFile(path.join(repoRoot, 'src/components/world/SceneThreadsPanel.tsx'), 'utf8');

  assert.match(threads, /min-w-0 flex-1 break-words text-xs font-medium leading-5/);
  assert.doesNotMatch(threads, /flex-1 truncate text-xs/);
  assert.match(threads, /grid-cols-\[repeat\(auto-fit,minmax\(4rem,1fr\)\)\]/);
  assert.match(threads, /data-testid="scene-thread-marks"/);
  assert.match(threads, /<textarea[\s\S]*?Qué cambia, en una frase/);
  assert.match(threads, /thread\.parties\.map[\s\S]*?break-words text-\[10px\] leading-4/);
  assert.match(threads, /grid grid-cols-2 gap-1\.5/);
});

test('manuscript workbench buttons grow with wrapped or translated labels', async () => {
  const manuscript = await readFile(path.join(repoRoot, 'src/views/ManuscriptView.tsx'), 'utf8');
  const workbench = manuscript.slice(
    manuscript.indexOf('function SceneWorkbench'),
    manuscript.indexOf('/**', manuscript.indexOf('function SceneWorkbench') + 1),
  );

  assert.match(workbench, /grid-cols-\[repeat\(auto-fit,minmax\(7rem,1fr\)\)\]/);
  assert.equal((workbench.match(/min-h-9 min-w-0 whitespace-normal break-words/g) ?? []).length, 2);
  assert.doesNotMatch(workbench, /className="btn btn-ghost h-7 flex-1/);
  assert.match(workbench, /min-w-0 rounded-xl border border-neutral-200/);
});

test('the manuscript textarea edits a clean projection and serializes links on save', async () => {
  const manuscript = await readFile(path.join(repoRoot, 'src/views/ManuscriptView.tsx'), 'utf8');

  assert.match(manuscript, /const editor = toManuscriptEditor\(text\.text\)/);
  assert.match(manuscript, /setDraft\(editor\.text\)/);
  assert.match(manuscript, /setDraftLinks\(editor\.links\)/);
  assert.match(manuscript, /saveSceneText\(sceneId, fromManuscriptEditor\(text, editorLinks\)\)/);
  assert.match(manuscript, /rebaseManuscriptEditorLinks\(draft, next, current\)/);
  assert.match(manuscript, /replaceCandidate: \(entry, range\) =>/);
});
