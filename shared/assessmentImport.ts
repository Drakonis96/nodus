/**
 * Shapes for AI-assisted plan import.
 *
 * The AI proposes STRUCTURE and never computes a grade — the same split the database
 * vault already uses for analysis ("the model chooses what to run, the engine runs
 * it"). A teacher pastes the evaluation table out of their own guía docente or
 * programación; the model turns that prose into a tree of weighted blocks; the teacher
 * confirms or corrects it before anything is written.
 *
 * Pure: guards only, no Electron.
 */

export interface ProposedItem {
  name: string;
  /** Percentage within its parent, as printed in the source document. */
  weight: number;
  /** Fraction 0–1 required before the tree may average, when the text states one. */
  minToAverage?: number | null;
  isMandatory?: boolean;
  isRecoverable?: boolean;
  /** Verbatim snippet the proposal came from, so the teacher can check it. */
  evidence?: string;
  children?: ProposedItem[];
}

export interface ProposedPlan {
  items: ProposedItem[];
  /** Anything the model read but could not express as structure. */
  notes?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function isProposedItem(value: unknown, depth = 0): value is ProposedItem {
  if (!isRecord(value)) return false;
  if (typeof value.name !== 'string' || !value.name.trim()) return false;
  if (typeof value.weight !== 'number' || !Number.isFinite(value.weight)) return false;
  if (value.minToAverage != null && typeof value.minToAverage !== 'number') return false;
  if (value.children != null) {
    // Depth is bounded on purpose: a runaway nesting would be a model artefact, and a
    // teacher cannot meaningfully review a six-level tree they did not write.
    if (depth >= 3 || !Array.isArray(value.children)) return false;
    if (!value.children.every((child) => isProposedItem(child, depth + 1))) return false;
  }
  return true;
}

export function isProposedPlan(value: unknown): value is ProposedPlan {
  return isRecord(value) && Array.isArray(value.items) && value.items.every((item) => isProposedItem(item));
}

/** Total of the top-level weights, for the "does this add up?" hint before applying. */
export function proposedWeightTotal(plan: ProposedPlan): number {
  return plan.items.reduce((sum, item) => sum + item.weight, 0);
}

export function countProposedItems(plan: ProposedPlan): number {
  const count = (items: ProposedItem[]): number =>
    items.reduce((total, item) => total + 1 + count(item.children ?? []), 0);
  return count(plan.items);
}
