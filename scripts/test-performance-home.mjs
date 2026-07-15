import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

const [home, pipeline, ipc, preload, types, repo] = await Promise.all([
  read('src/views/HomeView.tsx'),
  read('electron/ai/embeddingPipeline.ts'),
  read('electron/ipc.ts'),
  read('electron/preload.ts'),
  read('shared/types.ts'),
  read('electron/db/homeRepo.ts'),
]);

const homeView = home.slice(home.indexOf('export function HomeView'), home.indexOf('const EMPTY_HOME_STATS'));
assert.match(homeView, /getAcademicHomeSnapshot\(\)/, 'Home must request one compact snapshot');
for (const legacyCall of [
  'listWorks()',
  "getGraph('ideas')",
  'getGaps()',
  'getContradictions()',
  'getWorkEmbeddingStatuses()',
  'getCorpusHealth()',
]) {
  assert.equal(homeView.includes(legacyCall), false, `Home must not transfer the heavy ${legacyCall} payload`);
}
assert.match(homeView, /if \(reloadPromise\.current\) return reloadPromise\.current/, 'concurrent refreshes must be coalesced');

const statusFn = pipeline.slice(
  pipeline.indexOf('export function getWorkEmbeddingStatuses'),
  pipeline.indexOf('\n}', pipeline.indexOf('return [...byWork.entries()]')) + 2
);
assert.match(statusFn, /const config = currentEmbeddingConfig\(\)/, 'embedding configuration must be read once per status request');
assert.match(statusFn, /length\(i\.embedding\) AS embedding_bytes/g, 'status SQL must select only the BLOB length');
assert.equal(/\bi\.embedding\s*,/.test(statusFn), false, 'status SQL must not clone embedding BLOBs into JS');
assert.equal(statusFn.includes('ideaNeedsEmbedding(row, text)'), false, 'status loop must not reload settings per idea');

assert.match(ipc, /h\('home:academicSnapshot'/, 'compact Home IPC handler must be registered');
assert.match(preload, /getAcademicHomeSnapshot: \(\) => ipcRenderer\.invoke\('home:academicSnapshot'\)/, 'Home IPC must be exposed');
assert.match(types, /interface AcademicHomeSnapshot[\s\S]*?stats: AcademicHomeStats;/, 'compact snapshot must be typed');
assert.match(repo, /COUNT\(\*\) AS totalWorks/, 'Home counters must be aggregated in SQLite');
assert.equal(repo.includes('SELECT *'), false, 'Home aggregate repository must not select full rows');

console.log('Home performance regression checks passed.');
