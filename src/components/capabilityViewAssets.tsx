import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { ViewNode } from '@shared/capabilities';
import { Icon } from './ui';
import { t } from '../i18n';

/** The result kinds backed by bytes or by a service: a raster, a sound file, a map, a
 *  tiled image.
 *
 *  Each one is read through the core rather than by the page. An image and a sound file
 *  arrive as bytes the host has checked twice — once when the capability handed them
 *  over, once on the way back — and become blob URLs that are released when the result
 *  scrolls away. A map is drawn from GeoJSON that cannot refer to anything outside
 *  itself. A tiled image is the only kind that reaches the network at all, and even then
 *  the page never holds a URL: it asks the host for bytes, and the host decides. */

type Node<K extends ViewNode['kind']> = Extract<ViewNode, { kind: K }>;

/** Bytes as the structured clone delivers them, in a buffer a Blob will accept. */
const toBlob = (bytes: Uint8Array, type: string) => {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type });
};

/** Bytes from the host, as an object URL that lives exactly as long as the element does. */
function useCapabilityMedia(owner: string | undefined, attachmentId: string) {
  const [state, setState] = useState<{ url?: string; failed?: string }>({});

  useEffect(() => {
    if (!owner) return undefined;
    let url: string | undefined;
    let current = true;
    void window.nodus.readCapabilityMedia(`nodus-capability://chat/${owner}/${attachmentId}`)
      .then(asset => {
        if (!current) return;
        url = URL.createObjectURL(toBlob(asset.bytes, asset.mimeType));
        setState({ url });
      })
      .catch(error => { if (current) setState({ failed: error instanceof Error ? error.message : String(error) }); });

    return () => {
      current = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [owner, attachmentId]);

  return state;
}

// ---------------------------------------------------------------- raster

export function ViewImage({ node, owner }: { node: Node<'image'>; owner?: string }) {
  const media = useCapabilityMedia(owner, node.attachmentId);
  return <figure className="capability-view-image">
    {media.url
      ? <img src={media.url} alt={node.alt} width={node.width} height={node.height} loading="lazy" />
      : <p className="capability-view-asset-status" role={media.failed ? 'alert' : 'status'}>
        {media.failed ? t('Esta imagen no se pudo abrir.') : t('Cargando…')}
      </p>}
    <figcaption>{node.title}</figcaption>
  </figure>;
}

// ---------------------------------------------------------------- sound

export function ViewAudio({ node, owner }: { node: Node<'audio'>; owner?: string }) {
  const media = useCapabilityMedia(owner, node.attachmentId);
  return <figure className="capability-view-audio">
    <figcaption><Icon name="volume" size={14} />{node.title}</figcaption>
    {media.url
      // The native element: it seeks, it keys, it respects the system's media controls,
      // and it is the one thing here that does not need a component of our own.
      ? <audio controls preload="metadata" src={media.url} aria-label={node.alt} />
      : <p className="capability-view-asset-status" role={media.failed ? 'alert' : 'status'}>
        {media.failed ? t('Este audio no se pudo abrir.') : t('Cargando…')}
      </p>}
    <span className="capability-view-asset-meta">{node.name}</span>
  </figure>;
}

// ---------------------------------------------------------------- geography

export function ViewMap({ node }: { node: Node<'map'> }) {
  const mount = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = mount.current;
    if (!container) return undefined;
    let map: L.Map | undefined;
    try {
      map = L.map(container, { attributionControl: true, scrollWheelZoom: false });
      // Off by default: a basemap means tile requests to a third party every time this
      // result is looked at, which is the capability's to ask for and not ours to assume.
      if (node.basemap) {
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19, attribution: '© OpenStreetMap',
        }).addTo(map);
      }
      const layer = L.geoJSON(node.geojson as never, {
        style: () => ({ color: '#818cf8', weight: 2, fillOpacity: 0.2 }),
        pointToLayer: (_feature, latlng) => L.circleMarker(latlng, { radius: 5, color: '#818cf8', fillOpacity: 0.8 }),
        onEachFeature: (feature, featureLayer) => {
          const properties = (feature as { properties?: Record<string, unknown> }).properties ?? {};
          const rows = Object.entries(properties).slice(0, 12);
          if (!rows.length) return;
          // Text only, and inserted as text: a property is data a capability supplied.
          const list = document.createElement('dl');
          list.className = 'capability-view-map-properties';
          for (const [key, value] of rows) {
            const term = document.createElement('dt');
            term.textContent = key;
            const detail = document.createElement('dd');
            detail.textContent = value === null || value === undefined ? '—' : String(value);
            list.append(term, detail);
          }
          featureLayer.bindPopup(list);
        },
      }).addTo(map);

      const bounds = layer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 });
      else map.setView([0, 0], 1);
      // Leaflet measures on creation, and this is created inside a message that may still
      // be laying out.
      requestAnimationFrame(() => map?.invalidateSize());
    } catch {
      setFailed(true);
    }
    return () => { map?.remove(); };
  }, [node.geojson, node.basemap]);

  return <figure className="capability-view-map">
    <figcaption>{node.title}</figcaption>
    <div className="capability-view-map-canvas" ref={mount} role="img" aria-label={node.alt} />
    {failed && <p className="capability-view-asset-status" role="alert">{t('Este mapa no se pudo dibujar.')}</p>}
  </figure>;
}

// ---------------------------------------------------------------- tiled imagery

export function ViewImageTiles({ node, capabilityId }: { node: Node<'imageTiles'>; capabilityId?: string }) {
  const mount = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState('');
  const tileSize = node.tileSize ?? 512;
  const levels = useMemo(() => Math.max(1, Math.ceil(Math.log2(Math.max(node.width, node.height) / tileSize)) + 1), [node.width, node.height, tileSize]);

  useEffect(() => {
    const container = mount.current;
    if (!open || !container || !capabilityId) return undefined;
    let map: L.Map | undefined;
    const objectUrls: string[] = [];

    try {
      map = L.map(container, { crs: L.CRS.Simple, attributionControl: false, minZoom: 0, maxZoom: levels - 1 });

      /** A IIIF Image API layer whose tiles come from the host, never from the page.
       *
       *  `createTile` hands the request to the main process, which checks it against the
       *  origins this capability was permitted to reach and returns bytes. The element
       *  never holds a remote URL, so nothing here can be pointed somewhere else. */
      const IiifLayer = L.TileLayer.extend({
        createTile(coords: L.Coords, done: (error?: Error, tile?: HTMLElement) => void) {
          const tile = document.createElement('img');
          tile.alt = '';
          const scale = 2 ** (levels - 1 - coords.z);
          const size = tileSize * scale;
          const x = coords.x * size;
          const y = coords.y * size;
          const width = Math.min(size, node.width - x);
          const height = Math.min(size, node.height - y);
          if (width <= 0 || height <= 0) { done(undefined, tile); return tile; }

          const request = `${x},${y},${width},${height}/${Math.ceil(width / scale)},/0/default.jpg`;
          void window.nodus.fetchCapabilityTile(capabilityId, node.service, request)
            .then(({ bytes, mimeType }) => {
              const url = URL.createObjectURL(toBlob(bytes, mimeType));
              objectUrls.push(url);
              tile.src = url;
              done(undefined, tile);
            })
            .catch(error => done(error instanceof Error ? error : new Error(String(error)), tile));
          return tile;
        },
      });

      // `L.TileLayer.extend` returns a class whose constructor signature the typings
      // cannot know; the arguments are the ones `L.TileLayer` itself takes.
      const layer = new (IiifLayer as unknown as new (url: string, options: L.TileLayerOptions) => L.TileLayer)('', { tileSize, noWrap: true });
      layer.addTo(map);
      const southWest = map.unproject([0, node.height / 2 ** (levels - 1)], levels - 1);
      const northEast = map.unproject([node.width / 2 ** (levels - 1), 0], levels - 1);
      map.fitBounds(L.latLngBounds(southWest, northEast));
      requestAnimationFrame(() => map?.invalidateSize());
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
    }

    return () => {
      map?.remove();
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [open, capabilityId, node.service, node.width, node.height, tileSize, levels]);

  return <figure className="capability-view-tiles">
    <figcaption>
      <span><Icon name="image" size={14} />{node.title}</span>
      <span className="capability-view-asset-meta">{node.width} × {node.height}</span>
    </figcaption>
    {!open
      // Opening fetches tiles, so it is something a reader chooses rather than something
      // that happens because a message scrolled into view.
      ? <button type="button" className="chat-skill-primary" disabled={!capabilityId} onClick={() => setOpen(true)}>
        <Icon name="image" size={15} />{t('Abrir la imagen')}
      </button>
      : <>
        <div className="capability-view-tiles-canvas" ref={mount} role="img" aria-label={node.alt} />
        <div className="capability-view-tiles-controls">
          <button type="button" className="chat-skill-secondary" onClick={() => setOpen(false)}>{t('Cerrar la imagen')}</button>
        </div>
      </>}
    {failed && <p className="capability-view-asset-status" role="alert">{failed}</p>}
  </figure>;
}
