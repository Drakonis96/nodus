// Pure unit tests for shared/stats.ts — the deterministic statistics engine.
// Bundled with esbuild (no Electron/DB needed) and checked against known values.

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-stats-'));

function bundle(file, name) {
  const out = path.join(outDir, name);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${out}`],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  return require(out);
}
const S = bundle('shared/stats.ts', 'stats.cjs');

test.after(() => rm(outDir, { recursive: true, force: true }));

const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b} (±${eps})`);

test('describe: quartiles, median, iqr, outliers', () => {
  const d = S.describe([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
  near(d.median, 5.5);
  near(d.q1, 3.25);
  near(d.q3, 7.75);
  near(d.iqr, 4.5);
  assert.deepEqual(d.outliers, [100]); // beyond q3 + 1.5*iqr
  assert.equal(d.n, 10);
});

test('mean / stdev (sample)', () => {
  near(S.mean([2, 4, 6]), 4);
  near(S.stdev([2, 4, 6], true), 2); // sample sd of 2,4,6 = 2
});

test('pearson: perfect positive and negative', () => {
  const up = S.pearson([[1, 2], [2, 4], [3, 6], [4, 8]]);
  near(up.r, 1);
  assert.equal(up.n, 4);
  const down = S.pearson([[1, 8], [2, 6], [3, 4], [4, 2]]);
  near(down.r, -1);
});

test('pearson: known dataset (r ≈ 0.822)', () => {
  const xs = [1, 2, 3, 4, 5];
  const ys = [2, 1, 4, 3, 6];
  const pairs = xs.map((x, i) => [x, ys[i]]);
  near(S.pearson(pairs).r, 0.822, 1e-3);
});

test('spearman: monotone non-linear = 1', () => {
  const s = S.spearman([[1, 1], [2, 4], [3, 9], [4, 16]]);
  near(s.r, 1);
});

test('linearRegression: y = 2x + 1', () => {
  const reg = S.linearRegression([[0, 1], [1, 3], [2, 5], [3, 7]]);
  near(reg.slope, 2);
  near(reg.intercept, 1);
  near(reg.r2, 1);
});

test('chi-square: 2x2 table with known statistic', () => {
  // Table rows [10,20],[30,40] → uncorrected chi2 ≈ 0.7937, df=1.
  const t2 = {
    rowLabels: ['r1', 'r2'],
    colLabels: ['c1', 'c2'],
    counts: [[10, 20], [30, 40]],
    rowTotals: [30, 70],
    colTotals: [40, 60],
    total: 100,
  };
  const cs = S.chiSquare(t2);
  near(cs.chi2, 0.7937, 1e-2);
  assert.equal(cs.dof, 1);
  assert.ok(cs.p > 0.3 && cs.p < 0.4, `p=${cs.p}`);
});

test('contingencyTable builds counts from aligned labels', () => {
  const rows = ['x', 'x', 'y', 'y', 'y'];
  const cols = ['a', 'b', 'a', 'a', 'b'];
  const t = S.contingencyTable(rows, cols);
  assert.deepEqual(t.rowLabels, ['x', 'y']);
  assert.deepEqual(t.colLabels, ['a', 'b']);
  assert.deepEqual(t.counts, [[1, 1], [2, 1]]);
  assert.equal(t.total, 5);
});

test('groupBy + one-way ANOVA', () => {
  const cats = ['A', 'A', 'A', 'B', 'B', 'B'];
  const vals = [1, 2, 3, 10, 11, 12];
  const g = S.groupBy(cats, vals);
  assert.equal(g.groups.length, 2);
  const B = g.groups.find((x) => x.label === 'B');
  near(B.mean, 11);
  assert.ok(g.anova.f > 50, `F=${g.anova.f}`); // very separated groups → big F
  assert.ok(g.anova.p < 0.01);
});

test('frequencies: top-N', () => {
  const f = S.frequencies(['a', 'b', 'a', 'a', 'c', null, ''], 2);
  assert.equal(f.distinct, 3);
  assert.deepEqual(f.items, [{ label: 'a', count: 3 }, { label: 'b', count: 1 }]);
});

test('timeSeries: bucket by month', () => {
  const dates = ['2023-01-05', '2023-01-20', '2023-02-01'];
  const vals = [10, 20, 5];
  const ts = S.timeSeries(dates, vals, 'month');
  assert.equal(ts.length, 2);
  assert.deepEqual(ts[0], { bucket: '2023-01', count: 2, sum: 30, mean: 15 });
});

test('correlationMatrix: symmetric with 1 on diagonal', () => {
  const cm = S.correlationMatrix([
    { key: 'a', label: 'A', values: [1, 2, 3, 4] },
    { key: 'b', label: 'B', values: [2, 4, 6, 8] },
  ]);
  near(cm.matrix[0][0], 1);
  near(cm.matrix[0][1], 1);
  near(cm.matrix[1][0], 1);
});

test('p-value machinery: gammaP and incompleteBeta anchors', () => {
  near(S.gammaP(0.5, 0.5), 0.6827, 1e-3); // P(1/2, 1/2) ≈ erf(1/√2)... check monotone anchor
  near(S.chiSquarePValue(3.841, 1), 0.05, 2e-2); // chi2 crit @ 0.05, df=1
  near(S.incompleteBeta(0.5, 1, 1), 0.5, 1e-6); // I_0.5(1,1) = 0.5
});

test('covariance: sample covariance of y=2x', () => {
  const cov = S.covariance([[1, 2], [2, 4], [3, 6], [4, 8]]);
  // var(x)=1.6667, cov = 2*var(x) = 3.3333
  near(cov, 3.3333, 1e-3);
});

test('covarianceMatrix: diagonal is variance', () => {
  const cm = S.covarianceMatrix([
    { key: 'a', label: 'A', values: [1, 2, 3, 4] },
    { key: 'b', label: 'B', values: [2, 4, 6, 8] },
  ]);
  near(cm.matrix[0][0], S.variance([1, 2, 3, 4], true));
  near(cm.matrix[1][1], S.variance([2, 4, 6, 8], true));
  assert.ok(cm.matrix[0][1] > 0);
});

test('crosstab: count aggregate', () => {
  const rows = ['x', 'x', 'y', 'y', 'y'];
  const cols = ['a', 'b', 'a', 'a', 'b'];
  const ct = S.crosstab(rows, cols, null, 'count');
  assert.deepEqual(ct.rowLabels, ['x', 'y']);
  assert.deepEqual(ct.values, [[1, 1], [2, 1]]);
  assert.equal(ct.total, 5);
});

test('crosstab: mean aggregate over a numeric', () => {
  const rows = ['x', 'x', 'y'];
  const cols = ['a', 'a', 'a'];
  const vals = [10, 20, 5];
  const ct = S.crosstab(rows, cols, vals, 'mean');
  near(ct.values[0][0], 15); // mean of 10,20
  near(ct.values[1][0], 5);
});

test('boxplot: whiskers clamp to non-outlier extremes', () => {
  const b = S.boxplot([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
  assert.deepEqual(b.outliers, [100]);
  near(b.whiskerHigh, 9);
  near(b.median, 5.5);
});

test('robust statistics: MAD and trimmed mean', () => {
  near(S.medianAbsoluteDeviation([1, 2, 3, 4, 100]), 1);
  near(S.medianAbsoluteDeviation([1, 2, 3, 4, 100], 1.4826), 1.4826, 1e-6);
  near(S.trimmedMean([1, 2, 3, 4, 100], 0.2), 3, 1e-6);
});

test('seeded bootstrap and permutation are reproducible', () => {
  const a = S.bootstrap([1, 2, 3, 4], S.mean, { iterations: 100, seed: 'demo', confidence: 0.9 });
  const b = S.bootstrap([1, 2, 3, 4], S.mean, { iterations: 100, seed: 'demo', confidence: 0.9 });
  assert.deepEqual(a.samples, b.samples);
  assert.deepEqual(S.permutationTest([1, 2], [4, 5], undefined, { iterations: 100, seed: 42 }), S.permutationTest([1, 2], [4, 5], undefined, { iterations: 100, seed: 42 }));
});

test('multiple-testing corrections preserve input order', () => {
  const bh = S.benjaminiHochberg([0.001, 0.04, 0.2, 0.01]);
  assert.deepEqual(bh.rejected, [true, false, false, true]);
  const holm = S.holmCorrection([0.001, 0.04, 0.2, 0.01]);
  assert.deepEqual(holm.rejected, [true, false, false, true]);
});

test('effect sizes and diagnostics', () => {
  near(S.cohensD([2, 3, 4], [1, 2, 3]), 1, 1e-6);
  near(S.cliffsDelta([3, 4], [1, 2]), 1, 1e-6);
  assert.deepEqual(S.missingness([1, null, '', NaN]), { total: 4, missing: 3, observed: 1, rate: 0.75 });
  near(S.autocorrelation([1, 2, 3], 1)[0], 1, 1e-6);
});

test('linear/logistic regression and PCA are deterministic', () => {
  const lr = S.logisticRegression([[ -2, 0 ], [ -1, 0 ], [ 1, 1 ], [ 2, 1 ]]);
  assert.ok(lr.coefficient > 0);
  assert.equal(lr.n, 4);
  const p = S.pca([[1, 0], [2, 0], [3, 0]]);
  near(p.explainedVariance[0], 1, 1e-6);
  assert.equal(S.hashSnapshot({ b: 2, a: 1 }), S.hashSnapshot({ a: 1, b: 2 }));
});

test('change-point scan finds a clear level shift', () => {
  const cp = S.detectChangePoints([1, 1, 1, 1, 1, 10, 10, 10, 10, 10], { minSegmentLength: 2, threshold: 3 });
  assert.equal(cp[0].index, 5);
});

test('BCa, Welch, Mann–Whitney and Kruskal–Wallis are deterministic', () => {
  const first = S.bcaBootstrap([1, 2, 3, 4, 5], S.mean, { iterations: 200, seed: 7 });
  const second = S.bcaBootstrap([1, 2, 3, 4, 5], S.mean, { iterations: 200, seed: 7 });
  assert.deepEqual(first, second);
  const welch = S.welchTTest([1, 2, 3], [4, 5, 6]);
  near(welch.statistic, -3.674234614, 1e-6);
  const mw = S.mannWhitneyU([1, 2, 3], [4, 5, 6]);
  assert.equal(mw.statistic, 0);
  near(S.kruskalWallis([[1, 2, 3], [4, 5, 6]]).statistic, 3.857142857, 1e-6);
});

test('Kaplan–Meier and log-rank use event/censor ordering', () => {
  const km = S.kaplanMeier([1, 2, 3, 4], [1, 0, 1, 1]);
  assert.equal(km.n, 4);
  assert.equal(km.events, 3);
  near(km.points.at(-1).survival, 0, 1e-6);
  near(km.median, 3, 1e-6);
  const lr = S.logRank([1, 2, 3, 4, 1, 2, 3, 4], [1, 1, 1, 1, 1, 0, 1, 0], ['a', 'a', 'a', 'a', 'b', 'b', 'b', 'b']);
  assert.ok(Number.isFinite(lr.statistic));
  assert.equal(lr.groups[0], 4);
});

test('Cox PH and IPW expose assumptions and diagnostics', () => {
  const cox = S.coxPH([1, 2, 3, 4, 5, 6], [1, 1, 1, 1, 1, 1], [[0], [0], [1], [1], [2], [2]]);
  assert.equal(cox.n, 6);
  assert.equal(cox.coefficients.length, 1);
  assert.ok(Array.isArray(cox.pValues));
  const ipw = S.inverseProbabilityWeighting([0, 0, 1, 1], [1, 2, 4, 5], [[0], [1], [0], [1]], { stabilized: true });
  assert.equal(ipw.metadata.estimand, 'ATE');
  assert.equal(ipw.assumptions.length, 4);
  assert.equal(ipw.propensity.length, 4);
  const extreme = S.inverseProbabilityWeighting(
    [0, 0, 0, 0, 1, 1, 1, 1],
    [1, 2, 1, 2, 8, 9, 8, 9],
    [[-100], [-80], [-60], [-40], [40], [60], [80], [100]],
  );
  assert.ok(extreme.warnings.some((warning) => /Extreme propensity scores/.test(warning)));
});

test('Simpson and graph diagnostics are deterministic', () => {
  const simpson = S.detectSimpsonParadox(
    ['A', 'A', 'A', 'A', 'B', 'B', 'B', 'B'],
    [90, 80, 20, 10, 95, 85, 25, 15],
    ['easy', 'easy', 'hard', 'hard', 'easy', 'easy', 'hard', 'hard'],
  );
  assert.equal(simpson.detected, false); // same within-stratum direction
  const graph = S.relationGraphDiagnostics([{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'd', target: 'e' }]);
  assert.deepEqual(graph.components, [['a', 'b', 'c'], ['d', 'e']]);
  assert.equal(graph.degree.b, 2);
  assert.ok(graph.betweenness.b > graph.betweenness.a);
});

test('cohort comparison is label/metric aligned and FDR-corrected', () => {
  const result = S.cohortComparison(
    ['control', 'treated', 'control', 'treated', 'control', 'treated', null],
    [1, 5, 2, 6, 3, 7, 999],
  );
  assert.deepEqual(result.groups.map((group) => group.count), [3, 3]);
  assert.equal(result.pairwise.length, 1);
  assert.equal(result.pairwise[0].n1, 3);
  assert.equal(result.pairwise[0].n2, 3);
  assert.equal(result.correction.adjusted.length, 2);
});

test('sparse temporal change points retain source indices', () => {
  const points = S.detectIndexedChangePoints([1, null, 1, 1, 10, null, 10, 10], { minSegmentLength: 2, threshold: 3 });
  assert.equal(points[0].sourceIndex, 4);
});

test('text and geographic audits never expose source values', () => {
  const text = S.auditText(['Madrid', 'Madrid', '東京', null]);
  assert.equal(text.duplicateValues, 1);
  assert.ok(Array.isArray(text.tfidfTopTerms));
  assert.ok(Array.isArray(text.topCooccurrences));
  assert.equal(typeof text.nearDuplicatePairs, 'number');
  assert.equal(Object.prototype.hasOwnProperty.call(text, 'values'), false);
  const geo = S.auditGeo(['40.4,-3.7', { latitude: 41, longitude: -3 }, 'bad']);
  assert.equal(geo.observed, 2);
  assert.equal(geo.invalid, 1);
  assert.ok(geo.centroid);
});
