// Maps of an invented world (schema v97).
//
// A MAP IS A CANVAS, NOT A PLACE. `world_maps.place_id` says which place a map is OF, when
// it is of one, but the same place also appears as a pin on half a dozen other maps — so
// nothing here treats a map as a property of a place, and `placeMapAppearances` answers
// the reverse question from `map_markers` instead of from this table.
//
// Two invariants this repo is responsible for, both of which the renderer must NOT be
// trusted to keep:
//
//   - **The parent chain cannot close a loop.** A map inside itself makes the breadcrumb
//     walk forever, and a hang has no error message to follow. Guarded BEFORE the write,
//     exactly as `worldPlacesRepo` guards the place tree.
//   - **A canvas growth moves every coordinate the map holds.** `growMapCanvas` is the
//     ONLY correct way to resize a map, and it writes markers, calibration and footprint
//     in one transaction. Half-moved pins are a state the author cannot repair by hand.

import { v4 as uuid } from 'uuid';
import { getDb } from './database';
import type {
  MapDistanceUnitName,
  MapImageRole,
  PlaceMapAppearance,
  WorldMap,
  WorldMapInput,
  WorldMapKind,
} from '@shared/types';
import {
  applyCanvasGrowth,
  grownSize,
  type CanvasGrowth,
  type MapFootprint,
} from '@shared/worldMapGeometry';

function now(): string {
  return new Date().toISOString();
}

function newId(): string {
  return `map_${uuid()}`;
}

const MAP_KINDS = new Set<WorldMapKind>([
  'world', 'continent', 'region', 'city', 'town', 'building',
  'interior', 'dungeon', 'battle', 'route', 'schematic', 'other',
]);

const UNITS = new Set<MapDistanceUnitName>(['km', 'mi', 'm', 'ft', 'league', 'custom']);

export function mapKind(value: unknown): WorldMapKind {
  return typeof value === 'string' && MAP_KINDS.has(value as WorldMapKind) ? (value as WorldMapKind) : 'region';
}

function unitOrNull(value: unknown): MapDistanceUnitName | null {
  return typeof value === 'string' && UNITS.has(value as MapDistanceUnitName) ? (value as MapDistanceUnitName) : null;
}

interface MapRow {
  map_id: string;
  name: string;
  kind: string;
  place_id: string | null;
  place_name: string | null;
  parent_map_id: string | null;
  parent_x0: number | null;
  parent_y0: number | null;
  parent_x1: number | null;
  parent_y1: number | null;
  image_id: string | null;
  width_px: number;
  height_px: number;
  scale_x0: number | null;
  scale_y0: number | null;
  scale_x1: number | null;
  scale_y1: number | null;
  scale_distance: number | null;
  scale_unit: string | null;
  projection: string;
  planet_radius: number | null;
  planet_radius_unit: string | null;
  from_world_day: number | null;
  to_world_day: number | null;
  visual_seed: string | null;
  style: string | null;
  model_labels: number;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const MAP_SELECT = `SELECT m.*, p.name AS place_name
  FROM world_maps m LEFT JOIN places p ON p.place_id = m.place_id`;

function rowToMap(row: MapRow): WorldMap {
  return {
    mapId: row.map_id,
    name: row.name,
    kind: mapKind(row.kind),
    placeId: row.place_id,
    placeName: row.place_name,
    parentMapId: row.parent_map_id,
    parentX0: row.parent_x0,
    parentY0: row.parent_y0,
    parentX1: row.parent_x1,
    parentY1: row.parent_y1,
    imageId: row.image_id,
    widthPx: row.width_px,
    heightPx: row.height_px,
    scaleX0: row.scale_x0,
    scaleY0: row.scale_y0,
    scaleX1: row.scale_x1,
    scaleY1: row.scale_y1,
    scaleDistance: row.scale_distance,
    scaleUnit: unitOrNull(row.scale_unit),
    projection: row.projection === 'globe' ? 'globe' : 'flat',
    planetRadius: row.planet_radius,
    planetRadiusUnit: unitOrNull(row.planet_radius_unit),
    fromWorldDay: row.from_world_day,
    toWorldDay: row.to_world_day,
    visualSeed: row.visual_seed,
    style: row.style,
    modelLabels: !!row.model_labels,
    notes: row.notes,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listWorldMaps(): WorldMap[] {
  return (getDb().prepare(`${MAP_SELECT} ORDER BY m.sort_order, m.name`).all() as MapRow[]).map(rowToMap);
}

export function getWorldMap(mapId: string): WorldMap | null {
  const row = getDb().prepare(`${MAP_SELECT} WHERE m.map_id = ?`).get(mapId) as MapRow | undefined;
  return row ? rowToMap(row) : null;
}

/**
 * Would setting `parentMapId` as the parent of `mapId` close a loop?
 *
 * Walks upwards from the proposed parent looking for the map being reparented. The step
 * counter is a backstop, not the mechanism: if a loop already exists in the table (a
 * database restored from a half-written sync, say), walking it would never terminate and
 * the guard meant to prevent a hang would be the hang.
 */
export function wouldCycleMaps(mapId: string, parentMapId: string | null): boolean {
  if (!parentMapId) return false;
  if (parentMapId === mapId) return true;
  const parentOf = getDb().prepare('SELECT parent_map_id FROM world_maps WHERE map_id = ?');
  let current: string | null = parentMapId;
  for (let steps = 0; current && steps < 1000; steps += 1) {
    if (current === mapId) return true;
    const row = parentOf.get(current) as { parent_map_id: string | null } | undefined;
    current = row?.parent_map_id ?? null;
  }
  return false;
}

/** The chain from a map up to its root, nearest first. Loop-safe. */
export function mapAncestry(mapId: string): WorldMap[] {
  const chain: WorldMap[] = [];
  const seen = new Set<string>();
  let current = getWorldMap(mapId);
  while (current && !seen.has(current.mapId)) {
    seen.add(current.mapId);
    chain.push(current);
    current = current.parentMapId ? getWorldMap(current.parentMapId) : null;
  }
  return chain;
}

export function createWorldMap(input: WorldMapInput): WorldMap {
  const db = getDb();
  const id = newId();
  const ts = now();
  const parentMapId = input.parentMapId && !wouldCycleMaps(id, input.parentMapId) ? input.parentMapId : null;
  db.prepare(
    `INSERT INTO world_maps
      (map_id, name, kind, place_id, parent_map_id, parent_x0, parent_y0, parent_x1, parent_y1,
       image_id, width_px, height_px, scale_x0, scale_y0, scale_x1, scale_y1, scale_distance,
       scale_unit, projection, planet_radius, planet_radius_unit, from_world_day, to_world_day,
       visual_seed, style, model_labels, notes, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name.trim() || 'Mapa sin título',
    mapKind(input.kind),
    input.placeId ?? null,
    parentMapId,
    input.parentX0 ?? null,
    input.parentY0 ?? null,
    input.parentX1 ?? null,
    input.parentY1 ?? null,
    null,
    input.scaleX0 ?? null,
    input.scaleY0 ?? null,
    input.scaleX1 ?? null,
    input.scaleY1 ?? null,
    input.scaleDistance ?? null,
    unitOrNull(input.scaleUnit),
    input.projection === 'globe' ? 'globe' : 'flat',
    input.planetRadius ?? null,
    unitOrNull(input.planetRadiusUnit),
    input.fromWorldDay ?? null,
    input.toWorldDay ?? null,
    input.visualSeed ?? null,
    input.style ?? null,
    input.modelLabels ? 1 : 0,
    input.notes ?? null,
    input.sortOrder ?? 0,
    ts,
    ts,
  );
  return getWorldMap(id)!;
}

/** Column per patchable field, so `updateWorldMap` stays a loop instead of a wall of SQL. */
const PATCHABLE: Record<string, string> = {
  name: 'name',
  kind: 'kind',
  placeId: 'place_id',
  parentX0: 'parent_x0',
  parentY0: 'parent_y0',
  parentX1: 'parent_x1',
  parentY1: 'parent_y1',
  scaleX0: 'scale_x0',
  scaleY0: 'scale_y0',
  scaleX1: 'scale_x1',
  scaleY1: 'scale_y1',
  scaleDistance: 'scale_distance',
  scaleUnit: 'scale_unit',
  projection: 'projection',
  planetRadius: 'planet_radius',
  planetRadiusUnit: 'planet_radius_unit',
  fromWorldDay: 'from_world_day',
  toWorldDay: 'to_world_day',
  visualSeed: 'visual_seed',
  style: 'style',
  notes: 'notes',
  sortOrder: 'sort_order',
};

/**
 * Update a map. A reparent that would close a loop is REFUSED and the parent left as it
 * was, rather than the write failing — same rule as the place tree: there is nothing
 * sensible for the author to do about an error message here, and an unusable breadcrumb
 * is worse than an ignored gesture.
 */
export function updateWorldMap(mapId: string, patch: Partial<WorldMapInput>): WorldMap | null {
  const existing = getWorldMap(mapId);
  if (!existing) return null;
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(PATCHABLE)) {
    const value = (patch as Record<string, unknown>)[key];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    if (key === 'kind') values.push(mapKind(value));
    else if (key === 'name') values.push(String(value).trim() || existing.name);
    else if (key === 'scaleUnit' || key === 'planetRadiusUnit') values.push(unitOrNull(value));
    else if (key === 'projection') values.push(value === 'globe' ? 'globe' : 'flat');
    else values.push(value ?? null);
  }
  if (patch.modelLabels !== undefined) {
    sets.push('model_labels = ?');
    values.push(patch.modelLabels ? 1 : 0);
  }
  if (patch.parentMapId !== undefined) {
    sets.push('parent_map_id = ?');
    values.push(wouldCycleMaps(mapId, patch.parentMapId ?? null) ? existing.parentMapId : patch.parentMapId ?? null);
  }
  if (sets.length === 0) return existing;
  sets.push('updated_at = ?');
  values.push(now(), mapId);
  getDb().prepare(`UPDATE world_maps SET ${sets.join(', ')} WHERE map_id = ?`).run(...values);
  return getWorldMap(mapId);
}

/**
 * Delete a map. Children are DETACHED, never deleted (parent_map_id is ON DELETE SET
 * NULL): removing the continent must not silently take every city map with it. Images,
 * layers and markers DO cascade — they have no meaning without their map.
 */
export function deleteWorldMap(mapId: string): void {
  getDb().prepare('DELETE FROM world_maps WHERE map_id = ?').run(mapId);
}

/** The maps that hang directly off this one. */
export function childMaps(mapId: string): WorldMap[] {
  return (getDb().prepare(`${MAP_SELECT} WHERE m.parent_map_id = ? ORDER BY m.sort_order, m.name`).all(mapId) as MapRow[]).map(rowToMap);
}

/**
 * Every map a place is drawn on, for the "En los mapas" section of a place sheet. Reads
 * `map_markers`, not `world_maps`: being drawn somewhere and being the subject of a map
 * are different facts, and this is the first one.
 */
export function placeMapAppearances(placeId: string): PlaceMapAppearance[] {
  return (
    getDb()
      .prepare(
        `SELECT mk.marker_id AS markerId, mk.x, mk.y, m.map_id AS mapId, m.name AS mapName, m.kind AS mapKind
           FROM map_markers mk JOIN world_maps m ON m.map_id = mk.map_id
          WHERE mk.place_id = ?
          ORDER BY m.sort_order, m.name`
      )
      .all(placeId) as (PlaceMapAppearance & { mapKind: string })[]
  ).map((row) => ({ ...row, mapKind: mapKind(row.mapKind) }));
}

/**
 * What every map can show, in ONE query.
 *
 * Map-following has to ask "which map draws this place?" on every tick of the playhead,
 * for a chain of containers. Asking per map would be a query per map per tick; this is
 * loaded once and answered in memory by `resolveMapFocus`.
 */
export function worldMapCoverage(): { mapId: string; placeId: string | null; markerPlaceIds: string[]; fromWorldDay: number | null; toWorldDay: number | null }[] {
  const rows = getDb()
    .prepare(
      `SELECT m.map_id AS mapId, m.place_id AS placeId, m.from_world_day AS fromWorldDay,
              m.to_world_day AS toWorldDay, mk.place_id AS markerPlaceId
         FROM world_maps m
         LEFT JOIN map_markers mk ON mk.map_id = m.map_id AND mk.place_id IS NOT NULL
        ORDER BY m.sort_order, m.name`
    )
    .all() as { mapId: string; placeId: string | null; fromWorldDay: number | null; toWorldDay: number | null; markerPlaceId: string | null }[];
  const byMap = new Map<string, { mapId: string; placeId: string | null; markerPlaceIds: string[]; fromWorldDay: number | null; toWorldDay: number | null }>();
  for (const row of rows) {
    let entry = byMap.get(row.mapId);
    if (!entry) {
      entry = { mapId: row.mapId, placeId: row.placeId, markerPlaceIds: [], fromWorldDay: row.fromWorldDay, toWorldDay: row.toWorldDay };
      byMap.set(row.mapId, entry);
    }
    if (row.markerPlaceId && !entry.markerPlaceIds.includes(row.markerPlaceId)) entry.markerPlaceIds.push(row.markerPlaceId);
  }
  return [...byMap.values()];
}

/** Point a map at a base image and record its native pixel size. */
export function setMapImage(mapId: string, imageId: string, width: number, height: number): WorldMap | null {
  getDb()
    .prepare('UPDATE world_maps SET image_id = ?, width_px = ?, height_px = ?, updated_at = ? WHERE map_id = ?')
    .run(imageId, Math.max(0, Math.round(width)), Math.max(0, Math.round(height)), now(), mapId);
  return getWorldMap(mapId);
}

// ── growing the canvas ──────────────────────────────────────────────────────────

interface MarkerGeometryRow {
  marker_id: string;
  x: number;
  y: number;
  radius: number | null;
  points: string | null;
}

/**
 * Apply a canvas growth to EVERY coordinate this map holds, in ONE transaction.
 *
 * The single most dangerous operation in the feature. After an outpaint, markers,
 * polygon vertices, path points, both ends of the calibration segment and the footprint
 * inside the parent are all stale; a partial application leaves a map whose pins are
 * half-moved, which the author has no way to repair by hand.
 *
 * The arithmetic itself lives in `applyCanvasGrowth` (pure, tested); this function's job
 * is only to make the write atomic and to leave nothing out.
 */
export function growMapCanvas(mapId: string, growth: CanvasGrowth): WorldMap | null {
  const map = getWorldMap(mapId);
  if (!map) return null;
  const db = getDb();
  const markerRows = db
    .prepare('SELECT marker_id, x, y, radius, points FROM map_markers WHERE map_id = ?')
    .all(mapId) as MarkerGeometryRow[];

  const footprint: MapFootprint | null =
    map.parentX0 != null && map.parentY0 != null && map.parentX1 != null && map.parentY1 != null
      ? { x0: map.parentX0, y0: map.parentY0, x1: map.parentX1, y1: map.parentY1 }
      : null;

  const next = applyCanvasGrowth(
    {
      markers: markerRows.map((row) => ({
        markerId: row.marker_id,
        x: row.x,
        y: row.y,
        radius: row.radius,
        points: parsePoints(row.points),
      })),
      scaleFrom: map.scaleX0 != null && map.scaleY0 != null ? { x: map.scaleX0, y: map.scaleY0 } : null,
      scaleTo: map.scaleX1 != null && map.scaleY1 != null ? { x: map.scaleX1, y: map.scaleY1 } : null,
      footprint,
    },
    growth,
  );

  const size = grownSize(map.widthPx, map.heightPx, growth);
  const ts = now();
  const write = db.transaction(() => {
    const updateMarker = db.prepare(
      'UPDATE map_markers SET x = ?, y = ?, radius = ?, points = ?, updated_at = ? WHERE marker_id = ?'
    );
    for (const marker of next.markers) {
      updateMarker.run(
        marker.x,
        marker.y,
        marker.radius,
        marker.points ? JSON.stringify(marker.points.map((point) => [point.x, point.y])) : null,
        ts,
        marker.markerId,
      );
    }
    db.prepare(
      `UPDATE world_maps
          SET width_px = ?, height_px = ?, scale_x0 = ?, scale_y0 = ?, scale_x1 = ?, scale_y1 = ?, updated_at = ?
        WHERE map_id = ?`
    ).run(
      size.width,
      size.height,
      next.scaleFrom?.x ?? null,
      next.scaleFrom?.y ?? null,
      next.scaleTo?.x ?? null,
      next.scaleTo?.y ?? null,
      ts,
      mapId,
    );
  });
  write();
  return getWorldMap(mapId);
}

export function parsePoints(raw: string | null): { x: number; y: number }[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const points = parsed
      .map((entry) => (Array.isArray(entry) && entry.length >= 2 ? { x: Number(entry[0]), y: Number(entry[1]) } : null))
      .filter((point): point is { x: number; y: number } => !!point && Number.isFinite(point.x) && Number.isFinite(point.y));
    return points.length > 0 ? points : null;
  } catch {
    return null;
  }
}

// ── images ──────────────────────────────────────────────────────────────────────

export interface StoredMapImage {
  mapId: string;
  role: MapImageRole;
  mimeType: string;
  width: number;
  height: number;
  blob: Buffer;
  thumbnail: Buffer | null;
  thumbnailMimeType?: string | null;
  prompt?: string | null;
  provider?: string | null;
  model?: string | null;
  style?: string | null;
  generated?: boolean;
}

/**
 * Store an image and make it the map's base, demoting whatever was there to `previous`
 * so a regeneration can be undone. Only ONE `previous` is kept — a map is megabytes, and
 * an unbounded history of them would quietly triple the vault.
 */
export function saveMapImage(image: StoredMapImage): string {
  const db = getDb();
  const imageId = `mapimg_${uuid()}`;
  const ts = now();
  const write = db.transaction(() => {
    if (image.role === 'base') {
      db.prepare("DELETE FROM map_images WHERE map_id = ? AND role = 'previous'").run(image.mapId);
      db.prepare("UPDATE map_images SET role = 'previous' WHERE map_id = ? AND role = 'base'").run(image.mapId);
    }
    db.prepare(
      `INSERT INTO map_images
        (image_id, map_id, role, mime_type, width, height, bytes, blob, thumbnail,
         thumbnail_mime_type, prompt, provider, model, style, generated, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      imageId,
      image.mapId,
      image.role,
      image.mimeType,
      image.width,
      image.height,
      image.blob.length,
      image.blob,
      image.thumbnail ?? null,
      image.thumbnailMimeType ?? null,
      image.prompt ?? null,
      image.provider ?? null,
      image.model ?? null,
      image.style ?? null,
      image.generated ? 1 : 0,
      ts,
    );
    if (image.role === 'base') {
      db.prepare('UPDATE world_maps SET image_id = ?, width_px = ?, height_px = ?, updated_at = ? WHERE map_id = ?')
        .run(imageId, image.width, image.height, ts, image.mapId);
    }
  });
  write();
  return imageId;
}

export function getMapImageBlob(imageId: string): { mimeType: string; blob: Buffer } | null {
  const row = getDb().prepare('SELECT mime_type, blob FROM map_images WHERE image_id = ?').get(imageId) as
    | { mime_type: string; blob: Buffer | null }
    | undefined;
  return row?.blob ? { mimeType: row.mime_type, blob: row.blob } : null;
}

export function getMapThumbnail(mapId: string): { mimeType: string; blob: Buffer } | null {
  const row = getDb()
    .prepare(
      `SELECT mime_type, thumbnail, thumbnail_mime_type, blob
         FROM map_images WHERE map_id = ? AND role = 'base' LIMIT 1`
    )
    .get(mapId) as
    | { mime_type: string; thumbnail: Buffer | null; thumbnail_mime_type: string | null; blob: Buffer | null }
    | undefined;
  const bytes = row?.thumbnail ?? row?.blob;
  return bytes
    ? {
        mimeType: row!.thumbnail ? row!.thumbnail_mime_type ?? 'image/jpeg' : row!.mime_type,
        blob: bytes,
      }
    : null;
}
