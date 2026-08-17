/**
 * Where the floating selection ribbon goes.
 *
 * A selection is made with a pointer that keeps moving, so the ribbon must land
 * where the pointer finished, not over the bounding box of the whole selection:
 * on a long selection that box starts at the first click and the ribbon would
 * appear far above the text the reader is actually looking at.
 */

/** The band of text the ribbon must not cover, in viewport coordinates. */
export interface RibbonAnchor {
  /** Horizontal centre for the ribbon. */
  x: number;
  /** Top of the line the anchor sits on. */
  top: number;
  /** Bottom of that line. */
  bottom: number;
}

export interface RibbonSize {
  width: number;
  height: number;
}

/** The area the ribbon may occupy, in viewport coordinates. Already inset. */
export interface RibbonBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Gap between the anchored line and the ribbon. */
export const RIBBON_GAP = 8;
/** Distance kept from the edges of the area the ribbon may use. */
export const RIBBON_MARGIN = 8;
/** Half the line height assumed around a pointer, when no line box is known. */
export const RIBBON_POINTER_LINE = 12;

/** The band around a pointer position, when the line box under it is unknown. */
export function pointerAnchor(x: number, y: number): RibbonAnchor {
  return { x, top: y - RIBBON_POINTER_LINE, bottom: y + RIBBON_POINTER_LINE };
}

/** The window, inset by the margin the ribbon keeps from the screen edges. */
export function viewportRibbonBounds(): RibbonBounds {
  return {
    left: RIBBON_MARGIN,
    top: RIBBON_MARGIN,
    right: window.innerWidth - RIBBON_MARGIN,
    bottom: window.innerHeight - RIBBON_MARGIN,
  };
}

/** The part of `bounds` that also lies inside `limit`, never inverted. */
export function intersectRibbonBounds(bounds: RibbonBounds, limit: RibbonBounds): RibbonBounds {
  const left = Math.max(bounds.left, limit.left);
  const top = Math.max(bounds.top, limit.top);
  return {
    left,
    top,
    right: Math.max(left, Math.min(bounds.right, limit.right)),
    bottom: Math.max(top, Math.min(bounds.bottom, limit.bottom)),
  };
}

/** Top-left corner, in viewport coordinates, for a ribbon of this size. */
export function selectionRibbonPosition(
  anchor: RibbonAnchor,
  size: RibbonSize,
  bounds: RibbonBounds,
): { left: number; top: number } {
  const maxLeft = Math.max(bounds.left, bounds.right - size.width);
  const left = Math.max(bounds.left, Math.min(maxLeft, anchor.x - size.width / 2));
  const above = anchor.top - RIBBON_GAP - size.height;
  // Below the pointer when the line is too close to the top of the area, so the
  // ribbon is never clipped nor pinned over the words just selected.
  const top = above >= bounds.top
    ? above
    : Math.max(bounds.top, Math.min(bounds.bottom - size.height, anchor.bottom + RIBBON_GAP));
  return { left, top };
}

/**
 * The offset that takes a floating element from where it is to where it belongs.
 *
 * Used where a third-party positioner (floating-ui inside Milkdown) owns
 * `left`/`top` and rewrites them whenever it recomputes: the correction is kept
 * in the element's own transform, which that positioner never touches.
 */
export function selectionRibbonOffset(
  current: { x: number; y: number },
  rect: { left: number; top: number },
  target: { left: number; top: number },
): { x: number; y: number } {
  return {
    x: current.x + (target.left - rect.left),
    y: current.y + (target.top - rect.top),
  };
}
