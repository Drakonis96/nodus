import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { PrimarySourceMapPoint } from '@shared/primarySourcesTypes';
import { t } from '../../i18n';

const ROLE_COLORS: Record<string, string> = {
  provenance: '#4f46e5',
  creation: '#8b5cf6',
  mentioned: '#6366f1',
  event: '#ef4444',
  event_location: '#ef4444',
  route_origin: '#0ea5e9',
  route_destination: '#14b8a6',
  custody: '#f59e0b',
  repository: '#a16207',
  consultation: '#22c55e',
  physical_location: '#64748b',
};

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function PrimarySourcesEvidenceMap({
  points,
  onSelect,
}: {
  points: PrimarySourceMapPoint[];
  onSelect: (pointId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const [light, setLight] = useState(() => document.documentElement.classList.contains('light'));
  const geocoded = useMemo(
    () => points.filter((point): point is PrimarySourceMapPoint & { latitude: number; longitude: number } =>
      point.latitude !== null && point.longitude !== null
    ),
    [points]
  );

  useEffect(() => {
    const observer = new MutationObserver(() =>
      setLight(document.documentElement.classList.contains('light'))
    );
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
      worldCopyJump: true,
      minZoom: 2,
    }).setView([25, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    layersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const resize = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    resize.observe(containerRef.current);
    const timer = window.setTimeout(() => map.invalidateSize({ pan: false }), 80);
    return () => {
      window.clearTimeout(timer);
      resize.disconnect();
      mapRef.current = null;
      layersRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const click = (event: MouseEvent) => {
      const action = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-source-map-point]')
        : null;
      const id = action?.dataset.sourceMapPoint;
      if (id) {
        event.preventDefault();
        onSelect(id);
        return;
      }
      const link = event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>('a[href]')
        : null;
      if (!link) return;
      const href = link.href;
      if (!/^https?:/i.test(href)) return;
      event.preventDefault();
      void window.nodus.openExternal(href).catch(() => undefined);
    };
    container.addEventListener('click', click, true);
    return () => container.removeEventListener('click', click, true);
  }, [onSelect]);

  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!map || !layers) return;
    layers.clearLayers();
    const grouped = new Map<string, typeof geocoded>();
    for (const point of geocoded) {
      const key = `${point.latitude.toFixed(4)}:${point.longitude.toFixed(4)}`;
      (grouped.get(key) ?? grouped.set(key, []).get(key)!).push(point);
    }
    for (const group of grouped.values()) {
      const anchor = group[0];
      const confirmed = group.filter((point) => !point.hypothesis).length;
      const color = ROLE_COLORS[anchor.role] ?? '#6366f1';
      const marker = L.circleMarker([anchor.latitude, anchor.longitude], {
        radius: Math.min(12, 6 + group.length),
        color: light ? '#ffffff' : '#171717',
        weight: 2,
        fillColor: color,
        fillOpacity: anchor.hypothesis ? 0.35 : 0.88,
        dashArray: anchor.hypothesis ? '3 3' : undefined,
      }).addTo(layers);
      marker.on('click', () => onSelect(anchor.pointId));
      marker.bindTooltip(
        `<b>${esc(anchor.normalizedName)}</b><br><span>${group.length} ${esc(t('registros'))} · ${confirmed} ${esc(t('confirmados'))}</span>`,
        { direction: 'top' }
      );
      const rows = group.map((point) => (
        `<button data-source-map-point="${esc(point.pointId)}" style="display:block;width:100%;border:0;background:transparent;text-align:left;padding:5px 2px;cursor:pointer;color:${light ? '#18181b' : '#f4f4f5'}">`
        + `<b>${esc(point.sourceTitle ?? point.originalLabel)}</b><br>`
        + `<span style="font-size:10px;color:${light ? '#71717a' : '#a1a1aa'}">${esc(point.normalizedName)}</span></button>`
      )).join('');
      marker.bindPopup(`<div style="min-width:190px">${rows}</div>`, {
        className: light ? 'pm-popup pm-popup-light' : 'pm-popup pm-popup-dark',
      });
    }

    const routes = new Map<string, typeof geocoded>();
    for (const point of geocoded) {
      if (point.role !== 'route_origin' && point.role !== 'route_destination') continue;
      const source = point.sourceIds[0] ?? point.placeId;
      (routes.get(source) ?? routes.set(source, []).get(source)!).push(point);
    }
    for (const route of routes.values()) {
      const ordered = [...route].sort((a, b) =>
        a.role === b.role ? 0 : a.role === 'route_origin' ? -1 : 1
      );
      if (ordered.length > 1) {
        L.polyline(ordered.map((point) => [point.latitude, point.longitude] as [number, number]), {
          color: '#0ea5e9',
          weight: 3,
          opacity: 0.8,
          dashArray: '7 6',
        }).addTo(layers);
      }
    }
    map.invalidateSize({ pan: false });
    if (geocoded.length === 1) {
      map.setView([geocoded[0].latitude, geocoded[0].longitude], 10, { animate: false });
    } else if (geocoded.length > 1) {
      map.fitBounds(
        L.latLngBounds(geocoded.map((point) => [point.latitude, point.longitude] as [number, number])),
        { padding: [40, 40], maxZoom: 11, animate: false }
      );
    }
  }, [geocoded, light, onSelect]);

  return (
    <div
      data-testid="primary-sources-evidence-map"
      className="relative h-full min-h-[340px] overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800"
    >
      <div ref={containerRef} className={`h-full w-full ${light ? '' : 'pm-dark'}`} />
      {geocoded.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center bg-white/85 p-8 text-center text-sm text-neutral-600 dark:bg-neutral-950/85 dark:text-neutral-300">
          {t('No hay fuentes con un lugar de procedencia georreferenciado para los filtros actuales.')}
        </div>
      )}
    </div>
  );
}
