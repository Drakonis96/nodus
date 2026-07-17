/**
 * Geometry for the header's centred vault badge.
 *
 * The badge reads as the header's centrepiece, so its resting place is the true
 * centre of the window. But the two rails around it are not fixed: the logo is as
 * wide as the (user-resizable) sidebar, and the action rail grows leftwards when a
 * button pins its label open (the "configure an AI model" alert, "Actualizando…"),
 * when a vault type adds its own buttons, or while a button reveals its label on
 * hover. Pinned at a hard 50%, the badge eventually sits under the action rail.
 *
 * So the centre is a preference, not a rule: the badge is centred on the window
 * and then clamped into the free band between the two rails, keeping at least
 * {@link HEADER_BADGE_GAP} of air on both sides. The clamp only engages when the
 * band would otherwise be crossed, which keeps the badge visually centred in every
 * roomy layout and slides it just enough — never under a rail — in the tight ones.
 * When the band cannot hold the badge at all it does not fit and the caller hides
 * it; the same panel is always one click away from the Bóvedas action.
 *
 * Kept DOM-free so the rules can be asserted directly (scripts/test-header-layout.mjs).
 */

/** Minimum air between the badge and each rail, in CSS px. */
export const HEADER_BADGE_GAP = 12;

export interface HeaderBadgeMetrics {
  /** Header content width. */
  headerWidth: number;
  /** Width of the left rail (logo button — tracks the sidebar width). */
  logoWidth: number;
  /** Width of the right rail (action buttons), including its own padding. */
  actionsWidth: number;
  /** The badge's natural width. */
  badgeWidth: number;
  /** Minimum air on each side; defaults to {@link HEADER_BADGE_GAP}. */
  gap?: number;
}

export interface HeaderBadgePlacement {
  /** Distance from the header's left edge, in px. */
  left: number;
  /** False when the free band cannot hold the badge — the caller hides it. */
  fits: boolean;
}

/**
 * Resolve where the vault badge should sit. Returns the window-centred position
 * clamped into the band between the rails, and whether it fits there at all.
 *
 * Degenerate inputs (a header of width 0 before first paint, a badge not yet
 * measured) resolve to `fits: false` rather than to a nonsense coordinate.
 */
export function placeHeaderBadge({
  headerWidth,
  logoWidth,
  actionsWidth,
  badgeWidth,
  gap = HEADER_BADGE_GAP,
}: HeaderBadgeMetrics): HeaderBadgePlacement {
  if (!(headerWidth > 0) || !(badgeWidth > 0)) return { left: 0, fits: false };

  const bandStart = logoWidth + gap;
  const bandEnd = headerWidth - actionsWidth - gap;
  const centred = headerWidth / 2 - badgeWidth / 2;

  // The band is measured against the badge, not against zero: a band narrower than
  // the badge cannot host it with the required air on both sides.
  if (bandEnd - bandStart < badgeWidth) return { left: centred, fits: false };

  const left = Math.min(Math.max(centred, bandStart), bandEnd - badgeWidth);
  return { left, fits: true };
}
