/** Seven discrete Nodi sizes. The original 100% size is now the maximum. */
export const NODI_SIZE_SCALES = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] as const;

export const NODI_DEFAULT_SCALE = 1;

/** Keep persisted or hand-edited values on one of the supported slider stops. */
export function normalizeNodiScale(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : NODI_DEFAULT_SCALE;
  return NODI_SIZE_SCALES.reduce((nearest, scale) => (
    Math.abs(scale - numeric) < Math.abs(nearest - numeric) ? scale : nearest
  ), NODI_DEFAULT_SCALE as number);
}
