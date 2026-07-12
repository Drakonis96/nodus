import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The gazetteer module reads the committed offline asset
// (electron/assets/gazetteer/cities.tsv.gz) via app.getAppPath(). We bundle it with a
// tiny 'electron' stub whose getAppPath returns the repo root, so the test exercises
// the real asset + real search — verifying the map's place picker works offline.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-gaz-'));
const stub = path.join(outDir, 'electron-stub.cjs');
await writeFile(stub, `module.exports = { app: { getAppPath: () => ${JSON.stringify(repoRoot)} } };\n`);

const bundle = path.join(outDir, 'gazetteer.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/geo/gazetteer.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--alias:electron=${stub}`,
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);
const gz = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

test('the committed gazetteer asset loads with tens of thousands of places', () => {
  assert.ok(gz.gazetteerSize() > 20000, `expected a populated gazetteer, got ${gz.gazetteerSize()}`);
});

test('search finds Carmona (Sevilla, Spain) with a stable id and coordinates', () => {
  const results = gz.searchGazetteer('Carmona', 12);
  const es = results.find((r) => r.countryCode === 'ES');
  assert.ok(es, 'the Andalusian Carmona is found');
  assert.equal(es.gazetteerId, 'geonames:2520118', 'stable unique id');
  assert.match(es.country, /Spain/i);
  assert.ok(Math.abs(es.latitude - 37.47) < 0.1 && Math.abs(es.longitude + 5.64) < 0.1, 'real coordinates');
});

test('prefix + population ranking: "Paris" surfaces the French capital first', () => {
  const results = gz.searchGazetteer('Paris', 8);
  assert.ok(results.length > 0);
  assert.equal(results[0].countryCode, 'FR', 'the most populous Paris ranks first');
});

test('search is accent-insensitive and needs at least two characters', () => {
  assert.equal(gz.searchGazetteer('a', 5).length, 0, 'one letter is ignored');
  const withAccent = gz.searchGazetteer('Málaga', 5);
  const folded = gz.searchGazetteer('malaga', 5);
  assert.ok(withAccent.length > 0 && folded.length > 0, 'both accented and folded queries match');
  assert.equal(withAccent[0].gazetteerId, folded[0].gazetteerId, 'same top hit either way');
});

test('a gazetteer id round-trips back to its place', () => {
  const p = gz.getGazetteerPlace('geonames:2520118');
  assert.ok(p && /Carmona/.test(p.name), 'resolves the id back to Carmona');
});
