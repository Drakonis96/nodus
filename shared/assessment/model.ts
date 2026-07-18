/**
 * Assessment model (teaching vault) — the shapes the gradebook computes over.
 *
 * Two decisions run through everything here, and both come from what the law
 * actually says rather than from what a gradebook usually assumes:
 *
 * 1. **The numeric grade is a projection, not the datum.** Several Spanish regions
 *    record secondary-school results with no number at all — only a qualitative term.
 *    So the atom is `(student × item) → value + STATUS`, and the legal record is
 *    derived from it by a configurable projection. Modelling the number as primary
 *    would make the tool unable to emit the record those regions require.
 *
 * 2. **Nothing here is institution-specific.** No state norm prescribes any
 *    arithmetic: what binds a teacher is their own published programación didáctica
 *    or guía docente. Every threshold, rounding rule, cap and quota therefore lives
 *    in `PlanRules` and is editable. The presets in ./profiles.ts only seed sensible
 *    starting values, and institutional limits are surfaced as *advisories* — cited
 *    warnings the teacher can read and overrule — never as enforcement. A rule that
 *    is right at one university is wrong at the next one.
 *
 * Pure: no Electron, no DB, no settings.
 */

// ── Entry status ─────────────────────────────────────────────────────────────
//
// Orthogonal to the value, and the whole reason a blank cell need not mean zero.

export const ENTRY_STATUSES = ['evaluated', 'not_submitted', 'not_assessed', 'exempt', 'validated'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

/** How a value is captured for a leaf item. */
export const ENTRY_MODES = ['numeric', 'points', 'level', 'rubric', 'passFail', 'counter'] as const;
export type EntryMode = (typeof ENTRY_MODES)[number];

/**
 * How children roll up into their parent.
 *
 * `normalizeGroupMax` is the "cumulative criterion" a teacher uses for things like
 * class participation: whoever participated most gets full marks and the rest scale
 * against them. It has a consequence that must be shown in the UI, not hidden — a
 * student's mark changes when a *different* student participates more.
 */
export const AGGREGATIONS = [
  'weighted',           // media ponderada
  'mean',               // media aritmética
  'sum',                // suma de puntos
  'normalizeGroupMax',  // escala contra el máximo del grupo
  'normalizeTarget',    // escala contra un objetivo fijo
  'bestOf',             // mejores N de M
  'mode',               // moda
  'max',                // valor más alto
  'last',               // último valor
  'conditionalMean',    // media solo si todos alcanzan un mínimo
  'manual',             // el docente fija el valor
] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];

export const ROUNDING_MODES = ['none', 'halfUp', 'halfDown', 'truncate', 'threshold', 'integer'] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];

/** Which weight column applies. Mirrors the two columns of a UCLM-style guía docente. */
export const ASSESSMENT_TRACKS = ['continua', 'no_continua'] as const;
export type AssessmentTrack = (typeof ASSESSMENT_TRACKS)[number];

// ── Items ────────────────────────────────────────────────────────────────────

export type ItemKind = 'block' | 'activity' | 'criterion';

export interface AssessmentItem {
  id: string;
  planId: string;
  parentId: string | null;
  name: string;
  kind: ItemKind;
  position: number;
  /** Weight within the parent, for the `continua` track. Any scale — normalised. */
  weight: number;
  /** Weight for the `no_continua` track. Usually equal; sometimes 0 or 100. */
  weightAlt: number;
  aggregation: Aggregation;
  entryMode: EntryMode;
  /** Points this leaf is worth. 10 by default; an exam question might be 0.5. */
  maxPoints: number;
  /**
   * Fraction (0–1) this item must reach before the tree is allowed to average.
   * Null means no threshold. Widely used at university ("un 4 sobre 10 para
   * promediar"); the ceiling on how high it may be set is institutional, so it is an
   * advisory in PlanRules rather than a hard limit here.
   */
  minToAverage: number | null;
  /** Must be passed for the subject to be passed at all. */
  isMandatory: boolean;
  /** Can be re-sat in a later convocatoria. Non-recoverable marks carry over. */
  isRecoverable: boolean;
  /** `normalizeTarget`: the value that counts as full marks (e.g. 10 participations). */
  target: number | null;
  /** `bestOf`: how many of the children count. */
  bestOf: number | null;
  /** `conditionalMean`: every child must reach this fraction or the mean is refused. */
  conditionalMin: number | null;
  /** Provenance, so a grade can be traced back to what generated the column. */
  sourceExamId: string | null;
  sourceExamQuestionId: string | null;
  sourceRubricId: string | null;
  /** LOMLOE traceability: which competencia específica / criterio de evaluación. */
  competencyCode: string | null;
  criterionCode: string | null;
}

export interface GradeEntry {
  studentId: string;
  itemId: string;
  convocatoria: string;
  /** In the item's own units (0..maxPoints). Null when nothing was recorded. */
  rawValue: number | null;
  status: EntryStatus;
  /** The teacher overrode the computed value by hand. */
  isOverride: boolean;
  note: string;
}

// ── Plan rules ───────────────────────────────────────────────────────────────

export interface QualitativeBand {
  /** Short code as it appears in the official record, e.g. `SU`. */
  code: string;
  label: string;
  /** Lowest fraction (0–1) that earns this band. */
  min: number;
}

/**
 * What to record when a `minToAverage` was not reached.
 *  - `raw`: keep the weighted average (which will be below the pass mark).
 *  - `cap`: record `capAt` instead. Some universities recommend a value in the
 *    4.0–4.9 band; others say nothing at all, which is why this is a setting.
 */
export interface MinNotMetPolicy {
  mode: 'raw' | 'cap';
  capAt: number;
}

export interface NotPresentedPolicy {
  enabled: boolean;
  /** Code written in the record, e.g. `NP`. */
  label: string;
  /**
   * Numeric equivalent when the record is numeric, or null to leave it out of any
   * average. Note this genuinely differs *within* one region between stages, so it
   * must never be a shared constant.
   */
  value: number | null;
  /**
   * Fraction of the total weight a student may leave unattempted before the whole
   * subject is recorded as not-presented. Institutions use 50%, 60%… or nothing.
   */
  triggerPct: number | null;
}

export interface HonoursPolicy {
  enabled: boolean;
  /** Minimum fraction (0–1) to be eligible. */
  threshold: number;
  /** Share of the cohort that may receive it. */
  quotaPct: number;
  /** What the percentage is counted over. Universities genuinely differ. */
  unit: 'subject' | 'group' | 'record';
  /** How a fractional quota becomes a whole number. Universities differ, and at
   *  least one national-level norm is silent, so this cannot be hardcoded. */
  rounding: 'up' | 'halfUp' | 'down';
  /** Below this cohort size, exactly one may be awarded. */
  minCohortForOne: number;
}

/**
 * Advisory limits. These produce **warnings**, never refusals.
 *
 * Real published programaciones contain weights that do not sum, and institutional
 * caps vary or are absent. Refusing to save such a plan would make the tool unusable
 * for the documents teachers actually have; staying silent would make it useless as a
 * check. So: say it clearly, cite where it comes from, let the teacher decide.
 */
export interface PlanAdvisories {
  /** Highest fraction a `minToAverage` may take before we flag it. */
  maxMinToAverage: number | null;
  /** Highest share of the total that may be non-recoverable. */
  maxNonRecoverablePct: number | null;
  /** Flag when sibling criteria carry different weights (some regions require parity). */
  equalSiblingWeights: boolean;
  /** Free-text source for the above, shown verbatim in the warning. */
  source: string;
}

export interface PlanRules {
  /** Internal scale the projection maps onto. */
  scaleMin: number;
  scaleMax: number;
  /** Fraction (0–1) at or above which the subject is passed. Not always 0.5. */
  passAt: number;
  decimals: number;
  rounding: RoundingMode;
  /** For `threshold` rounding: round up only from this decimal part (e.g. 0.7). */
  roundingThreshold: number;
  /** Keep the unrounded value for later averages even when rounding the record. */
  keepRealForAverage: boolean;
  record: 'numeric' | 'qualitative' | 'both';
  qualitativeBands: QualitativeBand[];
  /**
   * What a `not_submitted` entry contributes: a number (usually 0), or null to leave
   * it out and renormalise — the difference between a fair blank and a punitive zero.
   */
  notSubmittedValue: number | null;
  /**
   * When false, an item nobody has assessed yet is dropped and the remaining weights
   * are renormalised, so a mid-term grade is computed over what has actually been
   * taught. This is the single most humane rule in any official gradebook.
   */
  notAssessedPenalizes: boolean;
  minNotMet: MinNotMetPolicy;
  np: NotPresentedPolicy;
  honours: HonoursPolicy | null;
  /** Never let a later mark lower an earlier one for the same item. */
  ratchet: boolean;
  advisories: PlanAdvisories;
}

export interface AssessmentPlan {
  id: string;
  name: string;
  subjectId: string;
  academicYearId: string | null;
  /** The preset this was seeded from. Purely informational once created. */
  profile: string;
  rules: PlanRules;
  /** Frozen once published; editing produces a new version. */
  publishedAt: string | null;
  version: number;
  parentVersionId: string | null;
}

// ── Results ──────────────────────────────────────────────────────────────────

/** A rule that fired, as a code plus params so the renderer can translate it. */
export interface TraceRule {
  code:
    | 'excluded_not_assessed'
    | 'excluded_exempt'
    | 'not_submitted_as_value'
    | 'not_submitted_excluded'
    | 'renormalized'
    | 'min_not_met'
    | 'mandatory_failed'
    | 'conditional_mean_refused'
    | 'ratchet_applied'
    | 'capped'
    | 'rounded'
    | 'group_max_missing'
    | 'no_data'
    | 'manual_override';
  detail?: Record<string, number | string>;
}

export interface TraceNode {
  itemId: string;
  name: string;
  kind: ItemKind;
  aggregation: Aggregation;
  /** 0–1, or null when this branch contributes nothing. */
  fraction: number | null;
  points: number | null;
  maxPoints: number;
  status: EntryStatus | null;
  /** Weight as configured. */
  weight: number;
  /** Weight actually used after siblings were dropped and the rest renormalised. */
  effectiveWeight: number;
  rules: TraceRule[];
  children: TraceNode[];
}

export interface LegalRecord {
  /** Present when the plan records a number. */
  numeric: number | null;
  /** Present when the plan records a qualitative term. */
  qualitative: string | null;
  /** True when the whole subject is recorded as not-presented. */
  notPresented: boolean;
}

export interface GradeResult {
  /** Unrounded internal value on the plan's scale, before projection. */
  raw: number | null;
  record: LegalRecord;
  passed: boolean;
  trace: TraceNode | null;
  rules: TraceRule[];
}

/** Per-item cohort statistics, needed by `normalizeGroupMax`. */
export interface CohortStats {
  /** Highest recorded raw value per item across the group. */
  maxByItem: Record<string, number>;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

export function defaultItem(planId: string, overrides: Partial<AssessmentItem> = {}): AssessmentItem {
  return {
    id: '',
    planId,
    parentId: null,
    name: '',
    kind: 'activity',
    position: 0,
    weight: 1,
    weightAlt: 1,
    aggregation: 'weighted',
    entryMode: 'numeric',
    maxPoints: 10,
    minToAverage: null,
    isMandatory: false,
    isRecoverable: true,
    target: null,
    bestOf: null,
    conditionalMin: null,
    sourceExamId: null,
    sourceExamQuestionId: null,
    sourceRubricId: null,
    competencyCode: null,
    criterionCode: null,
    ...overrides,
  };
}

export function defaultEntry(studentId: string, itemId: string, overrides: Partial<GradeEntry> = {}): GradeEntry {
  return {
    studentId,
    itemId,
    convocatoria: 'ordinaria',
    rawValue: null,
    status: 'not_assessed',
    isOverride: false,
    note: '',
    ...overrides,
  };
}
