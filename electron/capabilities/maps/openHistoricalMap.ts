import { createHash } from 'node:crypto';
import type { FeatureCollection } from 'geojson';
import { MAP_LIMITS, type MapQuery, type MapSource } from '../../../packages/capability-api/src/maps';
import { OPENHISTORICALMAP_API } from './sources';

/** OpenHistoricalMap, as a *dated* provider.
 *
 *  The data is CC0 and community-mapped: boundary relations carry their own `start_date` and
 *  `end_date`, which is what makes a period selectable at all, and the coverage is uneven —
 *  Spain's 1833–1982 regions exist as polygons while Castilla la Nueva exists only as a label,
 *  and the provinces mostly do not exist. This adapter therefore reports what it drew and what
 *  it could not, instead of completing the map from anywhere else.
 *
 *  It fails closed on everything it cannot account for: an element with an unreviewed licence,
 *  an element with no start date (which cannot be placed in a period), more boundaries than the
 *  frame can carry, and geometry that would exceed the request limits. There is no retry: the
 *  public endpoint rate-limits bursts with an HTML error page, and substituting another source
 *  silently is exactly what a dated map must never do. */

const MAX_RELATIONS = 120;
/** One relation's members are OSM-detail ways: a country's worth of boundaries runs to tens of
 *  megabytes, well past the reviewed response ceiling. The geometry is fetched in batches that
 *  fit it, and a batch that still overflows is halved rather than dropped. */
const GEOMETRY_BATCH = 16;
/** A ceiling on what the adapter hands over: the request's own position limit is 200k, and a
 *  frame this side of that keeps the JSON well inside the 12 MB input ceiling. The renderer
 *  simplifies for the screen on top of it, so this budget is about the request, not the drawing. */
const POINT_BUDGET = 40000;
const OVERPASS_TIMEOUT_SECONDS = 25;
/** Only two reviewed query templates exist; the adapter builds both from validated fields. */
export const openHistoricalMapIndexUrl = (level: 2 | 4, window: readonly [number, number, number, number]): string =>
  `${OPENHISTORICALMAP_API}?data=${encodeURIComponent(`[out:json][timeout:${OVERPASS_TIMEOUT_SECONDS}];relation["boundary"="administrative"]["admin_level"~"^(${level})$"](${window[1]},${window[0]},${window[3]},${window[2]});out tags;`)}`;
export const openHistoricalMapGeometryUrl = (ids: readonly number[]): string =>
  `${OPENHISTORICALMAP_API}?data=${encodeURIComponent(`[out:json][timeout:${OVERPASS_TIMEOUT_SECONDS}];relation(id:${ids.join(',')});out geom;`)}`;

/** The leading year of an OHM date tag, sign included; `null` when there is none to read. */
export const openHistoricalMapYear = (value: unknown): number | null => {
  const match = /^([+-]?)(\d{1,6})/.exec(String(value ?? '').trim());
  return match ? Number(`${match[1]}${match[2]}`) : null;
};
const yearOfPeriod = (date: string): number => Number(/^([+-]?\d{4,6})-/.exec(date)![1]);

/** CC0 or nothing: an element carrying any other licence waits for its own review. */
export function openHistoricalMapLicense(value: unknown, id: number): { license: string; url: string } {
  const tag = String(value ?? '').trim().toLowerCase();
  if (tag === '' || /^cc0(-1\.0)?$/.test(tag) || tag === 'public domain' || tag === 'public_domain') {
    return { license: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' };
  }
  throw new Error(`OpenHistoricalMap element ${id} carries a licence this adapter has not reviewed: ${tag.slice(0, 60)}.`);
}

const keyOf = ([lon, lat]: [number, number]): string => `${lon.toFixed(7)},${lat.toFixed(7)}`;
const ringArea = (ring: Array<[number, number]>): number => Math.abs(ring.reduce((sum, [x, y], index) => {
  const [nx, ny] = ring[(index + 1) % ring.length];
  return sum + (x * ny - nx * y);
}, 0) / 2);
/** Where an element sits, for the frame rule: the mean of its largest ring's vertices. Rough
 *  on purpose — a shape whose centre lands outside the frame is a neighbour the map is not
 *  about, and a shape whose centre lands inside is the subject. */
const centreOf = (ring: Array<[number, number]>): [number, number] =>
  [Number((ring.reduce((sum, [x]) => sum + x, 0) / ring.length).toFixed(4)), Number((ring.reduce((sum, [, y]) => sum + y, 0) / ring.length).toFixed(4))];
const inside = (ring: Array<[number, number]>, point: [number, number]): boolean => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

/** Member ways arrive as unordered fragments in either orientation; each chain grows from
 *  either end until it closes. */
function rings(parts: Array<Array<{ lon: number; lat: number }>>): Array<Array<[number, number]>> {
  const pool = parts.map(geometry => geometry.map(point => [point.lon, point.lat] as [number, number])).filter(points => points.length > 1);
  const closed: Array<Array<[number, number]>> = [];
  while (pool.length) {
    let chain = pool.pop()!, extended = true;
    while (extended && keyOf(chain[0]) !== keyOf(chain.at(-1)!)) {
      extended = false;
      for (let index = 0; index < pool.length; index++) {
        const candidate = pool[index], start = keyOf(chain[0]), end = keyOf(chain.at(-1)!);
        if (keyOf(candidate[0]) === end) chain = chain.concat(candidate.slice(1));
        else if (keyOf(candidate.at(-1)!) === end) chain = chain.concat([...candidate].reverse().slice(1));
        else if (keyOf(candidate.at(-1)!) === start) chain = [...candidate].slice(0, -1).concat(chain);
        else if (keyOf(candidate[0]) === start) chain = [...candidate].reverse().slice(0, -1).concat(chain);
        else continue;
        pool.splice(index, 1); extended = true; break;
      }
    }
    if (keyOf(chain[0]) === keyOf(chain.at(-1)!) && chain.length >= 4) closed.push(chain);
  }
  return closed;
}

/** Douglas-Peucker on a closed ring, keeping the first point as the anchor. Radial decimation
 *  is cheaper and wrong for this: it turns a coastline into long chords, which is how a
 *  province ends up looking like a wedge. */
const thin = (ring: Array<[number, number]>, tolerance: number): Array<[number, number]> => {
  const points = keyOf(ring[0]) === keyOf(ring.at(-1)!) ? ring.slice(0, -1) : ring;
  if (points.length < 4) return ring;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  const distance = ([x, y]: [number, number], [ax, ay]: [number, number], [bx, by]: [number, number]) => {
    const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy);
    return length === 0 ? Math.hypot(x - ax, y - ay) : Math.abs(dy * x - dx * y + bx * ay - by * ax) / length;
  };
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let furthest = -1, furthestDistance = tolerance;
    for (let index = first + 1; index < last; index++) {
      const value = distance(points[index], points[first], points[last]);
      if (value > furthestDistance) { furthest = index; furthestDistance = value; }
    }
    if (furthest > 0) { keep[furthest] = true; stack.push([first, furthest], [furthest, last]); }
  }
  const kept = points.filter((_, index) => keep[index]);
  if (kept.length < 3) return ring;
  kept.push(kept[0]);
  return kept;
};

/** Overpass answers a burst with an HTML error page, and a raw JSON parse error would tell a
 *  reader nothing about what to do. Rate limiting is transient, so one short wait and one repeat
 *  is worth it; nothing else is retried, no other source is substituted, and a second busy answer
 *  is reported as the service being busy rather than hidden. */
async function readOverpass(read: (url: string, limit: number) => Promise<Uint8Array>, url: string, signal: AbortSignal): Promise<{ elements?: unknown[] }> {
  for (let attempt = 1; ; attempt++) {
    const text = Buffer.from(await read(url, MAP_LIMITS.responseBytes)).toString('utf8');
    if (text.trim().startsWith('{')) {
      try { return JSON.parse(text) as { elements?: unknown[] }; }
      catch { throw new Error('OpenHistoricalMap returned a response this adapter cannot read.'); }
    }
    if (attempt >= 2) throw new Error('OpenHistoricalMap is busy or rate-limiting this request; try again in a moment.');
    signal.throwIfAborted();
    await new Promise(resolve => setTimeout(resolve, 3000));
    signal.throwIfAborted();
  }
}

export interface OpenHistoricalMapInput {
  query: MapQuery;
  /** The frame the map is drawn in: the retrieval window, since a boundary index has no country key. */
  window: readonly [number, number, number, number] | undefined;
  signal: AbortSignal;
  read: (url: string, limit: number) => Promise<Uint8Array>;
}

export async function retrieveOpenHistoricalMap(input: OpenHistoricalMapInput): Promise<{ geojson: FeatureCollection; source: MapSource }> {
  const { query, window } = input;
  const level = query.level as 2 | 4, period = query.period!;
  if (!window) throw new Error('OpenHistoricalMap retrieval needs the map frame: give the request bounds, which are also the retrieval window.');
  const from = yearOfPeriod(period.from), to = yearOfPeriod(period.to);

  const index = await readOverpass(input.read, openHistoricalMapIndexUrl(level, window), input.signal);
  if (!Array.isArray(index.elements)) throw new Error('OpenHistoricalMap did not return a boundary index; its response changed.');
  const eligible: number[] = [];
  let undated = 0;
  for (const element of index.elements as Array<{ type?: string; id?: number; tags?: Record<string, unknown> }>) {
    if (element?.type !== 'relation' || typeof element.id !== 'number') continue;
    const tags = element.tags ?? {};
    if (!tags.name) continue;
    openHistoricalMapLicense(tags.license, element.id);
    const start = openHistoricalMapYear(tags.start_date);
    // Undated is not the same as timeless: an element with no start date cannot be placed in a
    // period, and drawing it would mix an unknown era into a dated map.
    if (start === null) { undated++; continue; }
    const end = openHistoricalMapYear(tags.end_date);
    if (start <= from && (end === null || end >= to)) eligible.push(element.id);
  }
  if (!eligible.length) throw new Error(`OpenHistoricalMap has no admin level ${level} boundary covering ${period.from} to ${period.to} inside these bounds: the project has not mapped one there, or the frame is tighter than the division. Supply dated GeoJSON, or draw it as a stated reconstruction.`);
  if (eligible.length > MAX_RELATIONS) throw new Error(`OpenHistoricalMap returned ${eligible.length} boundaries for this frame; narrow the bounds or choose another level (at most ${MAX_RELATIONS}).`);

  const elements: Array<Record<string, unknown>> = [];
  const readBatch = async (ids: number[], depth = 0): Promise<void> => {
    try {
      const payload = await readOverpass(input.read, openHistoricalMapGeometryUrl(ids), input.signal);
      if (!Array.isArray(payload.elements)) throw new Error('OpenHistoricalMap did not return geometry for the selected boundaries.');
      elements.push(...payload.elements as Array<Record<string, unknown>>);
    } catch (error) {
      const oversized = /exceeds its byte limit/.test(String(error instanceof Error ? error.message : error));
      if (!oversized || ids.length === 1 || depth >= 4) {
        if (oversized && ids.length === 1) throw new Error(`OpenHistoricalMap boundary ${ids[0]} is too detailed to retrieve on its own; narrow the bounds or choose another level.`);
        throw error;
      }
      const half = Math.ceil(ids.length / 2);
      await readBatch(ids.slice(0, half), depth + 1);
      await readBatch(ids.slice(half), depth + 1);
    }
  };
  for (let index = 0; index < eligible.length; index += GEOMETRY_BATCH) await readBatch(eligible.slice(index, index + GEOMETRY_BATCH));
  const span = Math.max(Math.abs(window[2] - window[0]), Math.abs(window[3] - window[1]));
  const features: FeatureCollection['features'] = [];
  let duplicates = 0, unclosed = 0, outside = 0;
  const collected: Array<{ id: number; name: string; outers: Array<Array<[number, number]>>; inners: Array<Array<[number, number]>>; thinnedOuters?: Array<Array<[number, number]>>; thinnedInners?: Array<Array<[number, number]>> }> = [];
  for (const relation of elements as Array<{ type?: string; id?: number; tags?: Record<string, unknown>; members?: Array<{ role?: string; geometry?: Array<{ lon: number; lat: number }> }> }>) {
    if (relation?.type !== 'relation' || !eligible.includes(relation.id as number)) continue;
    const members = (relation.members ?? []).filter(member => Array.isArray(member.geometry) && member.geometry.length > 1);
    const outers = rings(members.filter(member => member.role !== 'inner').map(member => member.geometry!));
    const inners = rings(members.filter(member => member.role === 'inner').map(member => member.geometry!));
    if (!outers.length) { unclosed++; continue; }
    // The frame is the subject: a boundary whose centre falls outside it is a neighbour the map
    // is not about, and drawing it would put another country's divisions on this period's map.
    const centre = centreOf(outers.reduce((largest, ring) => ringArea(ring) > ringArea(largest) ? ring : largest));
    if (centre[0] < window[0] || centre[0] > window[2] || centre[1] < window[1] || centre[1] > window[3]) { outside++; continue; }
    collected.push({ id: relation.id as number, name: String(relation.tags?.name).slice(0, 160), outers, inners });
  }
  if (!collected.length) throw new Error('OpenHistoricalMap returned boundaries without closed geometry for this frame.');

  // Thin towards the drawing budget, coarsening until it fits: a dense administrative map
  // loses detail rather than failing, and the tolerance used is reported in the provenance.
  let tolerance = Math.max(span / 4000, 0.0005), points = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    const keep = (ring: Array<[number, number]>) => { const thinned = thin(ring, tolerance); return thinned.length >= 4 ? thinned : ring; };
    points = 0;
    for (const entry of collected) {
      entry.thinnedOuters = entry.outers.map(keep);
      entry.thinnedInners = entry.inners.map(keep);
      points += entry.thinnedOuters.reduce((sum, ring) => sum + ring.length, 0) + entry.thinnedInners.reduce((sum, ring) => sum + ring.length, 0);
    }
    if (points <= POINT_BUDGET) break;
    tolerance *= 2;
  }
  if (points > MAP_LIMITS.positions) throw new Error('OpenHistoricalMap geometry exceeds the map position limit; narrow the bounds or choose another level.');
  for (const entry of collected) {
    const outers = entry.thinnedOuters!, inners = entry.thinnedInners!;
    const holes = inners.map(ring => [ring, outers.find(outer => inside(outer, ring[0]))] as const).filter(([, owner]) => owner);
    features.push({
      type: 'Feature', id: `ohm-${entry.id}`,
      properties: { name: entry.name },
      geometry: outers.length === 1 && !holes.length ? { type: 'Polygon', coordinates: outers }
        : { type: 'MultiPolygon', coordinates: outers.map(outer => [outer, ...holes.filter(([, owner]) => owner === outer).map(([ring]) => ring)]) },
    });
  }

  // One entity, one outline: the project carries more than one relation for the same name over
  // the same window (two "Deutsches Reich", two "Imperium Romanum"), and drawn together they
  // double the boundary and print the label twice. The largest wins.
  // Only polygons and multipolygons are built here, but the GeoJSON type is wider.
  const firstRing = (geometry: FeatureCollection['features'][number]['geometry']): Array<[number, number]> =>
    geometry.type === 'Polygon' ? geometry.coordinates[0] as Array<[number, number]>
      : geometry.type === 'MultiPolygon' ? geometry.coordinates[0][0] as Array<[number, number]> : [];
  const byName = new Map<string, { feature: FeatureCollection['features'][number]; area: number }>();
  for (const feature of features) {
    const name = String(feature.properties!.name);
    const area = ringArea(firstRing(feature.geometry));
    const previous = byName.get(name);
    if (!previous) { byName.set(name, { feature, area }); continue; }
    duplicates++;
    if (area > previous.area) byName.set(name, { feature, area });
  }
  const kept = [...byName.values()].map(entry => entry.feature);
  const geojson = { type: 'FeatureCollection' as const, features: kept };
  if (JSON.stringify(geojson).length > MAP_LIMITS.inputBytes) throw new Error('OpenHistoricalMap geometry exceeds the map input limit; narrow the bounds or choose another level.');

  const retrievedAt = new Date().toISOString();
  const source: Omit<MapSource, 'sha256'> = {
    origin: 'provider', provider: 'openhistoricalmap', label: `OpenHistoricalMap · admin level ${level} · ${kept.length} boundaries`,
    attribution: 'OpenHistoricalMap (openhistoricalmap.org) contributors, CC0', license: 'CC0 1.0 (public domain dedication)',
    url: 'https://www.openhistoricalmap.org/', version: `ADM${level} / retrieved ${retrievedAt}`, retrievedAt, period,
    licenseUrls: ['https://creativecommons.org/publicdomain/zero/1.0/', 'https://www.openhistoricalmap.org/copyright'],
    modifications: [
      `Kept only the boundaries whose own start_date/end_date cover ${period.from} to ${period.to}.`,
      'Community-mapped data with uneven coverage: a region or province this project has not mapped is absent rather than approximated.',
      `Display simplification, minimum point spacing ${tolerance.toFixed(4)} degrees; exported geometry keeps the thinned vertices.`,
      ...(duplicates ? [`${duplicates} duplicate relation(s) for the same entity were collapsed to the largest.`] : []),
      ...(outside ? [`${outside} boundary(ies) lay outside the map frame and were not drawn.`] : []),
      ...(undated ? [`${undated} element(s) without a start date were not drawn: an undated boundary cannot be placed in a period.`] : []),
      ...(unclosed ? [`${unclosed} element(s) had no closed outer ring and were not drawn.`] : []),
    ],
  };
  return { geojson: geojson as FeatureCollection, source: { ...source, sha256: createHash('sha256').update(JSON.stringify(kept)).digest('hex') } };
}
