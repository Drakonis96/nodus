import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import type { MapMarker } from '@shared/types';
import type { CanvasFrame, NormPoint } from '@shared/worldMapGeometry';
import {
  nextMilestone,
  positionAt,
  trackMilestones,
  trackRange,
  type CharacterTrack,
} from '@shared/worldPresence';
import { Icon } from '../ui';
import { t, tx } from '../../i18n';

/**
 * The map's own timeline: a playhead over world days, and the characters moving under it.
 *
 * The genealogy map sweeps YEARS and makes pins appear and disappear. This sweeps days
 * and makes characters *travel* — which is the difference between a filter and a story.
 *
 * The playhead is GLOBAL, not per map. That is what lets M5 follow a character from the
 * continent into a city without the timeline resetting, and it is why this component
 * takes the day as a prop rather than owning it.
 */

/** Milliseconds between ticks at ×1. Slow enough to read, fast enough to feel like play. */
const TICK_MS = 420;
export const SPEEDS = [0.5, 1, 2, 5] as const;

export interface TimelineState {
  day: number | null;
  playing: boolean;
  speed: number;
}

/**
 * Drives the playhead: one step per tick, faster with speed, stopping at the end.
 *
 * The step is a fraction of the RANGE, not one world-day: a story spanning eleven days
 * and one spanning three centuries both have to play in about the same time on screen, or
 * the second is unwatchable. 240 steps is roughly a minute and a half at ×1.
 */
export function usePlayhead(
  range: { min: number; max: number } | null,
  state: TimelineState,
  onChange: (next: Partial<TimelineState>) => void,
) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // The interval closes over this, so it always advances from the CURRENT day without
  // having to be torn down and rebuilt on every tick.
  const dayRef = useRef(state.day);
  dayRef.current = state.day;

  // Keep the playhead inside the range as the cast selection changes it. Snapping to the
  // START, not the end: the author pressed play to watch the story happen, and a playhead
  // parked on the last day has nothing left to show.
  useEffect(() => {
    if (!range) {
      if (state.day != null) onChangeRef.current({ day: null, playing: false });
      return;
    }
    if (state.day == null || state.day < range.min || state.day > range.max) {
      onChangeRef.current({ day: range.min });
    }
  }, [range?.min, range?.max, state.day]);

  useEffect(() => {
    if (!state.playing || !range || range.min >= range.max) return;
    const step = Math.max(1, Math.round((range.max - range.min) / 240));
    const id = window.setInterval(() => {
      const current = dayRef.current ?? range.min;
      const next = current + step;
      if (next >= range.max) {
        // Stops at the end rather than looping: a map that silently restarts makes the
        // reader think they missed something.
        onChangeRef.current({ day: range.max, playing: false });
        return;
      }
      onChangeRef.current({ day: next });
    }, TICK_MS / state.speed);
    return () => window.clearInterval(id);
    // Rebuilt when speed changes, which is what makes a speed change take effect at once
    // instead of at the next tick.
  }, [state.playing, state.speed, range?.min, range?.max]);
}

export function TimelineBar({
  tracks,
  day,
  playing,
  speed,
  onDay,
  onPlaying,
  onSpeed,
  formatDay,
}: {
  tracks: CharacterTrack[];
  day: number | null;
  playing: boolean;
  speed: number;
  onDay: (day: number | null) => void;
  onPlaying: (playing: boolean) => void;
  onSpeed: (speed: number) => void;
  /** Turns an absolute day into what the world calls it. */
  formatDay: (day: number) => string;
}) {
  const range = useMemo(() => trackRange(tracks), [tracks]);
  const milestones = useMemo(() => trackMilestones(tracks), [tracks]);

  if (!range) {
    return (
      <div className="flex items-center gap-2 text-xs text-neutral-500" data-testid="map-timeline-empty">
        <Icon name="clock" size={13} />
        {t('Nada fechado todavía: pon fecha a una escena o a un evento y podrás reproducir el paso del tiempo.')}
      </div>
    );
  }

  const current = day ?? range.min;
  const atEnd = current >= range.max;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="map-timeline">
      <button
        className="btn btn-ghost h-8 w-8 border border-neutral-700 p-0"
        title={playing ? t('Pausa') : t('Reproducir')}
        aria-pressed={playing}
        onClick={() => {
          // Pressing play at the end restarts, instead of doing nothing and looking broken.
          if (!playing && atEnd) onDay(range.min);
          onPlaying(!playing);
        }}
        disabled={range.min === range.max}
        data-testid="map-timeline-play"
      >
        <Icon name={playing ? 'pause' : 'play'} size={13} />
      </button>

      <button
        className="btn btn-ghost h-8 w-8 border border-neutral-700 p-0"
        title={t('Suceso anterior')}
        onClick={() => { onPlaying(false); onDay(nextMilestone(milestones, current, -1) ?? range.min); }}
        data-testid="map-timeline-prev"
      >
        <Icon name="chevronLeft" size={13} />
      </button>
      <button
        className="btn btn-ghost h-8 w-8 border border-neutral-700 p-0"
        title={t('Siguiente suceso')}
        onClick={() => { onPlaying(false); onDay(nextMilestone(milestones, current, 1) ?? range.max); }}
        data-testid="map-timeline-next"
      >
        <Icon name="chevronRight" size={13} />
      </button>

      <div className="relative flex min-w-[10rem] flex-1 items-center">
        <input
          type="range"
          className="w-full"
          min={range.min}
          max={range.max}
          value={current}
          onChange={(event) => { onPlaying(false); onDay(Number(event.target.value)); }}
          title={t('Línea temporal')}
          data-testid="map-timeline-slider"
        />
      </div>

      <select
        className="input h-8 w-16 text-xs"
        value={speed}
        onChange={(event) => onSpeed(Number(event.target.value))}
        title={t('Velocidad')}
        data-testid="map-timeline-speed"
      >
        {SPEEDS.map((value) => (
          <option key={value} value={value}>×{value}</option>
        ))}
      </select>

      <span className="w-28 shrink-0 text-right text-xs tabular-nums text-neutral-300" data-testid="map-timeline-day">
        {formatDay(current)}
      </span>
    </div>
  );
}

// ── the cast on the map ─────────────────────────────────────────────────────────

const TRACK_COLORS = ['#f59e0b', '#22d3ee', '#a78bfa', '#f472b6', '#4ade80', '#fb7185', '#60a5fa', '#facc15'];

export function trackColor(index: number): string {
  return TRACK_COLORS[index % TRACK_COLORS.length];
}

export interface PlacedCharacter {
  personId: string;
  personName: string;
  color: string;
  /** Where to draw them on THIS map, normalized. Null when the map cannot show them. */
  point: NormPoint | null;
  placeId: string;
  placeName: string | null;
  towardsPlaceName: string | null;
  travelling: boolean;
  beforeFirst: boolean;
}

/**
 * Where each selected character is, expressed on THIS map.
 *
 * A character whose current place has no marker here gets `point: null` — they are
 * somewhere else, and the cast strip says where. Interpolating them onto the nearest pin
 * would put them in a place they are not.
 */
export function placeCharacters(
  tracks: CharacterTrack[],
  markers: MapMarker[],
  day: number | null,
): PlacedCharacter[] {
  const byPlace = new Map<string, MapMarker>();
  for (const marker of markers) {
    if (marker.placeId && !byPlace.has(marker.placeId)) byPlace.set(marker.placeId, marker);
  }
  return tracks.map((track, index) => {
    const position = positionAt(track.stays, track.journeys, day);
    const color = trackColor(index);
    if (!position) {
      return {
        personId: track.personId, personName: track.personName, color, point: null,
        placeId: '', placeName: null, towardsPlaceName: null, travelling: false, beforeFirst: false,
      };
    }
    const from = byPlace.get(position.placeId);
    const to = position.towardsPlaceId ? byPlace.get(position.towardsPlaceId) : undefined;
    let point: NormPoint | null = from ? { x: from.x, y: from.y } : null;
    // Both ends on this map: draw them ON the road, at the right fraction of it.
    if (from && to && position.progress != null) {
      point = {
        x: from.x + (to.x - from.x) * position.progress,
        y: from.y + (to.y - from.y) * position.progress,
      };
    } else if (!from && to && position.progress != null) {
      // Only the destination is here: they are arriving from off-map. Showing them at the
      // destination early would be a lie, so they wait outside until they get there.
      point = null;
    }
    return {
      personId: track.personId,
      personName: track.personName,
      color,
      point,
      placeId: position.placeId,
      placeName: position.placeName,
      towardsPlaceName: position.towardsPlaceName,
      travelling: position.progress != null,
      beforeFirst: position.beforeFirst,
    };
  });
}

/** The characters, their routes and their travel trails, drawn on the map. */
export function CastLayer({
  leaflet,
  frame,
  cast,
  tracks,
  markers,
  showRoutes,
}: {
  leaflet: L.Map;
  frame: CanvasFrame;
  cast: PlacedCharacter[];
  tracks: CharacterTrack[];
  markers: MapMarker[];
  showRoutes: boolean;
}) {
  useEffect(() => {
    const group = L.layerGroup().addTo(leaflet);
    const byPlace = new Map<string, MapMarker>();
    for (const marker of markers) {
      if (marker.placeId && !byPlace.has(marker.placeId)) byPlace.set(marker.placeId, marker);
    }

    if (showRoutes) {
      tracks.forEach((track, index) => {
        const points = track.stays
          .map((stay) => byPlace.get(stay.placeId))
          .filter((marker): marker is MapMarker => !!marker)
          .map((marker) => frame.toCanvas({ x: marker.x, y: marker.y }));
        if (points.length >= 2) {
          L.polyline(points as L.LatLngExpression[], {
            color: trackColor(index),
            weight: 2,
            opacity: 0.45,
            dashArray: '5 6',
            interactive: false,
          }).addTo(group);
        }
      });
    }

    for (const person of cast) {
      if (!person.point) continue;
      const html = `<span class="world-map-cast-dot" style="--cast:${person.color}"${person.beforeFirst ? ' data-faint="true"' : ''}${person.travelling ? ' data-travelling="true"' : ''}></span><span class="world-map-cast-label">${escapeHtml(person.personName)}</span>`;
      L.marker(frame.toCanvas(person.point) as unknown as L.LatLngExpression, {
        icon: L.divIcon({ className: 'world-map-cast', html, iconSize: [0, 0] }),
        keyboard: false,
        interactive: false,
      }).addTo(group);
    }

    return () => {
      group.remove();
    };
  }, [leaflet, frame, cast, tracks, markers, showRoutes]);

  return null;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── picking the cast ────────────────────────────────────────────────────────────

/**
 * Who to follow. Empty means nobody — NOT everybody.
 *
 * The genealogy map defaults to showing the whole family, which works because a pin is
 * just a dot. Here every selected character is a moving label with a route behind it, and
 * forty of them at once is noise, not a story.
 */
export function CastPicker({
  tracks,
  selected,
  onToggle,
  onClear,
}: {
  tracks: CharacterTrack[];
  selected: Set<string>;
  onToggle: (personId: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const shown = query.trim()
    ? tracks.filter((track) => track.personName.toLowerCase().includes(query.trim().toLowerCase()))
    : tracks;

  const label = selected.size === 0
    ? t('Elegir personajes')
    : selected.size === 1
      ? tracks.find((track) => selected.has(track.personId))?.personName ?? tx('{n} seleccionados', { n: 1 })
      : tx('{n} seleccionados', { n: selected.size });

  return (
    <div className="relative" data-testid="map-cast-picker">
      <button
        className={`btn h-8 gap-1.5 px-2 text-sm ${selected.size > 0 ? 'btn-primary' : 'btn-ghost border border-neutral-700'}`}
        onClick={() => setOpen((value) => !value)}
        disabled={tracks.length === 0}
      >
        <Icon name="users" size={14} /> <span className="max-w-[10rem] truncate">{label}</span>
        <Icon name="chevronDown" size={12} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[40]" onClick={() => setOpen(false)} />
          <div className="absolute z-[50] mt-1 w-60 rounded-md border border-neutral-800 bg-neutral-950 p-2 shadow-xl" data-testid="map-cast-dropdown">
            <input
              className="input mb-1.5 h-8 w-full text-sm"
              placeholder={t('Buscar personaje…')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {selected.size > 0 && (
              <button className="mb-1 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-neutral-300 hover:bg-neutral-800" onClick={onClear}>
                <Icon name="x" size={12} /> {t('Quitar todos')}
              </button>
            )}
            <div className="max-h-56 overflow-y-auto">
              {shown.map((track) => (
                <button
                  key={track.personId}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-neutral-200 hover:bg-neutral-800"
                  onClick={() => onToggle(track.personId)}
                >
                  <span
                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${selected.has(track.personId) ? 'border-transparent' : 'border-neutral-600'}`}
                    style={selected.has(track.personId) ? { backgroundColor: trackColor(tracks.findIndex((entry) => entry.personId === track.personId)) } : undefined}
                  >
                    {selected.has(track.personId) && <Icon name="check" size={10} className="text-neutral-900" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{track.personName}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-neutral-600">{track.stays.length}</span>
                </button>
              ))}
              {shown.length === 0 && <p className="px-2 py-2 text-center text-xs text-neutral-600">{t('Sin coincidencias')}</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── the cast strip (M5) ─────────────────────────────────────────────────────────

export interface CastChip {
  personId: string;
  personName: string;
  color: string;
  /** Where they are right now, in words. */
  where: string;
  /** The map that could show them, when it is not this one. */
  elsewhereMapId: string | null;
  elsewhereMapName: string | null;
  travelling: boolean;
  /** True when no map in the atlas covers where they are. */
  offAtlas: boolean;
}

/**
 * Where everyone is, said in words.
 *
 * This is what makes several selected characters usable: with five people on four maps,
 * following one automatically means losing the other four, so instead nobody is followed
 * and the strip reports each of them with a button to jump. Nothing moves on its own.
 */
export function CastStrip({
  chips,
  onJump,
}: {
  chips: CastChip[];
  onJump: (mapId: string) => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="map-cast-strip">
      {chips.map((chip) => {
        const away = !!chip.elsewhereMapId;
        return (
          <button
            key={chip.personId}
            className={`flex max-w-[15rem] items-center gap-1.5 rounded-full border px-2 py-1 text-left text-xs transition-colors ${
              away ? 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200' : 'border-transparent text-neutral-200'
            }`}
            style={away ? undefined : { backgroundColor: 'rgba(255,255,255,.06)' }}
            disabled={!away}
            title={away ? tx('Ir a {map}', { map: chip.elsewhereMapName ?? '' }) : undefined}
            onClick={() => chip.elsewhereMapId && onJump(chip.elsewhereMapId)}
            data-testid={`map-cast-chip-${chip.personId}`}
            data-away={away ? 'true' : 'false'}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: chip.color }} />
            <span className="truncate font-medium">{chip.personName}</span>
            <span className="truncate text-neutral-500">
              {chip.offAtlas ? t('fuera del atlas') : chip.where}
            </span>
            {away && <Icon name="external" size={11} className="shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}
