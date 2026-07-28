export interface ViewportAnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ViewportPopoverPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  placement: 'above' | 'below';
}

/**
 * Places a floating panel inside the visible renderer viewport.
 *
 * The panel is clamped horizontally and flips above its trigger when the lower
 * side is the tighter one. Keeping this calculation independent from React makes
 * the collision behaviour deterministic and directly testable.
 */
export function positionViewportPopover(
  anchor: ViewportAnchorRect,
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
  gap = 4,
): ViewportPopoverPosition {
  const width = Math.max(0, Math.min(panel.width, viewport.width - margin * 2));
  const left = Math.max(margin, Math.min(anchor.left, viewport.width - width - margin));
  const roomBelow = Math.max(0, viewport.height - anchor.bottom - gap - margin);
  const roomAbove = Math.max(0, anchor.top - gap - margin);
  const placement = roomBelow < panel.height && roomAbove > roomBelow ? 'above' : 'below';
  const maxHeight = placement === 'above' ? roomAbove : roomBelow;
  const visibleHeight = Math.min(panel.height, maxHeight);
  const top = placement === 'above'
    ? Math.max(margin, anchor.top - gap - visibleHeight)
    : Math.min(viewport.height - margin, anchor.bottom + gap);

  return { left, top, width, maxHeight, placement };
}
