import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import type { MapDistanceUnitName, MapTravelMode, WorldMap } from '@shared/types';
import {
  MAP_DISTANCE_UNITS,
  formatDistance,
  isCalibrated,
  measureDistance,
  niceScaleStep,
  travelDays,
  unitsPerPixel,
  type CanvasFrame,
  type MapDistanceUnit,
  type MapGeometrySpec,
  type NormPoint,
} from '@shared/worldMapGeometry';
import { Icon } from '../ui';
import { t, tx } from '../../i18n';

/**
 * Measuring an invented world: the scale bar, the compass, calibration and the ruler.
 *
 * All of it draws NATIVELY rather than being baked into the image. That is not a
 * stylistic choice: a scale bar drawn by an image model is wrong the moment the map is
 * extended by an edge, and a compass rose it drew points wherever it felt like. Drawn
 * here, both stay correct through every regeneration and every outpaint.
 *
 * The arithmetic lives in shared/worldMapGeometry.ts. Nothing in this file computes a
 * distance itself — it only decides what to say when the answer is `null`, which is the
 * part that matters: an uncalibrated map must read "sin escala", never "0 km".
 */

/** Turn a map row into what the geometry module wants. */
export function geometryOf(map: WorldMap): MapGeometrySpec {
  return {
    widthPx: map.widthPx,
    heightPx: map.heightPx,
    projection: map.projection,
    scaleFrom: map.scaleX0 != null && map.scaleY0 != null ? { x: map.scaleX0, y: map.scaleY0 } : null,
    scaleTo: map.scaleX1 != null && map.scaleY1 != null ? { x: map.scaleX1, y: map.scaleY1 } : null,
    scaleDistance: map.scaleDistance,
    scaleUnit: (map.scaleUnit ?? null) as MapDistanceUnit | null,
    planetRadius: map.planetRadius,
    planetRadiusUnit: (map.planetRadiusUnit ?? null) as MapDistanceUnit | null,
  };
}

export const UNIT_LABEL: Record<MapDistanceUnitName, string> = {
  km: 'km',
  mi: 'mi',
  m: 'm',
  ft: 'ft',
  league: 'leguas',
  custom: 'unidades',
};

export function unitLabel(unit: MapDistanceUnitName | null): string {
  return unit ? t(UNIT_LABEL[unit]) : '';
}

/** Add a Leaflet layer for as long as the component lives. */
function useLayer(leaflet: L.Map | null, make: () => L.Layer | null, deps: unknown[]) {
  useEffect(() => {
    if (!leaflet) return;
    const layer = make();
    if (!layer) return;
    layer.addTo(leaflet);
    return () => {
      layer.remove();
    };
    // The factory is rebuilt on every render; `deps` is what decides when to redraw.
    // eslint-disable-next-line
  }, [leaflet, ...deps]);
}

// ── the scale bar and the compass ───────────────────────────────────────────────

/**
 * A scale bar that reads "50 km", not "47,3 km", and that re-rounds as the author zooms.
 *
 * It has to be recomputed on every zoom and pan because its length in screen pixels is
 * what the reader measures against — a bar drawn once at the initial zoom is a lie at
 * every other zoom level.
 */
export function MapScaleBar({ map, leaflet, frame }: { map: WorldMap; leaflet: L.Map; frame: CanvasFrame }) {
  const geometry = useMemo(() => geometryOf(map), [map]);
  // `tick` — the VALUE, not the setter — is what the memo below depends on. Depending on
  // `setTick` (which React guarantees is stable) means the bar is computed once and never
  // again: it keeps saying "50 km" while the reader zooms in and the ground under those
  // 125 px shrinks to a fifth. Looks fine, is a lie.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const redraw = () => setTick((value) => value + 1);
    leaflet.on('zoomend moveend', redraw);
    return () => {
      leaflet.off('zoomend moveend', redraw);
    };
  }, [leaflet]);

  const bar = useMemo(() => {
    if (!isCalibrated(geometry)) return null;
    // How much world distance one SCREEN pixel covers at the current zoom: measure a
    // known canvas span and divide by how many pixels it currently occupies.
    const a = leaflet.latLngToContainerPoint(frame.toCanvas({ x: 0, y: 0.5 }) as unknown as L.LatLngExpression);
    const b = leaflet.latLngToContainerPoint(frame.toCanvas({ x: 1, y: 0.5 }) as unknown as L.LatLngExpression);
    const screenWidth = Math.abs(b.x - a.x);
    if (screenWidth < 1) return null;
    const worldWidth = measureDistance(geometry, { x: 0, y: 0.5 }, { x: 1, y: 0.5 });
    if (worldWidth == null) return null;
    return niceScaleStep(worldWidth / screenWidth, 130);
  }, [geometry, leaflet, frame, tick]);

  const unit = map.projection === 'globe' ? map.planetRadiusUnit ?? 'km' : map.scaleUnit;

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-[500] flex flex-col gap-1" data-testid="map-scale-bar">
      {bar ? (
        <>
          <div className="world-map-scale-rule h-2 border-x-2 border-b-2 shadow" style={{ width: Math.round(bar.pixels) }} />
          <span className="world-map-image-overlay-text text-[11px] font-medium tabular-nums">
            {formatDistance(bar.distance, (unit ?? 'km') as MapDistanceUnit, unitLabel(unit))}
          </span>
        </>
      ) : (
        // Never a fabricated number: an uncalibrated map says so, and says where to fix it.
        <span className="world-map-image-pill rounded px-2 py-1 text-[11px]" data-testid="map-no-scale">
          {t('Sin escala')}
        </span>
      )}
    </div>
  );
}

/**
 * The compass. Drawn natively for the same reason as the scale bar — and because on a
 * map extended northwards, a rose baked into the image is now somewhere in the middle
 * of the paper.
 */
export function MapCompass() {
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-[500]" data-testid="map-compass" aria-hidden="true">
      <svg width="34" height="34" viewBox="0 0 34 34" className="drop-shadow">
        <circle cx="17" cy="17" r="15" fill="rgba(10,10,11,.55)" stroke="rgba(229,229,229,.55)" strokeWidth="1" />
        <path d="M17 5 L21 19 L17 16 L13 19 Z" fill="#e5e5e5" />
        <text x="17" y="31" textAnchor="middle" fontSize="8" fill="#e5e5e5" fontWeight="700">N</text>
      </svg>
    </div>
  );
}

// ── calibration ─────────────────────────────────────────────────────────────────

export interface PendingSegment {
  from: NormPoint;
  to: NormPoint | null;
}

/** The dashed segment the author is dragging out, drawn on the map itself. */
export function SegmentPreview({
  leaflet,
  frame,
  segment,
  color = '#5eead4',
}: {
  leaflet: L.Map;
  frame: CanvasFrame;
  segment: PendingSegment;
  color?: string;
}) {
  useLayer(
    leaflet,
    () => {
      if (!segment.to) return null;
      return L.polyline([frame.toCanvas(segment.from), frame.toCanvas(segment.to)] as L.LatLngExpression[], {
        color,
        weight: 2,
        dashArray: '6 4',
        interactive: false,
      });
    },
    [segment.from.x, segment.from.y, segment.to?.x, segment.to?.y, color, frame],
  );
  return null;
}

/**
 * "Traza una línea sobre la barra de escala del mapa y dime cuánto mide."
 *
 * Two clicks, then a number. The segment is stored as its two ENDPOINTS rather than as a
 * length, which is what lets the calibration survive the map being regenerated at another
 * resolution or extended by an edge — see worldMapGeometry.
 */
export function CalibrationPanel({
  map,
  segment,
  onCancel,
  onSave,
}: {
  map: WorldMap;
  segment: PendingSegment;
  onCancel: () => void;
  onSave: (distance: number, unit: MapDistanceUnitName) => Promise<void>;
}) {
  const [distance, setDistance] = useState(String(map.scaleDistance ?? ''));
  const [unit, setUnit] = useState<MapDistanceUnitName>(map.scaleUnit ?? 'km');
  const [busy, setBusy] = useState(false);
  const value = Number(distance.replace(',', '.'));
  const valid = Number.isFinite(value) && value > 0 && !!segment.to;

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onSave(value, unit);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute left-1/2 top-3 z-[600] w-80 -translate-x-1/2 rounded-xl border border-teal-500/40 bg-neutral-950/95 p-3 shadow-2xl" data-testid="map-calibration-panel">
      <h3 className="text-sm font-semibold text-teal-300">{t('Calibrar la escala')}</h3>
      <p className="mt-1 text-xs leading-snug text-neutral-400">
        {segment.to
          ? t('¿Cuánto mide en el mundo el segmento que has trazado?')
          : t('Haz clic en los dos extremos de una distancia conocida: la barra de escala del mapa, o dos lugares cuya separación sepas.')}
      </p>
      {segment.to && (
        <>
          <div className="mt-2 flex gap-2">
            <input
              className="input h-8 w-24 text-sm"
              autoFocus
              inputMode="decimal"
              value={distance}
              onChange={(event) => setDistance(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void save(); }}
              data-testid="map-calibration-distance"
            />
            <select className="input h-8 flex-1 text-sm" value={unit} onChange={(event) => setUnit(event.target.value as MapDistanceUnitName)}>
              {MAP_DISTANCE_UNITS.map((entry) => (
                <option key={entry} value={entry}>{t(UNIT_LABEL[entry])}</option>
              ))}
            </select>
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-neutral-600">
            {t('«Unidades» mide en sí misma: sirve para una unidad propia de tu mundo, pero Nodus no podrá convertirla a kilómetros ni calcular con ella tiempos de viaje en otra unidad.')}
          </p>
        </>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button className="btn btn-ghost h-7 px-2 text-xs" onClick={onCancel}>{t('Cancelar')}</button>
        <button className="btn btn-primary h-7 gap-1 px-2 text-xs" disabled={!valid || busy} onClick={() => void save()} data-testid="map-calibration-save">
          <Icon name="check" size={12} /> {t('Guardar escala')}
        </button>
      </div>
    </div>
  );
}

// ── the ruler ───────────────────────────────────────────────────────────────────

/**
 * Distance between two points, and how long it takes to walk it.
 *
 * The travel times are the reason a writer opens this rather than eyeballing the map:
 * "400 leguas" means nothing until it is "veinte días a caballo". `travelDays` returns
 * null when the units cannot be reconciled, and that case is shown as a dash — the
 * impossible-journey report later depends on never having invented a number here.
 */
export function RulerPanel({
  map,
  segment,
  travelModes,
  onClose,
}: {
  map: WorldMap;
  segment: PendingSegment;
  travelModes: MapTravelMode[];
  onClose: () => void;
}) {
  const geometry = useMemo(() => geometryOf(map), [map]);
  const distance = segment.to ? measureDistance(geometry, segment.from, segment.to) : null;
  const unit = map.projection === 'globe' ? map.planetRadiusUnit ?? 'km' : map.scaleUnit;

  return (
    <div className="absolute left-1/2 top-3 z-[600] w-72 -translate-x-1/2 rounded-xl border border-neutral-700 bg-neutral-950/95 p-3 shadow-2xl" data-testid="map-ruler-panel">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('Medir')}</h3>
        <button className="text-neutral-500 hover:text-neutral-200" onClick={onClose} aria-label={t('Cerrar')}>
          <Icon name="x" size={14} />
        </button>
      </div>
      {!segment.to ? (
        <p className="mt-1 text-xs text-neutral-400">{t('Haz clic en el punto de destino.')}</p>
      ) : distance == null ? (
        <p className="mt-1 text-xs text-amber-300" data-testid="map-ruler-uncalibrated">
          {t('Este mapa no tiene escala todavía. Calíbralo y podré decirte distancias y tiempos de viaje.')}
        </p>
      ) : (
        <>
          <p className="mt-1 text-lg font-semibold tabular-nums text-teal-300" data-testid="map-ruler-distance">
            {formatDistance(distance, (unit ?? 'km') as MapDistanceUnit, unitLabel(unit))}
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {travelModes.map((mode) => {
              const days = unit ? travelDays(distance, unit as MapDistanceUnit, { ...mode, unit: mode.unit as MapDistanceUnit }) : null;
              return (
                <li key={mode.modeId} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5 text-neutral-400">
                    {mode.icon && <Icon name={mode.icon} size={12} className="shrink-0" />}
                    <span className="truncate">{mode.name}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-neutral-200">
                    {days == null ? '—' : days < 1 ? tx('{h} h', { h: Math.max(1, Math.round(days * 24)) }) : tx('{d} días', { d: days < 10 ? days.toFixed(1).replace(/\.0$/, '') : Math.round(days) })}
                  </span>
                </li>
              );
            })}
            {travelModes.length === 0 && <li className="text-xs text-neutral-600">{t('Sin modos de viaje definidos.')}</li>}
          </ul>
        </>
      )}
    </div>
  );
}

// ── the scale panel in the sidebar ──────────────────────────────────────────────

export function ScaleSummary({ map, onCalibrate }: { map: WorldMap; onCalibrate: () => void }) {
  const geometry = useMemo(() => geometryOf(map), [map]);
  const perPixel = unitsPerPixel(geometry);
  const across = measureDistance(geometry, { x: 0, y: 0.5 }, { x: 1, y: 0.5 });
  const unit = map.projection === 'globe' ? map.planetRadiusUnit ?? 'km' : map.scaleUnit;

  return (
    <div data-testid="map-scale-summary">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Escala')}</h3>
      {across != null ? (
        <p className="text-xs text-neutral-300">
          {tx('El mapa mide {d} de ancho', { d: formatDistance(across, (unit ?? 'km') as MapDistanceUnit, unitLabel(unit)) })}
        </p>
      ) : (
        <p className="text-xs text-neutral-500">{t('Sin calibrar: no se pueden medir distancias ni tiempos de viaje.')}</p>
      )}
      <button className="btn btn-ghost mt-1.5 h-7 gap-1.5 border border-neutral-700 px-2 text-xs" onClick={onCalibrate} data-testid="map-calibrate">
        <Icon name="ruler" size={12} /> {perPixel != null || across != null ? t('Recalibrar') : t('Calibrar la escala')}
      </button>
    </div>
  );
}

/**
 * The paces of this world. Seeded on first open rather than at vault creation: a writer
 * who never measures anything should not find four rows they did not ask for.
 */
export function TravelModesPanel({ modes, onChanged }: { modes: MapTravelMode[]; onChanged: () => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [pace, setPace] = useState('40');
  const [unit, setUnit] = useState<MapDistanceUnitName>('km');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) nameRef.current?.focus();
  }, [adding]);

  const add = async () => {
    const value = Number(pace.replace(',', '.'));
    if (!name.trim() || !Number.isFinite(value) || value <= 0) return;
    await window.nodus.createTravelMode({ name: name.trim(), distancePerDay: value, unit, sortOrder: modes.length });
    setName('');
    setAdding(false);
    await onChanged();
  };

  return (
    <div data-testid="map-travel-modes">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Modos de viaje')}</h3>
      <ul className="flex flex-col gap-1">
        {modes.map((mode) => (
          <li key={mode.modeId} className="flex items-center gap-1.5 text-xs">
            {mode.icon && <Icon name={mode.icon} size={12} className="shrink-0 text-neutral-500" />}
            <span className="min-w-0 flex-1 truncate text-neutral-300">{mode.name}</span>
            <span className="shrink-0 tabular-nums text-neutral-500">
              {mode.distancePerDay} {t(UNIT_LABEL[mode.unit])}/{t('día')}
            </span>
            <button
              className="shrink-0 text-neutral-600 hover:text-red-400"
              aria-label={t('Eliminar')}
              onClick={() => void window.nodus.deleteTravelMode(mode.modeId).then(onChanged)}
            >
              <Icon name="x" size={11} />
            </button>
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          <input ref={nameRef} className="input h-7 flex-1 text-xs" placeholder={t('Nombre')} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void add(); }} />
          <input className="input h-7 w-14 text-xs" inputMode="decimal" value={pace} onChange={(event) => setPace(event.target.value)} />
          <select className="input h-7 w-20 text-xs" value={unit} onChange={(event) => setUnit(event.target.value as MapDistanceUnitName)}>
            {MAP_DISTANCE_UNITS.map((entry) => <option key={entry} value={entry}>{t(UNIT_LABEL[entry])}</option>)}
          </select>
          <button className="btn btn-primary h-7 px-2 text-xs" onClick={() => void add()}>{t('Añadir')}</button>
        </div>
      ) : (
        <button className="btn btn-ghost mt-1 h-7 gap-1 px-2 text-xs" onClick={() => setAdding(true)}>
          <Icon name="plus" size={11} /> {t('Añadir modo')}
        </button>
      )}
    </div>
  );
}
