// Regression test for long renderer generations surviving view unmounts.
// The real store is bundled, while window.nodus is replaced with deterministic
// fakes so no Electron process, provider call or database is needed.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-background-jobs-test-'));

const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

try {
  const outfile = path.join(tmp, 'backgroundJobs.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'src/backgroundJobs.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const jobs = await import(pathToFileURL(outfile).href);

  let releaseImmersion;
  const immersionGate = new Promise((resolve) => {
    releaseImmersion = resolve;
  });
  let immersionCalls = 0;
  let deepCalls = 0;
  let saveCalls = 0;
  let databaseTextCalls = 0;
  let databaseImageCalls = 0;
  let releaseDatabaseText;
  let releaseDatabaseImage;
  const databaseTextGate = new Promise((resolve) => {
    releaseDatabaseText = resolve;
  });
  const databaseImageGate = new Promise((resolve) => {
    releaseDatabaseImage = resolve;
  });
  const fakeSession = { id: 'imm-1', topic: 'Tema recuperable' };
  const fakeReport = {
    draft: { title: 'Informe recuperable', brief: { kind: 'deep_research' } },
    meta: { sections: 4, pages: 9, ideasCovered: 12 },
  };
  const fakeSaved = { id: 'saved-1', title: 'Informe recuperable' };

  globalThis.window = {
    nodus: {
      generateImmersionSession: async (_request, handlers) => {
        immersionCalls += 1;
        handlers?.onProgress?.({ phase: 'station', message: 'Estación 2', stationIndex: 2, stationTotal: 4 });
        await immersionGate;
        handlers?.onProgress?.({ phase: 'done', message: 'Lista' });
        return fakeSession;
      },
      generateDeepResearchReport: async (_request, handlers) => {
        deepCalls += 1;
        handlers?.onProgress?.({ phase: 'section', message: 'Sección 3', sectionIndex: 3, sectionTotal: 4 });
        await Promise.resolve();
        return fakeReport;
      },
      saveWritingWorkshopDraft: async () => {
        saveCalls += 1;
        return fakeSaved;
      },
      runDatabaseAiCell: async (rowId, columnId) => {
        databaseTextCalls += 1;
        if (rowId === 'row-fail') throw new Error('provider unavailable');
        await databaseTextGate;
        return `generated:${rowId}:${columnId}`;
      },
      generateDatabaseAiImage: async (rowId, columnId) => {
        databaseImageCalls += 1;
        await databaseImageGate;
        return { id: 'image-1', rowId, columnId, fileName: 'generated.png' };
      },
    },
  };

  // Start the immersion, then unsubscribe exactly as a React view does when the
  // user navigates away. The request must keep running and retain its progress.
  const seenBeforeUnmount = [];
  const unsubscribe = jobs.subscribeBackgroundJob(jobs.IMMERSION_GENERATION_JOB_KEY, (job) => {
    seenBeforeUnmount.push(job?.status ?? null);
  });
  const first = jobs.startImmersionGeneration({
    scope: { topic: 'Tema recuperable' },
    request: { topic: 'Tema recuperable', language: 'es', minutes: 150, includeQuiz: true, model: null },
  });
  const duplicate = jobs.startImmersionGeneration({
    scope: { topic: 'No debe reemplazarlo' },
    request: { topic: 'No debe reemplazarlo', language: 'es', minutes: 90, includeQuiz: false, model: null },
  });
  assert.equal(duplicate.id, first.id, 'a second click reuses the running job');
  await waitFor(
    () => jobs.getBackgroundJob(jobs.IMMERSION_GENERATION_JOB_KEY)?.progress?.phase === 'station',
    'immersion progress'
  );
  unsubscribe();
  releaseImmersion();
  await waitFor(
    () => jobs.getBackgroundJob(jobs.IMMERSION_GENERATION_JOB_KEY)?.status === 'completed',
    'immersion completion after unmount'
  );
  assert.equal(immersionCalls, 1, 'only one underlying immersion request runs');
  assert.equal(jobs.getBackgroundJob(jobs.IMMERSION_GENERATION_JOB_KEY).result.id, 'imm-1');
  assert.ok(seenBeforeUnmount.includes('running'), 'the mounted view saw the running state');

  let recoveredImmersion = null;
  const unsubscribeRecovered = jobs.subscribeBackgroundJob(jobs.IMMERSION_GENERATION_JOB_KEY, (job) => {
    recoveredImmersion = job;
  });
  assert.equal(recoveredImmersion.status, 'completed', 'a remounted view immediately receives completion');
  assert.equal(recoveredImmersion.progress.phase, 'done', 'the final progress snapshot is retained');
  unsubscribeRecovered();

  // Deep Research retains the report and auto-saves it before announcing that
  // the background job is complete.
  jobs.startDeepResearchGeneration(jobs.DEEP_RESEARCH_MAIN_JOB_KEY, {
    objective: 'Pregunta principal',
    language: 'es',
    targetLength: 'standard',
    sectionLimit: 4,
    model: null,
  });
  await waitFor(
    () => jobs.getBackgroundJob(jobs.DEEP_RESEARCH_MAIN_JOB_KEY)?.status === 'completed',
    'deep research completion'
  );
  const deep = jobs.getBackgroundJob(jobs.DEEP_RESEARCH_MAIN_JOB_KEY);
  assert.equal(deepCalls, 1);
  assert.equal(saveCalls, 1, 'finished report is saved automatically');
  assert.equal(deep.result.report.draft.title, 'Informe recuperable');
  assert.equal(deep.result.savedDraft.id, 'saved-1');

  // A dossier launched from an immersion has its own key and cannot overwrite
  // the main Deep Research job.
  const dossierKey = jobs.immersionDossierJobKey('imm-1');
  jobs.startDeepResearchGeneration(dossierKey, { objective: 'Dossier', model: null });
  await waitFor(() => jobs.getBackgroundJob(dossierKey)?.status === 'completed', 'immersion dossier completion');
  assert.equal(jobs.getBackgroundJob(jobs.DEEP_RESEARCH_MAIN_JOB_KEY).request.objective, 'Pregunta principal');
  assert.equal(jobs.getBackgroundJob(dossierKey).request.objective, 'Dossier');
  assert.equal(saveCalls, 2, 'the immersion dossier is also saved automatically');

  // Database cell jobs survive the initiating cell's unmount. A remounted cell
  // immediately receives the running snapshot, then the retained result, and a
  // repeated click never creates a second provider call for that same cell.
  const textKey = jobs.databaseAiTextCellJobKey('row-1', 'column-1');
  const textJob = jobs.startDatabaseAiTextCellJob('row-1', 'column-1');
  const duplicateTextJob = jobs.startDatabaseAiTextCellJob('row-1', 'column-1');
  assert.equal(duplicateTextJob.id, textJob.id, 'duplicate database text generation reuses the running job');
  await waitFor(() => databaseTextCalls === 1, 'database text request start');
  let textBeforeUnmount = null;
  const unsubscribeText = jobs.subscribeBackgroundJob(textKey, (job) => {
    textBeforeUnmount = job;
  });
  assert.equal(textBeforeUnmount.status, 'running');
  unsubscribeText();
  releaseDatabaseText();
  await waitFor(() => jobs.getBackgroundJob(textKey)?.status === 'completed', 'database text completion after unmount');
  let recoveredText = null;
  const unsubscribeRecoveredText = jobs.subscribeBackgroundJob(textKey, (job) => {
    recoveredText = job;
  });
  assert.equal(recoveredText.status, 'completed', 'remounted text cell receives completion');
  assert.equal(recoveredText.result, 'generated:row-1:column-1');
  assert.equal(databaseTextCalls, 1, 'only one database text provider call runs');
  unsubscribeRecoveredText();

  const imageKey = jobs.databaseAiImageCellJobKey('row-2', 'column-2');
  jobs.startDatabaseAiImageCellJob('row-2', 'column-2');
  await waitFor(() => databaseImageCalls === 1, 'database image request start');
  const unsubscribeImage = jobs.subscribeBackgroundJob(imageKey, () => {});
  unsubscribeImage();
  releaseDatabaseImage();
  await waitFor(() => jobs.getBackgroundJob(imageKey)?.status === 'completed', 'database image completion after unmount');
  assert.equal(jobs.getBackgroundJob(imageKey).result.fileName, 'generated.png');

  const failedKey = jobs.databaseAiTextCellJobKey('row-fail', 'column-3');
  jobs.startDatabaseAiTextCellJob('row-fail', 'column-3');
  await waitFor(() => jobs.getBackgroundJob(failedKey)?.status === 'failed', 'database text failure retention');
  assert.equal(jobs.getBackgroundJob(failedKey).error, 'provider unavailable');

  console.log('background generation jobs test passed');
} finally {
  delete globalThis.window;
  await rm(tmp, { recursive: true, force: true });
}
