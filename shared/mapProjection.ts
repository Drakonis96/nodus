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
