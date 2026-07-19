// The grading engine (teaching vault).
//
// shared/assessment/* is pure, so we bundle it with esbuild and exercise the REAL
// functions. The scenarios are taken from how grading actually works in published
// programaciones didácticas and guías docentes, not from invented arithmetic:
//
//   · a weighted tree (EXAMEN 50 / PRÁCTICA 30 / APROVECHAMIENTO 20)
//   · a minimum mark required before the tree may average at all
//   · an item nobody has assessed yet must NOT drag the grade down
//   · a blank cell is not the same thing as a zero
//   · rounding rules that real centres publish, including rounding up only from 0,7
//     and a pass mark that is not 5
//   · a qualitative-only record, which is what several regions legally require
//
// Every scenario asserts the DERIVATION too, because a grade a teacher cannot justify
// is a grade that loses a reclamación.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-assessment-test-'));
try {
  const outfile = path.join(tmp, 'assessment.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'shared/assessment/index.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    external: ['@shared/*'],
    logLevel: 'silent',
  });
  const {
    computeGrade,
    roundValue,
    qualitativeFor,
    honoursQuota,
    awardHonours,
    validatePlan,
    defaultItem,
    defaultEntry,
    gradebookToGrid,
    anonymousGrid,
    anonymousStudentSummary,
    GRID_COL,
    assessmentProfile,
    ASSESSMENT_PROFILES,
    AGGREGATIONS,
  } = await import(pathToFileURL(outfile).href);

  // ── helpers ────────────────────────────────────────────────────────────────
  const planWith = (profileId, overrides = {}) => {
    const preset = assessmentProfile(profileId);
    return {
      id: 'p1',
      name: 'Plan',
      subjectId: 's1',
      academicYearId: 'y1',
      profile: profileId,
      rules: { ...preset.rules, ...overrides },
      publishedAt: null,
      version: 1,
      parentVersionId: null,
    };
  };
  const item = (id, over = {}) => defaultItem('p1', { id, name: id, ...over });
  const mark = (itemId, value, over = {}) =>
    defaultEntry('st1', itemId, { rawValue: value, status: 'evaluated', ...over });
  const gradeOf = (result) => result.record.numeric;
  const firedCodes = (node, out = []) => {
    if (!node) return out;
    for (const rule of node.rules) out.push(rule.code);
    for (const child of node.children) firedCodes(child, out);
    return out;
  };

  // ── 1. The canonical weighted tree ─────────────────────────────────────────
  {
    const plan = planWith('universidad');
    const items = [
      item('examen', { weight: 50, aggregation: 'weighted' }),
      item('practica', { weight: 30 }),
      item('aprov', { weight: 20 }),
    ];
    const result = computeGrade({ plan, items, entries: [mark('examen', 8), mark('practica', 6), mark('aprov', 10)] });
    // 8*0.5 + 6*0.3 + 10*0.2 = 7.8
    assert.equal(gradeOf(result), 7.8, 'weighted average of the three blocks');
    assert.equal(result.passed, true);
    assert.equal(result.record.qualitative, null, 'a numeric-record plan writes no qualitative term');

    // The derivation must expose what each block really contributed.
    const examen = result.trace.children.find((c) => c.itemId === 'examen');
    assert.equal(examen.fraction, 0.8);
    assert.ok(Math.abs(examen.effectiveWeight - 0.5) < 1e-9, 'effective weight is the renormalised share');
  }

  // ── 2. Nested blocks: an exam broken into its questions ────────────────────
  {
    const plan = planWith('universidad');
    const items = [
      item('examen', { weight: 50, aggregation: 'sum' }),
      item('q1', { parentId: 'examen', maxPoints: 2, position: 0 }),
      item('q2', { parentId: 'examen', maxPoints: 3, position: 1 }),
      item('q3', { parentId: 'examen', maxPoints: 5, position: 2 }),
      item('practica', { weight: 50 }),
    ];
    const result = computeGrade({
      plan, items,
      entries: [mark('q1', 2), mark('q2', 1.5), mark('q3', 4), mark('practica', 5)],
    });
    // exam = (2+1.5+4)/10 = 0.75 ; total = 7.5*0.5 + 5*0.5 = 6.25 → 6.3 (1 decimal)
    assert.equal(gradeOf(result), 6.3, 'points sum across questions of different worth');
  }

  // ── 3. Minimum mark required before averaging ──────────────────────────────
  {
    const plan = planWith('universidad');
    const items = [
      item('examen', { weight: 50, minToAverage: 0.4 }),
      item('trabajo', { weight: 50 }),
    ];
    // Below the threshold: the raw average would pass, but it must not.
    const failed = computeGrade({ plan, items, entries: [mark('examen', 3), mark('trabajo', 10)] });
    assert.ok(!failed.passed, 'a missed minimum blocks the pass even when the average is high');
    assert.ok(gradeOf(failed) <= 4.9, 'and the recorded mark is capped below the pass mark');
    assert.ok(firedCodes(failed.trace).includes('min_not_met'));
    assert.ok(failed.rules.some((r) => r.code === 'capped'), 'the cap is recorded in the derivation');

    // Exactly at the threshold it averages normally.
    const ok = computeGrade({ plan, items, entries: [mark('examen', 4), mark('trabajo', 10)] });
    assert.equal(gradeOf(ok), 7, 'meeting the minimum exactly is enough');
    assert.equal(ok.passed, true);

    // 'raw' mode records the true average instead of a cap.
    const rawMode = planWith('universidad', { minNotMet: { mode: 'raw', capAt: 4.9 } });
    const rawResult = computeGrade({ plan: rawMode, items, entries: [mark('examen', 3), mark('trabajo', 10)] });
    assert.equal(gradeOf(rawResult), 6.5, 'raw mode keeps the weighted average');
    assert.equal(rawResult.passed, false, 'but it still does not pass');
  }

  // ── 4. Not assessed ≠ zero — the humane rule ───────────────────────────────
  {
    const plan = planWith('universidad');
    const items = [
      item('t1', { weight: 40 }),
      item('t2', { weight: 40 }),
      item('t3', { weight: 20 }),
    ];
    // Only two of three taught so far. The mark must reflect what was taught.
    const partial = computeGrade({ plan, items, entries: [mark('t1', 8), mark('t2', 6)] });
    // (8*40 + 6*40) / 80 = 7
    assert.equal(gradeOf(partial), 7, 'unassessed items are dropped and the rest renormalised');
    assert.ok(firedCodes(partial.trace).includes('excluded_not_assessed'));
    assert.ok(partial.trace.rules.some((r) => r.code === 'renormalized'));

    // Opting into the punitive behaviour is possible, and changes the answer.
    const punitive = planWith('universidad', { notAssessedPenalizes: true });
    const punished = computeGrade({ plan: punitive, items, entries: [mark('t1', 8), mark('t2', 6)] });
    assert.equal(gradeOf(punished), 5.6, 'with penalisation on, the missing item counts as zero');
  }

  // ── 5. Not submitted IS distinct from not assessed ─────────────────────────
  {
    const items = [item('t1', { weight: 50 }), item('t2', { weight: 50 })];
    const asZero = computeGrade({
      plan: planWith('universidad'), items,
      entries: [mark('t1', 10), defaultEntry('st1', 't2', { status: 'not_submitted' })],
    });
    assert.equal(gradeOf(asZero), 5, 'a non-submission counts as zero by default');

    const excluded = planWith('universidad', { notSubmittedValue: null });
    const asBlank = computeGrade({
      plan: excluded, items,
      entries: [mark('t1', 10), defaultEntry('st1', 't2', { status: 'not_submitted' })],
    });
    assert.equal(gradeOf(asBlank), 10, 'or is dropped entirely when the plan says so');

    // Exempt is always dropped, never zero.
    const exempt = computeGrade({
      plan: planWith('universidad'), items,
      entries: [mark('t1', 7), defaultEntry('st1', 't2', { status: 'exempt' })],
    });
    assert.equal(gradeOf(exempt), 7, 'an exempt item never counts as zero');
    assert.ok(firedCodes(exempt.trace).includes('excluded_exempt'));
  }

  // ── 6. Rounding rules real centres publish ─────────────────────────────────
  {
    const rules = (over) => ({ ...assessmentProfile('universidad').rules, ...over });
    assert.equal(roundValue(6.47, rules({ rounding: 'halfUp', decimals: 1 })), 6.5);
    assert.equal(roundValue(6.44, rules({ rounding: 'halfUp', decimals: 1 })), 6.4);
    assert.equal(roundValue(6.45, rules({ rounding: 'halfUp', decimals: 1 })), 6.5, 'exact half rounds up');
    assert.equal(roundValue(6.99, rules({ rounding: 'truncate', decimals: 1 })), 6.9);
    assert.equal(roundValue(6.5, rules({ rounding: 'halfDown', decimals: 0 })), 6, 'exact half rounds down');

    // Rounding up only from 0,7 — a real published rule, and one no default provides.
    const t = rules({ rounding: 'threshold', roundingThreshold: 0.7, decimals: 0 });
    assert.equal(roundValue(6.69, t), 6);
    assert.equal(roundValue(6.7, t), 7);
    assert.equal(roundValue(6.99, t), 7);

    // Floating-point traps: 2.675 is really 2.67499… in binary.
    assert.equal(roundValue(2.675, rules({ rounding: 'halfUp', decimals: 2 })), 2.68);
    assert.equal(roundValue(0.1 + 0.2, rules({ rounding: 'halfUp', decimals: 1 })), 0.3);
  }

  // ── 7. A pass mark that is not 5 ───────────────────────────────────────────
  {
    // Real programaciones exist where 4,5 already passes.
    const plan = planWith('secundaria-cualitativa', {
      passAt: 0.45,
      record: 'both',
      decimals: 1,
      qualitativeBands: [
        { code: 'IN', label: 'Insuficiente', min: 0 },
        { code: 'SU', label: 'Suficiente', min: 0.45 },
        { code: 'BI', label: 'Bien', min: 0.6 },
      ],
    });
    const items = [item('t1', { weight: 100 })];
    const result = computeGrade({ plan, items, entries: [mark('t1', 4.6)] });
    assert.equal(result.passed, true, 'the centre decides where the pass mark sits');
    assert.equal(result.record.qualitative, 'SU');
    assert.equal(computeGrade({ plan, items, entries: [mark('t1', 4.4)] }).passed, false);
  }

  // ── 8. Qualitative-only record ─────────────────────────────────────────────
  {
    const plan = planWith('secundaria-cualitativa');
    const items = [item('c1', { weight: 50 }), item('c2', { weight: 50 })];
    const result = computeGrade({ plan, items, entries: [mark('c1', 7), mark('c2', 8)] });
    assert.equal(result.record.numeric, null, 'a qualitative-only record carries NO number');
    assert.equal(result.record.qualitative, 'NT', '7.5 lands in Notable');
    assert.ok(result.raw != null, 'the internal value still exists for later averages');

    assert.equal(qualitativeFor(0, plan.rules), 'IN');
    assert.equal(qualitativeFor(0.5, plan.rules), 'SU', 'band edges are inclusive');
    assert.equal(qualitativeFor(1, plan.rules), 'SB');
  }

  // ── 9. Aggregation modes ───────────────────────────────────────────────────
  {
    const plan = planWith('universidad');
    const children = (agg, extra = {}) => [
      item('root', { aggregation: agg, weight: 100, ...extra }),
      item('a', { parentId: 'root', position: 0 }),
      item('b', { parentId: 'root', position: 1 }),
      item('c', { parentId: 'root', position: 2 }),
    ];
    const marks = [mark('a', 4), mark('b', 8), mark('c', 9)];

    assert.equal(gradeOf(computeGrade({ plan, items: children('mean'), entries: marks })), 7);
    assert.equal(gradeOf(computeGrade({ plan, items: children('max'), entries: marks })), 9);
    assert.equal(gradeOf(computeGrade({ plan, items: children('last'), entries: marks })), 9, 'last follows position order');
    assert.equal(
      gradeOf(computeGrade({ plan, items: children('bestOf', { bestOf: 2 }), entries: marks })), 8.5,
      'best 2 of 3 drops the lowest',
    );

    // Mode: two 8s beat a single 4.
    const modeItems = children('mode');
    assert.equal(gradeOf(computeGrade({ plan, items: modeItems, entries: [mark('a', 4), mark('b', 8), mark('c', 8)] })), 8);

    // Conditional mean: refuses to average and is held back by the weakest.
    const cond = children('conditionalMean', { conditionalMin: 0.5 });
    const refused = computeGrade({ plan, items: cond, entries: marks });
    assert.equal(gradeOf(refused), 4, 'one failing part blocks the mean');
    assert.ok(firedCodes(refused.trace).includes('conditional_mean_refused'));
    const allowed = computeGrade({ plan, items: cond, entries: [mark('a', 6), mark('b', 8), mark('c', 9)] });
    assert.ok(Math.abs(gradeOf(allowed) - 7.7) < 0.05, 'all parts above the floor: it averages');
  }

  // ── 10. Cumulative criterion (normalise against the class maximum) ─────────
  {
    const plan = planWith('universidad');
    const items = [item('part', { weight: 100, aggregation: 'normalizeGroupMax', maxPoints: 10 })];
    const cohort = { maxByItem: { part: 10 } };
    assert.equal(gradeOf(computeGrade({ plan, items, entries: [mark('part', 10)], cohort })), 10,
      'the most active student sets the ceiling');
    assert.equal(gradeOf(computeGrade({ plan, items, entries: [mark('part', 1)], cohort })), 1);

    // THE side effect that must be surfaced in the UI: the same student's own count
    // yields a different mark when somebody else participates more.
    const busier = { maxByItem: { part: 20 } };
    assert.equal(gradeOf(computeGrade({ plan, items, entries: [mark('part', 10)], cohort: busier })), 5,
      'a classmate participating more lowers this mark — the reason the UI must warn');

    // Against a fixed target, a classmate cannot move your mark.
    const target = [item('part', { weight: 100, aggregation: 'normalizeTarget', target: 10 })];
    assert.equal(gradeOf(computeGrade({ plan, items: target, entries: [mark('part', 10)], cohort: busier })), 10);
    assert.equal(gradeOf(computeGrade({ plan, items: target, entries: [mark('part', 15)], cohort: busier })), 10,
      'exceeding the target does not exceed full marks');
  }

  // ── 11. Ratchet: continuous assessment never takes back what was earned ────
  {
    const plan = planWith('secundaria-cualitativa'); // ratchet on
    const items = [item('c1', { weight: 100 })];
    const result = computeGrade({ plan, items, entries: [mark('c1', 5)], previous: { c1: 0.8 } });
    assert.equal(result.record.qualitative, 'NT', 'a lower later mark cannot undo the earlier one');
    assert.ok(firedCodes(result.trace).includes('ratchet_applied'));

    const off = planWith('universidad'); // ratchet off
    const dropped = computeGrade({ plan: off, items, entries: [mark('c1', 5)], previous: { c1: 0.8 } });
    assert.equal(gradeOf(dropped), 5, 'without the rule the latest mark stands');
  }

  // ── 12. Continua vs no continua: two weight columns, one tree ──────────────
  {
    const plan = planWith('universidad');
    const items = [
      item('parciales', { weight: 49, weightAlt: 0 }),
      item('final', { weight: 51, weightAlt: 100 }),
    ];
    const entries = [mark('parciales', 10), mark('final', 5)];
    const continua = computeGrade({ plan, items, entries, track: 'continua' });
    const noContinua = computeGrade({ plan, items, entries, track: 'no_continua' });
    assert.ok(Math.abs(gradeOf(continua) - 7.5) < 0.05, 'continuous assessment weights both');
    assert.equal(gradeOf(noContinua), 5, 'the alternative route is the final exam alone');
  }

  // ── 13. Not presented ──────────────────────────────────────────────────────
  {
    const plan = planWith('universidad'); // triggerPct 0.5
    const items = [item('a', { weight: 60 }), item('b', { weight: 40 })];
    const np = computeGrade({ plan, items, entries: [mark('b', 7)] });
    assert.equal(np.record.notPresented, true, 'leaving most of the assessment unattempted is not a zero');
    assert.equal(np.record.qualitative, 'NP', 'the record carries the code the plan configures');
    assert.equal(np.passed, false);

    const attended = computeGrade({ plan, items, entries: [mark('a', 7)] });
    assert.equal(attended.record.notPresented, false, '60% attempted is above the trigger');

    // A non-submission counts toward the trigger even when it also contributes a 0 to
    // the average. The trigger asks about PARTICIPATION; notSubmittedValue only
    // decides arithmetic. Conflating them lets a student who handed in almost nothing
    // be recorded with a numeric fail instead of not-presented.
    const mostlyAbsent = computeGrade({
      plan, items,
      entries: [defaultEntry('st1', 'a', { status: 'not_submitted' }), mark('b', 8)],
    });
    assert.equal(plan.rules.notSubmittedValue, 0, 'this plan does score non-submissions as zero');
    assert.equal(mostlyAbsent.record.notPresented, true, 'yet 60% not handed in is still not-presented');

    // Exactly on the boundary the student is graded, not written off: the published
    // wording is "MÁS del 50 %".
    const half = computeGrade({
      plan, items: [item('x', { weight: 50 }), item('y', { weight: 50 })],
      entries: [mark('x', 6), defaultEntry('st1', 'y', { status: 'not_submitted' })],
    });
    assert.equal(half.record.notPresented, false, 'exactly at the trigger is not enough to write a student off');

    // Where the concept does not exist, it never appears.
    const eso = planWith('secundaria-cualitativa');
    const esoResult = computeGrade({ plan: eso, items, entries: [] });
    assert.equal(esoResult.record.notPresented, false, 'stages without a resit have no not-presented mark');
  }

  // ── 14. Honours quota ──────────────────────────────────────────────────────
  {
    const policy = { enabled: true, threshold: 0.9, quotaPct: 0.05, unit: 'group', rounding: 'halfUp', minCohortForOne: 20 };
    assert.equal(honoursQuota(19, policy), 1, 'small cohorts may award exactly one');
    assert.equal(honoursQuota(47, { ...policy, rounding: 'halfUp' }), 2, '2.35 → 2');
    assert.equal(honoursQuota(50, { ...policy, rounding: 'halfUp' }), 3, '2.5 → 3');
    assert.equal(honoursQuota(47, { ...policy, rounding: 'up' }), 3, 'rounding up is a real institutional choice');
    assert.equal(honoursQuota(47, { ...policy, rounding: 'down' }), 2);
    assert.equal(honoursQuota(0, policy), 0);

    const rules = assessmentProfile('universidad').rules;
    const ranked = [
      { studentId: 'a', raw: 9.8 }, { studentId: 'b', raw: 9.4 }, { studentId: 'c', raw: 9.1 },
      { studentId: 'd', raw: 8.9 }, { studentId: 'e', raw: null },
    ];
    assert.deepEqual(awardHonours(ranked, policy, rules), ['a'], 'a cohort of 5 gets exactly one');
    // Quota of 4 but only three students clear the 9,0 threshold: eligibility binds,
    // not the quota, and the order is best-first.
    assert.deepEqual(
      awardHonours(ranked, { ...policy, minCohortForOne: 0, quotaPct: 0.8 }, rules), ['a', 'b', 'c'],
      'a student below the threshold is never awarded, even with quota to spare',
    );
    // Students with no mark still enlarge the cohort the quota is counted over.
    assert.equal(honoursQuota(ranked.length, { ...policy, minCohortForOne: 0, quotaPct: 0.2 }), 1);
  }

  // ── 14b. A distinction presupposes a pass ──────────────────────────────────
  {
    const policy = { enabled: true, threshold: 0.9, quotaPct: 0.5, unit: 'group', rounding: 'up', minCohortForOne: 0 };
    const rules = assessmentProfile('universidad').rules;
    // Ranking on the number alone would hand the top distinction to a student recorded
    // as not-presented, and the next one to somebody whose 9,5 is held back by an
    // unmet minimum. Both are failures, not top marks.
    const ranked = [
      { studentId: 'np', raw: 9.9, passed: false, notPresented: true },
      { studentId: 'blocked', raw: 9.5, passed: false, notPresented: false },
      { studentId: 'real', raw: 9.2, passed: true, notPresented: false },
    ];
    assert.deepEqual(awardHonours(ranked, policy, rules), ['real'],
      'neither a not-presented nor a blocked student may take a distinction');
    // Callers that know nothing about the pass state keep the old behaviour.
    assert.deepEqual(
      awardHonours([{ studentId: 'x', raw: 9.5 }], policy, rules), ['x'],
      'an unqualified candidate is still eligible',
    );
  }

  // ── 14c. The not-presented trigger measures SHARE OF THE PLAN ──────────────
  {
    // `weight` is relative to an item's siblings, so adding weights across different
    // parents compares numbers on different scales. Here EXAMEN and PRÁCTICAS are 50/50,
    // but PRÁCTICAS holds ten leaves of weight 10 and EXAMEN two of weight 1: a raw sum
    // makes the practicals 98 % of the plan and writes off a student who sat the whole
    // exam as "no presentado".
    const plan = planWith('universidad'); // triggerPct 0.5
    const items = [
      item('examen', { weight: 50 }),
      ...[0, 1].map((i) => item(`e${i}`, { parentId: 'examen', weight: 1, position: i })),
      item('practicas', { weight: 50 }),
      ...Array.from({ length: 10 }, (_, i) => item(`p${i}`, { parentId: 'practicas', weight: 10, position: i })),
    ];

    const examOnly = computeGrade({ plan, items, entries: [mark('e0', 7), mark('e1', 7)] });
    assert.equal(examOnly.record.notPresented, false,
      'half the subject attempted is exactly the trigger, not above it');
    assert.equal(examOnly.record.numeric, 7, 'and the mark is the half that was assessed');

    // The mirror image must behave the same way, which it did not before: 2 % of
    // "missing weight" let a student who sat only the two exam questions through.
    const practicalsOnly = computeGrade({
      plan, items,
      entries: Array.from({ length: 10 }, (_, i) => mark(`p${i}`, 7)),
    });
    assert.equal(practicalsOnly.record.notPresented, false, 'and so is the other half');

    // Genuinely absent: one practical out of the whole plan is 5 %.
    const barely = computeGrade({ plan, items, entries: [mark('p0', 7)] });
    assert.equal(barely.record.notPresented, true, 'attempting 5 % of the plan is not presented');
  }

  // ── 14d. A discarded child cannot hold the branch back ─────────────────────
  {
    // "Mejores 3 de 4", every test needing a 4/10 to average, marks 9-9-9-2. The 2 is
    // thrown away by `bestOf`, so it never entered the average — but it used to mark the
    // minimum as unmet anyway, capping a 9 at 4,9 and failing the student.
    const plan = planWith('universidad'); // minNotMet: cap at 4.9
    const items = [
      item('pruebas', { weight: 100, aggregation: 'bestOf', bestOf: 3 }),
      ...[9, 9, 9, 2].map((_, i) => item(`t${i}`, { parentId: 'pruebas', position: i, minToAverage: 0.4 })),
    ];
    const entries = [9, 9, 9, 2].map((value, i) => mark(`t${i}`, value));
    const result = computeGrade({ plan, items, entries });
    assert.equal(gradeOf(result), 9, 'the discarded test does not cap the grade');
    assert.equal(result.passed, true);
    assert.ok(!result.rules.some((r) => r.code === 'capped'), 'and no cap is recorded');

    // The trace still SHOWS the missed minimum on the test itself: it happened, it just
    // did not propagate. And the weight printed for a discarded test is 0, because the
    // derivation is the document that answers a reclamación.
    const discarded = result.trace.children.find((c) => c.itemId === 't3');
    assert.ok(discarded.rules.some((r) => r.code === 'min_not_met'), 'the trace still records it');
    assert.equal(discarded.effectiveWeight, 0, 'a discarded test carries no weight in the derivation');
    const kept = result.trace.children.find((c) => c.itemId === 't0');
    assert.ok(Math.abs(kept.effectiveWeight - 1 / 3) < 1e-9, 'the three that counted split the branch');

    // When the low mark is NOT discarded it still blocks, which is the rule's point.
    const strict = computeGrade({
      plan,
      items: items.map((i) => (i.id === 'pruebas' ? { ...i, bestOf: 4 } : i)),
      entries,
    });
    assert.ok(strict.rules.some((r) => r.code === 'capped'), 'a counted test below its minimum still caps');
  }

  // ── 14e. Rounding modes agree with each other ──────────────────────────────
  {
    // Values that ARRIVE from a weighted average, not literals: 4.999999999999999 is
    // what a real plan produces and what a mode without an epsilon records as 4,9.
    const computed = 0.7 * 5 + 0.3 * 5; // 5, up to binary representation
    const truncatePlan = planWith('universidad', { rounding: 'truncate', decimals: 1 });
    assert.equal(roundValue(4.999999999999999, truncatePlan.rules), 5,
      'truncate must not fail a student over a binary representation');
    assert.equal(roundValue(computed, truncatePlan.rules), 5);
    assert.equal(roundValue(4.94, truncatePlan.rules), 4.9, 'a genuine 4,94 still truncates');

    const halfDown = planWith('universidad', { rounding: 'halfDown', decimals: 0 });
    assert.equal(roundValue(4.5, halfDown.rules), 4, 'exactly a half goes down — that is the mode');
    assert.equal(roundValue(4.500000000000001, halfDown.rules), 4, 'and noise does not flip it up');
    assert.equal(roundValue(4.6, halfDown.rules), 5);

    // `threshold` honours `decimals`: with two of them the rule is about the third.
    const twoDecimals = planWith('universidad', { rounding: 'threshold', roundingThreshold: 0.7, decimals: 2 });
    assert.equal(roundValue(6.55, twoDecimals.rules), 6.55, 'it no longer collapses to the units digit');
    assert.equal(roundValue(6.557, twoDecimals.rules), 6.56, 'and rounds up from the configured threshold');
    assert.equal(roundValue(6.556, twoDecimals.rules), 6.55, 'but not below it');

    // A threshold of 0 is allowed by the editor and must not push every exact value up.
    const zero = planWith('universidad', { rounding: 'threshold', roundingThreshold: 0, decimals: 0 });
    assert.equal(roundValue(6, zero.rules), 6, 'an exact 6 stays a 6');
    assert.equal(roundValue(6.01, zero.rules), 7, 'anything above it rounds up');
  }

  // ── 14f. FP: a scale that does not start at zero ───────────────────────────
  {
    // Modules are recorded 1–10 and passed with a 5. `passAt` is a fraction OF THE
    // SCALE, so 0.5 would have put the pass mark at 5,5 — and three consumers projected
    // with `fraction * scaleMax`, which put the same student on both sides of it.
    const fp = assessmentProfile('fp');
    assert.equal(fp.rules.scaleMin, 1);
    assert.ok(Math.abs(fp.rules.passAt - 4 / 9) < 1e-9, 'a 5 on 1–10 is 4/9 of the scale');

    const plan = planWith('fp');
    const items = [item('t', { weight: 100, maxPoints: 10 })];
    // 4.7/10 of the item is a fraction of 0.47, which on 1–10 is 1 + 0.47·9 = 5.23 → 5.
    const result = computeGrade({ plan, items, entries: [mark('t', 4.7)] });
    assert.equal(gradeOf(result), 5, 'the record is on the plan\'s own scale');
    assert.equal(result.passed, true, 'and the pass decision agrees with the number recorded');

    // 1 + 0.4·9 = 4.6, which this profile rounds to 5. The engine decides the pass on
    // the ROUNDED value on purpose — a student is not failed by a decimal nobody can
    // see — so this is a pass, and the two must agree.
    const borderline = computeGrade({ plan, items, entries: [mark('t', 4)] });
    assert.equal(gradeOf(borderline), 5);
    assert.equal(borderline.passed, true, 'the pass decision reads the number that is recorded');

    // Genuinely below: 1 + 0.3·9 = 3.7 → 4.
    const failing = computeGrade({ plan, items, entries: [mark('t', 3)] });
    assert.equal(gradeOf(failing), 4);
    assert.equal(failing.passed, false);

    // The grid projects through the same function, so a block subtotal cannot disagree
    // with the final mark printed beside it.
    const nested = [
      item('bloque', { weight: 100, aggregation: 'mean' }),
      item('x', { parentId: 'bloque', maxPoints: 10 }),
    ];
    // One decimal, so the two formulas cannot both round to the same thing:
    // `toScale` gives 1 + 0.47·9 = 5.23 → 5.2, while `fraction * scaleMax` gives 4.7.
    const grid = gradebookToGrid({
      plan: planWith('fp', { decimals: 1 }), items: nested,
      entries: [defaultEntry('s0', 'x', { rawValue: 4.7, status: 'evaluated' })],
      students: [{ id: 's0', givenNames: 'A', surnames: 'B', pseudonymCode: 'STU_0001', position: 0 }],
    });
    assert.equal(grid.rows[0].cells.bloque, '5.2', 'the block subtotal is projected onto 1–10 too');
  }

  // ── 15. Advisories warn, never refuse ──────────────────────────────────────
  {
    const plan = planWith('universidad'); // caps at 0.4 / 0.3
    const overCap = [item('examen', { weight: 50, minToAverage: 0.5 }), item('t', { weight: 50 })];
    const warnings = validatePlan(plan, overCap);
    assert.ok(warnings.some((w) => w.code === 'min_above_cap'), 'a minimum above the advisory is flagged');
    assert.ok(warnings.find((w) => w.code === 'min_above_cap').source.length > 0, 'and the warning cites its source');

    // Flagged, but the engine still computes it — advisories never block.
    const computed = computeGrade({ plan, items: overCap, entries: [mark('examen', 6), mark('t', 6)] });
    assert.equal(gradeOf(computed), 6, 'a flagged plan still produces a grade');

    // Weights that do not sum to 100 exist in real published documents.
    const bad = [item('a', { weight: 60 }), item('b', { weight: 30 })];
    assert.ok(validatePlan(plan, bad).some((w) => w.code === 'weights_not_100'));
    // But 1/1/1 is a plain mean, not a mistake.
    const equal = [item('a', { weight: 1 }), item('b', { weight: 1 })];
    assert.ok(!validatePlan(plan, equal).some((w) => w.code === 'weights_not_100'));

    // Equal-sibling advisory, for normativas that require parity between criteria.
    const parity = planWith('secundaria-criterios-iguales');
    assert.ok(validatePlan(parity, bad).some((w) => w.code === 'unequal_sibling_weights'));
    assert.ok(!validatePlan(parity, equal).some((w) => w.code === 'unequal_sibling_weights'));

    // Non-recoverable share above the advisory.
    const risky = [item('a', { weight: 50, isRecoverable: false }), item('b', { weight: 50 })];
    assert.ok(validatePlan(plan, risky).some((w) => w.code === 'non_recoverable_above_cap'));
  }

  // ── 16. Degenerate input must never crash or invent a grade ────────────────
  {
    const plan = planWith('universidad');
    assert.equal(computeGrade({ plan, items: [], entries: [] }).raw, null, 'an empty plan yields no grade');
    assert.deepEqual(validatePlan(plan, []).map((w) => w.code), ['empty_plan']);

    const noMarks = computeGrade({ plan, items: [item('a', { weight: 100 })], entries: [] });
    assert.equal(noMarks.raw, null, 'no marks at all is not a zero');
    assert.equal(noMarks.passed, false);

    // All weights zero is a misconfiguration, not a zero grade.
    const zeroWeights = [item('r', { weight: 0 }), item('a', { parentId: 'r', weight: 0 }), item('b', { parentId: 'r', weight: 0 })];
    assert.equal(gradeOf(computeGrade({ plan, items: zeroWeights, entries: [mark('a', 6), mark('b', 8)] })), 7,
      'zero weights fall back to a plain mean rather than dividing by zero');

    // Values outside the item range are clamped, not propagated.
    assert.equal(gradeOf(computeGrade({ plan, items: [item('a', { weight: 100 })], entries: [mark('a', 15)] })), 10);
    assert.equal(gradeOf(computeGrade({ plan, items: [item('a', { weight: 100 })], entries: [mark('a', -3)] })), 0);
  }

  // ── 17. Every preset and every aggregation is exercised ────────────────────
  {
    const items = [item('a', { weight: 60 }), item('b', { weight: 40 })];
    const entries = [mark('a', 7), mark('b', 5)];
    for (const profile of ASSESSMENT_PROFILES) {
      const plan = planWith(profile.id);
      const result = computeGrade({ plan, items, entries });
      assert.ok(result.trace, `${profile.id}: produces a derivation`);
      if (plan.rules.record !== 'qualitative') {
        assert.ok(result.record.numeric != null, `${profile.id}: records a number`);
        assert.ok(result.record.numeric >= plan.rules.scaleMin && result.record.numeric <= plan.rules.scaleMax,
          `${profile.id}: the number stays on the plan's own scale`);
      }
      if (plan.rules.record !== 'numeric') {
        assert.ok(result.record.qualitative != null, `${profile.id}: records a term`);
      }
    }
    for (const aggregation of AGGREGATIONS) {
      const tree = [
        item('root', { aggregation, weight: 100, bestOf: 2, target: 10, conditionalMin: 0.4 }),
        item('x', { parentId: 'root', position: 0 }),
        item('y', { parentId: 'root', position: 1 }),
      ];
      const result = computeGrade({
        plan: planWith('universidad'), items: tree,
        entries: [mark('x', 6), mark('y', 8)],
        cohort: { maxByItem: { root: 10, x: 10, y: 10 } },
      });
      assert.ok(result.trace, `${aggregation}: produces a derivation`);
      if (aggregation !== 'manual') {
        assert.ok(result.record.numeric != null && Number.isFinite(result.record.numeric),
          `${aggregation}: produces a finite grade`);
      }
    }
  }

  // ── 18. The grid adapter ───────────────────────────────────────────────────
  {
    const plan = planWith('universidad');
    const items = [
      item('examen', { name: 'Examen', weight: 50, aggregation: 'sum', position: 0 }),
      item('q1', { name: 'P1', parentId: 'examen', maxPoints: 4, position: 0 }),
      item('q2', { name: 'P2', parentId: 'examen', maxPoints: 6, position: 1 }),
      item('practica', { name: 'Práctica', weight: 50, position: 1 }),
    ];
    const students = [
      { id: 'st1', givenNames: 'Ana', surnames: 'Peña López', pseudonymCode: 'STU_7K3Q', position: 0 },
      { id: 'st2', givenNames: 'Juan', surnames: 'García Ruiz', pseudonymCode: 'STU_MMMM', position: 1 },
    ];
    const entries = [
      { ...defaultEntry('st1', 'q1', { rawValue: 4, status: 'evaluated' }) },
      { ...defaultEntry('st1', 'q2', { rawValue: 5, status: 'evaluated' }) },
      { ...defaultEntry('st1', 'practica', { rawValue: 8, status: 'evaluated' }) },
      { ...defaultEntry('st2', 'q1', { rawValue: 2, status: 'evaluated' }) },
      { ...defaultEntry('st2', 'practica', { rawValue: 4, status: 'evaluated' }) },
    ];

    const grid = gradebookToGrid({ plan, items, entries, students });

    // Columns read in plan order, with each block's subtotal AFTER its parts.
    assert.deepEqual(
      grid.columns.map((c) => c.name),
      ['Identificador', 'Nombre', 'Apellidos', 'P1', 'P2', 'Examen', 'Práctica', 'Calificación'],
    );
    assert.ok(grid.columns.every((c) => c.options && c.config), 'columns carry the shape the grid expects');

    // Leaves show what was typed; blocks show the computed subtotal.
    const ana = grid.rows.find((r) => r.id === 'st1');
    assert.equal(ana.cells.q1, '4', 'a leaf shows the teacher’s own number');
    assert.equal(ana.cells.examen, '9', 'a block shows its subtotal on the plan scale');
    assert.equal(ana.cells[GRID_COL.final], '8.5', '9*0.5 + 8*0.5');
    assert.equal(ana.cells[GRID_COL.code], 'STU_7K3Q');

    // An unassessed leaf stays blank rather than becoming a zero.
    const juan = grid.rows.find((r) => r.id === 'st2');
    assert.equal(juan.cells.q2, null, 'nothing typed means an empty cell, not a zero');
    assert.ok(grid.results.st2.trace, 'every row keeps its derivation for the "why" panel');

    // A qualitative-only plan emits no number at all.
    const qualitative = gradebookToGrid({ plan: planWith('secundaria-cualitativa'), items, entries, students });
    assert.ok(!qualitative.columns.some((c) => c.id === GRID_COL.final), 'no numeric column when the record has none');
    const term = qualitative.rows.find((r) => r.id === 'st1').cells[GRID_COL.qualitative];
    assert.ok(['SU', 'BI', 'NT', 'SB'].includes(term), `records a term, got ${term}`);

    // Hiding the codes, and stripping names for anything that leaves the machine.
    assert.ok(!gradebookToGrid({ plan, items, entries, students, showCodes: false })
      .columns.some((c) => c.id === GRID_COL.code));
    // Translated headers must still be dropped: anonymousGrid keys on id, not name.
    const translated = gradebookToGrid({ plan, items, entries, students, labels: { givenNames: 'First name', surnames: 'Surname' } });
    assert.ok(translated.columns.some((c) => c.name === 'First name'), 'column names follow the caller language');
    assert.ok(!anonymousGrid(translated).columns.some((c) => c.name === 'First name'),
      'and the anonymiser still strips them, because it keys on id');
    const anon = anonymousGrid(grid);
    assert.ok(!anon.columns.some((c) => c.name === 'Nombre' || c.name === 'Apellidos'));
    assert.ok(anon.rows.every((r) => !('__given__' in r.cells) && !('__surnames__' in r.cells)),
      'no student name survives into an analysable grid');
    assert.equal(anon.rows[0].cells[GRID_COL.code], 'STU_7K3Q', 'but the identifier does, so rows stay traceable');
    assert.equal(anon.rows[0].cells.examen, '9', 'and so do the marks');

    // The summary handed to a model is built FROM the anonymous grid, so the names are
    // gone by construction rather than by remembering to strip them here.
    const summary = anonymousStudentSummary(grid, 'st1');
    assert.ok(summary.includes('STU_7K3Q'), 'the identifier travels, so the reply can be mapped back');
    assert.ok(/examen/i.test(summary), 'the marks travel');
    assert.ok(!/Ana|Peña|Nombre|Apellidos/.test(summary),
      `no name and no name-column header may appear in what leaves the machine: ${summary}`);
    assert.equal(anonymousStudentSummary(grid, 'nobody'), '', 'an unknown student summarises to nothing');

    // Even when the caller translated the headers — the anonymiser keys on id.
    const translatedSummary = anonymousStudentSummary(translated, 'st1');
    assert.ok(!/First name|Surname/.test(translatedSummary), 'translated name headers are stripped too');
  }

  // ── 19. The grid really is consumable by the database machinery ────────────
  //
  // Asserting "it produces the right shape" would be circular. This runs the REAL
  // filter, sort and statistics functions over the produced grid, which is the actual
  // claim: the gradebook inherits that stack instead of reimplementing it.
  {
    const dbOut = path.join(tmp, 'dbstack.mjs');
    await build({
      entryPoints: [path.join(repoRoot, 'scripts/fixtures/db-stack-entry.ts')],
      outfile: dbOut, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
    });
    const { sortDatabaseRows, describe, numericValues } = await import(pathToFileURL(dbOut).href);

    const plan = planWith('universidad');
    const items = [item('t1', { name: 'T1', weight: 100 })];
    const students = Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`, givenNames: `A${i}`, surnames: 'X', pseudonymCode: `STU_000${i}`, position: i,
    }));
    const entries = [3, 5, 7, 9, 10].map((v, i) => defaultEntry(`s${i}`, 't1', { rawValue: v, status: 'evaluated' }));
    const grid = gradebookToGrid({ plan, items, entries, students });
    const finalCol = grid.columns.find((c) => c.id === GRID_COL.final);

    const sorted = sortDatabaseRows(grid.rows, grid.columns, [{ columnId: finalCol.id, dir: 'desc' }]);
    assert.deepEqual(sorted.map((r) => r.cells[finalCol.id]), ['10', '9', '7', '5', '3'],
      'the real sorter orders the gradebook without any adaptation');

    const stats = describe(numericValues(finalCol, grid.rows));
    assert.equal(stats.n, 5, 'the real statistics engine reads the grade column');
    assert.equal(stats.mean, 6.8, 'and computes over it directly');
  }

  console.log('assessment engine: OK');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
