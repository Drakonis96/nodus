// Regression guard: Study/Teaching grading remains human or deterministic local logic.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(path.join(repoRoot, relative), 'utf8');

test('student answers cannot reach an AI grading route', async () => {
  assert.equal(existsSync(path.join(repoRoot, 'electron/ai/studyGrading.ts')), false);
  const [ipc, preload, api, studyTasks] = await Promise.all([
    read('electron/ipc.ts'),
    read('electron/preload.ts'),
    read('shared/types.ts'),
    read('shared/studyAi.ts'),
  ]);
  for (const source of [ipc, preload, api]) {
    assert.doesNotMatch(source, /['"]study:grading:run['"]|gradeStudyAnswer|cancelStudyGrading/);
  }
  assert.doesNotMatch(studyTasks, /['"]grading['"]/);
});

test('manual gradebook and deterministic answer matching remain separate from AI', async () => {
  const [ipc, engine, immersion] = await Promise.all([
    read('electron/ipc.ts'),
    read('shared/assessment/engine.ts'),
    read('electron/ai/immersion.ts'),
  ]);
  assert.match(ipc, /study:grading:manual/);
  assert.match(engine, /grading|score/i);
  assert.match(immersion, /assessment: null/);
  assert.doesNotMatch(immersion, /respuesta_del_estudiante|EVALUA LA RESPUESTA|open → AI|heuristic fallback/i);
});
