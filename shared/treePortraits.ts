/**
 * Default portrait selection and facing for the family tree. When a person has no
 * photo, a gender silhouette stands in: the man silhouette faces right, the woman
 * faces left. Portraits should face INWARD in a couple (the left-side spouse looks
 * right, the right-side spouse looks left), so a default silhouette on the "wrong"
 * side is mirrored. Real user photos are NEVER mirrored — only the defaults.
 *
 * Pure and dependency-free; the renderer supplies the actual image assets.
 */

export type CoupleSide = 'left' | 'right' | 'none';
export type DefaultPortraitKind = 'man' | 'woman' | null;

/** Which default silhouette stands in for a person, or null (unknown → placeholder). */
export function defaultPortraitKind(sex: string | null | undefined): DefaultPortraitKind {
  if (sex === 'male') return 'man';
  if (sex === 'female') return 'woman';
  return null;
}

/** Native facing of each default silhouette. */
export function nativeFacing(sex: string | null | undefined): 'left' | 'right' | null {
  if (sex === 'male') return 'right';
  if (sex === 'female') return 'left';
  return null;
}

/** The facing a portrait should have on a given side (inward), or null when single. */
export function desiredFacing(side: CoupleSide): 'left' | 'right' | null {
  if (side === 'left') return 'right';
  if (side === 'right') return 'left';
  return null;
}

/**
 * Whether to horizontally mirror the DEFAULT silhouette so it faces inward on its
 * side of a couple. Returns false for single people (native facing) and whenever the
 * native facing already matches. Only ever applies to default silhouettes.
 */
export function mirrorDefaultPortrait(sex: string | null | undefined, side: CoupleSide): boolean {
  const desired = desiredFacing(side);
  const native = nativeFacing(sex);
  if (!desired || !native) return false;
  return native !== desired;
}
