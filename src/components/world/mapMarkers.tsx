import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import type { MapGeometryKind, MapLayer, MapMarker, WorldMap } from '@shared/types';
import {
  clamp01,
  distanceToRadius,
  formatDistance,
  measurePath,
  radiusToDistance,
  type CanvasFrame,
  type MapDistanceUnit,
  type NormPoint,
} from '@shared/worldMapGeometry';
import { Icon } from '../ui';
import { geometryOf, unitLabel } from './mapTools';
import { t, tx } from '../../i18n';

/**
 * Pins, circles of influence, traced outlines and routes.
 *
 * ONE tool with four rungs, not four tools. A pin gains a radius, the circle becomes a
 * polygon already shaped like the circle, and the polygon gets dented into the shape of
 * the forest. Modelling them separately would make each step a delete and an insert, and
 * the author would lose the place, the label and the temporal validity every time.
 *
 * ## Vertex editing, by hand
 *
 * `leaflet-editable` would do this, at ~40 KB and an API to tame for the 20% we use. Four
 * things have to be right for the hand-rolled version to be worth it, and all four are
 * here and pinned by tests:
 *
 *   1. **Undo per GESTURE, not per vertex.** Drag-and-release is one action. Without
 *      this, undoing a thirty-point outline is thirty keystrokes.
 *   2. **A drag threshold.** Without it, a click to select nudges the vertex a pixel or
 *      two and the outline degrades just from being looked at.
 *   3. **Handles sized in SCREEN pixels**, not map units, or they become unreachable
 *      when the author zooms out.
 *   4. **Alt+click deletes**, down to the minimum a shape can still be drawn with.
 */

const HANDLE_RADIUS = 6;
const MIDPOINT_RADIUS = 4;
/** Pixels the pointer must travel before a mousedown counts as a drag, not a click. */
export const DRAG_THRESHOLD_PX = 4;

export function minimumVertices(kind: MapGeometryKind): number {
  return kind === 'polygon' ? 3 : kind === 'path' ? 2 : 0;
}

/** Midpoint of each edge; for a polygon the last edge wraps to the first. */
export function midpoints(points: NormPoint[], closed: boolean): { index: number; point: NormPoint }[] {
  const result: { index: number; point: NormPoint }[] = [];
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    result.push({ index: i + 1, point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } });
  }
  return result;
}

export function insertVertex(points: NormPoint[], index: number, point: NormPoint): NormPoint[] {
  const next = [...points];
  next.splice(index, 0, point);
  return next;
}

export function removeVertex(points: NormPoint[], index: number, kind: MapGeometryKind): NormPoint[] {
  if (points.length <= minimumVertices(kind)) return points;
  return points.filter((_, i) => i !== index);
}

/** A marker is drawn only while it is valid at the playhead. */
export function markerVisibleAt(marker: MapMarker, worldDay: number | null): boolean {
  if (worldDay == null) return true;
  if (marker.fromWorldDay != null && worldDay < marker.fromWorldDay) return false;
  if (marker.toWorldDay != null && worldDay > marker.toWorldDay) return false;
  return true;
}

export function visibleMarkers(markers: MapMarker[], layers: MapLayer[], worldDay: number | null): MapMarker[] {
  const hidden = new Set(layers.filter((layer) => !layer.visible).map((layer) => layer.layerId));
  return markers.filter((marker) => !(marker.layerId && hidden.has(marker.layerId)) && markerVisibleAt(marker, worldDay));
}

// ── drawing the markers ─────────────────────────────────────────────────────────

const DEFAULT_COLOR = '#818cf8';

function markerColor(marker: MapMarker, layers: MapLayer[]): string {
  return marker.color ?? layers.find((layer) => layer.layerId === marker.layerId)?.color ?? DEFAULT_COLOR;
}

/**
 * Every marker on the map, as Leaflet layers.
 *
 * Rebuilt wholesale whenever the marker list changes. That is cheap at the scale a world
 * actually has (hundreds, not millions) and it removes a whole class of bug: no layer can
 * survive the marker it was drawn from.
 */
export function MarkerLayer({
  leaflet,
  frame,
  map,
  markers,
  layers,
  selectedId,
  worldDay,
  onSelect,
  onOpenChild,
}: {
  leaflet: L.Map;
  frame: CanvasFrame;
  map: WorldMap;
  markers: MapMarker[];
  layers: MapLayer[];
  selectedId: string | null;
  worldDay: number | null;
  onSelect: (markerId: string) => void;
  onOpenChild: (mapId: string) => void;
}) {
  const shown = useMemo(() => visibleMarkers(markers, layers, worldDay), [markers, layers, worldDay]);
  const handlers = useRef({ onSelect, onOpenChild });
  handlers.current = { onSelect, onOpenChild };

  useEffect(() => {
    const group = L.layerGroup().addTo(leaflet);
    for (const marker of shown) {
      const color = markerColor(marker, layers);
      const selected = marker.markerId === selectedId;
      const weight = selected ? 3 : 2;
      const style = { color, weight, fillColor: color, fillOpacity: selected ? 0.22 : 0.13 };
      let layer: L.Layer | null = null;

      if (marker.geometryKind === 'circle' && marker.radius != null) {
        // Radius is normalized against X; the canvas is `frame.width` wide, so this is the
        // same ground distance whatever the map's aspect ratio.
        layer = L.circle(frame.toCanvas({ x: marker.x, y: marker.y }) as unknown as L.LatLngExpression, {
          ...style,
          radius: marker.radius * frame.width,
        });
      } else if (marker.geometryKind === 'polygon' && marker.points) {
        layer = L.polygon(marker.points.map((point) => frame.toCanvas(point)) as L.LatLngExpression[], style);
      } else if (marker.geometryKind === 'path' && marker.points) {
        layer = L.polyline(marker.points.map((point) => frame.toCanvas(point)) as L.LatLngExpression[], {
          color,
          weight: selected ? 4 : 3,
        });
      }
      if (layer) {
        layer.on('click', (event: L.LeafletMouseEvent) => {
          L.DomEvent.stop(event);
          handlers.current.onSelect(marker.markerId);
        });
        layer.addTo(group);
      }

      // Every geometry also carries a pin at its anchor: it is what the author clicks, it
      // is where the label hangs, and it is the only thing visible when a shape is small.
      const label = marker.label ?? marker.placeName ?? '';
      const pin = L.marker(frame.toCanvas({ x: marker.x, y: marker.y }) as unknown as L.LatLngExpression, {
        icon: L.divIcon({
          className: 'world-map-pin',
          html: `<span class="world-map-pin-dot" style="--pin:${escapeAttr(color)}"${selected ? ' data-selected="true"' : ''}></span>${label ? `<span class="world-map-pin-label">${escapeHtml(label)}</span>` : ''}`,
          iconSize: [0, 0],
        }),
        keyboard: false,
      });
      pin.on('click', (event: L.LeafletMouseEvent) => {
        L.DomEvent.stop(event);
        handlers.current.onSelect(marker.markerId);
      });
      if (marker.childMapId) {
        pin.on('dblclick', (event: L.LeafletMouseEvent) => {
          L.DomEvent.stop(event);
          handlers.current.onOpenChild(marker.childMapId!);
        });
      }
      pin.addTo(group);
    }
    return () => {
      group.remove();
    };
  }, [leaflet, frame, shown, layers, selectedId, map.mapId]);

  return null;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

// ── vertex editing ──────────────────────────────────────────────────────────────

/**
 * Draggable handles for a polygon or path, plus the midpoint handles that add a vertex.
 *
 * Every gesture reports ONCE, on release (`onCommit`), so undo is per gesture. The live
 * shape during a drag is local state, so dragging does not round-trip to SQLite thirty
 * times a second.
 */
export function VertexEditor({
  leaflet,
  frame,
  marker,
  onCommit,
}: {
  leaflet: L.Map;
  frame: CanvasFrame;
  marker: MapMarker;
  onCommit: (points: NormPoint[]) => void;
}) {
  const [points, setPoints] = useState<NormPoint[]>(marker.points ?? []);
  /**
   * The live geometry, written SYNCHRONOUSLY by the gesture — not assigned during render.
   *
   * Assigning `pointsRef.current = points` on each render looks equivalent and is not:
   * React had not flushed the last `setPoints` of a drag by the time `mouseup` fired, so
   * the commit sent the ORIGINAL outline. The shape moved on screen, the gesture reported
   * exactly once, and nothing was saved — the drag simply did not stick, with no error
   * anywhere. Found by dragging a vertex, not by a test.
   */
  const pointsRef = useRef(points);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  /** The one way the working copy changes: ref first, then the render. */
  const applyPoints = (next: NormPoint[]) => {
    pointsRef.current = next;
    setPoints(next);
  };

  // A change from elsewhere (undo, a reload) replaces the working copy; a change from our
  // own drag does not, or the shape would snap back mid-gesture.
  useEffect(() => {
    applyPoints(marker.points ?? []);
    // eslint-disable-next-line
  }, [marker.markerId, marker.updatedAt]);

  const closed = marker.geometryKind === 'polygon';

  useEffect(() => {
    if (points.length === 0) return;
    const group = L.layerGroup().addTo(leaflet);

    // The shape as it is being dragged.
    const outline = closed
      ? L.polygon(points.map((point) => frame.toCanvas(point)) as L.LatLngExpression[], {
          color: '#fbbf24', weight: 2, fillOpacity: 0.08, interactive: false,
        })
      : L.polyline(points.map((point) => frame.toCanvas(point)) as L.LatLngExpression[], {
          color: '#fbbf24', weight: 3, interactive: false,
        });
    outline.addTo(group);

    points.forEach((point, index) => {
      const handle = L.circleMarker(frame.toCanvas(point) as unknown as L.LatLngExpression, {
        // circleMarker's radius is in SCREEN pixels — that is exactly what is wanted here
        // and the reason it is used instead of L.circle: a handle sized in map units
        // becomes unreachable the moment the author zooms out.
        radius: HANDLE_RADIUS,
        color: '#fbbf24',
        fillColor: '#0a0a0b',
        fillOpacity: 1,
        weight: 2,
        className: 'world-map-vertex',
      }).addTo(group);

      let dragging = false;
      let moved = false;
      let origin: L.Point | null = null;

      const onMove = (event: L.LeafletMouseEvent) => {
        if (!dragging || !origin) return;
        const current = leaflet.latLngToContainerPoint(event.latlng);
        // The threshold: below it this is still a click, not a drag. Without it a click
        // to select nudges the vertex and the outline degrades just from being looked at.
        if (!moved && origin.distanceTo(current) < DRAG_THRESHOLD_PX) return;
        moved = true;
        const next = [...pointsRef.current];
        const normalized = frame.fromCanvas(event.latlng.lat, event.latlng.lng);
        next[index] = { x: clamp01(normalized.x), y: clamp01(normalized.y) };
        applyPoints(next);
      };

      const onUp = () => {
        if (!dragging) return;
        dragging = false;
        leaflet.dragging.enable();
        leaflet.off('mousemove', onMove);
        leaflet.off('mouseup', onUp);
        // ONE commit per gesture. Committing per mousemove would make undo useless and
        // would write to SQLite thirty times a second.
        if (moved) commitRef.current(pointsRef.current);
      };

      handle.on('mousedown', (event: L.LeafletMouseEvent) => {
        L.DomEvent.stop(event);
        if (event.originalEvent.altKey) {
          const next = removeVertex(pointsRef.current, index, marker.geometryKind);
          if (next !== pointsRef.current) {
            applyPoints(next);
            commitRef.current(next);
          }
          return;
        }
        dragging = true;
        moved = false;
        origin = leaflet.latLngToContainerPoint(event.latlng);
        leaflet.dragging.disable();
        leaflet.on('mousemove', onMove);
        leaflet.on('mouseup', onUp);
      });
    });

    // Midpoint handles: dragging one inserts a vertex there. This is what makes "add
    // adjustment points" a drag rather than a mode the author has to find.
    for (const { index, point } of midpoints(points, closed)) {
      const handle = L.circleMarker(frame.toCanvas(point) as unknown as L.LatLngExpression, {
        radius: MIDPOINT_RADIUS,
        color: '#fbbf24',
        fillColor: '#fbbf24',
        fillOpacity: 0.5,
        weight: 1,
        className: 'world-map-midpoint',
      }).addTo(group);
      handle.on('mousedown', (event: L.LeafletMouseEvent) => {
        L.DomEvent.stop(event);
        // Alt means DELETE, everywhere. A midpoint has nothing to delete, so it does
        // nothing rather than adding a vertex — otherwise an Alt+click that lands a few
        // pixels off its target does the exact opposite of what was asked.
        if (event.originalEvent.altKey) return;
        const inserted = insertVertex(pointsRef.current, index, point);
        applyPoints(inserted);
        commitRef.current(inserted);
      });
    }

    return () => {
      group.remove();
    };
  }, [leaflet, frame, points, closed, marker.geometryKind]);

  return null;
}

// ── the marker sheet ────────────────────────────────────────────────────────────

const GEOMETRY_LABEL: Record<MapGeometryKind, string> = {
  point: 'Punto',
  circle: 'Círculo',
  polygon: 'Forma',
  path: 'Ruta',
};

/**
 * The panel for the selected marker: what it is, what place it points at, and the
 * ladder from point to exact outline.
 */
export function MarkerSheet({
  map,
  marker,
  layers,
  places,
  maps,
  onChanged,
  onDeselect,
}: {
  map: WorldMap;
  marker: MapMarker;
  layers: MapLayer[];
  places: { placeId: string; name: string }[];
  maps: WorldMap[];
  onChanged: () => Promise<void>;
  onDeselect: () => void;
}) {
  const geometry = useMemo(() => geometryOf(map), [map]);
  const unit = map.projection === 'globe' ? map.planetRadiusUnit ?? 'km' : map.scaleUnit;
  const radiusDistance = marker.radius != null ? radiusToDistance(geometry, marker.radius) : null;
  const pathLength = marker.points ? measurePath(geometry, marker.points) : null;

  const patch = async (next: Parameters<typeof window.nodus.updateMapMarker>[1]) => {
    await window.nodus.updateMapMarker(marker.markerId, next);
    await onChanged();
  };

  const toCircle = async () => {
    // A radius the author can see: a twelfth of the map, or 10 units if there is a scale.
    const seeded = distanceToRadius(geometry, 10) ?? 0.08;
    await patch({ geometryKind: 'circle', radius: Math.min(0.4, Math.max(0.02, seeded)), points: null });
  };

  const toPolygon = async () => {
    await window.nodus.circleToPolygon(marker.markerId, map.widthPx / Math.max(1, map.heightPx));
    await onChanged();
  };

  return (
    <div className="flex flex-col gap-3 border-t border-neutral-800 pt-3" data-testid="map-marker-sheet">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {t(GEOMETRY_LABEL[marker.geometryKind])}
        </h3>
        <button className="text-neutral-500 hover:text-neutral-200" onClick={onDeselect} aria-label={t('Cerrar')}>
          <Icon name="x" size={13} />
        </button>
      </div>

      <label className="block text-xs text-neutral-500">
        {t('Lugar')}
        <select
          className="input mt-1 w-full text-sm"
          value={marker.placeId ?? ''}
          onChange={(event) => void patch({ placeId: event.target.value || null })}
          data-testid="map-marker-place"
        >
          <option value="">{t('— sin lugar —')}</option>
          {places.map((place) => (
            <option key={place.placeId} value={place.placeId}>{place.name}</option>
          ))}
        </select>
      </label>

      <label className="block text-xs text-neutral-500">
        {t('Lleva al mapa')}
        <select
          className="input mt-1 w-full text-sm"
          value={marker.childMapId ?? ''}
          onChange={(event) => void patch({ childMapId: event.target.value || null })}
          data-testid="map-marker-child"
        >
          <option value="">{t('— ninguno —')}</option>
          {maps.filter((entry) => entry.mapId !== map.mapId).map((entry) => (
            <option key={entry.mapId} value={entry.mapId}>{entry.name}</option>
          ))}
        </select>
        <span className="mt-1 block text-[11px] leading-snug text-neutral-600">
          {t('Doble clic en la chincheta bajará a ese mapa.')}
        </span>
      </label>

      {layers.length > 0 && (
        <label className="block text-xs text-neutral-500">
          {t('Capa')}
          <select
            className="input mt-1 w-full text-sm"
            value={marker.layerId ?? ''}
            onChange={(event) => void patch({ layerId: event.target.value || null })}
          >
            <option value="">{t('— sin capa —')}</option>
            {layers.map((layer) => (
              <option key={layer.layerId} value={layer.layerId}>{layer.name}</option>
            ))}
          </select>
        </label>
      )}

      {/* The ladder: point → circle → shape. Each rung starts from the one below it. */}
      <div className="flex flex-col gap-1.5" data-testid="map-marker-geometry">
        {marker.geometryKind === 'point' && (
          <button className="btn btn-ghost h-7 justify-start gap-1.5 border border-neutral-700 px-2 text-xs" onClick={() => void toCircle()} data-testid="map-marker-to-circle">
            <Icon name="target" size={12} /> {t('Darle un radio de acción')}
          </button>
        )}
        {marker.geometryKind === 'circle' && (
          <>
            <label className="flex items-center gap-2 text-xs text-neutral-500">
              {t('Radio')}
              <input
                className="input h-7 w-20 text-xs"
                inputMode="decimal"
                defaultValue={radiusDistance != null ? radiusDistance.toFixed(1).replace(/\.0$/, '') : ''}
                key={`${marker.markerId}-radius-${marker.updatedAt}`}
                disabled={radiusDistance == null}
                onBlur={(event) => {
                  const value = Number(event.target.value.replace(',', '.'));
                  if (!Number.isFinite(value) || value <= 0) return;
                  const next = distanceToRadius(geometry, value);
                  if (next != null) void patch({ radius: clamp01(next) });
                }}
                data-testid="map-marker-radius"
              />
              <span className="text-neutral-500">{unitLabel(unit)}</span>
            </label>
            {radiusDistance == null && (
              <p className="text-[11px] leading-snug text-neutral-600">{t('Sin escala no se puede escribir el radio en unidades del mundo: arrástralo, o calibra el mapa.')}</p>
            )}
            <button className="btn btn-ghost h-7 justify-start gap-1.5 border border-neutral-700 px-2 text-xs" onClick={() => void toPolygon()} data-testid="map-marker-to-polygon">
              <Icon name="edit" size={12} /> {t('Convertir en forma editable')}
            </button>
          </>
        )}
        {(marker.geometryKind === 'polygon' || marker.geometryKind === 'path') && (
          <p className="text-[11px] leading-snug text-neutral-500" data-testid="map-marker-vertex-help">
            {tx('{n} puntos. Arrastra uno para moverlo, arrastra un punto intermedio para añadir otro, y Alt+clic para eliminarlo.', { n: marker.points?.length ?? 0 })}
            {pathLength != null && ` · ${formatDistance(pathLength, (unit ?? 'km') as MapDistanceUnit, unitLabel(unit))}`}
          </p>
        )}
      </div>

      <button
        className="btn btn-ghost h-7 justify-start gap-1.5 px-2 text-xs text-red-300"
        onClick={() => void window.nodus.deleteMapMarker(marker.markerId).then(() => { onDeselect(); return onChanged(); })}
        data-testid="map-marker-delete"
      >
        <Icon name="trash" size={12} /> {t('Eliminar la chincheta')}
      </button>
    </div>
  );
}
