/**
 * Wooden portrait-frame designs for the family tree. Each member's portrait sits in
 * a frame; the user can set one design for the whole tree or override it per person.
 * Every design renders a subtly different variant for men and women (the renderer
 * draws the actual SVG woodwork). Pure registry — ids + labels only.
 */

export interface TreeFrameDef {
  id: string;
  label: string;
}

export const TREE_FRAMES: TreeFrameDef[] = [
  { id: 'oak', label: 'Roble clásico' },
  { id: 'walnut', label: 'Nogal oscuro' },
  { id: 'gilded', label: 'Madera dorada' },
  { id: 'rustic', label: 'Rústico' },
];

export const DEFAULT_TREE_FRAME = 'oak';

const IDS = new Set(TREE_FRAMES.map((f) => f.id));

export function isTreeFrame(id: unknown): id is string {
  return typeof id === 'string' && IDS.has(id);
}

/** Coerce any stored/legacy value to a valid frame id (falls back to the default). */
export function normalizeTreeFrame(id: unknown): string {
  return isTreeFrame(id) ? id : DEFAULT_TREE_FRAME;
}

/** Resolve the effective frame for a person: their override, else the vault default. */
export function effectiveFrame(personFrame: string | null | undefined, vaultDefault: string | null | undefined): string {
  return isTreeFrame(personFrame) ? personFrame : normalizeTreeFrame(vaultDefault);
}
