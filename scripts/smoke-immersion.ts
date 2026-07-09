// Headless smoke for Inmersión. Seeds the bundled demo corpus into a throwaway
// DB and exercises the real Electron-side services end to end WITHOUT AI keys:
// migration 26, scope building (embeddings/lexical + graph), full generation
// (every AI step degrades to structural content), persistence, resume, progress
// and answer assessment (heuristic path).
// Run via:
//   rm -rf /tmp/nodus-immersion-smoke-userdata && \
//   npx esbuild scripts/smoke-immersion.ts --bundle --platform=node --format=esm \
//     --outfile=.smoke-immersion.mjs --external:better-sqlite3 \
//     --alias:electron=./scripts/stub-electron.mjs && \
//   NODUS_TEST_USERDATA=/tmp/nodus-immersion-smoke-userdata node .smoke-immersion.mjs
import { seedDemoData } from '../electron/db/demoData';
import { getDb } from '../electron/db/database';
import { buildImmersionScope, evaluateImmersionAnswer, generateImmersionSession } from '../electron/ai/immersion';
import { getImmersionSession, listImmersionSessions, setImmersionProgress } from '../electron/db/immersionRepo';

seedDemoData();

const db = getDb();
const table = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'immersion_sessions'")
  .get() as { name: string } | undefined;
if (!table) throw new Error('migration 26 did not create immersion_sessions');

const TOPIC = 'tourism heritage memory identity';

// ── Phase 0: scope (no AI) ────────────────────────────────────────────────────
const scope = await buildImmersionScope({ topic: TOPIC });
console.log(
  `scope: ${scope.ideas.length} ideas · ${scope.works.length} works · ${scope.authors.length} authors · ` +
    `${scope.debateCount} debates · ${scope.gapCount} gaps · ${scope.passageCount} passages · graph ${scope.graph.nodes.length}n/${scope.graph.edges.length}e`
);
if (scope.ideas.length === 0) throw new Error('scope found no ideas in the demo corpus');
if (scope.authors.length === 0) throw new Error('scope found no authors');
if (scope.graph.nodes.length === 0) throw new Error('scope graph is empty');

// ── Generation (no model configured → every step must degrade structurally) ──
const phases: string[] = [];
const session = await generateImmersionSession(
  { topic: TOPIC, language: 'es', minutes: 150, includeQuiz: true, model: null },
  (p) => phases.push(p.phase)
);
console.log(
  `session: ${session.plan.stations.length} stations · quiz ${session.plan.stats.quizQuestions} · ` +
    `citations ${session.plan.stats.citations} · degraded: ${session.plan.stoppedReason ? 'yes' : 'no'}`
);
if (session.plan.stations.length < 3) throw new Error('generated fewer than 3 stations');
if (phases[0] !== 'material' || phases[phases.length - 1] !== 'done') throw new Error('progress phases out of order');
if (!session.plan.overview) throw new Error('panorama missing');
if (!session.plan.exam.feynman) throw new Error('feynman close missing');
if (session.plan.contrasts.rows.length !== session.plan.stations.length) throw new Error('contrast rows mismatch');
for (const station of session.plan.stations) {
  if (!station.synthesis) throw new Error(`station ${station.id} has no synthesis`);
  if (station.ideaIds.length === 0) throw new Error(`station ${station.id} covers no ideas`);
}

// ── Persistence + resume ──────────────────────────────────────────────────────
const list = listImmersionSessions();
if (list.length !== 1 || list[0].id !== session.id) throw new Error('session not listed');
if (list[0].stats.stations !== session.plan.stations.length) throw new Error('summary stats mismatch');

setImmersionProgress(session.id, {
  ...session.progress,
  currentStep: 2,
  furthestStep: 2,
  completedSteps: [0, 1],
  startedAt: new Date().toISOString(),
});
const resumed = getImmersionSession(session.id);
if (!resumed) throw new Error('session did not resume');
if (resumed.progress.currentStep !== 2 || resumed.progress.completedSteps.join(',') !== '0,1') {
  throw new Error('progress did not persist');
}
if (resumed.plan.stations[0].synthesis !== session.plan.stations[0].synthesis) {
  throw new Error('stored plan content differs from the generated one');
}
console.log(`resume: step ${resumed.progress.currentStep} · completed [${resumed.progress.completedSteps}]`);

// ── Answer assessment (heuristic, no model) ──────────────────────────────────
const openQuestion =
  resumed.plan.stations.flatMap((s) => s.quiz).find((q) => q.kind === 'open') ??
  resumed.plan.exam.questions.find((q) => q.kind === 'open');
if (!openQuestion) throw new Error('no open question found in the degraded session');
const result = await evaluateImmersionAnswer({
  sessionId: session.id,
  questionId: openQuestion.id,
  answer: 'La idea central conecta el turismo con la memoria y la identidad según los autores del corpus.',
  model: null,
});
console.log(`assessment: ${result.record.assessment?.verdict} ${result.record.assessment?.score}/100`);
if (!result.record.assessment || result.record.assessment.score <= 0) throw new Error('assessment did not score');
const afterAnswer = getImmersionSession(session.id);
if (!afterAnswer?.progress.answers.some((a) => a.questionId === openQuestion.id)) {
  throw new Error('answer was not persisted into progress');
}

console.log('\nIMMERSION SMOKE OK');
