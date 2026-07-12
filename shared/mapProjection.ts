/**
 * Offline map geometry for the places / migration view. Equirectangular projection
 * (lat/lon → x/y) so places can be plotted and a person's migration path drawn
 * without any tile server or network — coordinates are entered by the user (or, opt
 * in, geocoded). Pure and testable.
 */

export interface LatLng {
  lat: number;
  lon: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
}

/** Equirectangular (plate carrée) projection into a width×height canvas. */
export function projectEquirectangular(p: LatLng, width: number, height: number): ProjectedPoint {
  const lon = Math.max(-180, Math.min(180, p.lon));
  const lat = Math.max(-90, Math.min(90, p.lat));
  return { x: ((lon + 180) / 360) * width, y: ((90 - lat) / 180) * height };
}

export interface MigrationStop {
  placeId: string;
  placeName: string;
  date: string | null;
  sortKey: string | null;
  lat: number;
  lon: number;
}

/**
 * A person's migration path: their located events in chronological order, with
 * consecutive stops at the same place collapsed (a stay isn't a move). Undated
 * located events sort after dated ones so the path still includes them.
 */
export function buildMigrationPath(stops: MigrationStop[]): MigrationStop[] {
  const ordered = [...stops].sort((a, b) => {
    if (a.sortKey && b.sortKey) return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
    if (a.sortKey) return -1;
    if (b.sortKey) return 1;
    return 0;
  });
  const path: MigrationStop[] = [];
  for (const stop of ordered) {
    const prev = path[path.length - 1];
    if (prev && prev.placeId === stop.placeId) continue; // stayed put
    path.push(stop);
  }
  return path;
}

// ── Auto-fit bounds + adaptive projection (for the map view) ──────────────────

export interface GeoBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface LocatedPoint {
  latitude: number;
  longitude: number;
}

const WORLD_BOUNDS: GeoBounds = { minLat: -58, maxLat: 78, minLon: -168, maxLon: 190 };
/** Never zoom tighter than this many degrees, so a single place isn't a pinpoint. */
const MIN_SPAN_DEG = 6;

function clampBounds(b: GeoBounds): GeoBounds {
  return {
    minLat: Math.max(-85, b.minLat),
    maxLat: Math.min(85, b.maxLat),
    minLon: Math.max(-180, b.minLon),
    maxLon: Math.min(180, b.maxLon),
  };
}

/**
 * Fit the view to the given located points, padded, with a minimum span so a lone
 * place still shows its surroundings. With no points, falls back to the whole world —
 * so the map naturally scales from a single village up to a world map as the person's
 * places spread across continents.
 */
export function boundsForPoints(points: LocatedPoint[], padFraction = 0.18): GeoBounds {
  if (points.length === 0) return WORLD_BOUNDS;
  let minLat = 90;
  let maxLat = -90;
  let minLon = 180;
  let maxLon = -180;
  for (const p of points) {
    minLat = Math.min(minLat, p.latitude);
    maxLat = Math.max(maxLat, p.latitude);
    minLon = Math.min(minLon, p.longitude);
    maxLon = Math.max(maxLon, p.longitude);
  }
  let latSpan = maxLat - minLat;
  let lonSpan = maxLon - minLon;
  // Enforce a minimum span, centred on the points.
  if (latSpan < MIN_SPAN_DEG) {
    const c = (minLat + maxLat) / 2;
    minLat = c - MIN_SPAN_DEG / 2;
    maxLat = c + MIN_SPAN_DEG / 2;
    latSpan = MIN_SPAN_DEG;
  }
  if (lonSpan < MIN_SPAN_DEG) {
    const c = (minLon + maxLon) / 2;
    minLon = c - MIN_SPAN_DEG / 2;
    maxLon = c + MIN_SPAN_DEG / 2;
    lonSpan = MIN_SPAN_DEG;
  }
  const latPad = latSpan * padFraction;
  const lonPad = lonSpan * padFraction;
  return clampBounds({ minLat: minLat - latPad, maxLat: maxLat + latPad, minLon: minLon - lonPad, maxLon: maxLon + lonPad });
}

/** Linear (equirectangular) projector mapping a bounds window into a width×height box. */
export function projectorFor(b: GeoBounds, width: number, height: number): (lat: number, lon: number) => ProjectedPoint {
  const lonSpan = Math.max(1e-6, b.maxLon - b.minLon);
  const latSpan = Math.max(1e-6, b.maxLat - b.minLat);
  return (lat: number, lon: number) => ({
    x: ((lon - b.minLon) / lonSpan) * width,
    y: ((b.maxLat - lat) / latSpan) * height,
  });
}

/** Year of a sortable date key ('YYYY-MM-DD' or 'YYYY…'); null if unparseable. */
export function yearFromSortKey(sortKey: string | null | undefined): number | null {
  if (!sortKey) return null;
  const m = /^(-?\d{1,4})/.exec(sortKey);
  if (!m) return null;
  const y = Number(m[1]);
  return Number.isFinite(y) ? y : null;
}

export interface DatedPoint {
  sortKey: string | null;
}

/** Min/max year across a set of dated points, or null when none are dated. */
export function pointsYearRange(points: DatedPoint[]): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const y = yearFromSortKey(p.sortKey);
    if (y == null) continue;
    if (y < min) min = y;
    if (y > max) max = y;
  }
  if (min === Infinity) return null;
  return { min, max };
}

/**
 * Filter points by the chronological slider: keep everything dated at or before
 * `year`. Undated points are kept only when `includeUndated` (they have no place in
 * time, so a genealogist usually wants them always visible).
 */
export function filterPointsByYear<T extends DatedPoint>(points: T[], year: number | null, includeUndated = true): T[] {
  if (year == null) return points;
  return points.filter((p) => {
    const y = yearFromSortKey(p.sortKey);
    if (y == null) return includeUndated;
    return y <= year;
  });
}
