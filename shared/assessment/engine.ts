/**
 * The grading engine.
 *
 * Walks the item tree once and returns both the grade AND the full derivation that
 * produced it. The trace is not a debugging extra: "justificar la calificación final"
 * is one of the things teachers report struggling with most, and a grade challenge is
 * resolved by checking the mark against the published plan. So every rule that fires —
 * a threshold missed, weights renormalised because two criteria were never assessed,
 * a 6.47 rounded to 6 — is recorded as a structured code the UI can render and
 * translate.
 *
 * Everything works internally in **fractions of 0–1** and projects onto the plan's
 * scale only at the very end, which is what lets items with different point values
 * (a 0.5-point exam question next to a 10-point essay) combine without special cases.
 *
 * Pure: no Electron, no DB, no settings, no clock.
 */
import type {
  AssessmentItem,
  AssessmentPlan,
  AssessmentTrack,
  CohortStats,
  GradeEntry,
  GradeResult,
  HonoursPolicy,
  LegalRecord,
  PlanRules,
  TraceNode,
  TraceRule,
} from './model';

export interface ComputeInput {
  plan: AssessmentPlan;
  items: AssessmentItem[];
  /** Entries for ONE student, already filtered to the relevant convocatoria. */
  entries: GradeEntry[];
  track?: AssessmentTrack;
  cohort?: CohortStats;
  /** Previously achieved fractions per item, for the ratchet rule. */
  previous?: Record<string, number>;
}

interface Ctx {
  rules: PlanRules;
  byParent: Map<string | null, AssessmentItem[]>;
  entryByItem: Map<string, GradeEntry>;
  track: AssessmentTrack;
  cohort: CohortStats | undefined;
  previous: Record<string, number>;
  unmetMin: string[];
  unmetMandatory: string[];
  /** Weight of leaves with nothing recorded, over the total — for the NP trigger. */
  totalLeafWeight: number;
  missingLeafWeight: number;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

function weightOf(item: AssessmentItem, track: AssessmentTrack): number {
  const w = track === 'no_continua' ? item.weightAlt : item.weight;
  return Number.isFinite(w) && w > 0 ? w : 0;
}

// ── Rounding and projection ──────────────────────────────────────────────────

/**
 * Applies the plan's rounding. `threshold` is the unusual one and it is not a
 * curiosity: real published programaciones round up only from, say, 0.7, and a tool
 * that silently rounds at 0.5 would contradict the document the teacher published.
 */
export function roundValue(value: number, rules: PlanRules): number {
  const d = Math.max(0, Math.floor(rules.decimals));
  const factor = 10 ** d;
  switch (rules.rounding) {
    case 'none':
      return value;
    case 'truncate':
      return Math.floor(value * factor) / factor;
    case 'halfDown': {
      const scaled = value * factor;
      const frac = scaled - Math.floor(scaled);
      return (frac > 0.5 ? Math.ceil(scaled) : Math.floor(scaled)) / factor;
    }
    case 'integer':
      return Math.round(value);
    case 'threshold': {
      const whole = Math.floor(value);
      return whole + (value - whole >= rules.roundingThreshold ? 1 : 0);
    }
    case 'halfUp':
    default: {
      const scaled = value * factor;
      const frac = scaled - Math.floor(scaled);
      // Explicit rather than Math.round so the .5 direction is unambiguous and so
      // binary representation (2.675 → 2.67499…) cannot flip it.
      return (frac >= 0.5 - 1e-9 ? Math.floor(scaled) + 1 : Math.floor(scaled)) / factor;
    }
  }
}

export function qualitativeFor(fraction: number, rules: PlanRules): string | null {
  let best: string | null = null;
  let bestMin = -Infinity;
  for (const band of rules.qualitativeBands) {
    if (fraction >= band.min - 1e-9 && band.min >= bestMin) {
      best = band.code;
      bestMin = band.min;
    }
  }
  return best;
}

function toScale(fraction: number, rules: PlanRules): number {
  return rules.scaleMin + fraction * (rules.scaleMax - rules.scaleMin);
}

function toFraction(value: number, rules: PlanRules): number {
  const span = rules.scaleMax - rules.scaleMin;
  return span === 0 ? 0 : (value - rules.scaleMin) / span;
}

// ── The tree walk ────────────────────────────────────────────────────────────

function leafNode(item: AssessmentItem, ctx: Ctx): TraceNode {
  const rules = ctx.rules;
  const entry = ctx.entryByItem.get(item.id);
  const weight = weightOf(item, ctx.track);
  const node: TraceNode = {
    itemId: item.id,
    name: item.name,
    kind: item.kind,
    aggregation: item.aggregation,
    fraction: null,
    points: null,
    maxPoints: item.maxPoints,
    status: entry?.status ?? 'not_assessed',
    weight,
    effectiveWeight: 0,
    rules: [],
    children: [],
  };

  ctx.totalLeafWeight += weight;

  const status = entry?.status ?? 'not_assessed';
  let value: number | null = null;

  // Dispatch on STATUS first and only then look at the value. A non-submission
  // legitimately carries no number, so testing `rawValue == null` before the status
  // would silently collapse "no entregado" into "sin evaluar" — turning a deliberate
  // zero into an exclusion, which is the single most consequential confusion in a
  // gradebook.
  switch (status) {
    case 'exempt':
      node.rules.push({ code: 'excluded_exempt' });
      ctx.missingLeafWeight += weight;
      return node;

    case 'not_submitted':
      // Counts toward the not-presented trigger either way: that trigger asks about
      // PARTICIPATION ("no realizó las actividades"), while notSubmittedValue only
      // decides the arithmetic. Two different questions about the same blank cell.
      ctx.missingLeafWeight += weight;
      if (rules.notSubmittedValue == null) {
        node.rules.push({ code: 'not_submitted_excluded' });
        return node;
      }
      value = rules.notSubmittedValue;
      node.rules.push({ code: 'not_submitted_as_value', detail: { value } });
      break;

    case 'validated':
      // A validated item is passed by definition; without a mark it counts as the
      // pass threshold rather than as zero.
      value = entry?.rawValue ?? toScale(rules.passAt, rules);
      break;

    case 'evaluated':
      if (entry?.rawValue == null) {
        // Marked evaluated but with nothing in the cell: treat as still unassessed.
        node.status = 'not_assessed';
        node.rules.push({ code: 'excluded_not_assessed' });
        ctx.missingLeafWeight += weight;
        return node;
      }
      value = entry.rawValue;
      break;

    case 'not_assessed':
    default:
      if (rules.notAssessedPenalizes) {
        value = 0;
        node.rules.push({ code: 'no_data' });
        break;
      }
      // The rule worth copying from official criterion-native gradebooks: an item
      // nobody has assessed yet does not drag the grade down; the remaining weights
      // are renormalised so the mark reflects what has actually been taught.
      node.rules.push({ code: 'excluded_not_assessed' });
      ctx.missingLeafWeight += weight;
      return node;
  }

  node.points = value;

  // A leaf's own aggregation acts as a scaling rule: it says what "full marks" means
  // for this column.
  if (item.aggregation === 'normalizeGroupMax') {
    const groupMax = ctx.cohort?.maxByItem?.[item.id];
    if (groupMax == null || groupMax <= 0) {
      node.rules.push({ code: 'group_max_missing' });
      node.fraction = value > 0 ? 1 : 0;
    } else {
      node.fraction = clamp01(value / groupMax);
    }
  } else if (item.aggregation === 'normalizeTarget') {
    const target = item.target && item.target > 0 ? item.target : item.maxPoints;
    node.fraction = clamp01(value / target);
  } else {
    node.fraction = item.maxPoints > 0 ? clamp01(value / item.maxPoints) : 0;
  }

  applyRatchet(item, node, ctx);
  applyThresholds(item, node, ctx);
  node.effectiveWeight = weight;
  return node;
}

function applyRatchet(item: AssessmentItem, node: TraceNode, ctx: Ctx): void {
  if (!ctx.rules.ratchet || node.fraction == null) return;
  const before = ctx.previous[item.id];
  if (before != null && before > node.fraction) {
    node.rules.push({ code: 'ratchet_applied', detail: { from: node.fraction, to: before } });
    node.fraction = before;
  }
}

function applyThresholds(item: AssessmentItem, node: TraceNode, ctx: Ctx): void {
  if (node.fraction == null) return;
  if (item.minToAverage != null && node.fraction < item.minToAverage - 1e-9) {
    node.rules.push({ code: 'min_not_met', detail: { required: item.minToAverage, got: node.fraction } });
    ctx.unmetMin.push(item.name);
  }
  if (item.isMandatory && node.fraction < ctx.rules.passAt - 1e-9) {
    node.rules.push({ code: 'mandatory_failed', detail: { required: ctx.rules.passAt, got: node.fraction } });
    ctx.unmetMandatory.push(item.name);
  }
}

function branchNode(item: AssessmentItem, children: AssessmentItem[], ctx: Ctx): TraceNode {
  const weight = weightOf(item, ctx.track);
  const childNodes = children.map((child) => computeNode(child, ctx));
  const node: TraceNode = {
    itemId: item.id,
    name: item.name,
    kind: item.kind,
    aggregation: item.aggregation,
    fraction: null,
    points: null,
    maxPoints: item.maxPoints,
    status: null,
    weight,
    effectiveWeight: 0,
    rules: [],
    children: childNodes,
  };

  const live = childNodes.filter((c) => c.fraction != null);
  const dropped = childNodes.length - live.length;
  if (dropped > 0 && live.length > 0) {
    node.rules.push({ code: 'renormalized', detail: { dropped, kept: live.length } });
  }
  if (live.length === 0) {
    node.rules.push({ code: 'no_data' });
    return node;
  }

  const manual = ctx.entryByItem.get(item.id);
  if (item.aggregation === 'manual' || manual?.isOverride) {
    if (manual?.rawValue != null) {
      node.fraction = item.maxPoints > 0 ? clamp01(manual.rawValue / item.maxPoints) : 0;
      node.points = manual.rawValue;
      node.rules.push({ code: 'manual_override', detail: { value: manual.rawValue } });
      node.effectiveWeight = weight;
      applyThresholds(item, node, ctx);
      return node;
    }
  }

  node.fraction = aggregateChildren(item, live, node, ctx);
  node.points = node.fraction == null ? null : node.fraction * item.maxPoints;

  // Effective weights, for the trace: what each child really contributed.
  const totalW = live.reduce((sum, c) => sum + c.weight, 0);
  for (const child of childNodes) {
    child.effectiveWeight = child.fraction == null || totalW === 0 ? 0 : child.weight / totalW;
  }

  applyRatchet(item, node, ctx);
  applyThresholds(item, node, ctx);
  node.effectiveWeight = weight;
  return node;
}

function aggregateChildren(
  item: AssessmentItem,
  live: TraceNode[],
  node: TraceNode,
  ctx: Ctx,
): number | null {
  const fractions = live.map((c) => c.fraction as number);

  switch (item.aggregation) {
    case 'mean':
      return fractions.reduce((a, b) => a + b, 0) / fractions.length;

    case 'sum': {
      const points = live.reduce((sum, c) => sum + (c.points ?? 0), 0);
      const max = live.reduce((sum, c) => sum + c.maxPoints, 0);
      return max > 0 ? clamp01(points / max) : 0;
    }

    case 'max':
      return Math.max(...fractions);

    case 'last':
      return fractions[fractions.length - 1];

    case 'mode': {
      // Rounded to two decimals before counting, or floating noise splits ties.
      const counts = new Map<number, number>();
      for (const f of fractions) {
        const key = Math.round(f * 100) / 100;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      let best = fractions[0];
      let bestCount = 0;
      for (const [value, count] of counts) {
        // Ties go to the higher value: never penalise a student for an arbitrary
        // iteration order.
        if (count > bestCount || (count === bestCount && value > best)) {
          best = value;
          bestCount = count;
        }
      }
      return best;
    }

    case 'bestOf': {
      const n = item.bestOf && item.bestOf > 0 ? Math.min(item.bestOf, fractions.length) : fractions.length;
      const top = [...fractions].sort((a, b) => b - a).slice(0, n);
      return top.reduce((a, b) => a + b, 0) / top.length;
    }

    case 'conditionalMean': {
      const min = item.conditionalMin ?? ctx.rules.passAt;
      const failing = fractions.filter((f) => f < min - 1e-9);
      if (failing.length > 0) {
        // "No hace media": the branch is held back by its weakest part rather than
        // being averaged. Recorded explicitly so the teacher sees why.
        node.rules.push({ code: 'conditional_mean_refused', detail: { required: min, failing: failing.length } });
        return Math.min(...fractions);
      }
      return fractions.reduce((a, b) => a + b, 0) / fractions.length;
    }

    case 'normalizeTarget': {
      const points = live.reduce((sum, c) => sum + (c.points ?? 0), 0);
      const target = item.target && item.target > 0 ? item.target : item.maxPoints;
      return clamp01(points / target);
    }

    case 'normalizeGroupMax': {
      const groupMax = ctx.cohort?.maxByItem?.[item.id];
      const points = live.reduce((sum, c) => sum + (c.points ?? 0), 0);
      if (groupMax == null || groupMax <= 0) {
        node.rules.push({ code: 'group_max_missing' });
        return points > 0 ? 1 : 0;
      }
      return clamp01(points / groupMax);
    }

    case 'weighted':
    default: {
      const totalW = live.reduce((sum, c) => sum + c.weight, 0);
      // All weights zero is a misconfiguration, not a zero grade: fall back to the
      // plain mean rather than dividing by zero.
      if (totalW <= 0) return fractions.reduce((a, b) => a + b, 0) / fractions.length;
      return live.reduce((sum, c) => sum + (c.fraction as number) * c.weight, 0) / totalW;
    }
  }
}

function computeNode(item: AssessmentItem, ctx: Ctx): TraceNode {
  const children = (ctx.byParent.get(item.id) ?? []).slice().sort((a, b) => a.position - b.position);
  return children.length === 0 ? leafNode(item, ctx) : branchNode(item, children, ctx);
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function computeGrade(input: ComputeInput): GradeResult {
  const rules = input.plan.rules;
  const byParent = new Map<string | null, AssessmentItem[]>();
  for (const item of input.items) {
    const list = byParent.get(item.parentId) ?? [];
    list.push(item);
    byParent.set(item.parentId, list);
  }
  const entryByItem = new Map<string, GradeEntry>();
  for (const entry of input.entries) entryByItem.set(entry.itemId, entry);

  const ctx: Ctx = {
    rules,
    byParent,
    entryByItem,
    track: input.track ?? 'continua',
    cohort: input.cohort,
    previous: input.previous ?? {},
    unmetMin: [],
    unmetMandatory: [],
    totalLeafWeight: 0,
    missingLeafWeight: 0,
  };

  const roots = (byParent.get(null) ?? []).slice().sort((a, b) => a.position - b.position);
  if (roots.length === 0) {
    return { raw: null, record: { numeric: null, qualitative: null, notPresented: false }, passed: false, trace: null, rules: [{ code: 'no_data' }] };
  }

  // One top-level block computes as itself; several are combined under a synthetic
  // root so the caller never has to invent one. The synthetic root always weights,
  // which is what "EXAMEN 50 / PRÁCTICA 30 / APROVECHAMIENTO 20" means.
  const singleRoot = roots.length === 1;
  const virtualRoot: AssessmentItem = {
    ...roots[0],
    id: '__root__',
    parentId: null,
    name: input.plan.name,
    kind: 'block',
    aggregation: 'weighted',
    maxPoints: rules.scaleMax,
    minToAverage: null,
    isMandatory: false,
    weight: 1,
    weightAlt: 1,
  };
  const rootNode = singleRoot ? computeNode(roots[0], ctx) : branchNode(virtualRoot, roots, ctx);

  const resultRules: TraceRule[] = [];
  const fraction = rootNode.fraction;

  // Not-presented: too much of the assessment was never attempted.
  const np = rules.np;
  let notPresented = false;
  if (np.enabled && np.triggerPct != null && ctx.totalLeafWeight > 0) {
    const missing = ctx.missingLeafWeight / ctx.totalLeafWeight;
    // Strictly greater: the published rules say "MÁS del 50 %", so a student sitting
    // exactly on the boundary is graded, not written off.
    if (missing > np.triggerPct + 1e-9) {
      notPresented = true;
      resultRules.push({ code: 'no_data', detail: { missing, trigger: np.triggerPct } });
    }
  }

  if (fraction == null) {
    return {
      raw: null,
      record: {
        numeric: np.enabled && np.value != null ? np.value : null,
        qualitative: null,
        notPresented: np.enabled,
      },
      passed: false,
      trace: rootNode,
      rules: [...resultRules, { code: 'no_data' }],
    };
  }

  let raw = toScale(fraction, rules);
  const blocked = ctx.unmetMin.length > 0 || ctx.unmetMandatory.length > 0;

  if (blocked && rules.minNotMet.mode === 'cap') {
    const capped = Math.min(raw, rules.minNotMet.capAt);
    if (capped !== raw) resultRules.push({ code: 'capped', detail: { from: raw, to: capped } });
    raw = capped;
  }
  if (blocked && ctx.unmetMin.length > 0) {
    resultRules.push({ code: 'min_not_met', detail: { items: ctx.unmetMin.join(', ') } });
  }
  if (blocked && ctx.unmetMandatory.length > 0) {
    resultRules.push({ code: 'mandatory_failed', detail: { items: ctx.unmetMandatory.join(', ') } });
  }

  const rounded = roundValue(raw, rules);
  if (rounded !== raw) resultRules.push({ code: 'rounded', detail: { from: raw, to: rounded } });

  // The pass decision reads the ROUNDED value: it is the number that gets recorded,
  // and a student must not be failed by a decimal nobody can see.
  const passed = !blocked && !notPresented && toFraction(rounded, rules) >= rules.passAt - 1e-9;

  const record: LegalRecord = {
    numeric: rules.record === 'qualitative' ? null : rounded,
    qualitative: rules.record === 'numeric' ? null : qualitativeFor(toFraction(rounded, rules), rules),
    notPresented,
  };
  if (notPresented) {
    record.numeric = np.value;
    record.qualitative = np.code;
  }

  return {
    // keepRealForAverage: the unrounded value survives for any later average, which
    // is exactly what programaciones mean by "truncar conservando la nota real".
    raw: rules.keepRealForAverage ? toScale(fraction, rules) : rounded,
    record,
    passed,
    trace: rootNode,
    rules: resultRules,
  };
}

// ── Honours quota ────────────────────────────────────────────────────────────

/**
 * How many distinctions a cohort may receive.
 *
 * The percentage is widely fixed but *how a fraction becomes a whole number* is not:
 * institutions round up, round half-up, or say nothing at all — and at least one
 * published rule contradicts itself. So the mode is a setting, and the small-cohort
 * exception is applied first.
 */
export function honoursQuota(cohortSize: number, policy: HonoursPolicy): number {
  if (!policy.enabled || cohortSize <= 0) return 0;
  if (cohortSize < policy.minCohortForOne) return 1;
  const exact = cohortSize * policy.quotaPct;
  switch (policy.rounding) {
    case 'up':
      return Math.max(1, Math.ceil(exact));
    case 'down':
      return Math.floor(exact);
    case 'halfUp':
    default: {
      const whole = Math.floor(exact);
      return exact - whole >= 0.5 ? whole + 1 : whole;
    }
  }
}

/**
 * Ranks eligible students and returns the ids that fit inside the quota.
 *
 * The cohort passed in is everyone *enrolled*, not everyone graded: the quota is
 * counted over enrolment, so students with no mark still enlarge the denominator.
 */
export function awardHonours(
  ranked: { studentId: string; raw: number | null }[],
  policy: HonoursPolicy,
  rules: PlanRules,
): string[] {
  if (!policy.enabled) return [];
  const quota = honoursQuota(ranked.length, policy);
  if (quota <= 0) return [];
  return ranked
    .filter((r): r is { studentId: string; raw: number } => r.raw != null)
    .filter((r) => toFraction(r.raw, rules) >= policy.threshold - 1e-9)
    .sort((a, b) => b.raw - a.raw)
    .slice(0, quota)
    .map((r) => r.studentId);
}

// ── Plan validation (advisories, never refusals) ─────────────────────────────

export interface PlanWarning {
  code: 'weights_not_100' | 'min_above_cap' | 'non_recoverable_above_cap' | 'unequal_sibling_weights' | 'empty_plan';
  itemId: string | null;
  detail: Record<string, number | string>;
  /** The cited source for the limit, when the advisory came from one. */
  source: string;
}

export function validatePlan(plan: AssessmentPlan, items: AssessmentItem[]): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  const advisories = plan.rules.advisories;
  if (items.length === 0) {
    return [{ code: 'empty_plan', itemId: null, detail: {}, source: '' }];
  }

  const byParent = new Map<string | null, AssessmentItem[]>();
  for (const item of items) {
    const list = byParent.get(item.parentId) ?? [];
    list.push(item);
    byParent.set(item.parentId, list);
  }

  for (const [parentId, siblings] of byParent) {
    if (siblings.length === 0) continue;
    const parent = parentId ? items.find((i) => i.id === parentId) : null;
    if (parent && parent.aggregation !== 'weighted') continue;

    const sum = siblings.reduce((total, item) => total + item.weight, 0);
    // Only meaningful when the weights are being used as percentages, which is what
    // every real guía docente does. Weights of 1/1/1 are a plain mean, not an error.
    if (siblings.some((s) => s.weight > 1) && Math.abs(sum - 100) > 0.01) {
      warnings.push({ code: 'weights_not_100', itemId: parentId, detail: { sum }, source: '' });
    }
    if (advisories.equalSiblingWeights && siblings.length > 1) {
      const first = siblings[0].weight;
      if (siblings.some((s) => Math.abs(s.weight - first) > 0.01)) {
        warnings.push({ code: 'unequal_sibling_weights', itemId: parentId, detail: {}, source: advisories.source });
      }
    }
  }

  if (advisories.maxMinToAverage != null) {
    for (const item of items) {
      if (item.minToAverage != null && item.minToAverage > advisories.maxMinToAverage + 1e-9) {
        warnings.push({
          code: 'min_above_cap',
          itemId: item.id,
          detail: { got: item.minToAverage, cap: advisories.maxMinToAverage },
          source: advisories.source,
        });
      }
    }
  }

  if (advisories.maxNonRecoverablePct != null) {
    const leaves = items.filter((i) => !items.some((c) => c.parentId === i.id));
    const total = leaves.reduce((sum, i) => sum + i.weight, 0);
    const nonRecoverable = leaves.filter((i) => !i.isRecoverable).reduce((sum, i) => sum + i.weight, 0);
    if (total > 0 && nonRecoverable / total > advisories.maxNonRecoverablePct + 1e-9) {
      warnings.push({
        code: 'non_recoverable_above_cap',
        itemId: null,
        detail: { got: nonRecoverable / total, cap: advisories.maxNonRecoverablePct },
        source: advisories.source,
      });
    }
  }

  return warnings;
}
