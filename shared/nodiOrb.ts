/**
 * Colour rules for Nodi's "orb" style.
 *
 * The orb is built from a SINGLE hue: every cool colour in it (the galaxy interior,
 * the nebula arms, the core and its flare, the halo, the glass rim, the satellites,
 * the pedestal…) is derived in CSS from one `--nodi-hue` custom property, as an offset
 * from that hue. The golds are deliberately NOT derived — they are the brand constant
 * that keeps the orb recognisable as Nodi in every colour.
 *
 * So recolouring the orb is exactly one number. This module is the only place that
 * decides what that number is: either the active vault's accent ('auto') or the colour
 * the user pinned ('manual').
 *
 * Pure and dependency-free: the main process reads the default from here to seed
 * settings, and the renderer reads the rest.
 */

import type { AppSettings, VaultType } from './types';
import { VAULT_TYPE_COLORS, vaultTypeColor } from './vaultTypes';

/** Nodi's own blue — the orb's colour when no vault says otherwise. */
export const NODI_ORB_DEFAULT_COLOR = '#4d9be8';

/**
 * The hue (0–359) of a hex colour. Only the hue travels into the orb: saturation and
 * lightness are fixed per layer in the stylesheet, so a muted vault accent still
 * yields a luminous orb rather than a washed-out one.
 */
export function hueOfHex(hex: string): number {
  const clean = hex.trim().replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value) || full.length !== 6) return hueOfHex(NODI_ORB_DEFAULT_COLOR);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round(h * 60) % 360;
}

/** The colour the orb should be, honouring the user's auto/manual choice. */
export function orbColor(settings: Pick<AppSettings, 'mascotOrbColorMode' | 'mascotOrbColor'>, vaultType: VaultType | null): string {
  if (settings.mascotOrbColorMode === 'auto') {
    return vaultType ? vaultTypeColor(vaultType) : NODI_ORB_DEFAULT_COLOR;
  }
  return settings.mascotOrbColor || NODI_ORB_DEFAULT_COLOR;
}

/** The orb's hue, honouring the user's auto/manual choice. */
export function orbHue(settings: Pick<AppSettings, 'mascotOrbColorMode' | 'mascotOrbColor'>, vaultType: VaultType | null): number {
  return hueOfHex(orbColor(settings, vaultType));
}

/**
 * The swatches offered when picking the orb's colour by hand. Nodi's own blue first,
 * then one per distinct vault accent, so a manual pick can still match a vault exactly.
 * `type` labels the swatch (and is null for Nodi's blue); duplicate accents — academic
 * and primary_sources share an indigo — are listed once.
 */
export const ORB_COLOR_CHOICES: { hex: string; type: VaultType | null }[] = [
  { hex: NODI_ORB_DEFAULT_COLOR, type: null },
  ...(Object.keys(VAULT_TYPE_COLORS) as VaultType[])
    .filter((type, index, all) => all.findIndex((other) => VAULT_TYPE_COLORS[other] === VAULT_TYPE_COLORS[type]) === index)
    .map((type) => ({ hex: VAULT_TYPE_COLORS[type], type })),
];
