// Headless smoke for Laboratorio de hipótesis. Seeds the bundled demo corpus into
// a throwaway DB and exercises the real Electron-side service without requiring a
// configured AI key: provider failures fall back to the structural local planner.
// Run via:
//   rm -rf /tmp/nodus-hypothesis-smoke-userdata && \
//   npx esbuild scripts/smoke-hypothesis-lab.ts --bundle --platform=node --format=esm \
//     --outfile=.smoke-hypothesis-lab.mjs --external:better-sqlite3 \
//     --alias:electron=./scripts/stub-electron.mjs && \
//   NODUS_TEST_USERDATA=/tmp/nodus-hypothesis-smoke-userdata node .smoke-hypothesis-lab.mjs
import { seedDemoData } from '../electron/db/demoData';
import { getDb } from '../electron/db/database';
import { generateHypothesisLab } from '../electron/ai/hypothesisLab';

seedDemoData();

const db = getDb();
const gapCount = (db.prepare('SELECT COUNT(*) AS n FROM gaps').get() as { n: number }).n;
if (gapCount === 0) throw new Error('demo corpus has no gaps for hypothesis lab');

const result = await generateHypothesisLab({
  objective: 'learning motivation feedback',
  mode: 'causal',
  language: 'en',
  maxCandidates: 4,
  model: null,
});

console.log(`hypotheses: ${result.candidates.length} · gaps ${result.stats.gaps} · ai ${result.stats.aiRefined}`);
if (result.candidates.length === 0) throw new Error('hypothesis lab returned no candidates');
if (!result.candidates[0].hypothesis.trim()) throw new Error('first candidate has no hypothesis');
if (!result.candidates[0].evidence.some((item) => item.citation.startsWith('nodus://gap/'))) {
  throw new Error('first candidate is not tied to a gap citation');
}
if (result.candidates[0].methods.length === 0) throw new Error('first candidate has no methods');
if (result.candidates[0].nextSteps.length === 0) throw new Error('first candidate has no next steps');

console.log('\nHYPOTHESIS LAB SMOKE OK');
