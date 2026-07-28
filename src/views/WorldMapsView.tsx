import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MapDistanceUnitName, MapLayer, MapMarker, MapTravelMode, WorldMap, WorldMapKind, WorldPlace, WorldScene } from '@shared/types';
import { normalizeFootprint, type MapFootprint, type NormPoint } from '@shared/worldMapGeometry';
import { EMPTY_CALENDAR, formatWorldDate, fromWorldDay, hasCalendar, type WorldCalendar } from '@shared/worldCalendar';
import {
  buildTracks,
  ORDER_SCALE,
  positionAt,
  resolveMapFocus,
  shouldAutoFollow,
  trackRange,
  type CharacterTrack,
  type MapFocusCandidate,
} from '@shared/worldPresence';
import { Icon } from '../components/ui';
import { confirm, toast } from '../components/feedback';
import { WorldMapCanvas, useMapImageUrl } from '../components/world/WorldMapCanvas';
import { MarkerLayer, MarkerSheet, VertexEditor } from '../components/world/mapMarkers';
import { GeneratePanel, SuggestMarkersPanel } from '../components/world/mapGenerate';
import { ExportButton, ReportsPanel, SceneLayer } from '../components/world/mapReports';
import {
  CastLayer,
  CastPicker,
  CastStrip,
  trackColor,
  type CastChip,
  TimelineBar,
  placeCharacters,
  usePlayhead,
  type TimelineState,
} from '../components/world/mapTimeline';
import {
  CalibrationPanel,
  MapCompass,
  MapScaleBar,
  RulerPanel,
  ScaleSummary,
  SegmentPreview,
  TravelModesPanel,
  type PendingSegment,
} from '../components/world/mapTools';
import { t, tx } from '../i18n';
import { mapThumbnailUrl } from '../lib/imageUrl';

/**
 * Maps of an invented world.
 *
 * There is more than one map, always: a world, its regions, a city, the inn where the
 * second act happens. They form a TREE (`parentMapId`) that the breadcrumb walks, and a
 * map may also be the map OF a place (`placeId`) — which are two different relations, and
 * conflating them is what makes "as many maps as places" impossible to model.
 *
 * This replaces the genealogy `MapView` for worldbuilding vaults. That one projects
 * lat/lon onto OpenStreetMap tiles, so in an invented world it renders an empty planet
 * every time.
 */

interface MapKindDef {
  id: WorldMapKind;
  label: string;
  icon: string;
}

/** Ordered from the largest thing a map can be to the smallest. */
export const MAP_KINDS: MapKindDef[] = [
  { id: 'world', label: 'Mundo', icon: 'globe' },
  { id: 'continent', label: 'Continente', icon: 'layers' },
  { id: 'region', label: 'Región', icon: 'map' },
  { id: 'city', label: 'Ciudad', icon: 'building' },
  { id: 'town', label: 'Pueblo', icon: 'home' },
  { id: 'building', label: 'Edificio', icon: 'building' },
  { id: 'interior', label: 'Interior', icon: 'grid' },
  { id: 'dungeon', label: 'Mazmorra', icon: 'lock' },
  { id: 'battle', label: 'Batalla', icon: 'flag' },
  { id: 'route', label: 'Ruta', icon: 'route' },
  { id: 'schematic', label: 'Esquema', icon: 'network' },
  { id: 'other', label: 'Otro', icon: 'file' },
];

export function mapKindDef(kind: WorldMapKind): MapKindDef {
  return MAP_KINDS.find((entry) => entry.id === kind) ?? MAP_KINDS[2];
}

export function WorldMapsView() {
  const [maps, setMaps] = useState<WorldMap[]>([]);
  const [places, setPlaces] = useState<WorldPlace[]>([]);
  const [openMapId, setOpenMapId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [nextMaps, nextPlaces] = await Promise.all([window.nodus.listWorldMaps(), window.nodus.listWorldPlaces()]);
    setMaps(nextMaps);
    setPlaces(nextPlaces);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openMap = useMemo(() => maps.find((map) => map.mapId === openMapId) ?? null, [maps, openMapId]);

  if (openMap) {
    return (
      <MapWorkbench
        map={openMap}
        maps={maps}
        places={places}
        onChanged={reload}
        onOpenMap={setOpenMapId}
        onBack={() => setOpenMapId(null)}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="world-maps-view">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-neutral-800 p-4">
        <Icon name="map" size={20} className="text-indigo-300" />
        <h1 className="text-lg font-semibold">{t('Mapas')}</h1>
        <span className="text-xs text-neutral-500">{tx('{n} mapas', { n: maps.length })}</span>
        <button className="btn btn-primary ml-auto gap-1.5" data-testid="world-map-create" onClick={() => setCreating(true)}>
          <Icon name="plus" size={14} /> {t('Nuevo mapa')}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="world-maps-grid">
        {loading ? (
          <p className="p-8 text-center text-sm text-neutral-500">{t('Cargando…')}</p>
        ) : maps.length === 0 ? (
          <EmptyMaps onCreate={() => setCreating(true)} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
            {maps.map((map) => (
              <MapCard key={map.mapId} map={map} maps={maps} onOpen={() => setOpenMapId(map.mapId)} />
            ))}
          </div>
        )}
      </div>

      {creating && (
        <CreateMapModal
          maps={maps}
          places={places}
          onClose={() => setCreating(false)}
          onCreated={async (map) => {
            setCreating(false);
            await reload();
            setOpenMapId(map.mapId);
          }}
        />
      )}
    </div>
  );
}

function EmptyMaps({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center" data-testid="world-maps-empty">
      <Icon name="map" size={32} className="text-neutral-600" />
      <p className="max-w-md text-sm text-neutral-500">
        {t('Todavía no hay mapas en este mundo. Crea uno y sube tu propia imagen, o genérala con IA; después podrás calibrar su escala y clavar en él los lugares que ya has guardado.')}
      </p>
      <button className="btn btn-primary gap-1.5" onClick={onCreate}>
        <Icon name="plus" size={14} /> {t('Nuevo mapa')}
      </button>
    </div>
  );
}

/** Card thumbnails come from `map_images.thumbnail`, never from the full base image. */
function MapCard({ map, maps, onOpen }: { map: WorldMap; maps: WorldMap[]; onOpen: () => void }) {
  const url = mapThumbnailUrl(map);
  const kind = mapKindDef(map.kind);
  const parent = map.parentMapId ? maps.find((entry) => entry.mapId === map.parentMapId) : null;

  return (
    <button
      className="group flex flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/40 text-left transition-colors hover:border-neutral-600"
      data-testid={`world-map-card-${map.mapId}`}
      onClick={onOpen}
    >
      <div className="relative aspect-[4/3] w-full bg-neutral-800/40">
        {url ? (
          <img src={url} alt="" draggable={false} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Icon name={kind.icon} size={28} className="text-neutral-600" />
          </div>
        )}
        <span className="world-map-image-badge absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
          {t(kind.label)}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 p-3">
        <span className="truncate text-sm font-medium text-neutral-100">{map.name}</span>
        <span className="truncate text-xs text-neutral-500">
          {parent ? tx('dentro de {name}', { name: parent.name }) : map.placeName ? tx('mapa de {name}', { name: map.placeName }) : t('Mapa raíz')}
        </span>
      </div>
    </button>
  );
}

/**
 * The workbench: breadcrumb, stage and the map's own panel.
 *
 * The breadcrumb walks `parentMapId`, so the author always knows how deep they are — the
 * "usted está aquí" of an atlas. It is loaded from the main process rather than derived
 * here because the chain has to be loop-safe, and that guard belongs next to the writes.
 */
/**
 * The workbench: breadcrumb, stage, tools and the map's own panel.
 *
 * The breadcrumb walks `parentMapId`, so the author always knows how deep they are — the
 * "usted está aquí" of an atlas. It is loaded from the main process rather than derived
 * here because the chain has to be loop-safe, and that guard belongs next to the writes.
 *
 * The two-click tools (calibrate, measure) share one `segment` state: they ask the same
 * question of the map — "these two points" — and differ only in what they do with the
 * answer.
 */
type MapTool = 'none' | 'calibrate' | 'measure' | 'pin' | 'region';

function MapWorkbench({
  map,
  maps,
  places,
  onChanged,
  onOpenMap,
  onBack,
}: {
  map: WorldMap;
  maps: WorldMap[];
  places: WorldPlace[];
  onChanged: () => Promise<void>;
  onOpenMap: (mapId: string) => void;
  onBack: () => void;
}) {
  const [ancestry, setAncestry] = useState<WorldMap[]>([]);
  const [busy, setBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [tool, setTool] = useState<MapTool>('none');
  const [segment, setSegment] = useState<PendingSegment | null>(null);
  const [travelModes, setTravelModes] = useState<MapTravelMode[]>([]);
  const [markers, setMarkers] = useState<MapMarker[]>([]);
  const [layers, setLayers] = useState<MapLayer[]>([]);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [tracks, setTracks] = useState<CharacterTrack[]>([]);
  const [cast, setCast] = useState<Set<string>>(new Set());
  const [calendar, setCalendar] = useState<WorldCalendar>(EMPTY_CALENDAR);
  const [timeline, setTimeline] = useState<TimelineState>({ day: null, playing: false, speed: 1 });
  const [coverage, setCoverage] = useState<MapFocusCandidate[]>([]);
  const [autoFollow, setAutoFollow] = useState(true);
  const [region, setRegion] = useState<MapFootprint | null>(null);
  const [scenes, setScenes] = useState<WorldScene[]>([]);
  const [showScenes, setShowScenes] = useState(false);
  const imageUrl = useMapImageUrl(map);
  const kind = mapKindDef(map.kind);

  useEffect(() => {
    void window.nodus.mapAncestry(map.mapId).then(setAncestry);
  }, [map.mapId, map.parentMapId, map.name]);

  // Seeded on first use, not at vault creation: a writer who never measures anything
  // should not find four rows they did not ask for.
  const reloadModes = useCallback(async () => {
    setTravelModes(await window.nodus.ensureTravelModes());
  }, []);
  useEffect(() => {
    void reloadModes();
  }, [reloadModes]);

  const reloadMarkers = useCallback(async () => {
    const [nextMarkers, nextLayers] = await Promise.all([
      window.nodus.listMapMarkers(map.mapId),
      window.nodus.listMapLayers(map.mapId),
    ]);
    setMarkers(nextMarkers);
    setLayers(nextLayers);
  }, [map.mapId]);
  useEffect(() => {
    setSelectedMarkerId(null);
    void reloadMarkers();
  }, [reloadMarkers]);

  const selectedMarker = markers.find((entry) => entry.markerId === selectedMarkerId) ?? null;

  // The presences are loaded ONCE and turned into tracks here: scrubbing the playhead is
  // pure arithmetic over what is already in memory, never a round-trip to SQLite.
  useEffect(() => {
    void Promise.all([
      window.nodus.listWorldPresences(),
      window.nodus.getWorldCalendar(),
      window.nodus.mapCoverage(),
      window.nodus.listScenes('chronological'),
    ]).then(([presences, nextCalendar, nextCoverage, nextScenes]) => {
      setTracks(buildTracks(presences));
      setCalendar(nextCalendar);
      setCoverage(nextCoverage);
      setScenes(nextScenes);
    });
  }, [map.mapId]);

  const followed = useMemo(
    () => (cast.size === 0 ? [] : tracks.filter((track) => cast.has(track.personId))),
    [tracks, cast],
  );
  const range = useMemo(() => trackRange(followed), [followed]);
  usePlayhead(range, timeline, (next) => setTimeline((current) => ({ ...current, ...next })));

  const placedCast = useMemo(
    () => placeCharacters(followed, markers, timeline.day),
    [followed, markers, timeline.day],
  );

  const parentOfPlace = useCallback(
    (placeId: string) => places.find((place) => place.placeId === placeId)?.parentId ?? null,
    [places],
  );

  /**
   * Where each followed character is, and on which map — the cast strip's data.
   *
   * Computed for EVERY selected character, not only the followed one, because the whole
   * point of the strip is that with several selected nobody is followed automatically and
   * the reader still needs to know where everyone is.
   */
  const castChips = useMemo<CastChip[]>(
    () =>
      followed.map((track, index) => {
        const position = positionAt(track.stays, track.journeys, timeline.day);
        const color = trackColor(index);
        if (!position) {
          return { personId: track.personId, personName: track.personName, color, where: '', elsewhereMapId: null, elsewhereMapName: null, travelling: false, offAtlas: true };
        }
        const focus = resolveMapFocus(position.placeId, coverage, parentOfPlace, {
          currentMapId: map.mapId,
          at: timeline.day,
        });
        const here = focus?.mapId === map.mapId;
        const target = focus && !here ? maps.find((entry) => entry.mapId === focus.mapId) ?? null : null;
        return {
          personId: track.personId,
          personName: track.personName,
          color,
          where: position.towardsPlaceName
            ? tx('camino de {place}', { place: position.towardsPlaceName })
            : position.placeName ?? '',
          elsewhereMapId: target?.mapId ?? null,
          elsewhereMapName: target?.name ?? null,
          travelling: position.progress != null,
          offAtlas: !focus,
        };
      }),
    [followed, timeline.day, coverage, parentOfPlace, map.mapId, maps],
  );

  /**
   * Follow the ONE selected character across maps.
   *
   * Only with exactly one selected (`shouldAutoFollow`): with five characters on four
   * maps, following one means losing the other four, and the view becomes a slideshow.
   * The jump is deliberately NOT made while the reader is dragging the slider — only
   * while playing or stepping — so scrubbing to look at something does not yank the map
   * out from under them.
   */
  const following = shouldAutoFollow(followed.length, autoFollow);
  useEffect(() => {
    if (!following || !timeline.playing) return;
    const track = followed[0];
    const position = positionAt(track.stays, track.journeys, timeline.day);
    if (!position) return;
    const focus = resolveMapFocus(position.placeId, coverage, parentOfPlace, {
      currentMapId: map.mapId,
      at: timeline.day,
    });
    if (focus && focus.mapId !== map.mapId) onOpenMap(focus.mapId);
  }, [following, timeline.playing, timeline.day, followed, coverage, parentOfPlace, map.mapId, onOpenMap]);

  /**
   * What the world calls this moment. With a calendar it is a real date; without one the
   * key is `year * ORDER_SCALE + order`, so the year is recovered by dividing — the same
   * fallback `TimelineView` uses, said once here instead of branching everywhere.
   */
  const formatDay = useCallback(
    (day: number) => {
      if (hasCalendar(calendar)) {
        const date = fromWorldDay(calendar, day);
        if (date) return formatWorldDate(calendar, date);
      }
      return tx('año {y}', { y: Math.floor(day / ORDER_SCALE) });
    },
    [calendar],
  );

  // Leaving a tool must clear its half-drawn segment, or re-entering starts from a point
  // the author no longer remembers clicking.
  const setToolAndReset = (next: MapTool) => {
    setSegment(null);
    setTool((current) => (current === next ? 'none' : next));
  };

  const toggleCast = (personId: string) =>
    setCast((current) => {
      const next = new Set(current);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });

  const handleClick = (point: NormPoint) => {
    if (tool === 'pin') {
      void window.nodus
        .createMapMarker({ mapId: map.mapId, x: point.x, y: point.y, sortOrder: markers.length })
        .then(async (created) => {
          await reloadMarkers();
          // Selected immediately: the next thing the author wants is to say WHICH place
          // this is, and making them hunt for the pin they just dropped is one click of
          // pure friction.
          setSelectedMarkerId(created.markerId);
        });
      return;
    }
    if (tool === 'region') {
      setSegment((current) => {
        if (current && !current.to) {
          // The second corner closes the box. Normalized so a rectangle dragged
          // right-to-left is still a rectangle.
          setRegion(normalizeFootprint({ x0: current.from.x, y0: current.from.y, x1: point.x, y1: point.y }));
          setTool('none');
          return null;
        }
        return { from: point, to: null };
      });
      return;
    }
    if (tool === 'none') return;
    setSegment((current) => (current && !current.to ? { ...current, to: point } : { from: point, to: null }));
  };

  const saveCalibration = async (distance: number, unit: MapDistanceUnitName) => {
    if (!segment?.to) return;
    await window.nodus.updateWorldMap(map.mapId, {
      scaleX0: segment.from.x,
      scaleY0: segment.from.y,
      scaleX1: segment.to.x,
      scaleY1: segment.to.y,
      scaleDistance: distance,
      scaleUnit: unit,
    });
    setSegment(null);
    setTool('none');
    await onChanged();
  };

  const importImage = async () => {
    setBusy(true);
    try {
      const updated = await window.nodus.importMapImage(map.mapId);
      if (updated) await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const downloadOriginal = async () => {
    if (!imageUrl || downloadBusy) return;
    setDownloadBusy(true);
    try {
      await window.nodus.downloadOriginalImage(imageUrl, map.name);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), { tone: 'error' });
    } finally {
      setDownloadBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: t('¿Eliminar este mapa?'),
      message: t('Se borran su imagen, sus capas y sus chinchetas. Los mapas que cuelgan de él NO se borran: quedan sueltos. Los lugares tampoco se tocan.'),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    await window.nodus.deleteWorldMap(map.mapId);
    await onChanged();
    onBack();
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="world-map-workbench">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-800 p-3">
        <button className="btn btn-ghost h-8 gap-1.5 px-2 text-sm" onClick={onBack} data-testid="world-map-back">
          <Icon name="arrowLeft" size={14} /> {t('Mapas')}
        </button>
        <nav className="flex min-w-0 items-center gap-1 text-sm" data-testid="world-map-breadcrumb">
          {[...ancestry].reverse().map((entry, index, all) => (
            <span key={entry.mapId} className="flex min-w-0 items-center gap-1">
              {index > 0 && <Icon name="chevronRight" size={12} className="shrink-0 text-neutral-600" />}
              {index === all.length - 1 ? (
                <span className="truncate font-medium text-neutral-100">{entry.name}</span>
              ) : (
                <button className="truncate text-neutral-400 hover:text-neutral-100" onClick={() => onOpenMap(entry.mapId)}>
                  {entry.name}
                </button>
              )}
            </span>
          ))}
        </nav>
        <span className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">
          {t(kind.label)}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <CastPicker tracks={tracks} selected={cast} onToggle={toggleCast} onClear={() => setCast(new Set())} />
          {followed.length === 1 && (
            <ToolButton
              icon="compass"
              label={t('Seguir')}
              active={autoFollow}
              onClick={() => setAutoFollow((value) => !value)}
              testId="world-map-follow"
            />
          )}
          <ToolButton icon="mapPin" label={t('Clavar')} active={tool === 'pin'} disabled={!map.imageId} onClick={() => setToolAndReset('pin')} testId="world-map-tool-pin" />
          <ToolButton icon="ruler" label={t('Medir')} active={tool === 'measure'} disabled={!map.imageId} onClick={() => setToolAndReset('measure')} testId="world-map-tool-measure" />
          <button className="btn btn-ghost h-8 gap-1.5 border border-neutral-700 px-2 text-sm" onClick={() => void importImage()} disabled={busy} data-testid="world-map-import-image">
            <Icon name={busy ? 'sync' : 'image'} size={14} className={busy ? 'animate-spin' : ''} />
            {map.imageId ? t('Cambiar imagen') : t('Subir imagen')}
          </button>
          <button
            className="btn btn-ghost grid h-8 w-8 place-items-center border border-neutral-700 p-0"
            onClick={() => void downloadOriginal()}
            disabled={!imageUrl || downloadBusy}
            aria-label={t('Descargar')}
            title={t('Descargar')}
            data-testid="world-map-download-original"
          >
            <Icon name={downloadBusy ? 'sync' : 'download'} size={14} className={downloadBusy ? 'animate-spin' : ''} />
          </button>
          <button className="btn btn-ghost h-8 gap-1.5 px-2 text-sm text-red-300" onClick={() => void remove()} data-testid="world-map-delete">
            <Icon name="trash" size={14} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 flex-1 p-3">
          <WorldMapCanvas map={map} imageUrl={imageUrl} onClick={handleClick} drawing={tool !== 'none'}>
            {({ leaflet, frame }) => (
              <>
                <MarkerLayer
                  leaflet={leaflet}
                  frame={frame}
                  map={map}
                  markers={markers}
                  layers={layers}
                  selectedId={selectedMarkerId}
                  worldDay={timeline.day}
                  onSelect={setSelectedMarkerId}
                  onOpenChild={onOpenMap}
                />
                {selectedMarker && (selectedMarker.geometryKind === 'polygon' || selectedMarker.geometryKind === 'path') && (
                  <VertexEditor
                    leaflet={leaflet}
                    frame={frame}
                    marker={selectedMarker}
                    onCommit={(points) => void window.nodus.updateMapMarker(selectedMarker.markerId, { points }).then(reloadMarkers)}
                  />
                )}
                <CastLayer
                  leaflet={leaflet}
                  frame={frame}
                  cast={placedCast}
                  tracks={followed}
                  markers={markers}
                  showRoutes={followed.length > 0}
                />
                {showScenes && (
                  <SceneLayer
                    leaflet={leaflet}
                    frame={frame}
                    scenes={scenes}
                    markers={markers}
                    onOpenScene={() => { /* the scenes section owns editing; the map only shows where */ }}
                  />
                )}
                <MapScaleBar map={map} leaflet={leaflet} frame={frame} />
                <MapCompass />
                {segment && (
                  <SegmentPreview
                    leaflet={leaflet}
                    frame={frame}
                    segment={segment}
                    color={tool === 'calibrate' ? '#5eead4' : '#fbbf24'}
                  />
                )}
              </>
            )}
          </WorldMapCanvas>
          {tool === 'calibrate' && (
            <CalibrationPanel
              map={map}
              segment={segment ?? { from: { x: 0, y: 0 }, to: null }}
              onCancel={() => setToolAndReset('none')}
              onSave={saveCalibration}
            />
          )}
          {followed.length > 0 && (
            <div className="world-map-timeline-dock absolute inset-x-3 bottom-3 z-[500] flex flex-col gap-2 rounded-xl border px-3 py-2 shadow-2xl" data-testid="map-timeline-dock">
              <CastStrip chips={castChips} onJump={onOpenMap} />
              <TimelineBar
                tracks={followed}
                day={timeline.day}
                playing={timeline.playing}
                speed={timeline.speed}
                onDay={(day) => setTimeline((current) => ({ ...current, day }))}
                onPlaying={(playing) => setTimeline((current) => ({ ...current, playing }))}
                onSpeed={(speed) => setTimeline((current) => ({ ...current, speed }))}
                formatDay={formatDay}
              />
            </div>
          )}
          {tool === 'measure' && (
            <RulerPanel
              map={map}
              segment={segment ?? { from: { x: 0, y: 0 }, to: null }}
              travelModes={travelModes}
              onClose={() => setToolAndReset('none')}
            />
          )}
        </div>
        <MapSidePanel
          map={map}
          maps={maps}
          places={places}
          travelModes={travelModes}
          layers={layers}
          markers={markers}
          selectedMarker={selectedMarker}
          onChanged={onChanged}
          onOpenMap={onOpenMap}
          onReloadModes={reloadModes}
          onReloadMarkers={reloadMarkers}
          onCalibrate={() => setToolAndReset('calibrate')}
          onDeselectMarker={() => setSelectedMarkerId(null)}
          region={region}
          onPickRegion={() => { setRegion(null); setToolAndReset('region'); }}
          onClearRegion={() => { setRegion(null); if (tool === 'region') setTool('none'); }}
          scenes={scenes}
          showScenes={showScenes}
          onToggleScenes={setShowScenes}
          // The reports read the SELECTED cast when there is one, and the whole world
          // otherwise: "elige dos personajes" is a useful prompt, but an author who has
          // selected nobody still wants to know their manuscript has an impossible ride.
          reportTracks={followed.length > 0 ? followed : tracks}
          formatDay={formatDay}
          imageUrl={imageUrl}
        />
      </div>
    </div>
  );
}

function ToolButton({
  icon,
  label,
  active,
  disabled,
  onClick,
  testId,
}: {
  icon: string;
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      className={`btn h-8 gap-1.5 px-2 text-sm ${active ? 'btn-primary' : 'btn-ghost border border-neutral-700'}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-pressed={active}
      data-testid={testId}
    >
      <Icon name={icon} size={14} /> {label}
    </button>
  );
}

function MapSidePanel({
  map,
  maps,
  places,
  travelModes,
  layers,
  markers,
  selectedMarker,
  onChanged,
  onOpenMap,
  onReloadModes,
  onReloadMarkers,
  onCalibrate,
  onDeselectMarker,
  region,
  onPickRegion,
  onClearRegion,
  scenes,
  showScenes,
  onToggleScenes,
  reportTracks,
  formatDay,
  imageUrl,
}: {
  map: WorldMap;
  maps: WorldMap[];
  places: WorldPlace[];
  travelModes: MapTravelMode[];
  layers: MapLayer[];
  markers: MapMarker[];
  selectedMarker: MapMarker | null;
  onChanged: () => Promise<void>;
  onOpenMap: (mapId: string) => void;
  onReloadModes: () => Promise<void>;
  onReloadMarkers: () => Promise<void>;
  onCalibrate: () => void;
  onDeselectMarker: () => void;
  region: MapFootprint | null;
  onPickRegion: () => void;
  onClearRegion: () => void;
  scenes: WorldScene[];
  showScenes: boolean;
  onToggleScenes: (value: boolean) => void;
  reportTracks: CharacterTrack[];
  formatDay: (day: number) => string;
  imageUrl: string | null;
}) {
  const children = maps.filter((entry) => entry.parentMapId === map.mapId);
  const patch = async (next: Parameters<typeof window.nodus.updateWorldMap>[1]) => {
    await window.nodus.updateWorldMap(map.mapId, next);
    await onChanged();
  };

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-neutral-800 p-3" data-testid="world-map-panel">
      <label className="block text-xs text-neutral-500">
        {t('Nombre')}
        <input
          className="input mt-1 w-full text-sm"
          defaultValue={map.name}
          key={`${map.mapId}-name`}
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (value && value !== map.name) void patch({ name: value });
          }}
        />
      </label>

      <label className="block text-xs text-neutral-500">
        {t('Tipo de mapa')}
        <select
          className="input mt-1 w-full text-sm"
          value={map.kind}
          onChange={(event) => void patch({ kind: event.target.value as WorldMapKind })}
        >
          {MAP_KINDS.map((entry) => (
            <option key={entry.id} value={entry.id}>{t(entry.label)}</option>
          ))}
        </select>
      </label>

      <label className="block text-xs text-neutral-500">
        {t('Mapa de')}
        <select
          className="input mt-1 w-full text-sm"
          value={map.placeId ?? ''}
          onChange={(event) => void patch({ placeId: event.target.value || null })}
          data-testid="world-map-place"
        >
          <option value="">{t('— ningún lugar —')}</option>
          {places.map((place) => (
            <option key={place.placeId} value={place.placeId}>{place.name}</option>
          ))}
        </select>
        <span className="mt-1 block text-[11px] leading-snug text-neutral-600">
          {t('Un mapa puede ser el mapa de un lugar concreto. No hace falta: un mapa de rutas cruza cinco reinos y no es de ninguno.')}
        </span>
      </label>

      {map.widthPx > 0 && (
        <div className="text-[11px] text-neutral-600">
          {tx('Imagen de {w}×{h} px', { w: map.widthPx, h: map.heightPx })}
        </div>
      )}

      {region && (
        <p className="rounded-lg border border-amber-700/50 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-snug text-amber-300" data-testid="map-region-chosen">
          {t('Rectángulo marcado. Elige abajo cómo ampliarlo.')}
        </p>
      )}

      <ScaleSummary map={map} onCalibrate={onCalibrate} />
      <TravelModesPanel modes={travelModes} onChanged={onReloadModes} />
      <LayersPanel mapId={map.mapId} layers={layers} markers={markers} onChanged={onReloadMarkers} />

      <ReportsPanel
        map={map}
        markers={markers}
        tracks={reportTracks}
        travelModes={travelModes}
        scenes={scenes}
        showScenes={showScenes}
        onToggleScenes={onToggleScenes}
        formatDay={formatDay}
      />
      <ExportButton map={map} imageUrl={imageUrl} markers={markers} />

      <GeneratePanel
        map={map}
        onChanged={onChanged}
        onOpenMap={onOpenMap}
        pendingRegion={region}
        onPickRegion={onPickRegion}
        onClearRegion={onClearRegion}
      />
      <SuggestMarkersPanel map={map} onChanged={onReloadMarkers} />

      {selectedMarker && (
        <MarkerSheet
          map={map}
          marker={selectedMarker}
          layers={layers}
          places={places}
          maps={maps}
          onChanged={onReloadMarkers}
          onDeselect={onDeselectMarker}
        />
      )}

      {children.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Mapas dentro')}</h3>
          <div className="flex flex-col gap-1">
            {children.map((child) => (
              <button
                key={child.mapId}
                className="flex items-center gap-1.5 rounded px-2 py-1 text-left text-sm text-neutral-300 hover:bg-neutral-800"
                onClick={() => onOpenMap(child.mapId)}
              >
                <Icon name={mapKindDef(child.kind).icon} size={13} className="shrink-0 text-neutral-500" />
                <span className="truncate">{child.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

/**
 * Layers: political borders, physical relief, roads, a battle's turns.
 *
 * Hiding a layer and losing what is on it are very different intentions, so deleting one
 * DETACHES its markers (the FK is ON DELETE SET NULL) and the dialog says so.
 */
function LayersPanel({
  mapId,
  layers,
  markers,
  onChanged,
}: {
  mapId: string;
  layers: MapLayer[];
  markers: MapMarker[];
  onChanged: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const add = async () => {
    if (!name.trim()) return;
    await window.nodus.createMapLayer(mapId, { name: name.trim(), sortOrder: layers.length });
    setName('');
    setAdding(false);
    await onChanged();
  };

  const unassigned = markers.filter((marker) => !marker.layerId).length;

  return (
    <div data-testid="map-layers-panel">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Capas')}</h3>
      <ul className="flex flex-col gap-1">
        {layers.map((layer) => {
          const count = markers.filter((marker) => marker.layerId === layer.layerId).length;
          return (
            <li key={layer.layerId} className="flex items-center gap-1.5 text-xs">
              <button
                className="shrink-0 text-neutral-500 hover:text-neutral-200"
                aria-label={layer.visible ? t('Ocultar') : t('Mostrar')}
                aria-pressed={layer.visible}
                onClick={() => void window.nodus.updateMapLayer(layer.layerId, { visible: !layer.visible }).then(onChanged)}
                data-testid={`map-layer-toggle-${layer.layerId}`}
              >
                <Icon name={layer.visible ? 'eye' : 'eyeOff'} size={12} />
              </button>
              <span className={`min-w-0 flex-1 truncate ${layer.visible ? 'text-neutral-300' : 'text-neutral-600'}`}>{layer.name}</span>
              <span className="shrink-0 tabular-nums text-neutral-600">{count}</span>
              <button
                className="shrink-0 text-neutral-600 hover:text-red-400"
                aria-label={t('Eliminar')}
                onClick={() => void window.nodus.deleteMapLayer(layer.layerId).then(onChanged)}
              >
                <Icon name="x" size={11} />
              </button>
            </li>
          );
        })}
        {layers.length > 0 && unassigned > 0 && (
          <li className="text-[11px] text-neutral-600">{tx('{n} sin capa (siempre visibles)', { n: unassigned })}</li>
        )}
      </ul>
      {adding ? (
        <div className="mt-1.5 flex gap-1">
          <input
            className="input h-7 flex-1 text-xs"
            autoFocus
            placeholder={t('Nombre de la capa')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void add(); }}
          />
          <button className="btn btn-primary h-7 px-2 text-xs" onClick={() => void add()}>{t('Añadir')}</button>
        </div>
      ) : (
        <button className="btn btn-ghost mt-1 h-7 gap-1 px-2 text-xs" onClick={() => setAdding(true)} data-testid="map-layer-add">
          <Icon name="plus" size={11} /> {t('Añadir capa')}
        </button>
      )}
    </div>
  );
}

function CreateMapModal({
  maps,
  places,
  onClose,
  onCreated,
}: {
  maps: WorldMap[];
  places: WorldPlace[];
  onClose: () => void;
  onCreated: (map: WorldMap) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<WorldMapKind>('region');
  const [placeId, setPlaceId] = useState('');
  const [parentMapId, setParentMapId] = useState('');
  const [busy, setBusy] = useState(false);

  // Naming the place is usually naming the map, so it is offered as the default rather
  // than making the author type "Aldermoor" twice.
  const chosenPlace = places.find((place) => place.placeId === placeId);
  const effectiveName = name.trim() || chosenPlace?.name || '';

  const create = async () => {
    if (busy || !effectiveName) return;
    setBusy(true);
    try {
      const map = await window.nodus.createWorldMap({
        name: effectiveName,
        kind,
        placeId: placeId || null,
        parentMapId: parentMapId || null,
      });
      await onCreated(map);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="card-modal w-full max-w-lg p-5"
        role="dialog"
        aria-modal="true"
        aria-label={t('Nuevo mapa')}
        data-testid="world-map-create-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold">{t('Nuevo mapa')}</h2>
        <label className="block text-sm">
          {t('Nombre')}
          <input
            className="input mt-1 w-full"
            autoFocus
            value={name}
            placeholder={chosenPlace?.name ?? t('Nombre del mapa')}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void create(); }}
            data-testid="world-map-create-name"
          />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block text-sm">
            {t('Tipo de mapa')}
            <select className="input mt-1 w-full" value={kind} onChange={(event) => setKind(event.target.value as WorldMapKind)}>
              {MAP_KINDS.map((entry) => (
                <option key={entry.id} value={entry.id}>{t(entry.label)}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            {t('Dentro de')}
            <select className="input mt-1 w-full" value={parentMapId} onChange={(event) => setParentMapId(event.target.value)}>
              <option value="">{t('— mapa raíz —')}</option>
              {maps.map((entry) => (
                <option key={entry.mapId} value={entry.mapId}>{entry.name}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-3 block text-sm">
          {t('Mapa de')}
          <select className="input mt-1 w-full" value={placeId} onChange={(event) => setPlaceId(event.target.value)}>
            <option value="">{t('— ningún lugar —')}</option>
            {places.map((place) => (
              <option key={place.placeId} value={place.placeId}>{place.name}</option>
            ))}
          </select>
        </label>
        <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-neutral-500">
          <Icon name="info" size={14} className="mt-0.5 shrink-0" />
          <span>{t('Al crearlo podrás subir tu propia imagen. Después se calibra la escala y se clavan encima los lugares que ya tengas guardados.')}</span>
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('Cancelar')}</button>
          <button className="btn btn-primary gap-1.5" onClick={() => void create()} disabled={busy || !effectiveName} data-testid="world-map-create-confirm">
            <Icon name={busy ? 'sync' : 'plus'} size={14} className={busy ? 'animate-spin' : ''} /> {t('Crear mapa')}
          </button>
        </div>
      </div>
    </div>
  );
}
