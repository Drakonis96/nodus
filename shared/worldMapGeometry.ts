/**
 * The geometry of an INVENTED map: normalized coordinates, scale, distance and the
 * transforms that keep pins where the author put them.
 *
 * Nothing here knows about Leaflet, React or SQLite. All of it is unit-tested.
 *
 * Three rules hold the whole design together, and every function below assumes them:
 *
 *   1. **Coordinates are normalized 0..1**, never pixels. The base image WILL change —
 *      regenerated in another style, re-uploaded at higher resolution, extended by an
 *      edge. In pixels, each of those gestures scatters every pin.
 *   2. **Normalized x and y are not the same physical distance** unless the image is
 *      square, so every measurement corrects by the aspect ratio. Forgetting this
 *      produces distances that are quietly wrong on any non-square map — the worst
 *      kind of wrong, because nothing looks broken.
 *   3. **Calibration is stored as two POINTS, not a length.** Two points survive a
 *      regeneration at a different resolution (they are still the same two points of
 *      the drawing) and survive outpainting (they transform with everything else).
 *
 * This is the counterpart of `mapProjection.ts`, which does the same job for REAL
 * places on a real planet. The two never mix: that one starts from lat/lon a gazetteer
 * supplied, this one starts from where the author clicked.
 */

// ── the unit vocabulary ─────────────────────────────────────────────────────────

/**
 * Distance units, with their length in metres. `custom` is the escape hatch for a
 * world with its own unit ("a league of Vael"); it measures in itself, so converting
 * to or from it is refused rather than guessed.
 */
export type MapDistanceUnit = 'km' | 'mi' | 'm' | 'ft' | 'league' | 'custom';

export const MAP_DISTANCE_UNITS: readonly MapDistanceUnit[] = ['km', 'mi', 'm', 'ft', 'league', 'custom'];

/** Metres per unit. A land league is taken as 4 km, the most common fantasy reading. */
const METRES_PER_UNIT: Record<Exclude<MapDistanceUnit, 'custom'>, number> = {
  m: 1,
  km: 1_000,
  ft: 0.3048,
  mi: 1_609.344,
  league: 4_000,
};

export function isMapDistanceUnit(value: unknown): value is MapDistanceUnit {
  return typeof value === 'string' && (MAP_DISTANCE_UNITS as readonly string[]).includes(value);
}

/**
 * Convert between units. Returns null when the conversion is not defined — which only
 * happens with `custom`, whose relation to a metre nobody has told us. A null here is
 * meant to reach the interface as "no puedo convertir", never as a zero.
 */
export function convertDistance(value: number, from: MapDistanceUnit, to: MapDistanceUnit): number | null {
  if (from === to) return value;
  if (from === 'custom' || to === 'custom') return null;
  return (value * METRES_PER_UNIT[from]) / METRES_PER_UNIT[to];
}

// ── the map, as this module needs to see it ─────────────────────────────────────

export interface NormPoint {
  x: number;
  y: number;
}

export type MapProjection = 'flat' | 'globe';

/**
 * The subset of a map's record that geometry cares about. Deliberately a plain shape
 * rather than the full `WorldMap`, so the tests can build one in a line and so a new
 * column on the table does not ripple through here.
 */
export interface MapGeometrySpec {
  widthPx: number;
  heightPx: number;
  projection: MapProjection;
  /** The calibration segment, in normalized coordinates. Null when uncalibrated. */
  scaleFrom: NormPoint | null;
  scaleTo: NormPoint | null;
  /** What that segment measures, in `scaleUnit`. */
  scaleDistance: number | null;
  scaleUnit: MapDistanceUnit | null;
  /** `globe` only: the planet's radius, in `planetRadiusUnit`. */
  planetRadius?: number | null;
  planetRadiusUnit?: MapDistanceUnit | null;
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function clampPoint(point: NormPoint): NormPoint {
  return { x: clamp01(point.x), y: clamp01(point.y) };
}

// ── measuring ───────────────────────────────────────────────────────────────────

/**
 * Distance between two normalized points IN PIXELS of the base image.
 *
 * This is the one place rule 2 lives. Everything else measures through here.
 */
export function pixelDistance(a: NormPoint, b: NormPoint, widthPx: number, heightPx: number): number {
  const dx = (b.x - a.x) * widthPx;
  const dy = (b.y - a.y) * heightPx;
  return Math.hypot(dx, dy);
}

/** True when the map carries a usable calibration. */
export function isCalibrated(map: MapGeometrySpec): boolean {
  if (map.projection === 'globe') return typeof map.planetRadius === 'number' && map.planetRadius > 0;
  if (!map.scaleFrom || !map.scaleTo) return false;
  if (!map.scaleDistance || map.scaleDistance <= 0 || !map.scaleUnit) return false;
  return pixelDistance(map.scaleFrom, map.scaleTo, map.widthPx, map.heightPx) > 0;
}

/**
 * How much world distance one pixel of the base image covers, in the map's own unit.
 * Null when the map is not calibrated — the caller must show "sin escala" rather than
 * invent a number.
 */
export function unitsPerPixel(map: MapGeometrySpec): number | null {
  if (map.projection !== 'flat') return null;
  if (!isCalibrated(map)) return null;
  const px = pixelDistance(map.scaleFrom!, map.scaleTo!, map.widthPx, map.heightPx);
  return map.scaleDistance! / px;
}

/** The unit distances come back in. Null when the map cannot measure. */
export function mapDistanceUnit(map: MapGeometrySpec): MapDistanceUnit | null {
  if (map.projection === 'globe') return map.planetRadiusUnit ?? 'km';
  return isCalibrated(map) ? map.scaleUnit : null;
}

const EARTH_LIKE_RADIUS_KM = 6371;

/**
 * Great-circle distance on an invented planet, for a map read as equirectangular:
 * x ↦ longitude [-180, 180], y ↦ latitude [90, -90].
 *
 * A world map measured flat gives nonsense near the poles — two points a centimetre
 * apart on the paper at 80° of latitude are far closer on the ground than the same
 * centimetre at the equator. This is the whole reason `globe` exists.
 */
function globeDistance(a: NormPoint, b: NormPoint, radius: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const lat = (p: NormPoint) => toRad(90 - p.y * 180);
  const lon = (p: NormPoint) => toRad(p.x * 360 - 180);
  const dLat = lat(b) - lat(a);
  const dLon = lon(b) - lon(a);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat(a)) * Math.cos(lat(b)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Distance between two points of a map, in the map's own unit. Null when the map has
 * no scale.
 */
export function measureDistance(map: MapGeometrySpec, a: NormPoint, b: NormPoint): number | null {
  if (map.projection === 'globe') {
    const radius = map.planetRadius && map.planetRadius > 0 ? map.planetRadius : EARTH_LIKE_RADIUS_KM;
    return globeDistance(a, b, radius);
  }
  const perPixel = unitsPerPixel(map);
  if (perPixel == null) return null;
  return pixelDistance(a, b, map.widthPx, map.heightPx) * perPixel;
}

/** Total length of a polyline, in the map's own unit. Null when there is no scale. */
export function measurePath(map: MapGeometrySpec, points: NormPoint[]): number | null {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const leg = measureDistance(map, points[i - 1], points[i]);
    if (leg == null) return null;
    total += leg;
  }
  return total;
}

/**
 * A circle marker's radius is stored normalized **against the X axis** (one number
 * cannot describe an ellipse). These two convert it to and from world units.
 */
export function radiusToDistance(map: MapGeometrySpec, radius: number): number | null {
  return measureDistance(map, { x: 0, y: 0 }, { x: radius, y: 0 });
}

export function distanceToRadius(map: MapGeometrySpec, distance: number): number | null {
  if (map.projection === 'globe') {
    const radius = map.planetRadius && map.planetRadius > 0 ? map.planetRadius : EARTH_LIKE_RADIUS_KM;
    // Inverse of the equatorial case of `globeDistance`: d = 2πR · (Δx), Δx in turns.
    return distance / (2 * Math.PI * radius);
  }
  const perPixel = unitsPerPixel(map);
  if (perPixel == null || map.widthPx <= 0) return null;
  return distance / perPixel / map.widthPx;
}

// ── travel ──────────────────────────────────────────────────────────────────────

export interface TravelMode {
  modeId: string;
  name: string;
  distancePerDay: number;
  unit: MapDistanceUnit;
}

/**
 * How many days a distance takes at a mode's pace. Null when the two units cannot be
 * reconciled (a `custom` unit on one side and not the other) — again, refused rather
 * than guessed, because a wrong travel time is exactly what the impossible-journey
 * report exists to catch.
 */
export function travelDays(distance: number, unit: MapDistanceUnit, mode: TravelMode): number | null {
  if (mode.distancePerDay <= 0) return null;
  const perDay = convertDistance(mode.distancePerDay, mode.unit, unit);
  if (perDay == null || perDay <= 0) return null;
  return distance / perDay;
}

// ── the parent/child relation ───────────────────────────────────────────────────

/** Where a child map sits inside its parent, in the parent's normalized coordinates. */
export interface MapFootprint {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function normalizeFootprint(footprint: MapFootprint): MapFootprint {
  return {
    x0: clamp01(Math.min(footprint.x0, footprint.x1)),
    y0: clamp01(Math.min(footprint.y0, footprint.y1)),
    x1: clamp01(Math.max(footprint.x0, footprint.x1)),
    y1: clamp01(Math.max(footprint.y0, footprint.y1)),
  };
}

/**
 * Re-express a point of the parent map in the child's coordinates. This is what makes
 * zooming into a region feel like magic: the three cities already pinned on the
 * continent turn up in the right places on the new regional map, untouched by hand.
 *
 * Returns null for a point OUTSIDE the footprint — it does not belong to the child,
 * and clamping it to the edge would silently pile every distant city onto the border.
 */
export function projectIntoChild(point: NormPoint, footprint: MapFootprint): NormPoint | null {
  const box = normalizeFootprint(footprint);
  const width = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  if (width <= 0 || height <= 0) return null;
  if (point.x < box.x0 || point.x > box.x1 || point.y < box.y0 || point.y > box.y1) return null;
  return { x: (point.x - box.x0) / width, y: (point.y - box.y0) / height };
}

/** The inverse: a point of the child expressed in the parent's coordinates. */
export function projectIntoParent(point: NormPoint, footprint: MapFootprint): NormPoint {
  const box = normalizeFootprint(footprint);
  return {
    x: box.x0 + point.x * (box.x1 - box.x0),
    y: box.y0 + point.y * (box.y1 - box.y0),
  };
}

/**
 * The scale a child map inherits from its parent, so a cropped or zoomed map is
 * measurable without the author calibrating anything.
 *
 * Returns the calibration segment to store, not a ratio: it is expressed the same way
 * a hand-drawn one is, so nothing downstream has to know where it came from.
 */
export function inheritScale(
  parent: MapGeometrySpec,
  footprint: MapFootprint,
): { from: NormPoint; to: NormPoint; distance: number; unit: MapDistanceUnit } | null {
  const box = normalizeFootprint(footprint);
  const unit = mapDistanceUnit(parent);
  if (!unit) return null;
  // The width of the footprint, measured on the parent, becomes the full width of the
  // child — so the child's calibration segment spans it from edge to edge.
  const midY = (box.y0 + box.y1) / 2;
  const width = measureDistance(parent, { x: box.x0, y: midY }, { x: box.x1, y: midY });
  if (width == null || width <= 0) return null;
  return { from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 }, distance: width, unit };
}

/**
 * Does the child's own calibration agree with the footprint it occupies in its parent?
 *
 * Cheap to compute and it catches an error that otherwise surfaces months later, in the
 * middle of writing a chase scene: a city map calibrated at 4 km whose footprint on the
 * continent says 40. `ratio` is child ÷ parent, so 10 means the child claims to be ten
 * times bigger than the space it occupies.
 */
export interface ScaleDisagreement {
  childWidth: number;
  parentWidth: number;
  unit: MapDistanceUnit;
  ratio: number;
}

/** Below this the two readings are close enough that saying anything would be noise. */
const SCALE_TOLERANCE = 1.35;

export function checkScaleAgreement(
  child: MapGeometrySpec,
  parent: MapGeometrySpec,
  footprint: MapFootprint,
): ScaleDisagreement | null {
  const inherited = inheritScale(parent, footprint);
  if (!inherited) return null;
  const own = measureDistance(child, { x: 0, y: 0.5 }, { x: 1, y: 0.5 });
  if (own == null || own <= 0) return null;
  const unit = mapDistanceUnit(child);
  if (!unit) return null;
  const parentWidth = convertDistance(inherited.distance, inherited.unit, unit);
  if (parentWidth == null || parentWidth <= 0) return null;
  const ratio = own / parentWidth;
  if (ratio >= 1 / SCALE_TOLERANCE && ratio <= SCALE_TOLERANCE) return null;
  return { childWidth: own, parentWidth, unit, ratio };
}

// ── growing the canvas (outpainting) ────────────────────────────────────────────

/**
 * Where the OLD image lands inside a NEW, larger canvas, in the new canvas's
 * normalized coordinates. Everything the map holds is transformed by this, and
 * `applyCanvasGrowth` is the only correct way to do it.
 */
export interface CanvasGrowth {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type MapEdge = 'north' | 'south' | 'east' | 'west';

/**
 * The growth produced by extending one edge by `fraction` of the current size.
 * Extending north by 0.5 puts the old image in the bottom two thirds.
 */
export function growthForEdge(edge: MapEdge, fraction: number): CanvasGrowth {
  const grow = Math.max(0, fraction);
  if (edge === 'north') return { x0: 0, y0: grow / (1 + grow), x1: 1, y1: 1 };
  if (edge === 'south') return { x0: 0, y0: 0, x1: 1, y1: 1 / (1 + grow) };
  if (edge === 'west') return { x0: grow / (1 + grow), y0: 0, x1: 1, y1: 1 };
  return { x0: 0, y0: 0, x1: 1 / (1 + grow), y1: 1 };
}

/**
 * A point of the old image, re-expressed in the grown canvas.
 *
 * THE most dangerous transform in the whole feature: after it, every coordinate the map
 * holds — pins, polygon vertices, path points, both ends of the calibration segment and
 * the footprint inside its parent — is stale until it has been through here. It must be
 * applied to all of them, in ONE transaction (see `applyCanvasGrowth`).
 */
export function growPoint(point: NormPoint, growth: CanvasGrowth): NormPoint {
  return {
    x: growth.x0 + point.x * (growth.x1 - growth.x0),
    y: growth.y0 + point.y * (growth.y1 - growth.y0),
  };
}

/** Everything on a map that carries coordinates, as the growth transform sees it. */
export interface GrowableMapState {
  markers: {
    markerId: string;
    x: number;
    y: number;
    radius: number | null;
    points: NormPoint[] | null;
  }[];
  scaleFrom: NormPoint | null;
  scaleTo: NormPoint | null;
  footprint: MapFootprint | null;
}

/**
 * Apply a canvas growth to EVERY coordinate of a map, and return the new state.
 *
 * Pure on purpose: the repo writes what this returns inside one transaction, so a
 * failure halfway cannot leave a map whose pins are half-moved — a state the author
 * has no way to repair by hand.
 *
 * The circle radius scales with X alone, matching how it is stored. Note that a growth
 * is NOT required to be uniform in x and y (extending north changes only y), so after
 * an asymmetric growth a circle stays a circle on screen only because the map's aspect
 * ratio changed with it — which is exactly right: the ground it covers did not move.
 */
export function applyCanvasGrowth(state: GrowableMapState, growth: CanvasGrowth): GrowableMapState {
  const scaleX = growth.x1 - growth.x0;
  return {
    markers: state.markers.map((marker) => {
      const moved = growPoint({ x: marker.x, y: marker.y }, growth);
      return {
        markerId: marker.markerId,
        x: moved.x,
        y: moved.y,
        radius: marker.radius == null ? null : marker.radius * scaleX,
        points: marker.points ? marker.points.map((point) => growPoint(point, growth)) : null,
      };
    }),
    scaleFrom: state.scaleFrom ? growPoint(state.scaleFrom, growth) : null,
    scaleTo: state.scaleTo ? growPoint(state.scaleTo, growth) : null,
    footprint: state.footprint,
  };
}

/**
 * The pixel size of the grown canvas. Kept here rather than at the call site because
 * it has to agree exactly with the growth the coordinates were transformed by.
 */
export function grownSize(widthPx: number, heightPx: number, growth: CanvasGrowth): { width: number; height: number } {
  const spanX = growth.x1 - growth.x0;
  const spanY = growth.y1 - growth.y0;
  return {
    width: Math.round(widthPx / (spanX > 0 ? spanX : 1)),
    height: Math.round(heightPx / (spanY > 0 ? spanY : 1)),
  };
}

// ── the viewer's coordinate frame ───────────────────────────────────────────────

/**
 * The height of a map in viewer units. Arbitrary but fixed: Leaflet's `CRS.Simple` needs
 * a coordinate space with room to zoom, and normalized 0..1 would leave every pin within
 * a single unit of every other.
 */
export const CANVAS_SPAN = 1000;

export interface CanvasFrame {
  aspect: number;
  width: number;
  height: number;
  /** Normalized → viewer, as Leaflet wants it: [lat, lng] with lat pointing UP. */
  toCanvas: (point: NormPoint) => [number, number];
  /** Viewer → normalized. */
  fromCanvas: (lat: number, lng: number) => NormPoint;
  bounds: [[number, number], [number, number]];
}

/**
 * The bridge between normalized image coordinates and the viewer's.
 *
 * **Leaflet's y axis points UP and an image's points DOWN**, so y is mirrored in both
 * directions. This is the only place in the app that mirror happens: doing it anywhere
 * else means a pin drawn where the author clicked and read back somewhere else, which
 * looks like a data problem rather than a projection one.
 *
 * A map with no image yet still gets a frame — the stage has to render something, and
 * 16:9 is a reasonable empty canvas.
 */
export function canvasFrame(widthPx: number, heightPx: number): CanvasFrame {
  const aspect = widthPx > 0 && heightPx > 0 ? widthPx / heightPx : 16 / 9;
  const height = CANVAS_SPAN;
  const width = CANVAS_SPAN * aspect;
  return {
    aspect,
    width,
    height,
    toCanvas: (point) => [height - point.y * height, point.x * width],
    fromCanvas: (lat, lng) => ({ x: lng / width, y: (height - lat) / height }),
    bounds: [
      [0, 0],
      [height, width],
    ],
  };
}

// ── the scale bar ───────────────────────────────────────────────────────────────

/** 1, 2 and 5 times a power of ten: the lengths a scale bar is allowed to show. */
const NICE_STEPS = [1, 2, 5];

/**
 * A round distance that fits in roughly `targetPixels` of screen, plus how wide it
 * actually is. This is what makes a scale bar read "50 km" instead of "47,3 km".
 */
export function niceScaleStep(unitsPerScreenPixel: number, targetPixels: number): { distance: number; pixels: number } | null {
  if (!Number.isFinite(unitsPerScreenPixel) || unitsPerScreenPixel <= 0) return null;
  const rough = unitsPerScreenPixel * targetPixels;
  if (!Number.isFinite(rough) || rough <= 0) return null;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  let best = magnitude;
  for (const step of NICE_STEPS) {
    const candidate = step * magnitude;
    if (candidate <= rough) best = candidate;
  }
  return { distance: best, pixels: best / unitsPerScreenPixel };
}

/**
 * Format a distance the way a reader expects: no decimals once it is large, one when
 * it is small, and never the seven digits a float division produces.
 */
export function formatDistance(distance: number, unit: MapDistanceUnit, unitLabel: string): string {
  const abs = Math.abs(distance);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 1 : 2;
  return `${distance.toFixed(digits).replace(/\.0+$/, '')} ${unitLabel}`;
}
