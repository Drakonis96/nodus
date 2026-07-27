import { useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import type { MapMarker, MapTravelMode, WorldMap, WorldScene } from '@shared/types';
import {
  formatDistance,
  measureDistance,
  travelDays,
  type CanvasFrame,
  type MapDistanceUnit,
} from '@shared/worldMapGeometry';
import {
  findEncounters,
  findImpossibleJourneys,
  type CharacterTrack,
} from '@shared/worldPresence';
import { Icon } from '../ui';
import { geometryOf, unitLabel } from './mapTools';
import { t, tx } from '../../i18n';

/**
 * What the map can tell a writer that nothing else can.
 *
 * All four of these fall out of data the author already wrote — scenes with places and
 * days, a calibrated scale, travel modes — which is the whole reason they are worth
 * building: none of them asks for anything new.
 */

// ── scenes on the map ───────────────────────────────────────────────────────────

/**
 * Every scene that has a place, drawn where it happens.
 *
 * The cheapest thing in M7 and the one a novelist opens daily: filter to an act and see
 * where your story actually is. It takes two seconds to discover that the whole second
 * act happens in one room, or that there is a continent nobody has ever visited.
 */
export function SceneLayer({
  leaflet,
  frame,
  scenes,
  markers,
  onOpenScene,
}: {
  leaflet: L.Map;
  frame: CanvasFrame;
  scenes: WorldScene[];
  markers: MapMarker[];
  onOpenScene: (sceneId: string) => void;
}) {
  const handler = useMemo(() => ({ onOpenScene }), [onOpenScene]);

  useEffect(() => {
    const group = L.layerGroup().addTo(leaflet);
    const byPlace = new Map<string, MapMarker>();
    for (const marker of markers) {
      if (marker.placeId && !byPlace.has(marker.placeId)) byPlace.set(marker.placeId, marker);
    }
    // Several scenes in one place stack into a single badge with a count, rather than
    // piling twelve identical dots on top of each other.
    const counted = new Map<string, { marker: MapMarker; scenes: WorldScene[] }>();
    for (const scene of scenes) {
      if (!scene.placeId) continue;
      const marker = byPlace.get(scene.placeId);
      if (!marker) continue;
      const entry = counted.get(scene.placeId);
      if (entry) entry.scenes.push(scene);
      else counted.set(scene.placeId, { marker, scenes: [scene] });
    }

    for (const { marker, scenes: here } of counted.values()) {
      const badge = L.marker(frame.toCanvas({ x: marker.x, y: marker.y }) as unknown as L.LatLngExpression, {
        icon: L.divIcon({
          className: 'world-map-scene',
          html: `<span class="world-map-scene-badge">${here.length}</span>`,
          iconSize: [0, 0],
        }),
        keyboard: false,
      });
      badge.bindTooltip(
        here.slice(0, 8).map((scene) => escapeHtml(scene.title)).join('<br>') + (here.length > 8 ? '…' : ''),
        { direction: 'top', offset: [0, -10] },
      );
      badge.on('click', (event: L.LeafletMouseEvent) => {
        L.DomEvent.stop(event);
        handler.onOpenScene(here[0].sceneId);
      });
      badge.addTo(group);
    }
    return () => {
      group.remove();
    };
  }, [leaflet, frame, scenes, markers, handler]);

  return null;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── the reports panel ───────────────────────────────────────────────────────────

export function ReportsPanel({
  map,
  markers,
  tracks,
  travelModes,
  scenes,
  showScenes,
  onToggleScenes,
  formatDay,
}: {
  map: WorldMap;
  markers: MapMarker[];
  tracks: CharacterTrack[];
  travelModes: MapTravelMode[];
  scenes: WorldScene[];
  showScenes: boolean;
  onToggleScenes: (value: boolean) => void;
  formatDay: (day: number) => string;
}) {
  const geometry = useMemo(() => geometryOf(map), [map]);
  const unit = (map.projection === 'globe' ? map.planetRadiusUnit ?? 'km' : map.scaleUnit) as MapDistanceUnit | null;

  const pointOf = useMemo(() => {
    const byPlace = new Map<string, MapMarker>();
    for (const marker of markers) {
      if (marker.placeId && !byPlace.has(marker.placeId)) byPlace.set(marker.placeId, marker);
    }
    return byPlace;
  }, [markers]);

  /**
   * The impossible-journey check, wired to THIS map's scale and the world's paces.
   *
   * Both halves refuse rather than guess: a place with no pin here, or a pace whose unit
   * cannot be reconciled with the map's, produces null and the journey is simply not
   * checked. A consistency report that invents numbers is worse than no report.
   */
  const impossible = useMemo(() => {
    if (!unit) return [];
    return findImpossibleJourneys(tracks, {
      unit,
      distanceBetween: (fromPlaceId, toPlaceId) => {
        const from = pointOf.get(fromPlaceId);
        const to = pointOf.get(toPlaceId);
        if (!from || !to) return null;
        return measureDistance(geometry, { x: from.x, y: from.y }, { x: to.x, y: to.y });
      },
      fastest: (distance) => {
        let best: { days: number; modeName: string } | null = null;
        for (const mode of travelModes) {
          const days = travelDays(distance, unit, { ...mode, unit: mode.unit as MapDistanceUnit });
          if (days == null) continue;
          if (!best || days < best.days) best = { days, modeName: mode.name };
        }
        return best;
      },
    });
  }, [tracks, geometry, unit, pointOf, travelModes]);

  const encounters = useMemo(() => findEncounters(tracks).slice(0, 40), [tracks]);
  const placedScenes = useMemo(() => scenes.filter((scene) => scene.placeId && pointOf.has(scene.placeId)).length, [scenes, pointOf]);

  return (
    <div className="flex flex-col gap-3 border-t border-neutral-800 pt-3" data-testid="map-reports-panel">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Lo que cuenta el mapa')}</h3>

      <label className="flex items-center gap-2 text-xs text-neutral-400">
        <input type="checkbox" checked={showScenes} onChange={(event) => onToggleScenes(event.target.checked)} data-testid="map-show-scenes" />
        {tx('Ver dónde ocurren las escenas ({n})', { n: placedScenes })}
      </label>

      {/* Impossible journeys: the flagship, and the reason the scale exists. */}
      <div data-testid="map-impossible-journeys">
        <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-600">{t('Viajes imposibles')}</h4>
        {!unit ? (
          <p className="text-[11px] leading-snug text-neutral-600">{t('Calibra la escala del mapa y podré avisarte de los viajes que no dan tiempo.')}</p>
        ) : impossible.length === 0 ? (
          <p className="text-[11px] text-neutral-600">{t('Ningún viaje imposible entre los personajes elegidos.')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {impossible.slice(0, 12).map((entry) => (
              <li key={`${entry.journey.personId}-${entry.journey.departs}`} className="rounded-lg border border-amber-800/50 bg-amber-500/5 px-2 py-1.5 text-[11px] leading-snug text-amber-200">
                {tx('{who} está en {from} el {d1} y en {to} el {d2}: son {dist}, {days} días {mode}.', {
                  who: entry.journey.personName,
                  from: entry.journey.fromPlaceName ?? '',
                  d1: formatDay(entry.journey.departs),
                  to: entry.journey.toPlaceName ?? '',
                  d2: formatDay(entry.journey.arrives),
                  dist: formatDistance(entry.distance, entry.unit as MapDistanceUnit, unitLabel(entry.unit as MapDistanceUnit)),
                  days: Math.round(entry.needed),
                  mode: entry.modeName.toLowerCase(),
                })}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Encounters: a question that today can only be answered by re-reading. */}
      <div data-testid="map-encounters">
        <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-600">{t('Encuentros posibles')}</h4>
        {tracks.length < 2 ? (
          <p className="text-[11px] leading-snug text-neutral-600">{t('Elige dos o más personajes y te diré cuándo pudieron coincidir.')}</p>
        ) : encounters.length === 0 ? (
          <p className="text-[11px] text-neutral-600">{t('No coinciden en ningún lugar ni momento.')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {encounters.slice(0, 12).map((entry, index) => (
              <li key={`${entry.placeId}-${entry.from}-${index}`} className="text-[11px] leading-snug text-neutral-300">
                <span className="text-neutral-400">{entry.people.map((person) => person.personName).join(' · ')}</span>
                {' — '}
                {entry.from === entry.to
                  ? tx('en {place}, el {day}', { place: entry.placeName ?? '', day: formatDay(entry.from) })
                  : tx('en {place}, del {from} al {to}', { place: entry.placeName ?? '', from: formatDay(entry.from), to: formatDay(entry.to) })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── export ──────────────────────────────────────────────────────────────────────

/**
 * The map as a PNG, with the labels, routes and scale bar burned in.
 *
 * Rendered from the live Leaflet view rather than re-composed from scratch: what the
 * author is looking at IS what they want to send their editor, and a second renderer
 * would drift from the first within a release.
 */
export async function exportMapPng(
  map: WorldMap,
  imageUrl: string,
  markers: MapMarker[],
  options: { labels: boolean; scaleBar: boolean } = { labels: true, scaleBar: true },
): Promise<Blob> {
  const image = await loadImage(imageUrl);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || map.widthPx || 2000;
  canvas.height = image.naturalHeight || map.heightPx || 1000;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No se pudo preparar el lienzo de exportación.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const scale = canvas.width / 1000;
  context.lineJoin = 'round';

  for (const marker of markers) {
    const x = marker.x * canvas.width;
    const y = marker.y * canvas.height;
    if (marker.points && marker.points.length > 1) {
      context.beginPath();
      marker.points.forEach((point, index) => {
        const px = point.x * canvas.width;
        const py = point.y * canvas.height;
        if (index === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      });
      if (marker.geometryKind === 'polygon') context.closePath();
      context.strokeStyle = marker.color ?? '#6366f1';
      context.lineWidth = 2 * scale;
      context.stroke();
    } else if (marker.geometryKind === 'circle' && marker.radius != null) {
      context.beginPath();
      context.arc(x, y, marker.radius * canvas.width, 0, Math.PI * 2);
      context.strokeStyle = marker.color ?? '#6366f1';
      context.lineWidth = 2 * scale;
      context.stroke();
    }

    context.beginPath();
    context.arc(x, y, 5 * scale, 0, Math.PI * 2);
    context.fillStyle = marker.color ?? '#6366f1';
    context.fill();
    context.strokeStyle = '#ffffff';
    context.lineWidth = 1.5 * scale;
    context.stroke();

    const label = marker.label ?? marker.placeName;
    if (options.labels && label) {
      context.font = `${Math.round(15 * scale)}px system-ui, sans-serif`;
      context.textBaseline = 'middle';
      // Stroke then fill: a white halo is what keeps a name readable over both a dark sea
      // and pale parchment without knowing which is underneath.
      context.strokeStyle = 'rgba(255,255,255,.92)';
      context.lineWidth = 4 * scale;
      context.strokeText(label, x + 9 * scale, y);
      context.fillStyle = '#111111';
      context.fillText(label, x + 9 * scale, y);
    }
  }

  if (options.scaleBar) drawScaleBar(context, canvas, map, scale);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No se pudo generar el PNG.'))), 'image/png');
  });
}

function drawScaleBar(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, map: WorldMap, scale: number) {
  const geometry = geometryOf(map);
  const across = measureDistance(geometry, { x: 0, y: 0.5 }, { x: 1, y: 0.5 });
  const unit = (map.projection === 'globe' ? map.planetRadiusUnit ?? 'km' : map.scaleUnit) as MapDistanceUnit | null;
  // No scale, no bar. Drawing one anyway would put a confidently wrong number on a map
  // the author is about to send someone.
  if (across == null || !unit) return;
  const barWidth = canvas.width * 0.2;
  const distance = across * 0.2;
  const x = 24 * scale;
  const y = canvas.height - 34 * scale;
  context.strokeStyle = 'rgba(17,17,17,.9)';
  context.lineWidth = 3 * scale;
  context.beginPath();
  context.moveTo(x, y - 6 * scale);
  context.lineTo(x, y);
  context.lineTo(x + barWidth, y);
  context.lineTo(x + barWidth, y - 6 * scale);
  context.stroke();
  context.font = `${Math.round(14 * scale)}px system-ui, sans-serif`;
  context.textBaseline = 'top';
  context.strokeStyle = 'rgba(255,255,255,.92)';
  context.lineWidth = 4 * scale;
  const text = formatDistance(distance, unit, unitLabel(unit));
  context.strokeText(text, x, y + 4 * scale);
  context.fillStyle = '#111111';
  context.fillText(text, x, y + 4 * scale);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No se pudo cargar la imagen del mapa.'));
    image.src = url;
  });
}

export function ExportButton({
  map,
  imageUrl,
  markers,
}: {
  map: WorldMap;
  imageUrl: string | null;
  markers: MapMarker[];
}) {
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!imageUrl || busy) return;
    setBusy(true);
    try {
      const blob = await exportMapPng(map, imageUrl, markers);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${map.name.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'mapa'}.png`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      className="btn btn-ghost h-7 w-full justify-start gap-1.5 border border-neutral-700 px-2 text-xs"
      onClick={() => void save()}
      disabled={!imageUrl || busy}
      data-testid="map-export-png"
    >
      <Icon name={busy ? 'sync' : 'download'} size={12} className={busy ? 'animate-spin' : ''} />
      {t('Exportar a PNG con etiquetas')}
    </button>
  );
}
