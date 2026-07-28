import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { WorldMap } from '@shared/types';
import { canvasFrame, type CanvasFrame, type NormPoint } from '@shared/worldMapGeometry';
import { t } from '../../i18n';
import { mapImageUrl } from '../../lib/imageUrl';

/**
 * The viewer for an INVENTED map.
 *
 * `L.CRS.Simple`, not the geographic CRS the genealogy map uses: there is no planet under
 * these coordinates and no tile server to ask. The base image is an `imageOverlay` and
 * everything on top is positioned in the same flat space — which is what lets a pin
 * placed on a 6000 px original stay put after the map is regenerated at 4096.
 *
 * ## The coordinate contract
 *
 * Callers speak NORMALIZED 0..1 and nothing else. Internally the map lives in a
 * CANVAS_SPAN×(CANVAS_SPAN·aspect) box so Leaflet has room to zoom, and `toLatLng` /
 * `toNorm` are the only two places that conversion happens. Leaflet's y axis points UP
 * and an image's points DOWN, so y is mirrored in both directions; getting that wrong
 * flips every pin about the equator, which looks like a data problem rather than a
 * projection one.
 */

export type { NormPoint };

export function useMapImageUrl(map: WorldMap | null): string | null {
  return map?.imageId ? mapImageUrl(map.imageId) : null;
}

/**
 * The frame is `canvasFrame` from shared/worldMapGeometry — pure, and unit-tested there,
 * because the y-axis mirror it performs is the single easiest thing in this feature to
 * get backwards and the hardest to notice.
 */
export type MapFrame = CanvasFrame;

export function mapFrame(map: Pick<WorldMap, 'widthPx' | 'heightPx'>): MapFrame {
  return canvasFrame(map.widthPx, map.heightPx);
}

export interface WorldMapCanvasProps {
  map: WorldMap;
  /** Internal protocol URL of the base image; null when there is none. */
  imageUrl: string | null;
  /** Rendered into the map's overlay pane. Receives the live Leaflet map and the frame. */
  children?: (context: { leaflet: L.Map; frame: MapFrame }) => React.ReactNode;
  /** Fires on every left click, in normalized coordinates. */
  onClick?: (point: NormPoint) => void;
  /** Changes the cursor and suppresses the "no image" placeholder while drawing. */
  drawing?: boolean;
  /** Re-fit the view whenever this changes. */
  fitKey?: string;
}

/**
 * The stage. Owns the Leaflet instance and nothing else — every overlay (markers,
 * shapes, routes, the scale bar) is a child that draws through the frame, so this file
 * does not grow a section per feature.
 */
export function WorldMapCanvas({ map, imageUrl, children, onClick, drawing = false, fitKey }: WorldMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<L.ImageOverlay | null>(null);
  const [ready, setReady] = useState(false);
  const frame = useMemo(() => mapFrame(map), [map.widthPx, map.heightPx]);
  // Held in a ref so changing the handler never tears the Leaflet instance down.
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || leafletRef.current) return;
    const instance = L.map(container, {
      crs: L.CRS.Simple,
      minZoom: -4,
      maxZoom: 4,
      zoomControl: true,
      attributionControl: false,
      // The image IS the map: bouncing back to its edges is the right feel, and it stops
      // the author panning into an infinite grey void and thinking the map vanished.
      maxBoundsViscosity: 0.85,
    });
    instance.on('click', (event: L.LeafletMouseEvent) => {
      clickRef.current?.(frame.fromCanvas(event.latlng.lat, event.latlng.lng));
    });
    leafletRef.current = instance;
    setReady(true);
    return () => {
      instance.remove();
      leafletRef.current = null;
      setReady(false);
    };
    // Deliberately mounts ONCE, with no dependencies: tearing down and rebuilding the
    // Leaflet instance would lose the author's pan and zoom on every re-render. The
    // frame is rebound by the effect below instead.
  }, []);

  // Re-bind the click handler whenever the frame changes, so a resized image does not
  // keep converting clicks through the old aspect ratio.
  useEffect(() => {
    const instance = leafletRef.current;
    if (!instance) return;
    const handler = (event: L.LeafletMouseEvent) => clickRef.current?.(frame.fromCanvas(event.latlng.lat, event.latlng.lng));
    instance.off('click');
    instance.on('click', handler);
    return () => {
      instance.off('click', handler);
    };
  }, [frame]);

  /**
   * Fit the map to its image — but ONLY once the container actually has a size.
   *
   * Fitting into a 0×0 box computes an absurdly negative zoom, Leaflet clamps it to
   * `minZoom`, and the map opens as a postage stamp in the middle of an empty stage. It
   * is a race: sometimes the browser has laid the flex child out by the time this effect
   * runs and sometimes it has not, which is exactly the kind of bug that passes review
   * and then only reproduces on someone else's machine. `fittedRef` makes the fit wait
   * for a real box instead of hoping for one.
   */
  const fittedRef = useRef(false);

  useEffect(() => {
    const instance = leafletRef.current;
    if (!instance) return;
    overlayRef.current?.remove();
    overlayRef.current = null;
    if (imageUrl) {
      overlayRef.current = L.imageOverlay(imageUrl, frame.bounds as L.LatLngBoundsLiteral, { className: 'world-map-image' }).addTo(instance);
    }
    instance.setMaxBounds(L.latLngBounds(frame.bounds as L.LatLngBoundsLiteral).pad(0.25));
    instance.invalidateSize({ pan: false });
    fittedRef.current = false;
    fitIfSized();
    // eslint-disable-next-line
  }, [imageUrl, frame, fitKey]);

  function fitIfSized() {
    const container = containerRef.current;
    const instance = leafletRef.current;
    if (!container || !instance || fittedRef.current) return;
    if (container.clientWidth < 2 || container.clientHeight < 2) return;
    instance.invalidateSize({ pan: false });
    instance.fitBounds(frame.bounds as L.LatLngBoundsLiteral, { animate: false });
    fittedRef.current = true;
  }

  // The stage is a flex child; Leaflet has to be told when its box changes or it draws
  // the map into the size it had at mount. This is also what lets a fit that arrived too
  // early get a second chance.
  useEffect(() => {
    const container = containerRef.current;
    const instance = leafletRef.current;
    if (!container || !instance) return;
    const observer = new ResizeObserver(() => {
      instance.invalidateSize({ pan: false });
      fitIfSized();
    });
    observer.observe(container);
    return () => observer.disconnect();
    // eslint-disable-next-line
  }, [ready]);

  return (
    <div className="world-map-stage relative h-full min-h-0 w-full" data-drawing={drawing ? 'true' : 'false'}>
      {/*
        The container's className is CONSTANT, and that is load-bearing.

        Leaflet adds its own classes (`leaflet-container`, `leaflet-touch`, …) to this
        element imperatively. React owns the `class` attribute, so re-rendering with a
        different className string overwrites the whole attribute and WIPES them — and
        with `.leaflet-container` gone, so is Leaflet's `.leaflet-container img {
        max-width: none !important }`. Tailwind's preflight `img { max-width: 100% }` then
        resolves against a zero-width pane and the map image collapses to nothing.

        The map broke the instant the author picked any tool. Anything that varies goes on
        the stage instead (see `[data-drawing]` in index.css).
      */}
      <div ref={containerRef} data-testid="world-map-canvas" className="h-full w-full rounded-xl" />
      {!imageUrl && !drawing && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="world-map-image-pill rounded-lg px-4 py-2 text-sm">
            {t('Este mapa todavía no tiene imagen.')}
          </p>
        </div>
      )}
      {ready && leafletRef.current && children?.({ leaflet: leafletRef.current, frame })}
    </div>
  );
}
