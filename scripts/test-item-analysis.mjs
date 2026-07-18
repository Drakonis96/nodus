// Item analysis and grade distribution (teaching vault).
//
// The load-bearing property is the one the research warned about: the DIRECTION of the
// difficulty index. Spanish sources disagree — Universidad de Murcia counts wrong
// answers, so high means hard, while UB, Sevilla and the MIR analyses count correct
// ones, so high means easy. We implement the latter and pin it here, because a number
// read the wrong way round tells a teacher to fix the questions that worked.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-item-analysis-'));
try {
  const outfile = path.join(tmp, 'itemAnalysis.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'shared/itemAnalysis.ts')],
    outfile, bundle: true, format: 'esm', platform: 'node', external: ['@shared/*'], logLevel: 'silent',
  });
  const { analyseItems, gradeDistribution, difficultyBand, discriminationBand, EXTREME_GROUP_FRACTION } =
    await import(pathToFileURL(outfile).href);

  const students = Array.from({ length: 10 }, (_, i) => `s${i}`);
  const item = (id, marks, maxPoints = 1) => ({ itemId: id, name: id, maxPoints, marks });

  // ── Direction: HIGH difficulty means EASY ──────────────────────────────────
  {
    const everyoneRight = Object.fromEntries(students.map((id) => [id, 1]));
    const everyoneWrong = Object.fromEntries(students.map((id) => [id, 0]));
    const [easy] = analyseItems([item('easy', everyoneRight)], students);
    const [hard] = analyseItems([item('hard', everyoneWrong)], students);

    assert.equal(easy.difficulty, 1, 'a question everyone answers correctly scores 1');
    assert.equal(hard.difficulty, 0, 'a question nobody answers correctly scores 0');
    assert.ok(easy.difficulty > hard.difficulty,
      'HIGH means EASY — the opposite convention would invert every recommendation');
    assert.equal(easy.difficultyBand, 'muy_facil');
    assert.equal(hard.difficultyBand, 'muy_dificil');
  }

  // ── Discrimination: the strong group minus the weak group ──────────────────
  {
    // A question only the top half gets right, on an exam where the top half also
    // scores higher overall.
    const marks = Object.fromEntries(students.map((id, i) => [id, i < 5 ? 1 : 0]));
    const filler = Object.fromEntries(students.map((id, i) => [id, i < 5 ? 1 : 0]));
    const [good] = analyseItems([item('good', marks), item('f1', filler), item('f2', filler)], students);
    assert.ok(good.discrimination > 0.9, `a question that separates the groups discriminates: ${good.discrimination}`);
    assert.equal(good.discriminationBand, 'excelente');

    // A question the WEAK group gets right and the strong one does not is broken, and
    // must come out negative rather than merely low.
    const inverted = Object.fromEntries(students.map((id, i) => [id, i < 5 ? 0 : 1]));
    const [bad] = analyseItems([item('bad', inverted), item('f1', filler), item('f2', filler)], students);
    assert.ok(bad.discrimination < 0, `an inverted question discriminates negatively: ${bad.discrimination}`);
    assert.equal(bad.discriminationBand, 'muy_mala');

    // A question everyone gets right cannot discriminate at all.
    const flat = Object.fromEntries(students.map((id) => [id, 1]));
    const [none] = analyseItems([item('flat', flat), item('f1', filler), item('f2', filler)], students);
    assert.equal(none.discrimination, 0, 'no variance, no discrimination');
  }

  // ── Point-biserial excludes the item from the total ────────────────────────
  {
    // With the item left inside the total it would correlate partly with itself; on a
    // two-item exam that inflates it to near 1 regardless of the item's quality.
    const random = { s0: 1, s1: 0, s2: 1, s3: 0, s4: 1, s5: 0, s6: 1, s7: 0, s8: 1, s9: 0 };
    const other = { s0: 0, s1: 1, s2: 0, s3: 1, s4: 0, s5: 1, s6: 0, s7: 1, s8: 0, s9: 1 };
    const [stats] = analyseItems([item('a', random), item('b', other)], students);
    assert.ok(stats.pointBiserial < -0.9,
      `an item that runs opposite to the rest correlates negatively: ${stats.pointBiserial}`);
  }

  // ── A student with no mark is excluded, not counted as zero ────────────────
  {
    const partial = { s0: 1, s1: 1, s2: 1 };
    const [stats] = analyseItems([item('q', partial)], students);
    assert.equal(stats.n, 3, 'only students with a mark count');
    assert.equal(stats.difficulty, 1, 'a question nobody else sat is not thereby difficult');
  }

  // ── Marks out of more than one point ───────────────────────────────────────
  {
    const outOfFive = Object.fromEntries(students.map((id) => [id, 4]));
    const [stats] = analyseItems([item('essay', outOfFive, 5)], students);
    assert.equal(stats.mean, 4);
    assert.equal(stats.difficulty, 0.8, 'difficulty is a proportion of the marks available');
  }

  // ── Degenerate input must not divide by zero ───────────────────────────────
  {
    assert.deepEqual(analyseItems([], students), []);
    assert.deepEqual(analyseItems([item('q', {})], []), []);
    const [single] = analyseItems([item('q', { s0: 1 })], ['s0']);
    assert.ok(Number.isFinite(single.discrimination), 'a class of one still yields a finite number');
    const [zeroMax] = analyseItems([item('q', { s0: 1 }, 0)], ['s0']);
    assert.ok(Number.isFinite(zeroMax.difficulty), 'a zero-point item does not divide by zero');
  }

  // ── Published bands, quoted not invented ───────────────────────────────────
  {
    assert.equal(difficultyBand(0.85), 'muy_facil');
    assert.equal(difficultyBand(0.55), 'optima', 'the SEDEM optimum 0.50–0.60 sits in the middle band');
    assert.equal(difficultyBand(0.1), 'muy_dificil');
    assert.equal(discriminationBand(0.4), 'excelente');
    assert.equal(discriminationBand(0.3), 'buena');
    assert.equal(discriminationBand(0.2), 'revisable');
    assert.equal(discriminationBand(0.05), 'mala');
    assert.equal(discriminationBand(-0.1), 'muy_mala');
    assert.equal(EXTREME_GROUP_FRACTION, 0.27, 'the split is stated, since sources use 27% or 25%');
  }

  // ── Distribution ───────────────────────────────────────────────────────────
  {
    const dist = gradeDistribution([2, 4, 5, 6, 8, 10], 0.5, 10);
    assert.equal(dist.n, 6);
    assert.equal(dist.mean, 5.83);
    assert.equal(dist.median, 5.5);
    assert.equal(dist.min, 2);
    assert.equal(dist.max, 10);
    assert.equal(dist.passRate, 0.667, 'four of six reach the pass mark');
    assert.equal(dist.buckets.reduce((sum, b) => sum + b.count, 0), 6,
      'every mark lands in exactly one bucket — a perfect 10 must not fall off the top');
    // The top bucket is closed at both ends on purpose: with a half-open interval a
    // perfect mark would fall off the end and vanish from the chart.
    const perfect = gradeDistribution([10], 0.5, 10);
    assert.equal(perfect.buckets[perfect.buckets.length - 1].count, 1, 'a perfect mark lands in the last bucket');
    assert.equal(perfect.buckets.reduce((sum, b) => sum + b.count, 0), 1, 'and is counted exactly once');

    // A pass mark that is not 5 changes the rate, which is the whole point of it
    // being configurable.
    assert.equal(gradeDistribution([4, 4.6], 0.45, 10).passRate, 0.5);
    assert.equal(gradeDistribution([], 0.5, 10).n, 0, 'no marks is not a crash');
  }

  console.log('item analysis: OK');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
