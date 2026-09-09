// Two real, read-only GitHub retrievals. No model responses or law text are mocked.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..'), scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-legalize-live-'));
try {
  const bundle = path.join(scratch, 'live.cjs');
  await build({ stdin: { contents: `export * from './electron/legalize'; export * from './shared/legalize';`, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent', plugins: [{ name: 'profile', setup(b) {
    b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `export const app = { getPath: () => ${JSON.stringify(scratch)} };` }));
  } }] });
  const lib = createRequire(import.meta.url)(bundle);
  const cases = [
    { question: 'España: Constitución Española, artículo 14', plan: { version: 1, country: 'es', query: 'Constitución Española', article: '14' }, expected: /Los españoles son iguales ante la ley/ },
    { question: 'United States: 17 U.S.C. § 105', plan: { version: 1, country: 'us', query: '17 U.S.C. § 105' }, expected: /Copyright protection under this title is not available for any work of the United States Government/ },
  ];
  for (const c of cases) {
    const plan = lib.parseLegalPlan(JSON.stringify(c.plan), c.question);
    const r = lib.validateLegalResult(JSON.stringify(await lib.retrieveLegalize(plan)));
    assert.match(r.document.text, c.expected); assert.match(lib.exportLegalText(r), /legalize-dev/);
    assert.match(r.document.source, c.plan.country === 'es' ? /boe.es/ : /uscode.house.gov/);
    console.log(JSON.stringify({ country: r.country, id: r.document.id, title: r.document.title, source: r.document.source, revision: r.revision, lastUpdated: r.document.lastUpdated, passed: true }));
  }
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
