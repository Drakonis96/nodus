// Verification of the historical map workflows, end to end and by eye.
//
// The cartography worker of the signed Research Visuals package is driven against this
// application's own map service, across countries and epochs, and each result is checked
// twice: in code (the label it claims — dated, reconstructed or reference — its provenance,
// its geometry, the canvas and the production sanitizer) and as an image, because a map can
// pass every assertion and still be unreadable.
//
// The geometry for a dated case comes from OpenHistoricalMap (CC0) and is assembled here from
// the member ways of its boundary relations. That assembly is deliberately not part of the
// application: this script is the experiment, and its findings are what the package's rules
// are written from.
//
// Needs a marketplace checkout with the package built:
//   NODUS_MARKETPLACE_DIR=/path/to/marketplace node scripts/verify-historical-maps.mjs
// A local rsvg-convert is used for the PNG when installed; otherwise the SVGs are written and
// the images are left to the reader.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const marketplace = process.env.NODUS_MARKETPLACE_DIR;
if (!marketplace || !fs.existsSync(path.join(marketplace, 'plugins'))) {
  console.log('SKIP: set NODUS_MARKETPLACE_DIR to a marketplace checkout to run this.');
  process.exit(0);
}
const buildDir = path.join(marketplace, 'build');
const archive = fs.existsSync(buildDir) ? fs.readdirSync(buildDir).find(name => name.startsWith('research-visuals-') && name.endsWith('.nodus-plugin')) : undefined;
if (!archive) {
  console.log('SKIP: research-visuals is not built. Run "node scripts/build-plugins.mjs research-visuals" in the marketplace checkout.');
  process.exit(0);
}

const out = path.join(root, 'artifacts/maps/historical');
const cache = path.join(out, 'sources');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-historical-maps-'));
for (const directory of [out, cache]) fs.mkdirSync(directory, { recursive: true });
const require = createRequire(import.meta.url);

const bundle = async (name, file) => {
  const destination = path.join(scratch, `${name}.cjs`);
  await build({ entryPoints: [file], outfile: destination, bundle: true, format: 'cjs', platform: 'node', logLevel: 'silent' });
  return require(destination);
};
const { createMapService } = await bundle('service', path.join(root, 'electron/capabilities/maps/service.ts'));
const { mapSourceTransport } = await bundle('source', path.join(root, 'electron/capabilities/maps/sources.ts'));
const { sanitizeChatSvg } = await bundle('sanitize', path.join(root, 'shared/chatSvg.ts'));
const { createHash } = await import('node:crypto');
// Approved provider responses are cached like every other verification here, so a re-run does
// not re-download Spain's provinces or the world's countries.
const transport = { async read(url, signal, limit) {
  const file = path.join(cache, `${createHash('sha256').update(url).digest('hex')}.json`);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const bytes = await mapSourceTransport.read(url, signal, limit);
  fs.writeFileSync(file, bytes);
  return bytes;
} };
// One service per case: a scope carries the reply's budget of eight calls, and every case
// here is a separate reply.
const serviceFor = () => createMapService({ providers: ['natural-earth', 'geoboundaries'], transport });

// Unpacked from the built archive, so what is verified is the published bytes and not a source tree.
const AdmZip = require('adm-zip');
new AdmZip(path.join(buildDir, archive)).extractAllTo(scratch, true);
const worker = require(path.join(scratch, 'capabilities/cartography/worker.js'))({
  signal: { throwIfAborted() {} },
  maps: { render: request => serviceFor().render(request, new AbortController().signal) },
  attachments: { async store({ bytes }) { return { attachmentId: 'verify-attachment', bytes: bytes.length }; } },
});

// ── OpenHistoricalMap: dated geometry, assembled from the member ways of each relation ──────
const ohmCache = path.join(out, 'ohm');
fs.mkdirSync(ohmCache, { recursive: true });
async function overpass(query, attempt = 1) {
  try {
    const response = await fetch('https://overpass-api.openhistoricalmap.org/api/interpreter', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: query }),
    });
    const text = await response.text();
    if (!text.trim().startsWith('{')) throw new Error(`not json: ${text.slice(0, 60).replace(/\s+/g, ' ')}`);
    return JSON.parse(text);
  } catch (error) {
    // The public endpoint rate-limits bursts with an HTML error page.
    if (attempt >= 6) throw error;
    await new Promise(resolve => setTimeout(resolve, 10_000 * attempt));
    return overpass(query, attempt + 1);
  }
}

const keyOf = ([lon, lat]) => `${lon.toFixed(7)},${lat.toFixed(7)}`;
const ringArea = ring => Math.abs(ring.reduce((sum, [x, y], index) => {
  const [nx, ny] = ring[(index + 1) % ring.length];
  return sum + (x * ny - nx * y);
}, 0) / 2);
const outerRings = feature => feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates[0]] : feature.geometry.coordinates.map(part => part[0]);
const biggestRing = feature => outerRings(feature).reduce((best, ring) => ringArea(ring) > ringArea(best) ? ring : best);
const inside = (ring, point) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

/** Joins member ways into closed rings: fragments arrive unordered and either way round. */
function rings(parts) {
  const pool = parts.map(geometry => geometry.map(point => [point.lon, point.lat])).filter(points => points.length > 1);
  const closed = [];
  while (pool.length) {
    let chain = pool.pop(), extended = true;
    while (extended && keyOf(chain[0]) !== keyOf(chain.at(-1))) {
      extended = false;
      for (let index = 0; index < pool.length; index++) {
        const candidate = pool[index], start = keyOf(chain[0]), end = keyOf(chain.at(-1));
        if (keyOf(candidate[0]) === end) chain = chain.concat(candidate.slice(1));
        else if (keyOf(candidate.at(-1)) === end) chain = chain.concat([...candidate].reverse().slice(1));
        else if (keyOf(candidate.at(-1)) === start) chain = [...candidate].slice(0, -1).concat(chain);
        else if (keyOf(candidate[0]) === start) chain = [...candidate].reverse().slice(0, -1).concat(chain);
        else continue;
        pool.splice(index, 1); extended = true; break;
      }
    }
    if (keyOf(chain[0]) === keyOf(chain.at(-1)) && chain.length >= 4) closed.push(chain);
  }
  return closed;
}
/** Display thinning: a country's OSM-detail ways do not fit the request's 12 MB input ceiling. */
const thin = (ring, tolerance) => {
  const kept = [ring[0]];
  for (const point of ring) if (Math.hypot(point[0] - kept.at(-1)[0], point[1] - kept.at(-1)[1]) >= tolerance) kept.push(point);
  if (keyOf(kept.at(-1)) !== keyOf(ring.at(-1))) kept.push(ring.at(-1));
  if (keyOf(kept[0]) !== keyOf(kept.at(-1))) kept.push(kept[0]);
  return kept;
};
/** A label needs a point inside the shape and away from its edges; the mean of the vertices is
 *  neither, and lands in the sea for a relation that carries outlying islands. */
const anchorOf = feature => {
  const ring = biggestRing(feature), [w, s, e, n] = ring.reduce(([a, b, c, d], [x, y]) => [Math.min(a, x), Math.min(b, y), Math.max(c, x), Math.max(d, y)], [180, 90, -180, -90]);
  let best = null, bestDistance = -1;
  for (let i = 1; i < 16; i++) for (let j = 1; j < 16; j++) {
    const point = [w + ((e - w) * i) / 16, s + ((n - s) * j) / 16];
    if (!inside(ring, point)) continue;
    const distance = Math.min(...ring.map(([x, y]) => Math.hypot(x - point[0], y - point[1])));
    if (distance > bestDistance) { bestDistance = distance; best = point; }
  }
  return best ? [Number(best[0].toFixed(4)), Number(best[1].toFixed(4))] : null;
};

const covers = (tags, year) => {
  const start = tags.start_date ? Number(String(tags.start_date).slice(0, 4)) : null;
  const end = tags.end_date ? Number(String(tags.end_date).slice(0, 4)) : null;
  return (!start || start <= year) && (!end || end >= year);
};

async function openHistoricalMap({ id, bbox, year, levels = ['2', '4'], ids: chosen, tolerance = 0.01 }) {
  const file = path.join(ohmCache, `${id}.json`);
  let payload;
  if (fs.existsSync(file)) payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  else {
    const index = await overpass(`[out:json][timeout:90];relation["boundary"="administrative"]["admin_level"~"^(${levels.join('|')})$"](${bbox.join(',')});out ids tags;`);
    const ids = chosen ?? index.elements.filter(element => covers(element.tags ?? {}, year) && element.tags?.name).map(element => element.id);
    const wide = ids.length ? await overpass(`[out:json][timeout:180];relation(id:${ids.join(',')});out geom;`) : { elements: [] };
    // Cached already narrowed: a cache holding the whole box is how a level or id filter stops applying.
    const keep = new Set(ids);
    payload = { ...wide, elements: wide.elements.filter(element => element.type === 'relation' && keep.has(element.id)) };
    fs.writeFileSync(file, JSON.stringify(payload));
  }

  const features = [];
  let raw = 0, kept = 0;
  for (const relation of payload.elements.filter(element => element.type === 'relation')) {
    const members = (relation.members ?? []).filter(member => Array.isArray(member.geometry) && member.geometry.length > 1);
    raw += members.reduce((sum, member) => sum + member.geometry.length, 0);
    const keep = ring => { const thinned = thin(ring, tolerance); return thinned.length >= 4 ? thinned : ring; };
    const outers = rings(members.filter(member => member.role !== 'inner').map(member => member.geometry)).map(keep);
    const inners = rings(members.filter(member => member.role === 'inner').map(member => member.geometry)).map(keep);
    if (!outers.length) continue;
    const holes = inners.map(ring => [ring, outers.find(outer => inside(outer, ring[0]))]).filter(([, owner]) => owner);
    kept += outers.reduce((sum, ring) => sum + ring.length, 0);
    features.push({
      type: 'Feature', id: `ohm-${relation.id}`,
      geometry: outers.length === 1 && !holes.length ? { type: 'Polygon', coordinates: outers }
        : { type: 'MultiPolygon', coordinates: outers.map(outer => [outer, ...holes.filter(([, owner]) => owner === outer).map(([ring]) => ring)]) },
      properties: { name: relation.tags.name },
    });
  }
  // OHM can carry more than one relation for the same entity over the same window (two
  // "Deutsches Reich", two "Imperium Romanum"): drawn together they overlap two outlines and
  // print the name twice. The largest wins; the rest is reported.
  const byName = new Map(), duplicates = [];
  for (const feature of features) {
    const previous = byName.get(feature.properties.name);
    if (!previous) { byName.set(feature.properties.name, feature); continue; }
    const [keepFeature, drop] = ringArea(biggestRing(feature)) > ringArea(biggestRing(previous)) ? [feature, previous] : [previous, feature];
    byName.set(feature.properties.name, keepFeature);
    duplicates.push(`${feature.properties.name} (${drop.id})`);
  }
  const unique = [...byName.values()].sort((a, b) => ringArea(biggestRing(b)) - ringArea(biggestRing(a)));
  return {
    points: { raw, kept },
    duplicates,
    // Markers for the divisions that can hold a label, inside the frame and on land: the
    // renderer places every label it is given, and a hundred of them over Belgium is not a map.
    labelTargets: (limit = 14, bounds) => unique
      .flatMap(feature => { const point = anchorOf(feature); return point ? [{ feature, point }] : []; })
      .filter(({ point }) => !bounds || (point[0] > bounds[0] && point[0] < bounds[2] && point[1] > bounds[1] && point[1] < bounds[3]))
      .slice(0, limit)
      .map(({ feature, point }) => ({ coordinates: point, label: feature.properties.name, radius: 2, color: '#6b5f4d' })),
    data: {
      geojson: { type: 'FeatureCollection', features: unique },
      source: {
        label: `OpenHistoricalMap · fronteras hacia ${year}`, attribution: 'OpenHistoricalMap (openhistoricalmap.org); datos CC0, geometría de relaciones ADM',
        license: 'CC0 1.0 (dominio público)', url: 'https://www.openhistoricalmap.org/',
        period: { from: `${String(year).padStart(4, '0')}-01-01`, to: `${String(year).padStart(4, '0')}-12-31` },
      },
    },
  };
}

// ── shared inputs for the two non-OHM lanes ────────────────────────────────────────────────
/** Natural Earth, clipped to western Europe and cached: the modern outline the reconstructed
 *  cases stand on, as a *reference* silhouette rather than a boundary of any period. */
const europeOutline = async () => {
  const file = path.join(cache, 'ne110m-europe.json');
  if (!fs.existsSync(file)) {
    const response = await fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_admin_0_countries.geojson');
    const text = await response.text();
    if (!text.trim().startsWith('{')) throw new Error('Natural Earth could not be fetched');
    const box = [-11, 34, 6, 45];
    const boxOf = ring => ring.reduce(([w, s, e, n], [x, y]) => [Math.min(w, x), Math.min(s, y), Math.max(e, x), Math.max(n, y)], [180, 90, -180, -90]);
    const clip = geometry => {
      const parts = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
      const kept = parts.filter(part => { const [w, s, e, n] = boxOf(part[0]); return e >= box[0] && w <= box[2] && n >= box[1] && s <= box[3]; });
      if (!kept.length) return null;
      return geometry.type === 'Polygon' ? { type: 'Polygon', coordinates: kept[0] } : { type: 'MultiPolygon', coordinates: kept };
    };
    const features = JSON.parse(text).features.flatMap((feature, index) => {
      const geometry = clip(feature.geometry);
      return geometry ? [{ type: 'Feature', id: `ne-${index}`, geometry, properties: null }] : [];
    });
    fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features }));
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
const modernOutline = await europeOutline();
const reconstruction = { label: 'Reconstrucción a partir de conocimiento general', attribution: 'Ejemplo sintético; no es evidencia histórica', license: 'CC0' };
const outlineSource = { label: 'Natural Earth 1:110m, silueta de referencia moderna', attribution: 'Natural Earth (naturalearthdata.com), dominio público', license: 'Dominio público (Natural Earth terms of use)', url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_admin_0_countries.geojson' };
const ohmLayer = (result, fill) => ({ data: result.data, fill });
const ohmSource = result => result.data.source;
const SPANISH_REGIONS = [2803708, 2805288, 2828834, 2828861, 2855651, 2806619, 2806617, 2806616, 2806614, 2829037, 2805410, 2806609, 2806620];

const cases = [
  ['ohm-iberia-117-roma', 'dated', async () => {
    const layer = await openHistoricalMap({ id: 'iberia117', bbox: [35, -10, 44, 4.5], year: 117, levels: ['4'] });
    return { title: 'Hispania romana, 117 d. C. (OpenHistoricalMap)', alt: 'Provincias romanas de la península ibérica hacia 117 d. C.', period: { from: '0117-01-01', to: '0117-12-31' },
      projection: 'mercator', bounds: [-10, 35, 4.5, 44], width: 1200, height: 900, layers: [{ ...ohmLayer(layer, '#c9b7a4'), labelProperty: 'name' }], legend: [{ label: 'Provincia romana', color: '#c9b7a4' }] };
  }],
  ['ohm-reino-unido-1900', 'dated', async () => {
    const layer = await openHistoricalMap({ id: 'uk1900', bbox: [49, -9, 59.5, 2], year: 1900, levels: ['2', '4'] });
    return { title: 'El Reino Unido en 1900: las cuatro naciones (OpenHistoricalMap)', alt: 'Inglaterra y Gales, Escocia e Irlanda, con las islas del canal, hacia 1900.', period: { from: '1900-01-01', to: '1900-12-31' },
      projection: 'mercator', bounds: [-9, 49, 2, 59.5], width: 1100, height: 1200,
      layers: [ohmLayer(layer, '#d6c7a8')], markers: layer.labelTargets(8, [-9, 49, 2, 59.5]), overlaySource: ohmSource(layer),
      legend: [{ label: 'Nación o dependencia', color: '#d6c7a8' }, { label: 'Nación mayor', color: '#6b5f4d' }] };
  }],
  ['ohm-roma-400-imperio', 'dated', async () => {
    const layer = await openHistoricalMap({ id: 'roma400', bbox: [25, -12, 58, 45], year: 400 });
    return { title: 'El imperio romano hacia 400 d. C. (OpenHistoricalMap)', alt: 'Provincias del imperio romano de Occidente y de Oriente hacia 400.', period: { from: '0400-01-01', to: '0400-12-31' },
      projection: 'equal-earth', bounds: [-12, 24, 46, 58], width: 1500, height: 1000,
      layers: [ohmLayer(layer, '#cfc0a2')], markers: layer.labelTargets(14, [-12, 24, 46, 58]), overlaySource: ohmSource(layer),
      legend: [{ label: 'Provincia', color: '#cfc0a2' }, { label: 'Provincia mayor', color: '#6b5f4d' }] };
  }],
  ['ohm-europa-occidental-1940', 'dated', async () => {
    const layer = await openHistoricalMap({ id: 'europa1940', bbox: [35, -10, 55.5, 19], year: 1940, levels: ['2'] });
    return { title: 'Europa occidental y central en 1940: Estados y administraciones (OpenHistoricalMap)', alt: 'Estados y administraciones de Europa occidental y central en 1940, con el Estado francés y la ocupación alemana.', period: { from: '1940-01-01', to: '1940-12-31' },
      projection: 'equirectangular', bounds: [-10, 35, 19, 55.5], width: 1500, height: 1050,
      layers: [ohmLayer(layer, '#cbbfae')], markers: layer.labelTargets(12, [-10, 35, 19, 55.5]), overlaySource: ohmSource(layer),
      legend: [{ label: 'Estado o administración', color: '#cbbfae' }, { label: 'Estado mayor', color: '#6b5f4d' }] };
  }],
  ['ohm-alemania-1939', 'dated', async () => {
    const layer = await openHistoricalMap({ id: 'alemania1939', bbox: [47, 5, 55, 15], year: 1939, levels: ['4'], tolerance: 0.02 });
    return { title: 'El Reich alemán en 1939: estados y provincias (OpenHistoricalMap)', alt: 'Estados, provincias y territorios del Reich alemán en 1939.', period: { from: '1939-01-01', to: '1939-12-31' },
      projection: 'equirectangular', bounds: [5, 47, 15, 55], width: 1300, height: 1000,
      layers: [ohmLayer(layer, '#cdc3ad')], markers: layer.labelTargets(14, [5, 47, 15, 55]), overlaySource: ohmSource(layer),
      legend: [{ label: 'Estado o provincia', color: '#cdc3ad' }, { label: 'División mayor', color: '#6b5f4d' }] };
  }],
  ['ohm-italia-1861', 'dated', async () => {
    const layer = await openHistoricalMap({ id: 'italia1861', bbox: [36, 6, 47.5, 19], year: 1861, levels: ['2', '4'] });
    return { title: 'Italia y el Adriático en 1861: reinos y divisiones (OpenHistoricalMap)', alt: 'Reinos y divisiones de la península italiana y el Adriático en 1861.', period: { from: '1861-01-01', to: '1861-12-31' },
      projection: 'equal-earth', bounds: [6, 36, 19, 47.5], width: 1200, height: 1100,
      layers: [ohmLayer(layer, '#d3c6ab')], markers: layer.labelTargets(12, [6, 36, 19, 47.5]), overlaySource: ohmSource(layer),
      legend: [{ label: 'Reino o división', color: '#d3c6ab' }, { label: 'División mayor', color: '#6b5f4d' }] };
  }],
  ['ohm-mexico-1900', 'dated', async () => {
    const layer = await openHistoricalMap({ id: 'mexico1900', bbox: [14, -118, 33, -85], year: 1900, levels: ['2', '4'] });
    return { title: 'México en 1900: entidades y territorios vecinos (OpenHistoricalMap)', alt: 'Estados de México y territorios vecinos hacia 1900.', period: { from: '1900-01-01', to: '1900-12-31' },
      projection: 'mercator', bounds: [-118, 14, -85, 33], width: 1500, height: 950,
      layers: [ohmLayer(layer, '#d8cdb4')], markers: layer.labelTargets(13, [-118, 14, -85, 33]), overlaySource: ohmSource(layer),
      legend: [{ label: 'Entidad', color: '#d8cdb4' }, { label: 'Entidad mayor', color: '#6b5f4d' }] };
  }],
  ['ohm-espana-1940-regiones', 'dated', async () => {
    const layer = await openHistoricalMap({ id: 'espana1940', bbox: [35, -10, 44, 4.5], year: 1940, levels: ['4'], ids: SPANISH_REGIONS });
    return { title: 'Regiones históricas de España en 1940 (OpenHistoricalMap)', alt: 'Las trece regiones históricas peninsulares y baleares con frontera datada.', period: { from: '1940-01-01', to: '1940-12-31' },
      projection: 'mercator', bounds: [-10, 35.5, 4.5, 44], width: 1200, height: 900, layers: [{ ...ohmLayer(layer, '#dcd3bd'), labelProperty: 'name' }], legend: [{ label: 'Región histórica (1833–1982)', color: '#dcd3bd' }] };
  }],
  ['espana-1940-provincias-referencia', 'reference', () => ({
    title: 'España en 1940: provincias como referencia actual', alt: 'División provincial vigente, dibujada como referencia para una petición de 1940.',
    period: { from: '1940-01-01', to: '1940-12-31' }, projection: 'mercator', bounds: [-10, 35.5, 4.5, 44], width: 1200, height: 900,
    layers: [{ query: { provider: 'geoboundaries', country: 'ESP', level: 2 }, fill: '#dcd3bd' }], legend: [{ label: 'Provincia (división vigente)', color: '#dcd3bd' }],
  })],
  ['espana-1940-castilla-nueva-referencia', 'dated+reference', async () => {
    const layer = await openHistoricalMap({ id: 'espana1940', bbox: [35, -10, 44, 4.5], year: 1940, levels: ['4'], ids: SPANISH_REGIONS });
    return { title: 'España en 1940: regiones datadas y el hueco de Castilla la Nueva', alt: 'Regiones históricas de OpenHistoricalMap con las provincias actuales de Castilla la Nueva como referencia.',
      period: { from: '1940-01-01', to: '1940-12-31' }, projection: 'mercator', bounds: [-10, 35.5, 4.5, 44], width: 1200, height: 900,
      layers: [
        { data: layer.data, fill: '#dcd3bd', labelProperty: 'name' },
        { query: { provider: 'geoboundaries', country: 'ESP', level: 2 }, select: { property: 'name', values: ['Madrid', 'Toledo', 'Ciudad Real', 'Cuenca', 'Guadalajara', 'Albacete'] }, fill: '#bfae94' },
      ],
      legend: [{ label: 'Región histórica (OHM)', color: '#dcd3bd' }, { label: 'Provincias actuales de Castilla la Nueva', color: '#bfae94' }] };
  }],
  ['espana-1940-ruta-madrid-toledo', 'reconstruction', () => ({
    title: 'España en 1940: ruta Madrid–Toledo', alt: 'Ruta aproximada entre Madrid y Toledo sobre una silueta moderna de referencia.',
    period: { from: '1940-01-01', to: '1940-12-31' }, projection: 'mercator', bounds: [-10, 35.4, 4, 44], width: 1100, height: 820,
    layers: [{ data: { geojson: modernOutline, source: outlineSource }, fill: '#e6e2d6' }],
    markers: [{ coordinates: [-3.7038, 40.4168], label: 'Madrid', color: '#a33f3f', radius: 7 }, { coordinates: [-4.0245, 39.8628], label: 'Toledo', color: '#a33f3f', radius: 7 }],
    routes: [{ coordinates: [[-3.7038, 40.4168], [-4.0245, 39.8628]], kind: 'curved', arrow: true, color: '#a33f3f', width: 3 }],
    overlaySource: reconstruction, legend: [{ label: 'Ciudades', color: '#a33f3f' }, { label: 'Itinerario aproximado', color: '#a33f3f' }, { label: 'Silueta moderna (referencia)', color: '#e6e2d6' }],
  })],
  ['espana-1939-rutas-exilio', 'reconstruction', () => ({
    title: 'Rutas del exilio, 1939', alt: 'Dos itinerarios aproximados: Barcelona hacia Portbou y Alicante hacia el norte de África.',
    period: { from: '1939-01-01', to: '1939-12-31' }, projection: 'equal-earth', bounds: [-4.5, 35, 5.5, 44], width: 1200, height: 820,
    layers: [{ data: { geojson: modernOutline, source: outlineSource }, fill: '#e6e2d6' }],
    markers: [{ coordinates: [2.1734, 41.3851], label: 'Barcelona', color: '#3f6ba3', radius: 7 }, { coordinates: [3.1601, 42.4264], label: 'Portbou', color: '#3f6ba3', radius: 7 },
      { coordinates: [-0.4815, 38.3452], label: 'Alicante', color: '#8a5a2b', radius: 7 }, { coordinates: [-0.6417, 35.6971], label: 'Orán', color: '#8a5a2b', radius: 7 }],
    routes: [{ coordinates: [[2.1734, 41.3851], [3.1601, 42.4264]], kind: 'curved', arrow: true, color: '#3f6ba3', width: 4 }, { coordinates: [[-0.4815, 38.3452], [-0.6417, 35.6971]], kind: 'curved', arrow: true, color: '#8a5a2b', width: 4 }],
    overlaySource: { ...reconstruction, label: 'Trazado esquemático entre ciudades actuales' },
    legend: [{ label: 'Ruta del norte', color: '#3f6ba3' }, { label: 'Ruta del sureste', color: '#8a5a2b' }, { label: 'Silueta moderna (referencia)', color: '#e6e2d6' }],
  })],
];

const EXPECTED = {
  dated: { approximate: false, notice: false },
  reference: { approximate: true, notice: true },
  'dated+reference': { approximate: false, notice: false },
  reconstruction: { approximate: true, notice: true },
};

let browser;
const failures = [], manifest = [];
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });

  for (const [id, expect, build] of cases) {
    const input = await build();
    const problems = [];
    let artifact;
    try { artifact = (await worker.invoke({ toolId: 'render-historical-map', input })).artifacts[0]; }
    catch (error) { problems.push(`render failed: ${error.message}`); }
    if (artifact) {
      const data = artifact.data, svg = data.svg ?? '';
      if (data.approximate !== EXPECTED[expect].approximate) problems.push(`approximate=${data.approximate}, expected ${EXPECTED[expect].approximate}`);
      const notice = artifact.view.nodes.some(node => node.kind === 'notice');
      if (notice !== EXPECTED[expect].notice) problems.push(`notice=${notice}, expected ${EXPECTED[expect].notice}`);
      if (svg.length > 300_000) problems.push(`svg of ${svg.length} characters, over the ceiling`);
      if (/NaN|Infinity/.test(svg)) problems.push('non-finite coordinate in the SVG');
      if (!/<path|<circle|<rect/.test(svg)) problems.push('nothing drawn');
      const width = Number(/<svg[^>]*width="(\d+(?:\.\d+)?)"/.exec(svg)?.[1] ?? 0), height = Number(/<svg[^>]*height="(\d+(?:\.\d+)?)"/.exec(svg)?.[1] ?? 0);
      for (const [, x, y, text] of svg.matchAll(/<text[^>]*x="(-?[\d.]+)"[^>]*y="(-?[\d.]+)"[^>]*>([^<]*)<\/text>/g)) {
        if (Number(x) < 0 || Number(x) > width || Number(y) < 0 || Number(y) > height) { problems.push(`label outside the canvas: ${text.slice(0, 24)}`); break; }
      }
      // The provenance travels escaped inside the SVG, as it does in every rendered map.
      const escaped = /<desc id="nodus-map-provenance">([\s\S]*?)<\/desc>/.exec(svg)?.[1];
      const sources = escaped ? JSON.parse(escaped.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')) : null;
      if (!sources?.sources?.length) problems.push('no provenance in the map');
      if (!sources?.sources?.every(source => source.license && source.attribution)) problems.push('a source without licence or attribution');
      if (expect !== 'reference' && !sources?.sources?.some(source => source.origin === 'caller')) problems.push('dated and reconstructed cases carry supplied geometry');
      // The production sanitizer runs where it runs in the application: in a DOM.
      let clean;
      try {
        clean = await page.evaluate(({ fn, source }) => {
          const result = eval('(' + fn + ')')(source);
          if (!result?.svg) throw new Error('the sanitizer rejected the map');
          if (!new DOMParser().parseFromString(result.svg, 'image/svg+xml').querySelector('#nodus-map-provenance')) throw new Error('the sanitizer dropped the provenance');
          return result.svg;
        }, { fn: sanitizeChatSvg.toString(), source: svg });
      } catch (error) { problems.push(String(error.message ?? error)); }
      const html = clean ?? svg;
      fs.writeFileSync(path.join(out, `${id}.svg`), html);
      fs.writeFileSync(path.join(out, `${id}.json`), JSON.stringify({ input, artifact: { data: { ...data, svg: undefined } }, provenance: sources }, null, 2));
      // The image is the point: a map that passes every assertion can still be unreadable.
      await page.setViewportSize({ width: input.width ?? 1200, height: input.height ?? 900 });
      await page.setContent('<body style="margin:0"><img alt="Generated map" style="display:block;width:100%" src="data:image/svg+xml;base64,'
        + Buffer.from(html).toString('base64') + '"></body>');
      await page.locator('img').evaluate(image => image.decode());
      await page.screenshot({ path: path.join(out, `${id}.png`) });
      manifest.push({ id, expect, approximate: data.approximate, referenceOnly: data.referenceOnly ?? false, features: input.layers?.reduce((sum, layer) => sum + (layer.data?.geojson.features.length ?? 0), 0) ?? 0, labels: [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].length, svgBytes: Buffer.byteLength(html), sources: sources.sources.map(source => source.origin) });
    }
    if (problems.length) { failures.push({ id, problems }); console.log(`FAIL ${id}\n     ${problems.join('\n     ')}`); }
    else console.log(`ok   ${id}`);
  }

  fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify(manifest, null, 2));
  console.table(manifest.map(entry => ({ id: entry.id, expect: entry.expect, approximate: entry.approximate, features: entry.features, labels: entry.labels, kb: Math.round(entry.svgBytes / 1024) })));
  if (failures.length) throw new Error(`${failures.length} case(s) failed`);
  console.log(`\nHistorical maps verified: ${manifest.length} cases, native renderer, production sanitizer and captures in ${path.relative(root, out)}.`);
} finally {
  await browser?.close();
  fs.rmSync(scratch, { recursive: true, force: true });
}
