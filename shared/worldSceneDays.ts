/**
 * The chain of days.
 *
 * `world_scenes.world_day` is the key half the world runs on — two people in two places on
 * the same day, a journey that cannot be made in the time available, a secret used before
 * it was learned — and in a real vault it is EMPTY. A novelist writes thirty scenes before
 * knowing whether the wedding is on day 412 or 415, and a form asking for the number gets
 * skipped thirty times.
 *
 * So this does not ask for the number. It asks for the RELATION to the previous scene,
 * which is how the writing actually goes: "same night", "three days later", "the following
 * spring". One anchor at the head of an act and a chain of relations gives the whole
 * manuscript a day line in a handful of clicks.
 *
 * Pure: the arithmetic is the part that must be right, and it is testable with no database.
 */

import type { SceneDayLink, SceneDayMode } from './types';

export interface SceneInOrder {
  sceneId: string;
  /** The narrative order. The chain is read in the order the READER meets the scenes. */
  narrativeOrder: number;
}

export const SCENE_DAY_MODE_LABEL: Record<SceneDayMode, string> = {
  anchor: 'Día fijo',
  same: 'El mismo día',
  offset: 'Días después',
};

/** The declaration a scene carries when the author has said nothing about it. */
export function defaultSceneDayLink(sceneId: string): SceneDayLink {
  return { sceneId, mode: 'offset', offsetDays: 0, anchorWorldDay: null };
}

/**
 * Walk the chain and give every scene an absolute day.
 *
 * Scenes BEFORE the first anchor get day 0 as their origin rather than `null`. Refusing to
 * date them would be defensible and useless: every contradiction this feeds is about the
 * DISTANCE between two scenes, and a manuscript with no anchor at all still has a perfectly
 * good relative calendar. The anchor exists to align that calendar with the invented one,
 * not to make it exist.
 */
export function computeSceneDays(
  scenes: SceneInOrder[],
  links: Map<string, SceneDayLink>
): Map<string, number> {
  const ordered = [...scenes].sort((a, b) => a.narrativeOrder - b.narrativeOrder);
  const days = new Map<string, number>();
  let current = 0;
  for (const scene of ordered) {
    const link = links.get(scene.sceneId) ?? defaultSceneDayLink(scene.sceneId);
    if (link.mode === 'anchor' && link.anchorWorldDay != null) {
      current = link.anchorWorldDay;
    } else if (link.mode === 'offset') {
      // A negative offset is allowed: a flashback is a scene the reader meets later and
      // that happens earlier, and forbidding it would make the chain unusable for exactly
      // the structure that needs it most.
      current += link.offsetDays;
    }
    // 'same' leaves the day where it is, which is the whole point of having it.
    days.set(scene.sceneId, current);
  }
  return days;
}

/**
 * How a scene's declaration reads in one line.
 *
 * Returns a KEY plus its variables rather than a finished sentence: an interpolated string
 * is invisible to the i18n collector and would stay in Spanish in the other six languages
 * — the trap a dynamic `t()` always sets.
 */
export function describeSceneDay(link: SceneDayLink): { key: string; vars?: Record<string, string> } {
  if (link.mode === 'anchor') return { key: 'Día fijo: {day}', vars: { day: String(link.anchorWorldDay ?? 0) } };
  if (link.mode === 'same' || link.offsetDays === 0) return { key: 'El mismo día que la anterior' };
  if (link.offsetDays === 1) return { key: 'Al día siguiente' };
  if (link.offsetDays < 0) return { key: '{count} días antes', vars: { count: String(Math.abs(link.offsetDays)) } };
  return { key: '{count} días después', vars: { count: String(link.offsetDays) } };
}

/**
 * Move a scene to a new position in the narrative order, and renumber.
 *
 * Returned as a full list of (sceneId, narrativeOrder) rather than a delta because the
 * chain is read positionally: a partial renumber leaves two scenes claiming the same slot,
 * and the day of everything after them then depends on which one SQLite returns first.
 */
export function reorderScenes(
  scenes: SceneInOrder[],
  sceneId: string,
  toIndex: number
): { sceneId: string; narrativeOrder: number }[] {
  const ordered = [...scenes].sort((a, b) => a.narrativeOrder - b.narrativeOrder);
  const from = ordered.findIndex((scene) => scene.sceneId === sceneId);
  if (from < 0) return ordered.map((scene, index) => ({ sceneId: scene.sceneId, narrativeOrder: index }));
  const [moved] = ordered.splice(from, 1);
  const target = Math.max(0, Math.min(toIndex, ordered.length));
  ordered.splice(target, 0, moved);
  return ordered.map((scene, index) => ({ sceneId: scene.sceneId, narrativeOrder: index }));
}

/**
 * How much of the manuscript the day line actually covers.
 *
 * Shown as a count of scenes, never as a percentage: "38 escenas no tienen día" is a piece
 * of work, and "72 %" is a grade.
 */
export function sceneDayCoverage(
  scenes: SceneInOrder[],
  links: Map<string, SceneDayLink>
): { declared: number; total: number; anchored: boolean } {
  let declared = 0;
  let anchored = false;
  for (const scene of scenes) {
    const link = links.get(scene.sceneId);
    if (!link) continue;
    declared += 1;
    if (link.mode === 'anchor' && link.anchorWorldDay != null) anchored = true;
  }
  return { declared, total: scenes.length, anchored };
}
