import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapPlacePoint, Person } from '@shared/types';
import { useIsLightTheme } from '../hooks';
import { t, tx } from '../i18n';
import manPortrait from '../assets/man-portrait.webp';
import womanPortrait from '../assets/woman-portrait.webp';

// A REAL, precise map: OpenStreetMap raster tiles (free, no key, © OpenStreetMap
// contributors) via Leaflet, with pinpoint place markers (portrait + who/where),
// per-person migration routes, and popups listing everyone at a place with their
// dates. Place coordinates come from the offline gazetteer (GeoNames), so pins land
// on the actual town. Dark mode applies a CSS filter to the tiles (see index.css).

const ROUTE_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ec4899', '#06b6d4', '#8b5cf6', '#ef4444', '#22c55e'];

interface PlaceGroup {
  placeId: string;
  placeName: string;
  admin1: string | null;
  country: string | null;
  lat: number;
  lon: number;
  entries: MapPlacePoint[];
}

function lifeDates(p: { birthDate: string | null; deathDate: string | null }): string {
  const b = p.birthDate?.trim();
  const d = p.deathDate?.trim();
  if (b && d) return `${b} – ${d}`;
  if (b) return `n. ${b}`;
  if (d) return `†︎ ${d}`;
  return '';
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Small circular portrait as an HTML string (for Leaflet marker/popup DOM). */
function portraitHtml(person: Person | undefined, url: string | undefined, size: number, personId?: string): string {
  const box = `width:${size}px;height:${size}px`;
  const interaction = personId
    ? ` data-person-id="${esc(personId)}" role="button" tabindex="0" title="${esc(t('Abrir ficha'))}"`
    : '';
  const pointer = personId ? 'cursor:pointer;' : '';
  if (person?.portrait && url) {
    const f = person.portrait;
    return `<span${interaction} style="${box};${pointer}display:inline-block;overflow:hidden;border-radius:9999px;background:#0a0a0a;box-shadow:0 0 0 1px rgba(0,0,0,.5)"><img src="${url}" style="width:100%;height:100%;object-fit:cover;object-position:${f.focusX * 100}% ${f.focusY * 100}%;transform:scale(${f.scale})"/></span>`;
  }
  const sil = person?.sex === 'female' ? womanPortrait : person?.sex === 'male' ? manPortrait : null;
  if (sil) {
    return `<span${interaction} style="${box};${pointer}display:inline-block;overflow:hidden;border-radius:9999px;background:#27272a;box-shadow:0 0 0 1px rgba(0,0,0,.5)"><img src="${sil}" style="width:100%;height:100%;object-fit:cover;object-position:50% 20%"/></span>`;
  }
  return `<span${interaction} style="${box};${pointer}display:inline-block;border-radius:9999px;background:#3f3f46;box-shadow:0 0 0 1px rgba(0,0,0,.5)"></span>`;
}

export function PlacesMap({
  points,
  showRoutes = true,
  height,
  fitPoints,
  onPersonClick,
}: {
  points: MapPlacePoint[];
  showRoutes?: boolean;
  /** Fixed pixel height; defaults to filling the parent (min-h-0 flex child). */
  height?: number;
  /** Points used to frame the view; defaults to `points`. Pass the person-filtered
   *  (not year-filtered) set so the chronological slider doesn't re-zoom the map. */
  fitPoints?: MapPlacePoint[];
  /** Opens the shared genealogy dossier from a marker portrait, label or popup row. */
  onPersonClick?: (personId: string) => void;
}) {
  const light = useIsLightTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const lastFitRef = useRef<string>('');
  const [personsById, setPersonsById] = useState<Map<string, Person>>(new Map());
  const [portraitUrls, setPortraitUrls] = useState<Map<string, string>>(new Map());

  // Leaflet renders its attribution as native anchors. Intercept them before
  // the library can navigate the Electron webContents and delegate the URL to
  // the same safe system-browser bridge used by the rest of Nodus.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleExternalLink = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!link) return;
      event.preventDefault();
      event.stopPropagation();
      void window.nodus.openExternal(link.href).catch(() => undefined);
    };
    container.addEventListener('click', handleExternalLink, true);
    return () => container.removeEventListener('click', handleExternalLink, true);
  }, []);

  // Leaflet creates markers and popups outside React's tree. Delegate their
  // person actions from the stable map container so regenerated layers keep the
  // same mouse and keyboard behaviour.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onPersonClick) return;
    const openFromTarget = (target: EventTarget | null) => {
      const personTarget = target instanceof Element ? target.closest<HTMLElement>('[data-person-id]') : null;
      const personId = personTarget?.dataset.personId;
      if (!personId) return false;
      onPersonClick(personId);
      return true;
    };
    const handleClick = (event: MouseEvent) => {
      if (openFromTarget(event.target)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.key === 'Enter' || event.key === ' ') && openFromTarget(event.target)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    // Capture before Leaflet's marker handler: a person click opens the dossier
    // directly and must not also start popup auto-pan behind the modal.
    container.addEventListener('click', handleClick, true);
    container.addEventListener('keydown', handleKeyDown, true);
    return () => {
      container.removeEventListener('click', handleClick, true);
      container.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [onPersonClick]);

  // Persons (portrait focus + sex) for the marker thumbnails.
  useEffect(() => {
    let cancelled = false;
    void window.nodus.listPersons().then((list) => {
      if (!cancelled) setPersonsById(new Map(list.map((p) => [p.personId, p])));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch real-photo blobs once per person that has one; keep object URLs.
  useEffect(() => {
    const need = new Set(points.filter((p) => p.hasPortrait).map((p) => p.personId));
    let cancelled = false;
    const created: string[] = [];
    void (async () => {
      const map = new Map<string, string>();
      for (const id of need) {
        const blob = await window.nodus.getPersonPortrait(id).catch(() => null);
        if (!blob) continue;
        const url = URL.createObjectURL(new Blob([new Uint8Array(blob.blob)], { type: blob.mime }));
        created.push(url);
        map.set(id, url);
      }
      if (!cancelled) setPortraitUrls(map);
      else created.forEach((u) => URL.revokeObjectURL(u));
    })();
    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [points]);

  // Create the Leaflet map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true, worldCopyJump: true, minZoom: 2 });
    map.setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    layersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const ro = new ResizeObserver(() => {
      if (mapRef.current === map) map.invalidateSize();
    });
    ro.observe(containerRef.current);
    // A tick after mount the flex container has its real size.
    const initialInvalidateTimer = window.setTimeout(() => {
      if (mapRef.current === map) map.invalidateSize();
    }, 60);
    return () => {
      window.clearTimeout(initialInvalidateTimer);
      ro.disconnect();
      mapRef.current = null;
      layersRef.current = null;
      map.stop();
      map.remove();
    };
  }, []);

  const groups = useMemo(() => {
    const byPlace = new Map<string, PlaceGroup>();
    for (const p of points) {
      let g = byPlace.get(p.placeId);
      if (!g) {
        g = { placeId: p.placeId, placeName: p.placeName, admin1: p.admin1, country: p.country, lat: p.latitude, lon: p.longitude, entries: [] };
        byPlace.set(p.placeId, g);
      }
      g.entries.push(p);
    }
    return [...byPlace.values()];
  }, [points]);

  // Rebuild markers + routes whenever the data (or the portraits/persons) change.
  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!map || !layers) return;
    layers.clearLayers();

    if (showRoutes) {
      const byPerson = new Map<string, MapPlacePoint[]>();
      for (const p of points) (byPerson.get(p.personId) ?? byPerson.set(p.personId, []).get(p.personId)!).push(p);
      let ci = 0;
      for (const [, list] of byPerson) {
        const ordered = [...list].sort((a, b) => {
          if (a.sortKey && b.sortKey) return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
          if (a.sortKey) return -1;
          if (b.sortKey) return 1;
          return 0;
        });
        const latlngs: [number, number][] = [];
        let last = '';
        for (const s of ordered) {
          if (s.placeId === last) continue;
          last = s.placeId;
          latlngs.push([s.latitude, s.longitude]);
        }
        if (latlngs.length > 1) {
          L.polyline(latlngs, { color: ROUTE_COLORS[ci % ROUTE_COLORS.length], weight: 3, opacity: 0.85, dashArray: '7 6' }).addTo(layers);
        }
        ci++;
        if (ci > 80) break;
      }
    }

    for (const g of groups) {
      const seen = new Set<string>();
      const persons = g.entries.filter((e) => (seen.has(e.personId) ? false : (seen.add(e.personId), true)));
      const single = persons.length === 1 ? persons[0] : null;
      const chipBg = light ? 'background:#ffffff;border-color:#d4d4d8' : 'background:#18181b;border-color:#3f3f46';
      const nameColor = light ? '#18181b' : '#f4f4f5';
      const subColor = light ? '#71717a' : '#a1a1aa';
      const cluster = persons.slice(0, 3).map((e) => portraitHtml(personsById.get(e.personId), portraitUrls.get(e.personId), 22, e.personId)).join('');
      const textHtml = single
        ? `<span data-person-id="${esc(single.personId)}" role="button" tabindex="0" title="${esc(t('Abrir ficha'))}" style="display:block;cursor:pointer"><b style="color:${nameColor};font-size:11px;line-height:1.15;display:block;white-space:nowrap">${esc(single.personName)}</b><span style="color:${subColor};font-size:9px;line-height:1.1;display:block;white-space:nowrap">${esc(lifeDates(single) || g.placeName)}</span></span>`
        : `<b style="color:${nameColor};font-size:11px;line-height:1.15;display:block;white-space:nowrap">${esc(g.placeName)}</b><span style="color:${subColor};font-size:9px;line-height:1.1;display:block">${esc(tx('{n} personas', { n: persons.length }))}</span>`;
      const chip = `<div style="position:absolute;left:0;bottom:0;transform:translate(-50%,-14px);display:flex;align-items:center;gap:5px;border:1px solid;${chipBg};border-radius:9999px;padding:2px 8px 2px 2px;box-shadow:0 2px 6px rgba(0,0,0,.35);white-space:nowrap"><span style="display:flex;margin-right:2px">${cluster.replace(/margin-left/g, '')}</span>${textHtml}</div>`;

      L.circleMarker([g.lat, g.lon], { radius: 5, color: light ? '#ffffff' : '#0a0a0a', weight: 2, fillColor: '#f59e0b', fillOpacity: 1 }).addTo(layers);
      const marker = L.marker([g.lat, g.lon], {
        icon: L.divIcon({ className: 'pm-marker', html: chip, iconSize: [0, 0], iconAnchor: [0, 0] }),
        keyboard: false,
      }).addTo(layers);

      const rows = persons
        .slice(0, 10)
        .map((e) => {
          const dates = [lifeDates(e), e.date && `· ${e.date}`].filter(Boolean).join(' ');
          return `<div data-person-id="${esc(e.personId)}" role="button" tabindex="0" title="${esc(t('Abrir ficha'))}" style="display:flex;align-items:center;gap:6px;padding:4px 2px;border-radius:6px;cursor:pointer">${portraitHtml(personsById.get(e.personId), portraitUrls.get(e.personId), 24)}<span><span style="display:block;font-size:12px;color:${nameColor}">${esc(e.personName)}</span><span style="display:block;font-size:10px;color:${subColor}">${esc(dates)}</span></span></div>`;
        })
        .join('');
      const popup = `<div style="min-width:150px"><div style="font-weight:600;font-size:12px;color:${nameColor};margin-bottom:4px">${esc(g.placeName)}${g.admin1 ? `<span style="color:${subColor};font-weight:400"> · ${esc(g.admin1)}</span>` : ''}</div>${rows}${persons.length > 10 ? `<div style="font-size:10px;color:${subColor}">${esc(tx('+{n} más', { n: persons.length - 10 }))}</div>` : ''}</div>`;
      marker.bindPopup(popup, { closeButton: true, className: light ? 'pm-popup pm-popup-light' : 'pm-popup pm-popup-dark' });
    }
  }, [groups, points, personsById, portraitUrls, showRoutes, light]);

  // Frame the view to the (person-filtered) points — but only when that set changes,
  // so the chronological slider never re-zooms mid-play.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const fitSet = fitPoints ?? points;
    const sig = [...new Set(fitSet.map((p) => `${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}`))].sort().join('|');
    if (!sig || sig === lastFitRef.current) return;
    lastFitRef.current = sig;
    const latlngs = fitSet.map((p) => [p.latitude, p.longitude] as [number, number]);
    if (latlngs.length === 1) {
      map.setView(latlngs[0], 11, { animate: false });
    } else if (latlngs.length > 1) {
      map.fitBounds(L.latLngBounds(latlngs), { padding: [50, 50], maxZoom: 13, animate: false });
    }
    const fitInvalidateTimer = window.setTimeout(() => {
      if (mapRef.current === map) map.invalidateSize();
    }, 50);
    return () => window.clearTimeout(fitInvalidateTimer);
  }, [fitPoints, points]);

  const hasPoints = points.length > 0;

  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-neutral-800" style={height ? { height } : { flex: 1, minHeight: 0 }} data-testid="places-map">
      <div ref={containerRef} className={`h-full w-full ${light ? '' : 'pm-dark'}`} style={{ minHeight: height ?? 240 }} />
      {!hasPoints && (
        <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center bg-neutral-950/60 p-6 text-center">
          <p className="max-w-sm text-sm text-neutral-300">
            {t('Ningún lugar localizado todavía. Añade lugares a las personas (con su municipio, estado y país) para verlos en el mapa.')}
          </p>
        </div>
      )}
    </div>
  );
}
