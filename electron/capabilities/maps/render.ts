import { createHash } from 'node:crypto';
import { geoArea, geoBounds, geoEqualEarth, geoEquirectangular, geoMercator, geoPath, type GeoProjection } from 'd3-geo';
import { topology } from 'topojson-server';
import { feature } from 'topojson-client';
import { presimplify, simplify } from 'topojson-simplify';
import type { FeatureCollection, Geometry, Position } from 'geojson';
import { MAP_LIMITS, validateMapGeometry, type MapRenderRequest, type MapResult, type MapSource, type MapSourceInput, type MapLayer } from '../../../packages/capability-api/src/maps';

export const mapHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const callerMapSource = (source: MapSourceInput, data: unknown): MapSource => ({ ...source, origin: 'caller', sha256: mapHash(data), modifications: ['Caller-supplied data; provenance not independently verified.'] });
const xml = (value: unknown): string => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' })[c]!);
const n = (v: number) => { if (!Number.isFinite(v)) throw new Error('The projection produced a non-finite coordinate.'); return Number(v.toFixed(2)); };

/** D3 uses clockwise exterior rings, unlike RFC 7946. Normalize on a copy using
 * spherical area so dateline-crossing polygons do not turn into the whole globe. */
export function orientMapGeometry(fc: FeatureCollection): FeatureCollection {
  const copy = structuredClone(fc);
  const polygon = (rings: Position[][]) => rings.forEach((ring, i) => {
    const area = geoArea({ type:'Polygon', coordinates:[ring] });
    const origin = ring[0];
    const planarArea = ring.slice(1).reduce((sum,p,j) => sum + (ring[j][0]-origin[0])*(p[1]-origin[1])-(p[0]-origin[0])*(ring[j][1]-origin[1]),0);
    if ((area < 1e-14 || Math.abs(area - 4 * Math.PI) < 1e-14) && planarArea === 0) throw new Error('Degenerate polygon ring.');
    if ((i === 0 && area > 2 * Math.PI) || (i > 0 && area < 2 * Math.PI)) ring.reverse();
  });
  const visit = (g: Geometry): void => {
    if (g.type === 'Polygon') polygon(g.coordinates);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach(polygon);
    else if (g.type === 'GeometryCollection') g.geometries.forEach(visit);
  };
  copy.features.forEach(f => visit(f.geometry)); return copy;
}
export function selectMapLayer(fc: FeatureCollection, layer: MapLayer): FeatureCollection {
  const property = (f: FeatureCollection['features'][number], key: string) => key === '$id' ? f.id : f.properties?.[key];
  if (layer.select) {
    for (const value of layer.select.values) if (!fc.features.some(f => property(f, layer.select!.property) === value)) throw new Error(`No map feature matches ${String(value).slice(0,80)}.`);
    fc = { type:'FeatureCollection', features:fc.features.filter(f => layer.select!.values.includes(property(f, layer.select!.property))) };
  }
  if (layer.colors) for (const entry of layer.colors.values) if (!fc.features.some(f => property(f, layer.colors!.property) === entry.value)) throw new Error(`No map feature matches color category ${String(entry.value).slice(0,80)}.`);
  if (layer.labelProperty && fc.features.some(f => property(f, layer.labelProperty!) === undefined || property(f, layer.labelProperty!) === null)) throw new Error('The requested map label property is missing.');
  return structuredClone(fc);
}
function wrap(text: string, width: number): string[] {
  const max = Math.max(20, Math.floor(width / 6.7)); const lines: string[] = [];
  for (const word of text.split(/\s+/).flatMap(word => word.length > max ? word.match(new RegExp(`.{1,${max}}`, 'g'))! : [word])) {
    if (!lines.length || lines.at(-1)!.length + word.length + 1 > max) lines.push(word); else lines[lines.length-1] += ' ' + word;
  }
  return lines;
}
export async function renderMap(request: MapRenderRequest, layers: Array<{ geojson: FeatureCollection; source: MapSource }>, signal?: AbortSignal): Promise<MapResult> {
  signal?.throwIfAborted();
  const width = request.width ?? 1100, height = request.height ?? 820;
  const projectionName = request.projection ?? 'equal-earth';
  const sources = layers.map((l,i) => ({ ...l.source, modifications:[...l.source.modifications, 'Projected and styled by Nodus.', ...(request.layers?.[i].select ? ['Filtered by exact feature properties.'] : [])] }));
  if (request.overlaySource) sources.push(callerMapSource(request.overlaySource, { markers: request.markers ?? [], routes: request.routes ?? [] }));
  const provenance: MapResult['provenance'] = { sources, projection:projectionName, centralMeridian:request.centralMeridian ?? 0, ...(request.bounds ? { bounds:request.bounds } : {}), coordinates:'WGS84 longitude, latitude', routes:'cartographic connections, not navigation directions' };
  const credits = sources.flatMap(s => wrap([s.attribution, s.license, ...new Set([...(s.url ? [s.url] : []), ...(s.licenseUrls ?? [])]), ...(s.version ? [s.version] : []), s.origin === 'caller' ? 'Caller-supplied; unverified' : 'Adapted geometry'].join(' | '), width-64));
  const titleLines = wrap(request.title, (width-64)/2);
  const top = 28 + titleLines.length * 28;
  const bottom = height - 28 - credits.length * 17;
  const right = width - 36 - (request.legend?.length ? 230 : 0);
  if (bottom - top < 180 || (request.legend?.length ?? 0)*42 > bottom-top) throw new Error('Map attribution or legend needs a larger canvas or shorter labels.');
  const viewport: [[number,number],[number,number]] = [[36,top+12],[right,bottom-18]];
  const projection: GeoProjection = (projectionName === 'mercator' ? geoMercator() : projectionName === 'equirectangular' ? geoEquirectangular() : geoEqualEarth()).rotate([-(request.centralMeridian ?? 0),0]).precision(.3);
  const geometry = layers.map((l,i) => selectMapLayer(validateMapGeometry(l.geojson), request.layers![i]));
  const oriented = geometry.map((fc,i) => {
    const oriented = orientMapGeometry(fc);
    if (request.detail === 'full') return oriented;
    const [[w,s],[e,north]] = geoBounds(oriented);
    const tolerance = Math.max(1e-8, (e < w ? e + 360 - w : e - w) * (north - s) / (width * height) * .06);
    const topo = presimplify(topology({ map: oriented }) as Parameters<typeof presimplify>[0]);
    const reduced = feature(simplify(topo,tolerance), topo.objects.map) as FeatureCollection;
    // Never erase tiny islands or holes which become degenerate under simplification.
    const preserveRings = (g: Geometry, original: Geometry): void => {
      const rings = (now: Position[][], prior: Position[][]) => now.forEach((ring,j) => {
        const area = geoArea({type:'Polygon',coordinates:[ring]});
        if (new Set(ring.map(p=>p.join(','))).size < 3 || area < 1e-14 || Math.abs(area-4*Math.PI)<1e-14) now[j] = prior[j];
      });
      if (g.type === 'Polygon' && original.type === 'Polygon') rings(g.coordinates,original.coordinates);
      if (g.type === 'MultiPolygon' && original.type === 'MultiPolygon') g.coordinates.forEach((p,j)=>rings(p,original.coordinates[j]));
      if (g.type === 'GeometryCollection' && original.type === 'GeometryCollection') g.geometries.forEach((p,j)=>preserveRings(p,original.geometries[j]));
    };
    reduced.features.forEach((f,j)=>preserveRings(f.geometry,oriented.features[j].geometry));
    sources[i].modifications.push(`Topology-preserving display simplification, minimum planar triangle area ${tolerance} square degrees. Exported geometry retains source vertices.`);
    return reduced;
  });
  const points = [...(request.markers ?? []).map(m => m.coordinates), ...(request.routes ?? []).flatMap(r => r.coordinates)];
  const combined: FeatureCollection = { type:'FeatureCollection', features:[...oriented.flatMap(fc => fc.features), ...points.map(p => ({ type:'Feature' as const, properties:{}, geometry:{type:'Point' as const, coordinates:p} }))] };
  if (request.bounds) {
    const [w,s,e,north] = request.bounds;
    // Sample each edge: parallel bounds are parallels, not great-circle diagonals.
    const ring: Position[] = []; const step = 40;
    for(let i=0;i<=step;i++) ring.push([w,s+(north-s)*i/step]);
    for(let i=1;i<=step;i++) ring.push([w+(e-w)*i/step,north]);
    for(let i=1;i<=step;i++) ring.push([e,north-(north-s)*i/step]);
    for(let i=1;i<=step;i++) ring.push([e-(e-w)*i/step,s]);
    projection.fitExtent(viewport, {type:'LineString',coordinates:ring});
  } else {
    const [[w,s],[e,north]] = geoBounds(combined);
    if (w === e && s === north) {
      if (projectionName === 'mercator' && Math.abs(s)>=85.051129) throw new Error('Coordinate is outside the supported Mercator latitude range.');
      projection.fitExtent(viewport,{type:'MultiPoint',coordinates:[[Math.max(-180,w-1),Math.max(-90,s-1)],[Math.min(180,w+1),Math.min(90,s+1)]]});
    } else projection.fitExtent(viewport, combined);
  }
  projection.clipExtent(viewport);
  const path = geoPath(projection).digits(1);
  const svg: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><title>${xml(request.title)}</title><desc>${xml(request.alt)}</desc><desc id="nodus-map-provenance">${xml(JSON.stringify(provenance))}</desc><rect width="${width}" height="${height}" fill="#ffffff"/><g font-family="Arial, sans-serif" fill="#243447">`];
  titleLines.forEach((line,i) => svg.push(`<text x="32" y="${32+i*28}" font-size="24" font-weight="700">${xml(line)}</text>`));
  svg.push(`<defs><clipPath id="map-frame"><rect x="36" y="${top+12}" width="${right-36}" height="${bottom-top-30}"/></clipPath></defs><rect x="36" y="${top+12}" width="${right-36}" height="${bottom-top-30}" fill="#f0f5f8" rx="8"/><g clip-path="url(#map-frame)">`);
  const labels: string[] = [];
  const label = (text: unknown, point: [number,number], size = 13) => {
    const value = String(text); if(value.length > 80) throw new Error('Map label exceeds 80 characters.');
    const x = Math.min(Math.max(point[0],45+value.length*size*.28),right-8-value.length*size*.28), y = Math.max(top+28,Math.min(bottom-28,point[1]));
    return `<text x="${n(x)}" y="${n(y)}" text-anchor="middle" font-size="${size}" paint-order="stroke" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" fill="#243447">${xml(value)}</text>`;
  };
  for (let i=0; i<oriented.length; i++) for (let j=0; j<oriented[i].features.length; j++) {
    signal?.throwIfAborted(); if (j % 25 === 0) await new Promise<void>(r=>setImmediate(r));
    const f = oriented[i].features[j], layer = request.layers![i];
    const value = (key: string) => key === '$id' ? f.id : f.properties?.[key];
    const fill = layer.colors?.values.find(entry => entry.value === value(layer.colors!.property))?.color ?? layer.fill ?? '#d5e1e9';
    const draw = (g: Geometry): void => {
      if (g.type === 'GeometryCollection') { g.geometries.forEach(draw); return; }
      const d = path(g), line = g.type === 'LineString' || g.type === 'MultiLineString';
      if (d) svg.push(`<path d="${d}" fill="${line ? 'none' : fill}" fill-rule="evenodd" stroke="${line ? fill : '#ffffff'}" stroke-width="${line ? 1.5 : .9}"><title>${xml(f.properties?.name ?? f.id ?? 'Feature')}</title></path>`);
    };
    const d = path(f); draw(f.geometry);
    if (layer.labelProperty && d) { const center = path.centroid(f); if(center.every(Number.isFinite) && center[0]>=36 && center[0]<=right && center[1]>=top && center[1]<=bottom) labels.push(label(value(layer.labelProperty),center)); }
    if (svg.reduce((sum,s)=>sum+s.length,0) > MAP_LIMITS.svgChars) throw new Error('Map SVG exceeds 300 KB; use simpler geometry or select fewer features.');
  }
  const project = (p: [number,number]): [number,number] => {
    if (projectionName === 'mercator' && Math.abs(p[1]) >= 85.051129) throw new Error('Coordinate is outside the supported Mercator latitude range.');
    if (request.bounds && (p[0]<request.bounds[0] || p[0]>request.bounds[2] || p[1]<request.bounds[1] || p[1]>request.bounds[3])) throw new Error('Overlay coordinate is outside the requested bounds.');
    const xy = projection(p); if (!xy || !xy.every(Number.isFinite)) throw new Error('Coordinate cannot be projected.'); return xy;
  };
  for (const [i,route] of (request.routes ?? []).entries()) {
    signal?.throwIfAborted();
    const color = route.color ?? '#9360a8', xy = route.coordinates.map(project);
    if (route.kind !== 'great-circle' && route.coordinates.slice(1).some((p,j)=>Math.abs(p[0]-route.coordinates[j][0])>180)) throw new Error('Use great-circle routes to cross the antimeridian.');
    const arrow = route.arrow ? ` marker-end="url(#route-arrow-${i})"` : '';
    if(route.arrow) svg.push(`<defs><marker id="route-arrow-${i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 Z" fill="${color}"/></marker></defs>`);
    for(let j=1;j<xy.length;j++) {
      const [a,b] = [xy[j-1],xy[j]], mx=(a[0]+b[0])/2, my=(a[1]+b[1])/2;
      const d = route.kind === 'great-circle' ? path({type:'LineString',coordinates:[route.coordinates[j-1],route.coordinates[j]]}) : `M${n(a[0])},${n(a[1])} ${route.kind === 'curved' ? `Q${n(mx-(b[1]-a[1])*.18)},${n(my+(b[0]-a[0])*.18)} ` : 'L'}${n(b[0])},${n(b[1])}`;
      if(d) svg.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${route.width ?? 2.5}" stroke-linecap="round"${arrow}/>`);
    }
    if(route.label) labels.push(label(route.label,xy[Math.floor(xy.length/2)]));
  }
  for (const marker of request.markers ?? []) {
    const xy = project(marker.coordinates);
    svg.push(`<circle cx="${n(xy[0])}" cy="${n(xy[1])}" r="${marker.radius ?? 5}" fill="${marker.color ?? '#b04c51'}" stroke="#ffffff" stroke-width="2"/>`);
    if(marker.label) labels.push(label(marker.label,[xy[0],xy[1]-12],14));
  }
  svg.push(...labels, '</g>');
  for(const [i,item] of (request.legend ?? []).entries()) {
    const y=top+32+i*42;
    svg.push(`<rect x="${right+22}" y="${y-12}" width="14" height="14" rx="2" fill="${item.color}"/>`);
    const lines=wrap(item.label,180); if(lines.length>2) throw new Error('Legend label is too long; shorten it.');
    lines.forEach((line,j)=>svg.push(`<text x="${right+44}" y="${y+j*15}" font-size="12">${xml(line)}</text>`));
  }
  credits.forEach((line,i)=>svg.push(`<text x="32" y="${bottom+17+i*17}" font-size="11" fill="#526273">${xml(line)}</text>`));
  svg.push('</g></svg>');
  const result = svg.join('');
  if (result.length > MAP_LIMITS.svgChars || /(?:NaN|Infinity)/.test(result.replace(/<text[\s\S]*?<\/text>/g,''))) throw new Error('The rendered map exceeds its limits.');
  signal?.throwIfAborted();
  return {schemaVersion:1,capabilityId:'nodus:maps',svg:result,geometry,overlays:structuredClone({markers:request.markers ?? [],routes:request.routes ?? []}),provenance};
}
