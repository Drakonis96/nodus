// Real-corpus E2E for Inmersión (NOT part of npm test). Runs against a COPY of
// the live userData (never the original), with no AI keys: the scope must stay
// on-topic via ranking, generation must complete structurally, persistence and
// resume must survive, and the whole thing must not take forever on a ~5k-idea
// corpus. Run via:
//   npx esbuild scripts/smoke-immersion-realcopy.ts --bundle --platform=node --format=esm \
//     --outfile=.smoke-immersion-real.mjs --external:better-sqlite3 \
//     --alias:electron=./scripts/stub-electron.mjs && \
//   NODUS_TEST_USERDATA=<copy-dir> ELECTRON_RUN_AS_NODE=1 npx electron .smoke-immersion-real.mjs
import { getDb } from '../electron/db/database';
import { buildImmersionScope, evaluateImmersionAnswer, generateImmersionSession } from '../electron/ai/immersion';
import { getImmersionSession, listImmersionSessions } from '../electron/db/immersionRepo';

const TOPIC = process.env.IMMERSION_TOPIC || 'uso franquista de las fiestas y tradiciones populares';

const db = getDb();
const counts = {
  ideas: (db.prepare('SELECT COUNT(*) AS n FROM ideas').get() as { n: number }).n,
  works: (db.prepare('SELECT COUNT(*) AS n FROM works').get() as { n: number }).n,
  passages: (db.prepare('SELECT COUNT(*) AS n FROM passages').get() as { n: number }).n,
};
console.log(`corpus: ${counts.ideas} ideas · ${counts.works} works · ${counts.passages} passages`);
if (counts.ideas < 100) throw new Error('this does not look like the real corpus copy');

// ── Scope on the real corpus ──────────────────────────────────────────────────
let t0 = Date.now();
const scope = await buildImmersionScope({ topic: TOPIC });
const scopeMs = Date.now() - t0;
console.log(
  `scope (${scopeMs}ms): ${scope.ideas.length} ideas · ${scope.works.length} works · ${scope.authors.length} authors · ` +
    `${scope.debateCount} debates · ${scope.gapCount} gaps · ${scope.passageCount} passages · graph ${scope.graph.nodes.length}n/${scope.graph.edges.length}e · ` +
    `embeddings ${scope.embeddingAvailable}`
);
console.log('top ideas:');
for (const idea of scope.ideas.slice(0, 8)) console.log(`  [${idea.score.toFixed(2)}] ${idea.label}`);
console.log(`voices: ${scope.authors.slice(0, 8).map((a) => `${a.name}(${a.ideaCount})`).join(' · ')}`);
if (scope.ideas.length === 0) throw new Error('scope found nothing on the real corpus');
if (scopeMs > 60_000) throw new Error(`scope too slow: ${scopeMs}ms`);

// ── Full generation (structural path, no keys) ────────────────────────────────
t0 = Date.now();
const phases: string[] = [];
const session = await generateImmersionSession(
  { topic: TOPIC, language: 'es', minutes: 150, includeQuiz: true, model: null },
  (p) => phases.push(`${p.phase}${p.stationIndex ? `#${p.stationIndex}` : ''}`)
);
const genMs = Date.now() - t0;
console.log(`\ngeneration (${genMs}ms): ${session.plan.stations.length} stations · degraded: ${session.plan.stoppedReason ?? 'no'}`);
for (const st of session.plan.stations) {
  console.log(`  · ${st.title} — ${st.ideaIds.length} ideas, ${st.citations.length} quotes, quiz ${st.quiz.length}`);
}
const totalQuotes = session.plan.stations.reduce((a, s) => a + s.citations.length, 0);
console.log(`quotes total: ${totalQuotes} · contrasts ${session.plan.contrasts.rows.length}x${session.plan.contrasts.authors.length} · frontiers ${session.plan.frontiers.length}`);
if (session.plan.stations.length < 3) throw new Error('too few stations on real corpus');

// Literal quotes must be verbatim DB text.
for (const st of session.plan.stations) {
  for (const c of st.citations) {
    const row = db.prepare('SELECT text FROM passages WHERE passage_id = ?').get(c.passageId) as { text: string } | undefined;
    if (!row) throw new Error(`citation ${c.passageId} not found in passages`);
    if (row.text !== c.text) throw new Error('quote text does not match the stored passage verbatim');
  }
}
console.log('all literal quotes verified verbatim against the DB');

// ── Persistence + resume + heuristic answer ──────────────────────────────────
const listed = listImmersionSessions();
if (!listed.some((s) => s.id === session.id)) throw new Error('session not listed');
const resumed = getImmersionSession(session.id);
if (!resumed || resumed.plan.stations.length !== session.plan.stations.length) throw new Error('resume mismatch');
const open = resumed.plan.stations.flatMap((s) => s.quiz).find((q) => q.kind === 'open');
if (open) {
  const res = await evaluateImmersionAnswer({ sessionId: session.id, questionId: open.id, answer: 'Respuesta de prueba sobre el franquismo y las fiestas.', model: null });
  console.log(`assessment: ${res.record.assessment?.verdict} ${res.record.assessment?.score}/100`);
}

console.log('\nIMMERSION REAL-CORPUS SMOKE OK');
