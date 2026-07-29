// Derived analysis status for a library work.
//
// The library used to show one column per pipeline field (light, deep, summary,
// embeddings, passages) because that is how the analysis is stored. A reader has
// a single question — "can I use this work yet?" — so this module folds those
// five fields into one readiness value plus a per-step breakdown.
//
// It deliberately holds NO user-facing strings: labels live next to their `t()`
// call in the components, which is what keeps them inside the i18n coverage scan.
import type { QueueItem, WorkEmbeddingStatus, WorkPassageStatus, WorkReadiness, WorkView } from '@shared/types';

export type { WorkReadiness };

/** The five things that can be done to a work, in pipeline order. */
export type StepId = 'themes' | 'ideas' | 'summary' | 'semantic' | 'citable';

export type StepState =
  /** Finished and current. */
  | 'done'
  /** Started but not complete — partially embedded, or outdated, or abstract-only. */
  | 'partial'
  /** Never run, and it could be. */
  | 'missing'
  /** Queued or currently being processed. */
  | 'running'
  | 'failed'
  /** Impossible until something outside Nodus changes (no full text available). */
  | 'blocked'
  /** Not applicable — e.g. embedding a work that has no ideas to embed. */
  | 'na';

// WorkReadiness lives in shared/types.ts because the works repository filters by
// it in SQL; see electron/db/readinessFilters.ts for the predicates that must
// stay in step with `deriveWorkStatus` below.

export const STEP_ORDER: readonly StepId[] = ['themes', 'ideas', 'summary', 'semantic', 'citable'];

/**
 * Steps that must be `done` for a work to count as ready.
 *
 * `summary` is excluded because it is an orientation aid generated from the
 * ideas, not citable evidence: holding a work at amber for a missing summary
 * would nag every reader who does not use summaries.
 *
 * `semantic` is excluded for a harder reason. Whether an idea's embedding is
 * current depends on a text hash computed in JS from its type, label, statement
 * and themes, so SQL cannot evaluate it (see embeddingPipeline.getWorkEmbeddingStatuses).
 * Including it here would make the library's "ready" filter — which runs in SQL
 * over the whole corpus — disagree with the "ready" pill on the row. Both steps
 * are still shown in the per-work breakdown; they just do not gate the green.
 */
export const READY_STEPS: readonly StepId[] = ['themes', 'ideas', 'citable'];

export interface StepStatus {
  id: StepId;
  state: StepState;
  /** Progress numbers where the step has them (embedded ideas, indexed passages). */
  done?: number;
  total?: number;
}

export interface WorkStatus {
  readiness: WorkReadiness;
  steps: Record<StepId, StepStatus>;
  /** Ready-steps that are actionable and not finished — what "incomplete · N" counts. */
  missing: StepId[];
}

/** Queue kinds map onto the three steps that run through the scan queue. */
const QUEUE_KIND_STEP: Partial<Record<QueueItem['kind'], StepId>> = {
  light: 'themes',
  deep: 'ideas',
  summary: 'summary',
};

/**
 * True when Nodus has no full text for this work, whether extraction was skipped
 * or Zotero only ever offered an abstract. Passages can never be indexed in that
 * state, so such a work must not be reported as "incomplete" — retrying costs
 * tokens and cannot succeed until the PDF/EPUB reaches Zotero.
 */
export function hasNoFullText(work: WorkView): boolean {
  return (
    work.deep_status === 'skipped_no_text' ||
    work.summary_status === 'skipped_no_text' ||
    work.source_type === 'none' ||
    work.source_type === 'abstract_only'
  );
}

/** The deep analysis ran, but against the abstract alone. Re-scannable once the file exists. */
export function isAbstractOnly(work: WorkView): boolean {
  return work.deep_status === 'done' && (work.source_type === 'abstract_only' || work.source_type === 'none');
}

function themesState(work: WorkView): StepState {
  switch (work.light_status) {
    case 'done':
      return 'done';
    case 'pending':
      return 'running';
    case 'failed':
      return 'failed';
    default:
      return 'missing';
  }
}

function ideasState(work: WorkView): StepState {
  switch (work.deep_status) {
    case 'done':
      // Done, but only the abstract was read: real but degraded.
      return isAbstractOnly(work) ? 'partial' : 'done';
    case 'pending':
      return 'running';
    case 'failed':
      return 'failed';
    case 'skipped_no_text':
      return 'blocked';
    default:
      return 'missing';
  }
}

function summaryState(work: WorkView): StepState {
  switch (work.summary_status) {
    case 'done':
      return 'done';
    case 'pending':
      return 'running';
    case 'failed':
      return 'failed';
    case 'skipped_no_text':
      return 'blocked';
    default:
      return 'missing';
  }
}

function semanticStep(work: WorkView, embedding: WorkEmbeddingStatus | undefined): StepStatus {
  // Nothing to embed until the deep pass has produced ideas.
  if (work.deep_status !== 'done' || !embedding || embedding.totalIdeas === 0) {
    return { id: 'semantic', state: 'na' };
  }
  if (embedding.complete) {
    return { id: 'semantic', state: 'done', done: embedding.embeddedIdeas, total: embedding.totalIdeas };
  }
  return { id: 'semantic', state: 'partial', done: embedding.embeddedIdeas, total: embedding.totalIdeas };
}

function citableStep(work: WorkView, passage: WorkPassageStatus | undefined): StepStatus {
  if (hasNoFullText(work)) return { id: 'citable', state: 'blocked' };
  if (!passage || passage.status === 'missing') return { id: 'citable', state: 'missing' };
  if (passage.status === 'complete') return { id: 'citable', state: 'done', total: passage.totalPassages };
  // 'outdated': the text was re-extracted or the embedding model changed.
  return { id: 'citable', state: 'partial', total: passage.totalPassages };
}

/**
 * Fold a work's five pipeline fields (plus any live queue activity) into one
 * readable status.
 *
 * `queued` is the set of scan-queue items for this work. The persisted
 * `*_status` fields go 'pending' when a job is enqueued but never distinguish
 * "waiting in line" from "running right now", so the queue is the only source
 * that can say a work is being worked on this instant.
 */
export function deriveWorkStatus(
  work: WorkView,
  embedding: WorkEmbeddingStatus | undefined,
  passage: WorkPassageStatus | undefined,
  queued: readonly QueueItem[] = []
): WorkStatus {
  const steps: Record<StepId, StepStatus> = {
    themes: { id: 'themes', state: themesState(work) },
    ideas: { id: 'ideas', state: ideasState(work) },
    summary: { id: 'summary', state: summaryState(work) },
    semantic: semanticStep(work, embedding),
    citable: citableStep(work, passage),
  };

  // A live queue entry outranks whatever the row last persisted.
  for (const item of queued) {
    if (item.state !== 'queued' && item.state !== 'running') continue;
    const step = QUEUE_KIND_STEP[item.kind];
    if (step) steps[step] = { ...steps[step], state: 'running' };
  }

  const states = STEP_ORDER.map((id) => steps[id].state);
  const missing = READY_STEPS.filter((id) => steps[id].state === 'missing' || steps[id].state === 'partial');

  // Precedence: what is happening now beats what failed, which beats what is
  // merely absent. The two text-shortage states sit above `incomplete` so a work
  // Nodus cannot finish is never presented as one retry away from done.
  let readiness: WorkReadiness;
  if (states.includes('running')) readiness = 'running';
  else if (states.includes('failed')) readiness = 'failed';
  else if (work.light_status === 'none' && work.deep_status === 'none') readiness = 'unstarted';
  else if (isAbstractOnly(work)) readiness = 'abstractOnly';
  else if (hasNoFullText(work)) readiness = 'noText';
  else if (missing.length === 0) readiness = 'ready';
  else readiness = 'incomplete';

  return { readiness, steps, missing };
}

/** Index live queue items by the work they belong to, for per-row lookup. */
export function queueItemsByWork(items: readonly QueueItem[]): Map<string, QueueItem[]> {
  const map = new Map<string, QueueItem[]>();
  for (const item of items) {
    if (item.state !== 'queued' && item.state !== 'running') continue;
    const list = map.get(item.nodus_id);
    if (list) list.push(item);
    else map.set(item.nodus_id, [item]);
  }
  return map;
}
