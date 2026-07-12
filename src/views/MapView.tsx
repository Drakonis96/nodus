import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HistoricalEvent, Person, Place } from '@shared/types';
import { buildMigrationPath, type MigrationStop } from '@shared/mapProjection';
import { Icon } from '../components/ui';
import { t } from '../i18n';

const W = 1000;
const H = 560;
const PADDING = 0.15; // fraction of span to pad the auto-fit bounds

interface Bounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

function boundsOf(located: Place[]): Bounds {
  if (located.length === 0) return { minLat: -60, maxLat: 75, minLon: -170, maxLon: 175 };
  let minLat = 90;
  let maxLat = -90;
  let minLon = 180;
  let maxLon = -180;
  for (const p of located) {
    minLat = Math.min(minLat, p.latitude!);
    maxLat = Math.max(maxLat, p.latitude!);
    minLon = Math.min(minLon, p.longitude!);
    maxLon = Math.max(maxLon, p.longitude!);
  }
  const latPad = Math.max(0.5, (maxLat - minLat) * PADDING);
  const lonPad = Math.max(0.5, (maxLon - minLon) * PADDING);
  return { minLat: minLat - latPad, maxLat: maxLat + latPad, minLon: minLon - lonPad, maxLon: maxLon + lonPad };
}

function makeProjector(b: Bounds) {
  const lonSpan = Math.max(1e-6, b.maxLon - b.minLon);
  const latSpan = Math.max(1e-6, b.maxLat - b.minLat);
  return (lat: number, lon: number) => ({
    x: ((lon - b.minLon) / lonSpan) * W,
    y: ((b.maxLat - lat) / latSpan) * H,
  });
}

export function MapView() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [personId, setPersonId] = useState('');
  const [events, setEvents] = useState<HistoricalEvent[]>([]);
  const [editing, setEditing] = useState<Place | null>(null);

  const reload = useCallback(async () => {
    setPlaces(await window.nodus.listPlaces());
    setPersons(await window.nodus.listPersons());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (personId) void window.nodus.listEvents({ personId }).then(setEvents);
    else setEvents([]);
  }, [personId]);

  const located = useMemo(() => places.filter((p) => p.latitude != null && p.longitude != null), [places]);
  const bounds = useMemo(() => boundsOf(located), [located]);
  const project = useMemo(() => makeProjector(bounds), [bounds]);
  const placeById = useMemo(() => new Map(places.map((p) => [p.placeId, p])), [places]);

  const route = useMemo(() => {
    if (!personId) return [] as MigrationStop[];
    const stops: MigrationStop[] = [];
    for (const e of events) {
      const place = e.placeId ? placeById.get(e.placeId) : undefined;
      if (place?.latitude != null && place.longitude != null) {
        stops.push({
          placeId: place.placeId,
          placeName: place.name,
          date: e.date,
          sortKey: e.sortKey,
          lat: place.latitude,
          lon: place.longitude,
        });
      }
    }
    return buildMigrationPath(stops);
  }, [personId, events, placeById]);

  const unlocated = places.length - located.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-neutral-800 p-4">
        <Icon name="map" size={20} className="text-indigo-300" />
        <h1 className="text-lg font-semibold">{t('Mapa')}</h1>
        <select
          className="input h-9 max-w-[16rem] text-sm"
          value={personId}
          onChange={(e) => setPersonId(e.target.value)}
          title={t('Trazar la migración de…')}
        >
          <option value="">{t('Sin ruta de migración')}</option>
          {persons.map((p) => (
            <option key={p.personId} value={p.personId}>
              {p.displayName}
            </option>
          ))}
        </select>
        {unlocated > 0 && (
          <span className="ml-auto text-xs text-neutral-500">
            {t('{n} lugares sin coordenadas').replace('{n}', String(unlocated))}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {located.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Icon name="map" size={30} className="text-neutral-600" />
            <p className="max-w-md text-sm text-neutral-500">
              {t('Ningún lugar tiene coordenadas todavía. Añádelas a los lugares para verlos en el mapa; todo funciona sin conexión.')}
            </p>
          </div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border border-neutral-800 bg-neutral-950/60">
            {/* Graticule every ~10° for a geographic frame (no tile server). */}
            {gridLines(bounds, project)}
            {/* Migration route. */}
            {route.length > 1 && (
              <polyline
                points={route.map((s) => { const p = project(s.lat, s.lon); return `${p.x},${p.y}`; }).join(' ')}
                fill="none"
                stroke="#6366f1"
                strokeWidth={2}
                strokeDasharray="6 4"
                markerEnd="url(#arrow)"
              />
            )}
            <defs>
              <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="#6366f1" />
              </marker>
            </defs>
            {/* Places. */}
            {located.map((pl) => {
              const p = project(pl.latitude!, pl.longitude!);
              const onRoute = route.some((s) => s.placeId === pl.placeId);
              return (
                <g key={pl.placeId} transform={`translate(${p.x}, ${p.y})`} style={{ cursor: 'pointer' }} onClick={() => setEditing(pl)}>
                  <circle r={onRoute ? 6 : 4.5} fill={onRoute ? '#818cf8' : '#f59e0b'} stroke="#0a0a0a" strokeWidth={1.5} />
                  <text x={8} y={4} fill="#d4d4d8" fontSize={12}>
                    {pl.name}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {editing && (
        <PlaceCoordsModal
          place={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}
    </div>
  );
}

function gridLines(bounds: Bounds, project: (lat: number, lon: number) => { x: number; y: number }) {
  const lines: JSX.Element[] = [];
  const step = 10;
  const startLon = Math.ceil(bounds.minLon / step) * step;
  for (let lon = startLon; lon <= bounds.maxLon; lon += step) {
    const a = project(bounds.maxLat, lon);
    const b = project(bounds.minLat, lon);
    lines.push(<line key={`lon${lon}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#27272a" strokeWidth={1} />);
  }
  const startLat = Math.ceil(bounds.minLat / step) * step;
  for (let lat = startLat; lat <= bounds.maxLat; lat += step) {
    const a = project(lat, bounds.minLon);
    const b = project(lat, bounds.maxLon);
    lines.push(<line key={`lat${lat}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#27272a" strokeWidth={1} />);
  }
  return lines;
}

function PlaceCoordsModal({ place, onClose, onSaved }: { place: Place; onClose: () => void; onSaved: () => Promise<void> }) {
  const [lat, setLat] = useState(place.latitude != null ? String(place.latitude) : '');
  const [lon, setLon] = useState(place.longitude != null ? String(place.longitude) : '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await window.nodus.updatePlace(place.placeId, {
        latitude: lat.trim() === '' ? null : Number(lat),
        longitude: lon.trim() === '' ? null : Number(lon),
      });
      await onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="card w-full max-w-sm space-y-3 p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold">{place.name}</h2>
        <p className="text-xs text-neutral-500">{t('Coordenadas (grados decimales). Se guardan localmente.')}</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-xs text-neutral-500">{t('Latitud')}</span>
            <input className="input h-9 w-full text-sm" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="37.39" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-neutral-500">{t('Longitud')}</span>
            <input className="input h-9 w-full text-sm" value={lon} onChange={(e) => setLon(e.target.value)} placeholder="-5.99" />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn btn-ghost" onClick={onClose}>
            {t('Cancelar')}
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {t('Guardar')}
          </button>
        </div>
      </div>
    </div>
  );
}
