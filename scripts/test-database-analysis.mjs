// End-to-end test for the databases Analysis engine against a REAL migrated SQLite DB
// (Electron-as-Node, throwaway userData dir). Exercises suggestDatabaseAnalyses (with an
// injected completion so no provider is needed), the deterministic runDatabaseAnalysis /
// computeAnalysis, and the schema validation that keeps the AI on real columns.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-analysis-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-database-analysis.mjs'), '--electron-analysis-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-analysis-test-'));
installRuntimeHooks(root);

try {
  const dbmode = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));
  const analysis = require(path.join(repoRoot, 'electron/ai/databaseAnalysis.ts'));

  // ── build a fixture: price/qty numeric, region select, when date ──
  const db = dbmode.createDatabase('Ventas');
  dbmode.createColumn(db.id, 'Producto', 'title');
  const price = dbmode.createColumn(db.id, 'Precio', 'number');
  const qty = dbmode.createColumn(db.id, 'Unidades', 'number');
  const region = dbmode.createColumn(db.id, 'Región', 'select');
  const when = dbmode.createColumn(db.id, 'Fecha', 'date');
  const north = dbmode.addOption(region.id, 'Norte');
  const south = dbmode.addOption(region.id, 'Sur');

  // price strongly correlated with qty; region North has higher prices.
  const data = [
    [10, 1, north, '2023-01-10'],
    [20, 2, north, '2023-01-20'],
    [30, 3, north, '2023-02-05'],
    [40, 4, north, '2023-02-15'],
    [5, 1, south, '2023-03-01'],
    [8, 2, south, '2023-03-10'],
    [12, 3, south, '2023-04-01'],
    [15, 4, south, '2023-04-20'],
  ];
  for (const [p, q, reg, d] of data) {
    const r = dbmode.createRow(db.id);
    dbmode.setCell(r.id, price.id, String(p));
    dbmode.setCell(r.id, qty.id, String(q));
    dbmode.setCell(r.id, region.id, reg.id);
    dbmode.setCell(r.id, when.id, d);
  }

  // ── computeAnalysis: correlation is strong & positive ──
  const cols = dbmode.getColumns(db.id);
  const rows = dbmode.listRows(db.id);
  const corr = analysis.computeAnalysis(cols, rows, { kind: 'correlation', columns: [price.id, qty.id] });
  assert.equal(corr.kind, 'correlation');
  assert.ok(corr.pearson.r > 0.5, `expected positive correlation, got ${corr.pearson.r}`);
  assert.equal(corr.points.length, 8);

  // ── runDatabaseAnalysis: group_compare with MULTIPLE value columns + ANOVA ──
  const grp = analysis.runDatabaseAnalysis(db.id, { kind: 'group_compare', columns: [region.id, price.id, qty.id] });
  assert.equal(grp.result.kind, 'group_compare');
  assert.equal(grp.result.metrics.length, 2, 'two value metrics');
  const labels = grp.result.metrics[0].result.groups.map((g) => g.label).sort();
  assert.deepEqual(labels, ['Norte', 'Sur']);
  assert.equal(grp.result.metrics[0].boxplots.length, 2);
  assert.ok(grp.result.metrics[0].result.anova, 'ANOVA present for 2 groups');

  // ── descriptive over MULTIPLE numeric columns (comparison table) ──
  const desc = analysis.runDatabaseAnalysis(db.id, { kind: 'descriptive', columns: [price.id, qty.id] });
  assert.equal(desc.result.columns.length, 2);
  assert.ok(Number.isFinite(desc.result.columns[0].stats.variance), 'variance computed');

  // ── correlation_matrix (all) + covariance_matrix (subset) ──
  const mat = analysis.runDatabaseAnalysis(db.id, { kind: 'correlation_matrix', columns: [] });
  assert.equal(mat.result.matrix.labels.length, 2);
  assert.equal(mat.result.matrix.matrix[0][0], 1);
  const cov = analysis.runDatabaseAnalysis(db.id, { kind: 'covariance_matrix', columns: [price.id, qty.id] });
  assert.equal(cov.result.kind, 'covariance_matrix');
  assert.ok(cov.result.matrix.matrix[0][0] > 0, 'diagonal = variance > 0');

  // ── time_series by month with MULTIPLE numeric series ──
  const ts = analysis.runDatabaseAnalysis(db.id, { kind: 'time_series', columns: [when.id, price.id, qty.id] });
  assert.equal(ts.result.kind, 'time_series');
  assert.equal(ts.result.series.length, 2, 'two series');
  assert.ok(ts.result.series[0].points.length >= 3);

  // ── crosstab (2 categoricals): need a 2nd low-card category ──
  const tier = dbmode.createColumn(db.id, 'Nivel', 'select');
  const hi = dbmode.addOption(tier.id, 'Alto');
  const lo = dbmode.addOption(tier.id, 'Bajo');
  const rows0 = dbmode.listRows(db.id);
  rows0.forEach((r, i) => dbmode.setCell(r.id, tier.id, (i % 2 ? hi : lo).id));
  const ct = analysis.runDatabaseAnalysis(db.id, { kind: 'crosstab', columns: [region.id, tier.id, price.id] });
  assert.equal(ct.result.kind, 'crosstab');
  assert.equal(ct.result.aggregate, 'mean');
  assert.ok(ct.result.rowLabels.length >= 1 && ct.result.colLabels.length >= 1);

  // ── data_quality report over the whole table ──
  const dq = analysis.runDatabaseAnalysis(db.id, { kind: 'data_quality', columns: [] });
  assert.equal(dq.result.kind, 'data_quality');
  assert.equal(dq.result.rowCount, 8);
  assert.ok(dq.result.columns.length >= 5);

  // ── validation: an invalid request (category as numeric) throws ──
  assert.throws(() => analysis.runDatabaseAnalysis(db.id, { kind: 'correlation', columns: [region.id, price.id] }));

  // ── suggestDatabaseAnalyses with an injected completion returning a plan ──
  const fakePlan = JSON.stringify([
    { kind: 'correlation', columns: [price.id, qty.id], title: 'Precio vs Unidades', rationale: 'ver relación' },
    { kind: 'group_compare', columns: [region.id, price.id], title: 'Precio por región', rationale: 'comparar' },
    { kind: 'correlation', columns: [price.id, 'ghost-col'], title: 'inválido', rationale: 'columna falsa' }, // dropped by validation
  ]);
  const sug = await analysis.suggestDatabaseAnalyses(db.id, { complete: async () => '```json\n' + fakePlan + '\n```' });
  assert.equal(sug.suggestions.length, 2, 'invalid suggestion dropped, two kept');
  assert.equal(sug.suggestions[0].kind, 'correlation');

  // ── suggest fallback: empty AI reply → deterministic defaults ──
  const fb = await analysis.suggestDatabaseAnalyses(db.id, { complete: async () => 'lo siento, no sé' });
  assert.ok(fb.suggestions.length > 0, 'fallback seeds default suggestions');

  // ── narrate over a computed result with injected completion ──
  const prose = await analysis.narrateAnalysisResult(corr, {
    complete: async (opts) => {
      assert.match(opts.user, /Pearson/, 'narration prompt carries the computed figures');
      return 'La correlación es fuerte y positiva.';
    },
  });
  assert.match(prose, /correlación/);

  console.log('Database analysis test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (v) => Buffer.from(String(v), 'utf8'),
      decryptString: (v) => Buffer.from(v).toString('utf8'),
    },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
