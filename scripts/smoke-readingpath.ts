// Headless smoke for the "Ruta de lectura" against a COPY of the real corpus.
// Point NODUS_TEST_USERDATA at a dir holding a COPY of nodus.sqlite(+wal/shm) —
// never the live file. Regression guard for the NULL cited_work crash that made
// buildReadingPath throw for every strategy (external_refs.cited_work is nullable
// and normalizeText(null) blew up). Run via:
//   esbuild scripts/smoke-readingpath.ts --bundle --platform=node --format=cjs \
//     --alias:electron=./scripts/stub-electron.mjs --external:better-sqlite3 \
//     --outfile=/tmp/smoke-readingpath.cjs
//   NODUS_TEST_USERDATA=<copy-dir> ELECTRON_RUN_AS_NODE=1 <electron> /tmp/smoke-readingpath.cjs
import { buildReadingPath } from '../electron/graph/graphService';
import type { ReadingPathStrategy } from '@shared/types';

const strategies: ReadingPathStrategy[] = [
  'research_relevance', 'gaps', 'foundational', 'recent', 'connected_authors', 'bridges',
];
const briefs = ['', 'identidad nacional y literatura de viajes en el franquismo'];

let failed = 0;
for (const strategy of strategies) {
  for (const researchBrief of briefs) {
    try {
      const t0 = performance.now();
      const plan = buildReadingPath({ strategy, researchBrief, limit: 72, includeRead: true });
      const ms = (performance.now() - t0).toFixed(0);
      if (plan.totalWorks > 0 && plan.phases.length === 0) {
        throw new Error('plan has works but produced zero phases');
      }
      console.log(
        `OK  strat=${strategy.padEnd(20)} brief=${researchBrief ? 'yes' : 'no '}  ` +
          `total=${plan.totalWorks} shown=${plan.shownWorks} phases=${plan.phases.length}  ${ms}ms`
      );
    } catch (e) {
      failed++;
      console.log(`FAIL strat=${strategy} brief=${researchBrief ? 'yes' : 'no'}`);
      console.log(e instanceof Error ? (e.stack ?? e.message) : String(e));
    }
  }
}

if (failed > 0) throw new Error(`${failed} reading-path combination(s) threw`);
console.log('\nREADING PATH: all strategies build a plan ✓');
