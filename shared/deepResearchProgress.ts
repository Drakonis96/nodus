import type { DeepResearchProgress } from './types';

/**
 * How far along a report is, from the progress events the pipelines already emit.
 *
 * A report takes minutes and the queue strip only ever showed a spinning icon and a
 * sentence, so a queue of several reports gave no way to tell "just started" from
 * "nearly done". The phases are not equal in cost — writing the sections is most of
 * the wall clock — so each gets a band of the bar proportional to what it really
 * takes, and the section band is subdivided by the section being written.
 *
 * Pure and shared so the desktop, the tests and anything else that shows this bar
 * agree on what a phase is worth.
 */

/** Where each phase starts. The section band runs from `section` to `coverage`. */
const PHASE_FLOOR: Record<DeepResearchProgress['phase'], number> = {
  queued: 0,
  snapshot: 0.04,
  planning: 0.1,
  section: 0.14,
  coverage: 0.82,
  assembling: 0.88,
  done: 1,
};

/** Assumed section count when a pipeline reports an index without a total. */
const ASSUMED_SECTIONS = 4;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * `0`–`1`, or `null` when there is nothing to report yet (no progress at all).
 *
 * Never goes backwards over the course of a run: the coverage top-up writes further
 * sections *after* the planned ones, so a section index past the planned total is
 * clamped to the top of the section band rather than overflowing into it.
 */
export function deepResearchProgressFraction(progress: DeepResearchProgress | null | undefined): number | null {
  if (!progress) return null;
  const floor = PHASE_FLOOR[progress.phase];
  if (floor === undefined) return null;
  if (progress.phase !== 'section') return floor;

  const total = Math.max(1, progress.sectionTotal ?? Math.max(progress.sectionIndex ?? 1, ASSUMED_SECTIONS));
  const index = Math.max(1, progress.sectionIndex ?? 1);
  // Credited half a section: the event fires when the section STARTS, and showing a
  // bar that has not moved while the longest step of all is under way reads as stuck.
  const through = clamp01((index - 0.5) / total);
  return floor + through * (PHASE_FLOOR.coverage - floor);
}

/** The same fraction as a whole percentage, for display and for the bar's width. */
export function deepResearchProgressPercent(progress: DeepResearchProgress | null | undefined): number | null {
  const fraction = deepResearchProgressFraction(progress);
  return fraction === null ? null : Math.round(fraction * 100);
}
