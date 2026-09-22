// Verification of the historical map workflows, end to end and by eye.
//
// Twelve real requests go through the signed package's own cartography worker and this
// application's map service, and each result is checked twice: in code (the label it claims —
// dated, reconstructed or reference frame — its provenance, its geometry, the label placement,
// the canvas and the production sanitizer) and as an image, because a map can pass every
// assertion and still be unreadable.
//
// The dated cases ask the *application* for the period's own boundaries through the
// `openhistoricalmap` provider, so this exercises the adapter, its licence and date rules, its
// frame rule and its provenance — not a fixture. Only the two reconstructed cases supply their
// own geometry, because that is what a reconstruction is.
//
// Needs a marketplace checkout with the package built, and network for the providers:
//   NODUS_MARKETPLACE_DIR=/path/to/marketplace node scripts/verify-historical-maps.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
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
// Provider responses are cached like every other verification here, so a re-run does not
// re-download the world — or re-ask a public endpoint that rate-limits bursts.
const transport = { async read(url, signal, limit) {
  const file = path.join(cache, `${createHash('sha256').update(url).digest('hex')}.json`);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const bytes = await mapSourceTransport.read(url, signal, limit);
  fs.writeFileSync(file, bytes);
  return bytes;
} };
// One service per case: a scope carries the reply's budget of eight calls, and every case here
// is a separate reply.
const serviceFor = () => createMapService({ providers: ['natural-earth', 'geoboundaries', 'openhistoricalmap'], transport });

// Unpacked from the built archive, so what is verified is the published bytes and not a source tree.
const AdmZip = require('adm-zip');
new AdmZip(path.join(buildDir, archive)).extractAllTo(scratch, true);
const worker = require(path.join(scratch, 'capabilities/cartography/worker.js'))({
  signal: { throwIfAborted() {} },
  maps: { render: request => serviceFor().render(request, new AbortController().signal) },
  attachments: { async store({ bytes }) { return { attachmentId: 'verify-attachment', bytes: bytes.length }; } },
});

/** Natural Earth, clipped to western Europe and cached: the modern silhouette the two
 *  reconstructed cases stand on, as a reference outline rather than a boundary of any period. */
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
const year = (value, month = '01-01') => `${String(value).padStart(4, '0')}-${month}`;
const span = (from, to = from) => ({ from: year(from), to: year(to, '12-31') });
const dated = (level, [from, to = from]) => ({ query: { provider: 'openhistoricalmap', level, period: span(from, to) }, fill: '#dcd3bd', labelProperty: 'name' });

const cases = [
  // Dated, from the provider: different countries and epochs, each frame its retrieval window.
  ['ohm-hispania-117', 'dated', { title: 'Hispania romana, 117 d. C. (OpenHistoricalMap)', alt: 'Provincias romanas de la península ibérica hacia 117 d. C.', period: span(117),
    projection: 'mercator', bounds: [-10, 35, 4.5, 44], width: 1200, height: 900, layers: [dated(4, [117])], legend: [{ label: 'Provincia romana', color: '#dcd3bd' }] }],
  ['ohm-roma-400', 'dated', { title: 'Provincias del imperio romano hacia 400 d. C. (OpenHistoricalMap)', alt: 'Provincias del imperio romano de Occidente y de Oriente hacia 400.', period: span(400),
    projection: 'equal-earth', bounds: [-12, 24, 46, 58], width: 1500, height: 1000, layers: [dated(4, [400])], legend: [{ label: 'Provincia', color: '#dcd3bd' }] }],
  ['ohm-reino-unido-1900', 'dated', { title: 'El Reino Unido en 1900: las cuatro naciones (OpenHistoricalMap)', alt: 'Inglaterra y Gales, Escocia e Irlanda, con las islas del canal, hacia 1900.', period: span(1900),
    projection: 'mercator', bounds: [-9, 49, 2, 59.5], width: 1100, height: 1200, layers: [dated(4, [1900])], legend: [{ label: 'Nación o dependencia', color: '#dcd3bd' }] }],
  ['ohm-europa-occidental-1940', 'dated', { title: 'Europa occidental y central en 1940: Estados y administraciones (OpenHistoricalMap)', alt: 'Estados y administraciones de Europa occidental y central en 1940, con el Estado francés y la ocupación alemana.', period: span(1940),
    projection: 'equirectangular', bounds: [-10, 35, 19, 55.5], width: 1500, height: 1050, layers: [dated(2, [1940])], legend: [{ label: 'Estado o administración', color: '#dcd3bd' }] }],
  ['ohm-alemania-1939', 'dated', { title: 'El Reich alemán en 1939: estados y provincias (OpenHistoricalMap)', alt: 'Estados, provincias y territorios del Reich alemán en 1939.', period: span(1939),
    projection: 'equirectangular', bounds: [5, 47, 15, 55], width: 1300, height: 1000, layers: [dated(4, [1939])], legend: [{ label: 'Estado o provincia', color: '#dcd3bd' }] }],
  ['ohm-italia-1861', 'dated', { title: 'Italia y el Adriático en 1861: reinos y divisiones (OpenHistoricalMap)', alt: 'Reinos y divisiones de la península italiana y el Adriático en 1861.', period: span(1861),
    projection: 'equal-earth', bounds: [6, 36, 19, 47.5], width: 1200, height: 1100, layers: [dated(2, [1861])], legend: [{ label: 'Reino', color: '#dcd3bd' }] }],
  ['ohm-mexico-1900', 'dated', { title: 'México en 1900: entidades y territorios vecinos (OpenHistoricalMap)', alt: 'Estados de México y territorios vecinos hacia 1900.', period: span(1900),
    projection: 'mercator', bounds: [-118, 14, -85, 33], width: 1500, height: 950, layers: [dated(4, [1900])], legend: [{ label: 'Entidad', color: '#dcd3bd' }] }],
  ['ohm-espana-1940-regiones', 'dated', { title: 'Regiones históricas de España en 1940 (OpenHistoricalMap)', alt: 'Las regiones históricas peninsulares y baleares con frontera datada.', period: span(1940),
    projection: 'mercator', bounds: [-10, 35.5, 4.5, 44], width: 1200, height: 900, layers: [dated(4, [1940])], legend: [{ label: 'Región histórica (1833–1982)', color: '#dcd3bd' }] }],
  // The dated region this dataset does not have, filled with real current geometry.
  ['espana-1940-castilla-nueva', 'dated+reference', { title: 'España en 1940: regiones datadas y el hueco de Castilla la Nueva', alt: 'Regiones históricas de OpenHistoricalMap con las provincias actuales de Castilla la Nueva como referencia.', period: span(1940),
    projection: 'mercator', bounds: [-10, 35.5, 4.5, 44], width: 1200, height: 900,
    layers: [
      dated(4, [1940]),
      { query: { provider: 'geoboundaries', country: 'ESP', level: 2 }, select: { property: 'name', values: ['Madrid', 'Toledo', 'Ciudad Real', 'Cuenca', 'Guadalajara', 'Albacete'] }, fill: '#bfae94' },
    ],
    legend: [{ label: 'Región histórica (OHM)', color: '#dcd3bd' }, { label: 'Provincias actuales de Castilla la Nueva', color: '#bfae94' }] }],
  // The other two lanes, unchanged: a reference frame and two reconstructions.
  ['espana-1940-provincias-referencia', 'reference', { title: 'España en 1940: provincias como referencia actual', alt: 'División provincial vigente, dibujada como referencia para una petición de 1940.',
    period: span(1940), projection: 'mercator', bounds: [-10, 35.5, 4.5, 44], width: 1200, height: 900,
    layers: [{ query: { provider: 'geoboundaries', country: 'ESP', level: 2 }, fill: '#dcd3bd' }], legend: [{ label: 'Provincia (división vigente)', color: '#dcd3bd' }] }],
  ['espana-1940-ruta-madrid-toledo', 'reconstruction', { title: 'España en 1940: ruta Madrid–Toledo', alt: 'Ruta aproximada entre Madrid y Toledo sobre una silueta moderna de referencia.',
    period: span(1940), projection: 'mercator', bounds: [-10, 35.4, 4, 44], width: 1100, height: 820,
    layers: [{ data: { geojson: modernOutline, source: outlineSource }, fill: '#e6e2d6' }],
    markers: [{ coordinates: [-3.7038, 40.4168], label: 'Madrid', color: '#a33f3f', radius: 7 }, { coordinates: [-4.0245, 39.8628], label: 'Toledo', color: '#a33f3f', radius: 7 }],
    routes: [{ coordinates: [[-3.7038, 40.4168], [-4.0245, 39.8628]], kind: 'curved', arrow: true, color: '#a33f3f', width: 3 }],
    overlaySource: reconstruction, legend: [{ label: 'Ciudades', color: '#a33f3f' }, { label: 'Itinerario aproximado', color: '#a33f3f' }, { label: 'Silueta moderna (referencia)', color: '#e6e2d6' }] }],
  ['espana-1939-rutas-exilio', 'reconstruction', { title: 'Rutas del exilio, 1939', alt: 'Dos itinerarios aproximados: Barcelona hacia Portbou y Alicante hacia el norte de África.',
    period: span(1939), projection: 'equal-earth', bounds: [-4.5, 35, 5.5, 44], width: 1200, height: 820,
    layers: [{ data: { geojson: modernOutline, source: outlineSource }, fill: '#e6e2d6' }],
    markers: [{ coordinates: [2.1734, 41.3851], label: 'Barcelona', color: '#3f6ba3', radius: 7 }, { coordinates: [3.1601, 42.4264], label: 'Portbou', color: '#3f6ba3', radius: 7 },
      { coordinates: [-0.4815, 38.3452], label: 'Alicante', color: '#8a5a2b', radius: 7 }, { coordinates: [-0.6417, 35.6971], label: 'Orán', color: '#8a5a2b', radius: 7 }],
    routes: [{ coordinates: [[2.1734, 41.3851], [3.1601, 42.4264]], kind: 'curved', arrow: true, color: '#3f6ba3', width: 4 }, { coordinates: [[-0.4815, 38.3452], [-0.6417, 35.6971]], kind: 'curved', arrow: true, color: '#8a5a2b', width: 4 }],
    overlaySource: { ...reconstruction, label: 'Trazado esquemático entre ciudades actuales' },
    legend: [{ label: 'Ruta del norte', color: '#3f6ba3' }, { label: 'Ruta del sureste', color: '#8a5a2b' }, { label: 'Silueta moderna (referencia)', color: '#e6e2d6' }] }],
];

const EXPECTED = {
  dated: { approximate: false, notice: false },
  reference: { approximate: true, notice: true },
  'dated+reference': { approximate: false, notice: false },
  reconstruction: { approximate: true, notice: true },
};

/** The public endpoint rate-limits bursts and the adapter deliberately does not retry, so the
 *  verification waits and asks again rather than turning someone else's load into a failure. */
const invoke = async (input) => {
  for (let attempt = 1; ; attempt++) {
    try { return (await worker.invoke({ toolId: 'render-historical-map', input })).artifacts[0]; }
    catch (error) {
      const busy = /boundary index|geometry for the selected/i.test(String(error.message));
      if (!busy || attempt >= 4) throw error;
      console.log(`     waiting ${attempt * 20}s for the provider (${String(error.message).slice(0, 60)}…)`);
      await new Promise(resolve => setTimeout(resolve, 20_000 * attempt));
    }
  }
};

let browser;
const failures = [], manifest = [];
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });

  for (const [id, expect, input] of cases) {
    const problems = [];
    let artifact;
    try { artifact = await invoke(input); }
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
      const provenance = escaped ? JSON.parse(escaped.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')) : null;
      const sources = provenance?.sources ?? [];
      if (!sources.length) problems.push('no provenance in the map');
      if (!sources.every(source => source.license && source.attribution)) problems.push('a source without licence or attribution');
      if (expect === 'reconstruction' && !sources.some(source => source.origin === 'caller')) problems.push('a reconstruction case without a supplied source');
      if (expect.startsWith('dated') && !sources.some(source => source.provider === 'openhistoricalmap' && source.period)) problems.push('a dated case without a dated provider source');
      if (expect === 'reference' && !sources.some(source => source.origin === 'provider' && !source.period)) problems.push('a reference case without an undated provider source');
      let clean = svg;
      try {
        clean = await page.evaluate(({ fn, source }) => {
          const result = eval('(' + fn + ')')(source);
          if (!result?.svg) throw new Error('the sanitizer rejected the map');
          if (!new DOMParser().parseFromString(result.svg, 'image/svg+xml').querySelector('#nodus-map-provenance')) throw new Error('the sanitizer dropped the provenance');
          return result.svg;
        }, { fn: sanitizeChatSvg.toString(), source: svg });
      } catch (error) { problems.push(String(error.message ?? error)); }
      fs.writeFileSync(path.join(out, `${id}.svg`), clean);
      fs.writeFileSync(path.join(out, `${id}.json`), JSON.stringify({ input, artifact: { data: { ...data, svg: undefined } }, provenance }, null, 2));
      // The image is the point: a map that passes every assertion can still be unreadable.
      await page.setViewportSize({ width: input.width ?? 1200, height: input.height ?? 900 });
      await page.setContent('<body style="margin:0"><img alt="Generated map" style="display:block;width:100%" src="data:image/svg+xml;base64,'
        + Buffer.from(clean).toString('base64') + '"></body>');
      await page.locator('img').evaluate(image => image.decode());
      await page.screenshot({ path: path.join(out, `${id}.png`) });
      manifest.push({ id, expect, approximate: data.approximate, referenceOnly: data.referenceOnly ?? false, shapes: (svg.match(/<path /g) ?? []).length, labels: [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].length, svgBytes: Buffer.byteLength(clean) });
    }
    if (problems.length) { failures.push({ id, problems }); console.log(`FAIL ${id}\n     ${problems.join('\n     ')}`); }
    else console.log(`ok   ${id}`);
  }

  fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify(manifest, null, 2));
  console.table(manifest.map(entry => ({ id: entry.id, expect: entry.expect, approximate: entry.approximate, shapes: entry.shapes, labels: entry.labels, kb: Math.round(entry.svgBytes / 1024) })));
  if (failures.length) throw new Error(`${failures.length} case(s) failed`);
  console.log(`\nHistorical maps verified: ${manifest.length} cases through the provider and the native renderer, with the production sanitizer and captures in ${path.relative(root, out)}.`);
} finally {
  await browser?.close();
  fs.rmSync(scratch, { recursive: true, force: true });
}
