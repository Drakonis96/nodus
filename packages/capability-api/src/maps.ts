import { exactKeys, plainText } from './json';
import type { FeatureCollection, Feature, Geometry, Position } from 'geojson';

/** No fetch URLs, paths, credentials or executable styles. Source links are inert attribution. */
export const MAP_LIMITS = { calls: 8, retrievals: 4, layers: 4, features: 5000, positions: 200000, inputBytes: 12000000, responseBytes: 16000000, svgChars: 300000, markers: 200, routes: 100, timeoutMs: 30000 } as const;
export const MAP_PROVIDERS = ['natural-earth', 'geoboundaries'] as const;
export type MapProviderId = typeof MAP_PROVIDERS[number];
export type MapProjection = 'equal-earth' | 'mercator' | 'equirectangular';
export interface MapQuery { provider: MapProviderId; country?: string; level?: number; period?: { from: string; to: string } }
export interface MapSourceInput { label: string; attribution: string; license: string; url?: string; period?: { from: string; to: string } }
export interface MapSource extends MapSourceInput { origin: 'provider' | 'caller'; provider?: MapProviderId; version?: string; retrievedAt?: string; licenseUrls?: string[]; sha256: string; modifications: string[] }
export interface MapDataset { datasetId: string; geojson: FeatureCollection; source: MapSource }
export interface MapLayer {
  query?: MapQuery;
  datasetId?: string;
  data?: { geojson: FeatureCollection; source: MapSourceInput };
  /** Exact matches only; an unmatched selection is an error, never an invented polygon. */
  select?: { property: string; values: Array<string | number> };
  fill?: string;
  colors?: { property: string; values: Array<{ value: string | number; color: string }> };
  labelProperty?: string;
}
export interface MapMarker { coordinates: [number, number]; label?: string; color?: string; radius?: number }
export interface MapRoute { coordinates: [number, number][]; kind?: 'straight' | 'curved' | 'great-circle'; arrow?: boolean; color?: string; width?: number; label?: string }
export interface MapRenderRequest {
  title: string; alt: string; width?: number; height?: number; projection?: MapProjection; detail?: 'standard' | 'full';
  centralMeridian?: number; bounds?: [number, number, number, number];
  layers?: MapLayer[]; markers?: MapMarker[]; routes?: MapRoute[];
  /** Provenance of coordinates/route overlays, mandatory when overlays are present. */
  overlaySource?: MapSourceInput;
  legend?: Array<{ label: string; color: string }>;
}
export interface MapResult { schemaVersion: 1; capabilityId: 'nodus:maps'; svg: string; geometry: FeatureCollection[]; overlays: {markers: MapMarker[]; routes: MapRoute[]}; provenance: { sources: MapSource[]; projection: MapProjection; centralMeridian: number; bounds?: number[]; coordinates: 'WGS84 longitude, latitude'; routes: 'cartographic connections, not navigation directions' } }

function object(value: any, keys: string[], label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !exactKeys(value, keys)) throw new Error(`Invalid map ${label}.`);
}
function text(value: unknown, max: number, label: string): void { if (!plainText(value, max)) throw new Error(`Invalid map ${label}.`); }
function number(value: unknown, min: number, max: number, label: string): void { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid map ${label}.`); }
function list(value: unknown, max: number, label: string): asserts value is any[] { if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid map ${label}.`); }
export function validateMapPosition(value: unknown): asserts value is [number, number] {
  if (!Array.isArray(value) || value.length !== 2) throw new Error('Map coordinates must be [longitude, latitude].');
  number(value[0], -180, 180, 'longitude'); number(value[1], -90, 90, 'latitude');
}
function color(value: unknown): void { if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Map colors must be six-digit hexadecimal values.'); }
function period(value: any): void {
  object(value, ['from','to'], 'period');
  const date = (d: unknown) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0,10) === d;
  if (!date(value.from) || !date(value.to) || value.from > value.to) throw new Error('Invalid map period.');
}
export function validateMapSource(value: any): MapSourceInput {
  object(value, ['label','attribution','license','url','period'], 'source');
  text(value.label, 160, 'source label'); text(value.attribution, 500, 'attribution'); text(value.license, 200, 'license');
  if (value.url !== undefined) { text(value.url,1500,'source URL'); const url = new URL(value.url); if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid source URL.'); }
  if (value.period !== undefined) period(value.period);
  return structuredClone(value);
}
export function validateMapQuery(value: any): MapQuery {
  object(value, ['provider','country','level','period'], 'source query');
  if (!MAP_PROVIDERS.includes(value.provider)) throw new Error('Map provider is not approved.');
  if (value.period !== undefined) period(value.period);
  if (value.provider === 'natural-earth') { if (value.country !== undefined || value.level !== undefined) throw new Error('Natural Earth supplies the world countries layer; select features after retrieval.'); }
  else if (typeof value.country !== 'string' || !/^[A-Z]{3}$/.test(value.country) || value.country === 'ALL' || !Number.isInteger(value.level) || value.level < 0 || value.level > 2) throw new Error('Administrative retrieval requires one ISO alpha-3 country and level 0, 1 or 2.');
  return structuredClone(value);
}
export function validateMapGeometry(input: unknown): FeatureCollection {
  if (JSON.stringify(input).length > MAP_LIMITS.inputBytes) throw new Error('Map geometry exceeds the input limit.');
  let positions = 0, geometries = 0;
  const position = (v: any): void => { validateMapPosition(v); if (++positions > MAP_LIMITS.positions) throw new Error('Map position limit exceeded.'); };
  const line = (v: any, ring = false): void => {
    list(v, MAP_LIMITS.positions, 'line'); if (v.length < (ring ? 4 : 2)) throw new Error('Map line has too few positions.'); v.forEach(position);
    if (ring) {
      if (v[0][0] !== v.at(-1)[0] || v[0][1] !== v.at(-1)[1]) throw new Error('Polygon rings must be closed.');
      if (new Set(v.map((p: Position) => p.join(','))).size < 3) throw new Error('Degenerate polygon ring.');
    }
  };
  const polygon = (v: any): void => { list(v, 1000, 'polygon'); if (!v.length) throw new Error('Empty polygon.'); v.forEach((r: any) => line(r, true)); };
  const geometry = (v: any, depth = 0): void => {
    if (++geometries > MAP_LIMITS.features * 10 || depth > 8) throw new Error('Map geometry nesting limit exceeded.');
    object(v, ['type','coordinates','geometries'], 'geometry');
    if (v.type === 'GeometryCollection') { list(v.geometries, MAP_LIMITS.features, 'geometry collection'); if (!v.geometries.length || v.coordinates !== undefined) throw new Error('Invalid geometry collection.'); v.geometries.forEach((g: any) => geometry(g, depth + 1)); return; }
    if (v.geometries !== undefined) throw new Error('Invalid geometry fields.');
    switch (v.type) {
      case 'Point': position(v.coordinates); break;
      case 'MultiPoint': list(v.coordinates, MAP_LIMITS.positions, 'multipoint'); if (!v.coordinates.length) throw new Error('Empty multipoint.'); v.coordinates.forEach(position); break;
      case 'LineString': line(v.coordinates); break;
      case 'MultiLineString': list(v.coordinates, MAP_LIMITS.features, 'multiline'); if (!v.coordinates.length) throw new Error('Empty multiline.'); v.coordinates.forEach((l: any) => line(l)); break;
      case 'Polygon': polygon(v.coordinates); break;
      case 'MultiPolygon': list(v.coordinates, MAP_LIMITS.features, 'multipolygon'); if (!v.coordinates.length) throw new Error('Empty multipolygon.'); v.coordinates.forEach(polygon); break;
      default: throw new Error('Unsupported map geometry type.');
    }
  };
  const fc = input as FeatureCollection;
  object(fc, ['type','features'], 'FeatureCollection'); if (fc.type !== 'FeatureCollection') throw new Error('Expected a GeoJSON FeatureCollection.');
  list(fc.features, MAP_LIMITS.features, 'features'); if (!fc.features.length) throw new Error('Empty map geometry.');
  const ids = new Set<string>();
  for (const f of fc.features) {
    object(f, ['type','id','geometry','properties'], 'feature'); if (f.type !== 'Feature') throw new Error('Invalid GeoJSON feature.');
    if (f.id !== undefined) { if (!(typeof f.id === 'string' ? plainText(f.id,160) : typeof f.id === 'number' && Number.isFinite(f.id)) || ids.has(String(f.id))) throw new Error('Invalid or duplicate feature ID.'); ids.add(String(f.id)); }
    geometry(f.geometry);
    if (f.properties !== null) { object(f.properties, Object.keys(f.properties ?? {}), 'properties'); if (Object.keys(f.properties!).length > 40) throw new Error('Too many map properties.'); for (const [k,v] of Object.entries(f.properties!)) { text(k, 120, 'property'); if (v === null || typeof v === 'boolean') continue; if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('Invalid map property.'); } else text(v, 2000, 'property'); } }
  }
  return structuredClone(fc);
}
export function validateMapRenderRequest(input: unknown): MapRenderRequest {
  if (JSON.stringify(input).length > MAP_LIMITS.inputBytes) throw new Error('Map request exceeds the input limit.');
  const v = input as MapRenderRequest;
  object(v, ['title','alt','width','height','projection','detail','centralMeridian','bounds','layers','markers','routes','overlaySource','legend'], 'request');
  if (v.detail !== undefined && !['standard','full'].includes(v.detail)) throw new Error('Invalid map detail.');
  text(v.title, 120, 'title'); text(v.alt, 1000, 'alt text');
  if (v.width !== undefined) number(v.width, 640, 1600, 'width'); if (v.height !== undefined) number(v.height, 480, 1400, 'height');
  if (v.projection !== undefined && !['equal-earth','mercator','equirectangular'].includes(v.projection)) throw new Error('Unsupported map projection.');
  if (v.centralMeridian !== undefined) number(v.centralMeridian, -180, 180, 'central meridian');
  if (v.bounds !== undefined) { if (!Array.isArray(v.bounds) || v.bounds.length !== 4) throw new Error('Invalid map bounds.'); validateMapPosition(v.bounds.slice(0,2)); validateMapPosition(v.bounds.slice(2)); if (v.bounds[0] >= v.bounds[2] || v.bounds[1] >= v.bounds[3]) throw new Error('Bounds must have west < east and south < north.'); }
  list(v.layers ?? [], MAP_LIMITS.layers, 'layers'); list(v.markers ?? [], MAP_LIMITS.markers, 'markers'); list(v.routes ?? [], MAP_LIMITS.routes, 'routes'); list(v.legend ?? [], 16, 'legend');
  if (!v.layers?.length && !v.markers?.length && !v.routes?.length) throw new Error('A map needs geometry or coordinates.');
  for (const layer of v.layers ?? []) {
    object(layer, ['query','datasetId','data','select','fill','colors','labelProperty'], 'layer');
    if ([layer.query, layer.datasetId, layer.data].filter(x => x !== undefined).length !== 1) throw new Error('Each map layer needs exactly one data source.');
    if (layer.query) validateMapQuery(layer.query);
    if (layer.datasetId !== undefined && !/^[a-f0-9-]{36}$/.test(layer.datasetId)) throw new Error('Invalid map dataset reference.');
    if (layer.data) { object(layer.data, ['geojson','source'], 'layer data'); validateMapGeometry(layer.data.geojson); validateMapSource(layer.data.source); }
    if (layer.fill !== undefined) color(layer.fill);
    if (layer.labelProperty !== undefined) text(layer.labelProperty, 120, 'label property');
    if (layer.select) { object(layer.select, ['property','values'], 'selection'); text(layer.select.property,120,'selection property'); list(layer.select.values,5000,'selection'); if (!layer.select.values.length || layer.select.values.some(x => typeof x !== 'string' && !Number.isFinite(x))) throw new Error('Invalid map selection.'); }
    if (layer.colors) { object(layer.colors, ['property','values'], 'colors'); text(layer.colors.property,120,'color property'); list(layer.colors.values,1000,'color values'); for (const c of layer.colors.values) { object(c,['value','color'],'color entry'); if (typeof c.value !== 'string' && !Number.isFinite(c.value)) throw new Error('Invalid category.'); color(c.color); } }
  }
  for (const m of v.markers ?? []) { object(m,['coordinates','label','color','radius'],'marker'); validateMapPosition(m.coordinates); if (m.label !== undefined) text(m.label,80,'marker label'); if (m.color !== undefined) color(m.color); if (m.radius !== undefined) number(m.radius,2,16,'radius'); }
  for (const r of v.routes ?? []) { object(r,['coordinates','kind','arrow','color','width','label'],'route'); list(r.coordinates,100,'route'); if (r.coordinates.length < 2) throw new Error('A route needs at least two positions.'); r.coordinates.forEach(validateMapPosition); if (r.kind !== undefined && !['straight','curved','great-circle'].includes(r.kind)) throw new Error('Invalid route kind.'); if (r.arrow !== undefined && typeof r.arrow !== 'boolean') throw new Error('Invalid arrow.'); if (r.color !== undefined) color(r.color); if (r.width !== undefined) number(r.width,1,12,'route width'); if (r.label !== undefined) text(r.label,80,'route label'); }
  if (v.overlaySource !== undefined) validateMapSource(v.overlaySource);
  if ((v.markers?.length || v.routes?.length) && !v.overlaySource) throw new Error('Coordinate overlays require source attribution.');
  for (const item of v.legend ?? []) { object(item,['label','color'],'legend'); text(item.label,80,'legend label'); color(item.color); }
  return structuredClone(v);
}
