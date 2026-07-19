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

/** Thresholds a node missed, kept per node so a discarded child cannot block the tree. */
interface Unmet {
  min: string[];
  mandatory: string[];
}

interface Ctx {
  rules: PlanRules;
  byParent: Map<string | null, AssessmentItem[]>;
  entryByItem: Map<string, GradeEntry>;
  track: AssessmentTrack;
  cohort: CohortStats | undefined;
  previous: Record<string, number>;
  /**
   * itemId → thresholds missed by that node or by the children it actually counted.
   * Recorded per node instead of in one global list because an item that `bestOf`
   * throws away must not hold back the branch that never used it.
   */
  unmet: Map<string, Unmet>;
  /** Leaves with nothing recorded, for the NP trigger. Ids, not weights: see leafShares. */
  missingLeaves: Set<string>;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

function weightOf(item: AssessmentItem, track: AssessmentTrack): number {
  const w = track === 'no_continua' ? item.weightAlt : item.weight;
  return Number.isFinite(w) && w > 0 ? w : 0;
}

function unmetOf(ctx: Ctx, itemId: string): Unmet {
  let entry = ctx.unmet.get(itemId);
  if (!entry) {
    entry = { min: [], mandatory: [] };
    ctx.unmet.set(itemId, entry);
  }
  return entry;
}

// ── Share of the plan each leaf carries ──────────────────────────────────────

/**
 * How much of the WHOLE plan each leaf represents, normalised level by level.
 *
 * `weight` is relative to an item's siblings, so adding raw weights across different
 * parents compares numbers that live on different scales: a block of 2 leaves weighing
 * 1 each and a block of 10 leaves weighing 10 each are 50/50 in the plan, but a naive
 * sum makes the second one 98 % of it. Every consumer that asks "how much of the
 * subject is this set of items?" — the not-presented trigger, the non-recoverable
 * advisory — has to go through here.
 */
function shareWeight(item: AssessmentItem, parent: AssessmentItem | null, track: AssessmentTrack): number {
  const aggregation = parent ? parent.aggregation : 'weighted';
  // Point-summing parents make a child's share its points, not its weight.
  if (aggregation === 'sum' || aggregation === 'normalizeTarget' || aggregation === 'normalizeGroupMax') {
    return Number.isFinite(item.maxPoints) && item.maxPoints > 0 ? item.maxPoints : 0;
  }
  if (aggregation === 'weighted') return weightOf(item, track);
  // mean, bestOf, mode, max, last, conditionalMean, manual: every child counts alike.
  return 1;
}

export function leafShares(
  items: AssessmentItem[],
  track: AssessmentTrack = 'continua',
): Map<string, number> {
  const byParent = new Map<string | null, AssessmentItem[]>();
  for (const item of items) {
    const list = byParent.get(item.parentId) ?? [];
    list.push(item);
    byParent.set(item.parentId, list);
  }
  const out = new Map<string, number>();
  const walk = (nodes: AssessmentItem[], parent: AssessmentItem | null, share: number): void => {
    if (nodes.length === 0) return;
    const weights = nodes.map((n) => shareWeight(n, parent, track));
    const total = weights.reduce((a, b) => a + b, 0);
    nodes.forEach((node, index) => {
      // All weights zero is a misconfiguration, not a plan where nothing counts.
      const portion = total > 0 ? share * (weights[index] / total) : share / nodes.length;
      const children = (byParent.get(node.id) ?? []).slice().sort((a, b) => a.position - b.position);
      if (children.length === 0) out.set(node.id, portion);
      else walk(children, node, portion);
    });
  };
  walk((byParent.get(null) ?? []).slice().sort((a, b) => a.position - b.position), null, 1);
  return out;
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
  // Every mode gets the same nudge. A grade is never a literal: it arrives from a
  // weighted average, so the value that "is" 5 is really 4.999999999999999, and a mode
  // that truncates without an epsilon records 4.9 and fails a student who passed.
  // Applying it to only one mode is what made the modes disagree with each other.
  const EPS = 1e-9;
  const floorAt = (scaled: number) => Math.floor(scaled + EPS);
  switch (rules.rounding) {
    case 'none':
      return value;
    case 'truncate':
      return floorAt(value * factor) / factor;
    case 'halfDown': {
      const scaled = value * factor;
      const whole = floorAt(scaled);
      // Strictly above .5 goes up; exactly .5 goes down — that is what halfDown means.
      return (scaled - whole > 0.5 + EPS ? whole + 1 : whole) / factor;
    }
    case 'integer':
      // Deliberately ignores `decimals`: "entera" is the rule, and the editor warns
      // that the decimals field has no effect while this mode is selected.
      return floorAt(value + 0.5);
    case 'threshold': {
      // Honours `decimals` like every other mode: with 2 decimals the rule is about
      // the third decimal, not about the units digit.
      const scaled = value * factor;
      const whole = floorAt(scaled);
      const frac = scaled - whole;
      // `> EPS` guards a threshold of 0, which the editor allows: without it every
      // exact value would be pushed up a whole step (6,0 → 7).
      const up = frac > EPS && frac >= rules.roundingThreshold - EPS;
      return (whole + (up ? 1 : 0)) / factor;
    }
    case 'halfUp':
    default: {
      const scaled = value * factor;
      const whole = floorAt(scaled);
      // Explicit rather than Math.round so the .5 direction is unambiguous and so
      // binary representation (2.675 → 2.67499…) cannot flip it.
      return (scaled - whole >= 0.5 - EPS ? whole + 1 : whole) / factor;
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

/**
 * Fraction → the plan's scale. Exported because `scaleMin` is not always 0 (FP records
 * modules on 1–10), and anything that projects with a bare `fraction * scaleMax`
 * disagrees with the record the engine emits — which is how the same student came out
 * failed in the acta and passed in the analytics panel.
 */
export function toScale(fraction: number, rules: PlanRules): number {
  return rules.scaleMin + fraction * (rules.scaleMax - rules.scaleMin);
}

/** The inverse. Use it instead of `value / scaleMax` for the same reason. */
export function toFraction(value: number, rules: PlanRules): number {
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

  const status = entry?.status ?? 'not_assessed';
  let value: number | null = null;
  /** Set when the status alone fixes the fraction, independently of `maxPoints`. */
  let fixedFraction: number | null = null;

  // Dispatch on STATUS first and only then look at the value. A non-submission
  // legitimately carries no number, so testing `rawValue == null` before the status
  // would silently collapse "no entregado" into "sin evaluar" — turning a deliberate
  // zero into an exclusion, which is the single most consequential confusion in a
  // gradebook.
  switch (status) {
    case 'exempt':
      node.rules.push({ code: 'excluded_exempt' });
      ctx.missingLeaves.add(item.id);
      return node;

    case 'not_submitted':
      // Counts toward the not-presented trigger either way: that trigger asks about
      // PARTICIPATION ("no realizó las actividades"), while notSubmittedValue only
      // decides the arithmetic. Two different questions about the same blank cell.
      ctx.missingLeaves.add(item.id);
      if (rules.notSubmittedValue == null) {
        node.rules.push({ code: 'not_submitted_excluded' });
        return node;
      }
      value = rules.notSubmittedValue;
      node.rules.push({ code: 'not_submitted_as_value', detail: { value } });
      break;

    case 'validated':
      // A validated item is passed by definition; without a mark it counts as the
      // pass threshold rather than as zero. Expressed as a FRACTION: `passAt` already
      // is one, and projecting it onto the plan's scale to then divide by the item's
      // own `maxPoints` mixed two different units (a 2-point question came out at 250 %).
      if (entry?.rawValue == null) {
        fixedFraction = clamp01(rules.passAt);
      } else {
        value = entry.rawValue;
      }
      break;

    case 'evaluated':
      if (entry?.rawValue == null) {
        // Marked evaluated but with nothing in the cell: treat as still unassessed.
        node.status = 'not_assessed';
        node.rules.push({ code: 'excluded_not_assessed' });
        ctx.missingLeaves.add(item.id);
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
      ctx.missingLeaves.add(item.id);
      return node;
  }

  if (fixedFraction != null) {
    node.fraction = fixedFraction;
    node.points = item.maxPoints > 0 ? fixedFraction * item.maxPoints : null;
  } else {
    const raw = value as number;
    node.points = raw;

    // A leaf's own aggregation acts as a scaling rule: it says what "full marks" means
    // for this column.
    if (item.aggregation === 'normalizeGroupMax') {
      const groupMax = ctx.cohort?.maxByItem?.[item.id];
      if (groupMax == null || groupMax <= 0) {
        // Falling back to the item's own maximum rather than to "full marks": with a
        // single student graded so far there is no group to normalise against, and
        // handing them 100 % would invent a mark that changes on its own later.
        node.rules.push({ code: 'group_max_missing' });
        node.fraction = item.maxPoints > 0 ? clamp01(raw / item.maxPoints) : 0;
      } else {
        node.fraction = clamp01(raw / groupMax);
      }
    } else if (item.aggregation === 'normalizeTarget') {
      const target = item.target && item.target > 0 ? item.target : item.maxPoints;
      node.fraction = target > 0 ? clamp01(raw / target) : 0;
    } else {
      node.fraction = item.maxPoints > 0 ? clamp01(raw / item.maxPoints) : 0;
    }
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
    // `points` has to follow: parents that aggregate by `sum`, `normalizeTarget` or
    // `normalizeGroupMax` read points and never look at the fraction, so leaving it
    // stale made the ratchet silently do nothing under exactly those parents.
    node.points = node.maxPoints > 0 ? before * node.maxPoints : node.points;
  }
}

function applyThresholds(item: AssessmentItem, node: TraceNode, ctx: Ctx): void {
  if (node.fraction == null) return;
  const unmet = unmetOf(ctx, node.itemId);
  if (item.minToAverage != null && node.fraction < item.minToAverage - 1e-9) {
    node.rules.push({ code: 'min_not_met', detail: { required: item.minToAverage, got: node.fraction } });
    unmet.min.push(item.name);
  }
  if (item.isMandatory && node.fraction < ctx.rules.passAt - 1e-9) {
    node.rules.push({ code: 'mandatory_failed', detail: { required: ctx.rules.passAt, got: node.fraction } });
    unmet.mandatory.push(item.name);
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

  // The manual override is checked BEFORE the "no live children" bail-out: a branch a
  // teacher marked by hand is exactly the branch whose children are still empty.
  const manual = ctx.entryByItem.get(item.id);
  if ((item.aggregation === 'manual' || manual?.isOverride) && manual?.rawValue != null) {
    node.fraction = item.maxPoints > 0 ? clamp01(manual.rawValue / item.maxPoints) : 0;
    node.points = manual.rawValue;
    node.rules.push({ code: 'manual_override', detail: { value: manual.rawValue } });
    node.effectiveWeight = weight;
    applyThresholds(item, node, ctx);
    return node;
  }

  const live = childNodes.filter((c) => c.fraction != null);
  const dropped = childNodes.length - live.length;
  if (dropped > 0 && live.length > 0) {
    node.rules.push({ code: 'renormalized', detail: { dropped, kept: live.length } });
  }
  if (live.length === 0) {
    node.rules.push({ code: 'no_data' });
    return node;
  }

  const { fraction, counted } = aggregateChildren(item, live, node, ctx);
  node.fraction = fraction;
  node.points = node.fraction == null ? null : node.fraction * item.maxPoints;

  // Effective weights, for the trace: what each child really contributed. Computed
  // over the children the aggregation ACTUALLY used, because the derivation is the
  // document that answers a grade challenge — printing a 25 % next to a test that
  // `bestOf` discarded is worse than printing nothing.
  const countedSet = new Set(counted);
  const shares = countedShares(item, counted);
  for (const child of childNodes) {
    child.effectiveWeight = countedSet.has(child) ? shares.get(child) ?? 0 : 0;
  }

  // Only the children that counted can hold the branch back.
  const unmet = unmetOf(ctx, node.itemId);
  for (const child of counted) {
    const childUnmet = ctx.unmet.get(child.itemId);
    if (!childUnmet) continue;
    unmet.min.push(...childUnmet.min);
    unmet.mandatory.push(...childUnmet.mandatory);
  }

  applyRatchet(item, node, ctx);
  applyThresholds(item, node, ctx);
  node.effectiveWeight = weight;
  return node;
}

/** Normalised contribution of each counted child, per the parent's aggregation. */
function countedShares(item: AssessmentItem, counted: TraceNode[]): Map<TraceNode, number> {
  const out = new Map<TraceNode, number>();
  if (counted.length === 0) return out;
  const raw = (child: TraceNode): number => {
    switch (item.aggregation) {
      case 'sum':
      case 'normalizeTarget':
      case 'normalizeGroupMax':
        return child.maxPoints > 0 ? child.maxPoints : 0;
      case 'weighted':
        return child.weight;
      default:
        return 1;
    }
  };
  const weights = counted.map(raw);
  const total = weights.reduce((a, b) => a + b, 0);
  counted.forEach((child, index) => {
    out.set(child, total > 0 ? weights[index] / total : 1 / counted.length);
  });
  return out;
}

/**
 * The aggregation, plus **which children it actually used**.
 *
 * The second half is not bookkeeping. `bestOf`, `max`, `last` and `mode` throw children
 * away, and everything downstream that treats a discarded child as if it had counted
 * gets the grade wrong: its missed minimum caps the subject, and the derivation prints
 * a weight for a test nobody used.
 */
function aggregateChildren(
  item: AssessmentItem,
  live: TraceNode[],
  node: TraceNode,
  ctx: Ctx,
): { fraction: number | null; counted: TraceNode[] } {
  const fractionOf = (c: TraceNode) => c.fraction as number;
  const fractions = live.map(fractionOf);
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

  switch (item.aggregation) {
    case 'mean':
      return { fraction: mean(fractions), counted: live };

    case 'sum': {
      const points = live.reduce((sum, c) => sum + (c.points ?? 0), 0);
      const max = live.reduce((sum, c) => sum + c.maxPoints, 0);
      return { fraction: max > 0 ? clamp01(points / max) : 0, counted: live };
    }

    case 'max': {
      const best = live.reduce((a, b) => (fractionOf(b) > fractionOf(a) ? b : a));
      return { fraction: fractionOf(best), counted: [best] };
    }

    case 'last': {
      const lastNode = live[live.length - 1];
      return { fraction: fractionOf(lastNode), counted: [lastNode] };
    }

    case 'mode': {
      // Rounded to two decimals before counting, or floating noise splits ties.
      const key = (f: number) => Math.round(f * 100) / 100;
      const counts = new Map<number, number>();
      for (const f of fractions) counts.set(key(f), (counts.get(key(f)) ?? 0) + 1);
      let best = key(fractions[0]);
      let bestCount = 0;
      for (const [value, count] of counts) {
        // Ties go to the higher value: never penalise a student for an arbitrary
        // iteration order.
        if (count > bestCount || (count === bestCount && value > best)) {
          best = value;
          bestCount = count;
        }
      }
      return { fraction: best, counted: live.filter((c) => key(fractionOf(c)) === best) };
    }

    case 'bestOf': {
      const n = item.bestOf && item.bestOf > 0 ? Math.min(item.bestOf, live.length) : live.length;
      const top = [...live].sort((a, b) => fractionOf(b) - fractionOf(a)).slice(0, n);
      return { fraction: mean(top.map(fractionOf)), counted: top };
    }

    case 'conditionalMean': {
      const min = item.conditionalMin ?? ctx.rules.passAt;
      const failing = live.filter((c) => fractionOf(c) < min - 1e-9);
      if (failing.length > 0) {
        // "No hace media": the branch is held back by its weakest part rather than
        // being averaged. Recorded explicitly so the teacher sees why.
        node.rules.push({ code: 'conditional_mean_refused', detail: { required: min, failing: failing.length } });
        const worst = live.reduce((a, b) => (fractionOf(b) < fractionOf(a) ? b : a));
        return { fraction: fractionOf(worst), counted: [worst] };
      }
      return { fraction: mean(fractions), counted: live };
    }

    case 'normalizeTarget': {
      const points = live.reduce((sum, c) => sum + (c.points ?? 0), 0);
      const target = item.target && item.target > 0 ? item.target : item.maxPoints;
      return { fraction: target > 0 ? clamp01(points / target) : 0, counted: live };
    }

    case 'normalizeGroupMax': {
      const groupMax = ctx.cohort?.maxByItem?.[item.id];
      const points = live.reduce((sum, c) => sum + (c.points ?? 0), 0);
      const max = live.reduce((sum, c) => sum + c.maxPoints, 0);
      if (groupMax == null || groupMax <= 0) {
        // No group to normalise against yet: fall back to the branch's own maximum
        // rather than declaring the first student graded a perfect 100 %.
        node.rules.push({ code: 'group_max_missing' });
        return { fraction: max > 0 ? clamp01(points / max) : 0, counted: live };
      }
      return { fraction: clamp01(points / groupMax), counted: live };
    }

    case 'weighted':
    default: {
      const totalW = live.reduce((sum, c) => sum + c.weight, 0);
      // All weights zero is a misconfiguration, not a zero grade: fall back to the
      // plain mean rather than dividing by zero.
      if (totalW <= 0) return { fraction: mean(fractions), counted: live };
      return {
        fraction: live.reduce((sum, c) => sum + fractionOf(c) * c.weight, 0) / totalW,
        counted: live,
      };
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
    unmet: new Map(),
    missingLeaves: new Set(),
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

  // Not-presented: too much of the assessment was never attempted. Measured as a share
  // of the whole plan, normalised level by level — adding the raw weights of leaves
  // that hang from different parents compares numbers on different scales and can
  // write off a student who sat half the subject. See `leafShares`.
  const np = rules.np;
  let notPresented = false;
  if (np.enabled && np.triggerPct != null && ctx.missingLeaves.size > 0) {
    const shares = leafShares(input.items, ctx.track);
    let missing = 0;
    for (const id of ctx.missingLeaves) missing += shares.get(id) ?? 0;
    // Strictly greater: the published rules say "MÁS del 50 %", so a student sitting
    // exactly on the boundary is graded, not written off.
    if (missing > np.triggerPct + 1e-9) {
      notPresented = true;
      resultRules.push({ code: 'no_data', detail: { missing, trigger: np.triggerPct } });
    }
  }

  /**
   * The legal record is a PROJECTION of the computed value through `rules.record`, and
   * the not-presented case was escaping it: the old code assigned both fields after the
   * `rules.record` check, so a qualitative-only plan emitted a number for a student who
   * never turned up. Both paths that reach "no presentado" now go through here, so they
   * can no longer produce two different records for the same situation.
   *
   * The NP CODE is the one thing that survives the projection in every plan. It is not a
   * qualitative grade — it is what the official record must say verbatim in that cell,
   * numeric plan or not, which is why `NotPresentedPolicy.code` exists at all.
   */
  const recordFor = (rounded: number | null, isNp: boolean): LegalRecord => {
    const wantsNumber = rules.record !== 'qualitative';
    const wantsTerm = rules.record !== 'numeric';
    if (isNp) {
      return {
        numeric: wantsNumber ? np.value : null,
        qualitative: np.code,
        notPresented: true,
      };
    }
    return {
      numeric: wantsNumber ? rounded : null,
      qualitative: wantsTerm && rounded != null ? qualitativeFor(toFraction(rounded, rules), rules) : null,
      notPresented: false,
    };
  };

  if (fraction == null) {
    // Nothing at all was recorded. That is the not-presented case whenever the plan
    // has the concept, regardless of the trigger percentage.
    const isNp = np.enabled;
    return {
      raw: null,
      record: recordFor(null, isNp),
      passed: false,
      trace: rootNode,
      rules: [...resultRules, { code: 'no_data' }],
    };
  }

  let raw = toScale(fraction, rules);
  const rootUnmet = ctx.unmet.get(rootNode.itemId) ?? { min: [], mandatory: [] };
  const blocked = rootUnmet.min.length > 0 || rootUnmet.mandatory.length > 0;

  if (blocked && rules.minNotMet.mode === 'cap') {
    const capped = Math.min(raw, rules.minNotMet.capAt);
    if (capped !== raw) resultRules.push({ code: 'capped', detail: { from: raw, to: capped } });
    raw = capped;
  }
  if (rootUnmet.min.length > 0) {
    resultRules.push({ code: 'min_not_met', detail: { items: rootUnmet.min.join(', ') } });
  }
  if (rootUnmet.mandatory.length > 0) {
    resultRules.push({ code: 'mandatory_failed', detail: { items: rootUnmet.mandatory.join(', ') } });
  }

  const rounded = roundValue(raw, rules);
  if (rounded !== raw) resultRules.push({ code: 'rounded', detail: { from: raw, to: rounded } });

  // The pass decision reads the ROUNDED value: it is the number that gets recorded,
  // and a student must not be failed by a decimal nobody can see.
  const passed = !blocked && !notPresented && toFraction(rounded, rules) >= rules.passAt - 1e-9;

  const record = recordFor(rounded, notPresented);

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
export interface HonoursCandidate {
  studentId: string;
  raw: number | null;
  /** Whether the subject was actually passed. A distinction presupposes a pass. */
  passed?: boolean;
  notPresented?: boolean;
}

export function awardHonours(
  ranked: HonoursCandidate[],
  policy: HonoursPolicy,
  rules: PlanRules,
): string[] {
  if (!policy.enabled) return [];
  const quota = honoursQuota(ranked.length, policy);
  if (quota <= 0) return [];
  return ranked
    .filter((r): r is HonoursCandidate & { raw: number } => r.raw != null)
    // A distinction is awarded on top of a pass. Ranking on the number alone would
    // hand one to a student recorded as not-presented, or to one whose mark is high
    // but capped by an unmet minimum — both of which are failures, not top marks.
    .filter((r) => r.notPresented !== true && r.passed !== false)
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
    // Shares, not raw weights: `weight` is relative to an item's siblings, so summing
    // it across the whole tree measures nothing (see `leafShares`).
    const shares = leafShares(items);
    let nonRecoverable = 0;
    for (const item of items) {
      if (!item.isRecoverable) nonRecoverable += shares.get(item.id) ?? 0;
    }
    if (nonRecoverable > advisories.maxNonRecoverablePct + 1e-9) {
      warnings.push({
        code: 'non_recoverable_above_cap',
        itemId: null,
        detail: { got: nonRecoverable, cap: advisories.maxNonRecoverablePct },
        source: advisories.source,
      });
    }
  }

  return warnings;
}
