/**
 * Classical item analysis for an exam: which questions worked and which did not.
 *
 * ⚠️ THE CONVENTION MUST BE STATED, because Spanish sources genuinely disagree.
 *
 * Here, and everywhere it is shown, `difficulty` is the proportion of the marks
 * available that the group actually obtained — so **a HIGH value means an EASY
 * question**. That matches UB's IDP-ICE, Universidad de Sevilla and the published MIR
 * analyses. It is the opposite of Universidad de Murcia's exam service, which counts
 * wrong-plus-blank answers, so a high value there means a HARD question. One SEDEM
 * guide concedes the label is a misnomer: it is really an index of *facility*. A tool
 * that shows the number without saying which way round it runs is inviting a teacher
 * to read it backwards.
 *
 * The extreme-group split is also not a constant: 27% (Sevilla, the MIR papers) or 25%
 * (Murcia, parameterisable). We use 27% and say so.
 *
 * The bands below are quoted from published Spanish sources rather than invented. Note
 * in particular that the familiar "difficulty 0.30–0.70 / discrimination > 0.20"
 * pairing does NOT appear in any Spanish institutional document we could find; it is
 * folklore, and it is deliberately not used here.
 *
 * Pure: no Electron, no DB.
 */

/** Fraction of the cohort taken as the strong and weak groups. */
export const EXTREME_GROUP_FRACTION = 0.27;

export interface ItemStats {
  itemId: string;
  name: string;
  /** Number of students with a mark on this item. */
  n: number;
  /** Mean mark, on the item's own scale. */
  mean: number;
  maxPoints: number;
  /** 0–1. HIGH = EASY. See the module docstring. */
  difficulty: number;
  /** −1…1. Strong group minus weak group, over the item's maximum. */
  discrimination: number;
  /** Point-biserial correlation between this item and the total. */
  pointBiserial: number;
  difficultyBand: 'muy_facil' | 'facil' | 'optima' | 'dificil' | 'muy_dificil';
  discriminationBand: 'excelente' | 'buena' | 'revisable' | 'mala' | 'muy_mala';
  /** How many of the strong / weak group actually have a mark on this item. */
  strongN: number;
  weakN: number;
  /**
   * False when the numbers above are arithmetic but not interpretable: too few
   * students, an extreme group with no mark on this item, or no spread at all in the
   * totals. A discrimination of 0 computed from one empty group is not "mala
   * discriminación", and labelling it so sends a teacher to rewrite a fine question.
   */
  reliable: boolean;
}

/**
 * Difficulty bands, quoted from Baladrón et al., *FEM* 2016 (analysis of the MIR):
 * muy fácil 0.8–1, fácil 0.6–0.8, media 0.4–0.6, difícil 0.2–0.4, muy difícil 0–0.2.
 * The band SEDEM (2014) calls optimal, 0.50–0.60, sits inside "media".
 */
export function difficultyBand(value: number): ItemStats['difficultyBand'] {
  if (value >= 0.8) return 'muy_facil';
  if (value >= 0.6) return 'facil';
  if (value >= 0.4) return 'optima';
  if (value >= 0.2) return 'dificil';
  return 'muy_dificil';
}

/**
 * Discrimination bands, quoted from the same source: excelente > 0.34,
 * bueno 0.24–0.34, revisable 0.14–0.24, malo 0–0.14, muy malo < 0.
 */
export function discriminationBand(value: number): ItemStats['discriminationBand'] {
  if (value > 0.34) return 'excelente';
  if (value > 0.24) return 'buena';
  if (value > 0.14) return 'revisable';
  if (value >= 0) return 'mala';
  return 'muy_mala';
}

export interface ItemInput {
  itemId: string;
  name: string;
  maxPoints: number;
  /** studentId → mark on this item. Absent students are simply not present. */
  marks: Record<string, number>;
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

/**
 * Runs the analysis over one exam block's questions.
 *
 * Students with no mark on an item are excluded from THAT item rather than counted as
 * zero: a question nobody sat is not a difficult question.
 */
export function analyseItems(items: ItemInput[], studentIds: string[]): ItemStats[] {
  if (items.length === 0 || studentIds.length === 0) return [];

  // Total per student, over the items they actually have marks for.
  const totals = new Map<string, number>();
  for (const id of studentIds) {
    let total = 0;
    for (const item of items) total += item.marks[id] ?? 0;
    totals.set(id, total);
  }
  const ranked = [...studentIds].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
  // At least one student per group, so a tiny class still yields a (noisy) number
  // rather than a division by zero.
  const groupSize = Math.max(1, Math.round(ranked.length * EXTREME_GROUP_FRACTION));
  const strong = ranked.slice(0, groupSize);
  const weak = ranked.slice(-groupSize);
  // No spread in the totals means the extreme groups are the same cohort split by tie
  // order: every difference they produce is an artefact.
  const totalValues = ranked.map((id) => totals.get(id) ?? 0);
  const hasSpread = Math.max(...totalValues) - Math.min(...totalValues) > 1e-9;

  return items.map((item) => {
    const present = studentIds.filter((id) => item.marks[id] != null);
    const n = present.length;
    const max = item.maxPoints > 0 ? item.maxPoints : 1;
    const mean = n === 0 ? 0 : present.reduce((sum, id) => sum + item.marks[id], 0) / n;
    const difficulty = Math.min(1, Math.max(0, mean / max));

    // Null, not 0, when nobody in the group has a mark: "absent" and "scored zero" are
    // the distinction this whole module exists to preserve, and collapsing them here
    // made an unanswered question look like a perfectly discriminating one.
    const groupMean = (ids: string[]): number | null => {
      const withMark = ids.filter((id) => item.marks[id] != null);
      if (withMark.length === 0) return null;
      return withMark.reduce((sum, id) => sum + item.marks[id], 0) / withMark.length;
    };
    const strongMean = groupMean(strong);
    const weakMean = groupMean(weak);
    const strongN = strong.filter((id) => item.marks[id] != null).length;
    const weakN = weak.filter((id) => item.marks[id] != null).length;
    const discrimination = strongMean == null || weakMean == null
      ? 0
      : Math.max(-1, Math.min(1, (strongMean - weakMean) / max));
    const reliable = n >= 2 && strongN > 0 && weakN > 0 && hasSpread;

    // Point-biserial against the total EXCLUDING this item, which is the corrected
    // form: leaving the item inside correlates it partly with itself, and on a short
    // exam that inflates every value.
    const xs = present.map((id) => item.marks[id]);
    const ys = present.map((id) => (totals.get(id) ?? 0) - (item.marks[id] ?? 0));
    const pointBiserial = pearson(xs, ys);

    return {
      itemId: item.itemId,
      name: item.name,
      n,
      mean: Math.round(mean * 100) / 100,
      maxPoints: item.maxPoints,
      difficulty: Math.round(difficulty * 1000) / 1000,
      discrimination: Math.round(discrimination * 1000) / 1000,
      pointBiserial: Math.round(pointBiserial * 1000) / 1000,
      difficultyBand: difficultyBand(difficulty),
      discriminationBand: discriminationBand(discrimination),
      strongN,
      weakN,
      reliable,
    };
  });
}

export interface GradeDistribution {
  n: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  /** Share of graded students at or above the pass mark. */
  passRate: number;
  /** Counts per qualitative band or numeric bucket, in display order. */
  buckets: { label: string; count: number }[];
}

/**
 * The plan's scale. Passed whole rather than as a bare `scaleMax` because the minimum
 * is not always 0 — FP records modules on 1–10 — and a pass mark computed as
 * `passAt * scaleMax` puts the 5 in a different place from the one the engine records.
 */
export interface GradeScale {
  min: number;
  max: number;
}

/** Distribution of the final marks, for the group summary. */
export function gradeDistribution(values: number[], passAt: number, scale: GradeScale): GradeDistribution {
  const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return { n: 0, mean: 0, median: 0, min: 0, max: 0, passRate: 0, buckets: [] };
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const passMark = scale.min + passAt * (scale.max - scale.min);
  const buckets: { label: string; count: number }[] = [];
  const step = (scale.max - scale.min) / 5;
  for (let i = 0; i < 5; i++) {
    const lo = scale.min + i * step;
    const hi = i === 4 ? scale.max : scale.min + (i + 1) * step;
    buckets.push({
      label: `${Math.round(lo * 10) / 10}–${Math.round(hi * 10) / 10}`,
      // Last bucket is closed at the top so a perfect mark is not dropped.
      count: sorted.filter((v) => (i === 4 ? v >= lo && v <= hi : v >= lo && v < hi)).length,
    });
  }
  return {
    n,
    mean: Math.round(mean * 100) / 100,
    median: Math.round(median * 100) / 100,
    min: sorted[0],
    max: sorted[n - 1],
    passRate: Math.round((sorted.filter((v) => v >= passMark - 1e-9).length / n) * 1000) / 1000,
    buckets,
  };
}
