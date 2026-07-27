// Pins, shapes, layers and travel modes (schema v97).
//
// One `map_markers` table holds four geometries — point, circle, polygon, path — because
// to the author they are ONE thing that grows as they refine it: a pin gains a radius,
// the circle becomes a polygon, the polygon gets dented into the shape of the forest.
// Four tables would turn each of those steps into a delete and an insert, and the author
// would lose the place, the label and the temporal validity every time.
//
// Coordinates are normalized 0..1. Vertices are stored as a JSON `[[x, y], …]` array
// rather than a child table: they are only ever read and written as a whole shape, never
// queried individually, and a vertex table would make every drag a transaction over
// dozens of rows.

import { v4 as uuid } from 'uuid';
import { getDb } from './database';
import { parsePoints } from './worldMapsRepo';
import { clamp01 } from '@shared/worldMapGeometry';
import type {
  MapGeometryKind,
  MapLayer,
  MapLayerInput,
  MapLayerKind,
  MapMarker,
  MapMarkerInput,
  MapTravelMode,
  MapTravelModeInput,
  MapDistanceUnitName,
} from '@shared/types';

function now(): string {
  return new Date().toISOString();
}

const GEOMETRY_KINDS = new Set<MapGeometryKind>(['point', 'circle', 'polygon', 'path']);
const LAYER_KINDS = new Set<MapLayerKind>([
  'political', 'physical', 'routes', 'climate', 'culture', 'battle', 'labels', 'custom',
]);
const UNITS = new Set<MapDistanceUnitName>(['km', 'mi', 'm', 'ft', 'league', 'custom']);

function geometryKind(value: unknown): MapGeometryKind {
  return typeof value === 'string' && GEOMETRY_KINDS.has(value as MapGeometryKind)
    ? (value as MapGeometryKind)
    : 'point';
}

function layerKind(value: unknown): MapLayerKind {
  return typeof value === 'string' && LAYER_KINDS.has(value as MapLayerKind) ? (value as MapLayerKind) : 'custom';
}

function unit(value: unknown): MapDistanceUnitName {
  return typeof value === 'string' && UNITS.has(value as MapDistanceUnitName) ? (value as MapDistanceUnitName) : 'km';
}

/**
 * The minimum vertex count a geometry is still itself at. Dropping below it is what
 * turns a polygon into a line and a line into nothing, so deletion is refused there
 * rather than allowed to produce a shape that cannot be drawn.
 */
export function minimumVertices(kind: MapGeometryKind): number {
  return kind === 'polygon' ? 3 : kind === 'path' ? 2 : 0;
}

function serializePoints(points: { x: number; y: number }[] | null | undefined): string | null {
  if (!points || points.length === 0) return null;
  return JSON.stringify(points.map((point) => [clamp01(point.x), clamp01(point.y)]));
}

// ── markers ─────────────────────────────────────────────────────────────────────

interface MarkerRow {
  marker_id: string;
  map_id: string;
  layer_id: string | null;
  place_id: string | null;
  place_name: string | null;
  place_kind: string | null;
  child_map_id: string | null;
  label: string | null;
  geometry_kind: string;
  x: number;
  y: number;
  radius: number | null;
  points: string | null;
  icon: string | null;
  color: string | null;
  from_world_day: number | null;
  to_world_day: number | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const MARKER_SELECT = `SELECT mk.*, p.name AS place_name, p.kind AS place_kind
  FROM map_markers mk LEFT JOIN places p ON p.place_id = mk.place_id`;

function rowToMarker(row: MarkerRow): MapMarker {
  return {
    markerId: row.marker_id,
    mapId: row.map_id,
    layerId: row.layer_id,
    placeId: row.place_id,
    placeName: row.place_name,
    placeKind: row.place_kind,
    childMapId: row.child_map_id,
    label: row.label,
    geometryKind: geometryKind(row.geometry_kind),
    x: row.x,
    y: row.y,
    radius: row.radius,
    points: parsePoints(row.points),
    icon: row.icon,
    color: row.color,
    fromWorldDay: row.from_world_day,
    toWorldDay: row.to_world_day,
    notes: row.notes,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listMapMarkers(mapId: string): MapMarker[] {
  return (
    getDb().prepare(`${MARKER_SELECT} WHERE mk.map_id = ? ORDER BY mk.sort_order, mk.created_at`).all(mapId) as MarkerRow[]
  ).map(rowToMarker);
}

export function getMapMarker(markerId: string): MapMarker | null {
  const row = getDb().prepare(`${MARKER_SELECT} WHERE mk.marker_id = ?`).get(markerId) as MarkerRow | undefined;
  return row ? rowToMarker(row) : null;
}

export function createMapMarker(input: MapMarkerInput): MapMarker {
  const id = `mk_${uuid()}`;
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO map_markers
        (marker_id, map_id, layer_id, place_id, child_map_id, label, geometry_kind, x, y,
         radius, points, icon, color, from_world_day, to_world_day, notes, sort_order,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.mapId,
      input.layerId ?? null,
      input.placeId ?? null,
      input.childMapId ?? null,
      input.label ?? null,
      geometryKind(input.geometryKind),
      clamp01(input.x),
      clamp01(input.y),
      input.radius ?? null,
      serializePoints(input.points),
      input.icon ?? null,
      input.color ?? null,
      input.fromWorldDay ?? null,
      input.toWorldDay ?? null,
      input.notes ?? null,
      input.sortOrder ?? 0,
      ts,
      ts,
    );
  return getMapMarker(id)!;
}

const MARKER_PATCHABLE: Record<string, string> = {
  layerId: 'layer_id',
  placeId: 'place_id',
  childMapId: 'child_map_id',
  label: 'label',
  radius: 'radius',
  icon: 'icon',
  color: 'color',
  fromWorldDay: 'from_world_day',
  toWorldDay: 'to_world_day',
  notes: 'notes',
  sortOrder: 'sort_order',
};

export function updateMapMarker(markerId: string, patch: Partial<MapMarkerInput>): MapMarker | null {
  const existing = getMapMarker(markerId);
  if (!existing) return null;
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(MARKER_PATCHABLE)) {
    const value = (patch as Record<string, unknown>)[key];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(value ?? null);
  }
  if (patch.geometryKind !== undefined) {
    sets.push('geometry_kind = ?');
    values.push(geometryKind(patch.geometryKind));
  }
  if (patch.x !== undefined) {
    sets.push('x = ?');
    values.push(clamp01(patch.x));
  }
  if (patch.y !== undefined) {
    sets.push('y = ?');
    values.push(clamp01(patch.y));
  }
  if (patch.points !== undefined) {
    sets.push('points = ?');
    values.push(serializePoints(patch.points));
  }
  if (sets.length === 0) return existing;
  sets.push('updated_at = ?');
  values.push(now(), markerId);
  getDb().prepare(`UPDATE map_markers SET ${sets.join(', ')} WHERE marker_id = ?`).run(...values);
  return getMapMarker(markerId);
}

export function deleteMapMarker(markerId: string): void {
  getDb().prepare('DELETE FROM map_markers WHERE marker_id = ?').run(markerId);
}

/**
 * Turn a circle into an editable outline: the polygon is seeded AROUND the circle so the
 * author starts from the shape they already had and dents it, instead of tracing a
 * coastline from nothing. This is the whole reason the four geometries are one tool.
 *
 * The vertices are laid out in normalized space with the aspect ratio applied, so the
 * seeded polygon is drawn as the circle it replaces rather than as an ellipse.
 */
export function circleToPolygon(markerId: string, aspect: number, vertices = 12): MapMarker | null {
  const marker = getMapMarker(markerId);
  if (!marker || marker.geometryKind !== 'circle' || marker.radius == null) return null;
  const count = Math.max(3, Math.min(64, Math.round(vertices)));
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    points.push({
      x: clamp01(marker.x + Math.cos(angle) * marker.radius),
      // `aspect` = widthPx / heightPx: the same ground distance is a LARGER step in
      // normalized y on a wide map, which is what keeps the seed circular on screen.
      y: clamp01(marker.y + Math.sin(angle) * marker.radius * aspect),
    });
  }
  return updateMapMarker(markerId, { geometryKind: 'polygon', points, radius: null });
}

// ── layers ──────────────────────────────────────────────────────────────────────

interface LayerRow {
  layer_id: string;
  map_id: string;
  name: string;
  kind: string;
  color: string | null;
  opacity: number;
  visible: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function rowToLayer(row: LayerRow): MapLayer {
  return {
    layerId: row.layer_id,
    mapId: row.map_id,
    name: row.name,
    kind: layerKind(row.kind),
    color: row.color,
    opacity: row.opacity,
    visible: !!row.visible,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listMapLayers(mapId: string): MapLayer[] {
  return (
    getDb().prepare('SELECT * FROM map_layers WHERE map_id = ? ORDER BY sort_order, name').all(mapId) as LayerRow[]
  ).map(rowToLayer);
}

export function createMapLayer(mapId: string, input: MapLayerInput): MapLayer {
  const id = `mlay_${uuid()}`;
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO map_layers (layer_id, map_id, name, kind, color, opacity, visible, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      mapId,
      input.name.trim() || 'Capa',
      layerKind(input.kind),
      input.color ?? null,
      input.opacity ?? 1,
      input.visible === false ? 0 : 1,
      input.sortOrder ?? 0,
      ts,
      ts,
    );
  return rowToLayer(getDb().prepare('SELECT * FROM map_layers WHERE layer_id = ?').get(id) as LayerRow);
}

export function updateMapLayer(layerId: string, patch: Partial<MapLayerInput>): MapLayer | null {
  const row = getDb().prepare('SELECT * FROM map_layers WHERE layer_id = ?').get(layerId) as LayerRow | undefined;
  if (!row) return null;
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.name !== undefined) { sets.push('name = ?'); values.push(patch.name.trim() || row.name); }
  if (patch.kind !== undefined) { sets.push('kind = ?'); values.push(layerKind(patch.kind)); }
  if (patch.color !== undefined) { sets.push('color = ?'); values.push(patch.color ?? null); }
  if (patch.opacity !== undefined) { sets.push('opacity = ?'); values.push(Math.max(0, Math.min(1, patch.opacity))); }
  if (patch.visible !== undefined) { sets.push('visible = ?'); values.push(patch.visible ? 1 : 0); }
  if (patch.sortOrder !== undefined) { sets.push('sort_order = ?'); values.push(patch.sortOrder); }
  if (sets.length === 0) return rowToLayer(row);
  sets.push('updated_at = ?');
  values.push(now(), layerId);
  getDb().prepare(`UPDATE map_layers SET ${sets.join(', ')} WHERE layer_id = ?`).run(...values);
  return rowToLayer(getDb().prepare('SELECT * FROM map_layers WHERE layer_id = ?').get(layerId) as LayerRow);
}

/**
 * Delete a layer. Its markers are DETACHED, not deleted (layer_id is ON DELETE SET
 * NULL): hiding a layer and losing everything on it are very different intentions, and
 * only one of them is ever meant.
 */
export function deleteMapLayer(layerId: string): void {
  getDb().prepare('DELETE FROM map_layers WHERE layer_id = ?').run(layerId);
}

// ── travel modes ────────────────────────────────────────────────────────────────

interface TravelModeRow {
  mode_id: string;
  name: string;
  distance_per_day: number;
  unit: string;
  icon: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function rowToTravelMode(row: TravelModeRow): MapTravelMode {
  return {
    modeId: row.mode_id,
    name: row.name,
    distancePerDay: row.distance_per_day,
    unit: unit(row.unit),
    icon: row.icon,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listTravelModes(): MapTravelMode[] {
  return (
    getDb().prepare('SELECT * FROM map_travel_modes ORDER BY sort_order, name').all() as TravelModeRow[]
  ).map(rowToTravelMode);
}

export function createTravelMode(input: MapTravelModeInput): MapTravelMode {
  const id = `mode_${uuid()}`;
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO map_travel_modes (mode_id, name, distance_per_day, unit, icon, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, input.name.trim() || 'Modo', Math.max(0, input.distancePerDay), unit(input.unit), input.icon ?? null, input.sortOrder ?? 0, ts, ts);
  return rowToTravelMode(getDb().prepare('SELECT * FROM map_travel_modes WHERE mode_id = ?').get(id) as TravelModeRow);
}

export function updateTravelMode(modeId: string, patch: Partial<MapTravelModeInput>): MapTravelMode | null {
  const row = getDb().prepare('SELECT * FROM map_travel_modes WHERE mode_id = ?').get(modeId) as TravelModeRow | undefined;
  if (!row) return null;
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.name !== undefined) { sets.push('name = ?'); values.push(patch.name.trim() || row.name); }
  if (patch.distancePerDay !== undefined) { sets.push('distance_per_day = ?'); values.push(Math.max(0, patch.distancePerDay)); }
  if (patch.unit !== undefined) { sets.push('unit = ?'); values.push(unit(patch.unit)); }
  if (patch.icon !== undefined) { sets.push('icon = ?'); values.push(patch.icon ?? null); }
  if (patch.sortOrder !== undefined) { sets.push('sort_order = ?'); values.push(patch.sortOrder); }
  if (sets.length === 0) return rowToTravelMode(row);
  sets.push('updated_at = ?');
  values.push(now(), modeId);
  getDb().prepare(`UPDATE map_travel_modes SET ${sets.join(', ')} WHERE mode_id = ?`).run(...values);
  return rowToTravelMode(getDb().prepare('SELECT * FROM map_travel_modes WHERE mode_id = ?').get(modeId) as TravelModeRow);
}

export function deleteTravelMode(modeId: string): void {
  getDb().prepare('DELETE FROM map_travel_modes WHERE mode_id = ?').run(modeId);
}

/**
 * The paces a world starts with, seeded the first time the travel panel is opened rather
 * than at vault creation: a writer who never measures anything should not find four rows
 * they did not ask for, and a writer who does should not face an empty table.
 */
export const DEFAULT_TRAVEL_MODES: MapTravelModeInput[] = [
  { name: 'A pie', distancePerDay: 25, unit: 'km', icon: 'user', sortOrder: 0 },
  { name: 'A caballo', distancePerDay: 55, unit: 'km', icon: 'route', sortOrder: 1 },
  { name: 'Carro', distancePerDay: 30, unit: 'km', icon: 'truck', sortOrder: 2 },
  { name: 'Barco', distancePerDay: 120, unit: 'km', icon: 'anchor', sortOrder: 3 },
];

export function ensureTravelModes(): MapTravelMode[] {
  const existing = listTravelModes();
  if (existing.length > 0) return existing;
  for (const mode of DEFAULT_TRAVEL_MODES) createTravelMode(mode);
  return listTravelModes();
}
