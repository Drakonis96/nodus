import type { PortraitFocus } from './types';

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5));
}

/**
 * Convert a pointer delta into a persisted focal point.
 *
 * Dragging the image to the right reveals its left side, hence the inverse sign. The
 * frame's real dimensions are used instead of a guessed card size so genealogy's square
 * portrait and worldbuilding's taller portrait move at the same physical rate.
 */
export function dragPortraitFocus(
  focus: PortraitFocus,
  deltaX: number,
  deltaY: number,
  frameWidth: number,
  frameHeight: number
): PortraitFocus {
  const width = Math.max(1, frameWidth);
  const height = Math.max(1, frameHeight);
  return {
    ...focus,
    focusX: clamp01(focus.focusX - deltaX / width),
    focusY: clamp01(focus.focusY - deltaY / height),
  };
}
