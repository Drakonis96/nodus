// The result kinds a capability may return, and the rules each one is held to.
//
// Nine kinds, and the interesting thing about them is how little they have in common.
// A formula and a chart are values the core draws. A raster and a sound file are bytes
// the core checks and stores. A map is data that, uniquely among spatial formats, cannot
// point anywhere else. A tiled image is the only kind that reaches the network at all.
// Each is tested against the failure that kind actually has.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-capability-results-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

const bundle = path.join(scratch, 'sdk.cjs');
await build({
  entryPoints: [path.join(root, 'packages/capability-api/src/index.ts')],
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
});
const sdk = createRequire(import.meta.url)(bundle);

const document = (node) => sdk.validateViewDocument({ schemaVersion: 1, summary: 'A result.', nodes: [node] });
const accepts = (node) => document(node).nodes[0];
const refuses = (node, hint) => assert.throws(() => document(node), hint, JSON.stringify(node).slice(0, 160));
const ATTACHMENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

// ---------------------------------------------------------------- formula

test('a formula is TeX and the words that say it', () => {
  const node = accepts({ kind: 'math', tex: 'E = mc^2', alt: 'Energy equals mass times the speed of light squared.' });
  assert.equal(node.tex, 'E = mc^2');
  assert.match(sdk.viewToText({ schemaVersion: 1, summary: 's', nodes: [node] }), /Energy equals mass/);

  refuses({ kind: 'math', tex: '', alt: 'Nothing.' });
  refuses({ kind: 'math', tex: 'x', alt: '' });
  // Set on its own line by default; `display: false` puts it in the run of the sentence.
  assert.equal(accepts({ kind: 'math', tex: 'x^2', alt: 'x squared.', display: false }).display, false);

  refuses({ kind: 'math', tex: 'x'.repeat(sdk.LIMITS.mathChars + 1), alt: 'Too long.' });
  refuses({ kind: 'math', tex: 'x', alt: 'A', display: 'block' });
  // The alt text is what a reader who cannot see it is given, so it is never optional.
  refuses({ kind: 'math', tex: 'x' });
});

// ---------------------------------------------------------------- chart

const series = (overrides = {}) => ({ label: 'Series', points: [[0, 1], [1, 4], [2, 9]], ...overrides });

test('a chart is values, not a drawing', () => {
  const node = accepts({ kind: 'chart', chartType: 'line', title: 'Growth', alt: 'It rises.', series: [series()] });
  assert.equal(node.series[0].points.length, 3);
  // The text projection carries the numbers, so a later turn can reason about them.
  assert.match(sdk.viewToText({ schemaVersion: 1, summary: 's', nodes: [node] }), /Series: 0=1, 1=4, 2=9/);

  accepts({ kind: 'chart', chartType: 'bar', title: 'By country', alt: 'Counts.', series: [series({ points: [['es', 3], ['fr', 5]] })] });
  refuses({ kind: 'chart', chartType: 'pie', title: 'T', alt: 'A', series: [series()] });
  refuses({ kind: 'chart', chartType: 'line', title: 'T', alt: 'A', series: [] });
  refuses({ kind: 'chart', chartType: 'line', title: 'T', alt: 'A', series: [series({ points: [] })] });
  // A series that mixed categories and numbers would have no honest axis.
  refuses({ kind: 'chart', chartType: 'line', title: 'T', alt: 'A', series: [series({ points: [['es', 1], [2, 3]] })] });
  refuses({ kind: 'chart', chartType: 'line', title: 'T', alt: 'A', series: [series({ points: [[0, Number.NaN]] })] });
  refuses({ kind: 'chart', chartType: 'line', title: 'T', alt: 'A', series: [series({ points: [[0, Infinity]] })] });
  refuses({ kind: 'chart', chartType: 'line', title: 'T', alt: 'A', series: Array.from({ length: sdk.LIMITS.chartSeries + 1 }, () => series()) });
  refuses({ kind: 'chart', chartType: 'line', title: 'T', alt: 'A', series: [series({ points: Array.from({ length: sdk.LIMITS.chartPoints + 1 }, (_, i) => [i, i]) })] }, /more points/);
});

// ---------------------------------------------------------------- hierarchy

test('a tree is bounded in both directions', () => {
  const node = accepts({ kind: 'tree', alt: 'A classification.', roots: [{ label: 'Animalia', children: [{ label: 'Chordata', detail: 'phylum' }] }] });
  assert.equal(node.roots[0].children[0].detail, 'phylum');
  assert.match(sdk.viewToText({ schemaVersion: 1, summary: 's', nodes: [node] }), /- Animalia[\s\S]*- Chordata — phylum/);

  let deep = { label: 'leaf' };
  for (let i = 0; i < sdk.LIMITS.treeDepth + 1; i += 1) deep = { label: `level ${i}`, children: [deep] };
  refuses({ kind: 'tree', alt: 'Too deep.', roots: [deep] }, /deeper than/);
  refuses({ kind: 'tree', alt: 'Empty.', roots: [] });
  refuses({ kind: 'tree', alt: 'A', roots: [{ label: 'x', unexpected: true }] });
});

// ---------------------------------------------------------------- marked-up passage

test('a mark points inside the text it came with, and nowhere else', () => {
  const text = 'Ferrocene was first reported in 1951.';
  const node = accepts({ kind: 'passage', text, marks: [{ start: 0, end: 9, label: 'compound' }, { start: 32, end: 36, label: 'year', tone: 'info' }] });
  assert.equal(node.marks.length, 2);
  assert.match(sdk.viewToText({ schemaVersion: 1, summary: 's', nodes: [node] }), /compound: Ferrocene/);

  refuses({ kind: 'passage', text, marks: [{ start: 0, end: text.length + 1, label: 'past the end' }] });
  refuses({ kind: 'passage', text, marks: [{ start: -1, end: 4, label: 'before the start' }] });
  refuses({ kind: 'passage', text, marks: [{ start: 5, end: 5, label: 'empty' }] });
  refuses({ kind: 'passage', text, marks: [{ start: 5, end: 2, label: 'backwards' }] });
  refuses({ kind: 'passage', text: '', marks: [] });
});

// ---------------------------------------------------------------- comparison

test('a comparison carries two texts and lets the core find the differences', () => {
  const node = accepts({ kind: 'comparison', before: { label: '1897', text: 'the first edition' }, after: { label: '1904', text: 'the second edition' } });
  assert.equal(node.before.label, '1897');
  // Nothing in the contract lets a capability say what changed: that is computed, so two
  // packages cannot disagree about what a difference is.
  assert.equal('hunks' in node, false);
  assert.equal('diff' in node, false);

  refuses({ kind: 'comparison', before: { label: 'a', text: 'x' }, after: { label: 'b', text: 'y' }, granularity: 'character' });
  refuses({ kind: 'comparison', before: { label: 'a', text: 'x' }, after: { label: 'b', text: 'x'.repeat(sdk.LIMITS.comparisonChars + 1) } });
  refuses({ kind: 'comparison', before: { label: 'a', text: 'x' } });
});

// ---------------------------------------------------------------- geography

const feature = (geometry, properties = {}) => ({ type: 'Feature', geometry, properties });
const collection = (...features) => ({ type: 'FeatureCollection', features });

test('a map takes GeoJSON, which cannot point anywhere else', () => {
  const node = accepts({
    kind: 'map', title: 'Findspots', alt: 'Three sites along a river.',
    geojson: collection(
      feature({ type: 'Point', coordinates: [-3.7, 40.4] }, { name: 'Madrid', finds: 12 }),
      feature({ type: 'LineString', coordinates: [[-3.7, 40.4], [2.17, 41.39]] }),
      feature({ type: 'Polygon', coordinates: [[[-3.7, 40.4], [2.17, 41.39], [-0.38, 39.47], [-3.7, 40.4]]] }),
    ),
  });
  assert.equal(node.geojson.features.length, 3);
  assert.equal(node.basemap, undefined, 'a basemap is opt-in, because it means requests to a third party');

  // The Earth is a bounded surface and a coordinate outside it is a mistake, not a view.
  refuses({ kind: 'map', title: 'T', alt: 'A', geojson: collection(feature({ type: 'Point', coordinates: [200, 0] })) }, /off the Earth/);
  refuses({ kind: 'map', title: 'T', alt: 'A', geojson: collection(feature({ type: 'Point', coordinates: [0, 91] })) }, /off the Earth/);
  refuses({ kind: 'map', title: 'T', alt: 'A', geojson: collection(feature({ type: 'Point', coordinates: ['3', '4'] })) });
  refuses({ kind: 'map', title: 'T', alt: 'A', geojson: collection(feature({ type: 'Sphere', coordinates: [0, 0] })) }, /Unsupported map geometry/);
  refuses({ kind: 'map', title: 'T', alt: 'A', geojson: { type: 'FeatureCollection', features: [] } });
  refuses({ kind: 'map', title: 'T', alt: 'A', geojson: collection(feature({ type: 'Point', coordinates: [0, 0] }, { note: 'x'.repeat(3_000) })) });

  // The remaining GeoJSON shapes, including the two that are easy to forget: a collection
  // of geometries, and a feature that deliberately locates nothing.
  accepts({
    kind: 'map', title: 'T', alt: 'A',
    geojson: collection(
      feature({ type: 'MultiPoint', coordinates: [[0, 0], [1, 1]] }),
      feature({ type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] }),
      feature({ type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 1], [2, 0], [0, 0]]]] }),
      feature({ type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [0, 0] }] }),
      { type: 'Feature', geometry: null, properties: { note: 'a record with no findspot' } },
    ),
  });
  // A position is longitude, latitude and optionally altitude — never a fourth number.
  accepts({ kind: 'map', title: 'T', alt: 'A', geojson: collection(feature({ type: 'Point', coordinates: [0, 0, 250] })) });
  refuses({ kind: 'map', title: 'T', alt: 'A', geojson: collection(feature({ type: 'Point', coordinates: [0, 0, 1, 2] })) });
  refuses({ kind: 'map', title: 'T', alt: 'A', geojson: collection(feature({ type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [999, 0] }] })) }, /off the Earth/);
  refuses({ kind: 'map', title: 'T', alt: 'A', geojson: collection({ type: 'NotAFeature', geometry: { type: 'Point', coordinates: [0, 0] } }) });
  refuses({
    kind: 'map', title: 'T', alt: 'A',
    geojson: collection(...Array.from({ length: sdk.LIMITS.geoFeatures + 1 }, () => feature({ type: 'Point', coordinates: [0, 0] }))),
  }, /more features/);
});

// ---------------------------------------------------------------- raster and sound

test('an image or a sound file refers to an attachment and declares a format the core opens', () => {
  const image = accepts({ kind: 'image', attachmentId: ATTACHMENT, title: 'Plot', alt: 'A rendered plot.', name: 'plot.png', mimeType: 'image/png', bytes: 4_096, width: 800, height: 600 });
  assert.equal(image.width, 800);
  accepts({ kind: 'audio', attachmentId: ATTACHMENT, title: 'Interview', alt: 'Ten minutes of recorded speech.', name: 'interview.mp3', mimeType: 'audio/mpeg', bytes: 1_000_000 });

  refuses({ kind: 'image', attachmentId: ATTACHMENT, title: 'T', alt: 'A', name: 'x.svg', mimeType: 'image/svg+xml', bytes: 10 });
  refuses({ kind: 'image', attachmentId: ATTACHMENT, title: 'T', alt: 'A', name: 'x.html', mimeType: 'text/html', bytes: 10 });
  refuses({ kind: 'image', attachmentId: ATTACHMENT, title: 'T', alt: 'A', name: '../escape.png', mimeType: 'image/png', bytes: 10 });
  refuses({ kind: 'image', attachmentId: '../secrets', title: 'T', alt: 'A', name: 'x.png', mimeType: 'image/png', bytes: 10 });
  refuses({ kind: 'audio', attachmentId: ATTACHMENT, title: 'T', alt: 'A', name: 'x.mp3', mimeType: 'audio/mpeg', bytes: sdk.LIMITS.audioBytes + 1 });
  // Bytes never travel inline, for any kind.
  refuses({ kind: 'image', attachmentId: ATTACHMENT, title: 'T', alt: 'A', name: 'x.png', mimeType: 'image/png', bytes: 10, data: 'AAAA' });
});

// ---------------------------------------------------------------- what the bytes really are

const png = (width = 2, height = 2) => {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return new Uint8Array(bytes);
};

test('a declared type is a claim, and the bytes decide', () => {
  const info = sdk.validateMediaAsset(png(1024, 768), 'image/png');
  assert.deepEqual({ kind: info.kind, mimeType: info.mimeType, width: info.width, height: info.height }, { kind: 'image', mimeType: 'image/png', width: 1024, height: 768 });

  // An HTML document called a PNG is the case this exists for.
  const html = new TextEncoder().encode('<!doctype html><script>alert(1)</script>');
  assert.throws(() => sdk.validateMediaAsset(html, 'image/png'), /not in a format the viewer can open/);
  // A real PNG that claims to be something else is refused just as firmly.
  assert.throws(() => sdk.validateMediaAsset(png(), 'image/jpeg'), /says it is image\/jpeg but its contents are image\/png/);
  assert.throws(() => sdk.validateMediaAsset(png(), 'audio/mpeg'), /contents are image\/png/);
  assert.throws(() => sdk.validateMediaAsset(png(), 'image/svg+xml'), /not a format the viewer can open/);
  assert.throws(() => sdk.validateMediaAsset(png(), 'text/html'), /not a format the viewer can open/);
  assert.throws(() => sdk.validateMediaAsset(new Uint8Array(0), 'image/png'), /empty/);
  assert.throws(() => sdk.validateMediaAsset('not bytes', 'image/png'), /handed over as bytes/);
  assert.throws(() => sdk.validateMediaAsset(png(20_000, 20_000), 'image/png'), /more pixels/);

  // Sound, by its own signatures.
  const mp3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(sdk.validateMediaAsset(mp3, 'audio/mpeg').kind, 'audio');
  const ogg = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0, 0, 0, 0, 0]);
  assert.equal(sdk.validateMediaAsset(ogg, 'audio/ogg').kind, 'audio');
  assert.throws(() => sdk.validateMediaAsset(mp3, 'audio/wav'), /contents are audio\/mpeg/);
  assert.throws(() => sdk.validateMediaAsset(png(), 'image/png', 'audio'), /Expected audio/);
});

// ---------------------------------------------------------------- tiled imagery

test('a tiled image names a service, and nothing it could smuggle past one', () => {
  const node = accepts({ kind: 'imageTiles', service: 'https://iiif.example.org/iiif/2/manuscript-1', title: 'Folio 3r', alt: 'A manuscript opening.', width: 8_000, height: 12_000 });
  assert.equal(node.width, 8_000);

  refuses({ kind: 'imageTiles', service: 'http://iiif.example.org/x', title: 'T', alt: 'A', width: 10, height: 10 }, /https/);
  refuses({ kind: 'imageTiles', service: 'https://user:pass@iiif.example.org/x', title: 'T', alt: 'A', width: 10, height: 10 });
  refuses({ kind: 'imageTiles', service: 'https://iiif.example.org/x?token=abc', title: 'T', alt: 'A', width: 10, height: 10 }, /no query or fragment/);
  refuses({ kind: 'imageTiles', service: 'https://iiif.example.org/x#f', title: 'T', alt: 'A', width: 10, height: 10 }, /no query or fragment/);
  refuses({ kind: 'imageTiles', service: 'https://iiif.example.org/x', title: 'T', alt: 'A', width: 0, height: 10 });
  refuses({ kind: 'imageTiles', service: 'https://iiif.example.org/x', title: 'T', alt: 'A', width: 10, height: 10, tileSize: 32 });
});

// ---------------------------------------------------------------- permission

test('handing bytes to the core is a declared permission', () => {
  assert.equal(sdk.validateTrustedPermissions({ media: true }).media, true);
  assert.throws(() => sdk.validateTrustedPermissions({ media: 'yes' }), /media permission/);
  assert.equal(sdk.permissionsExpandV2({}, { media: true }), true);
  assert.equal(sdk.permissionsExpandV2({ media: true }, { media: true }), false);
  assert.notEqual(sdk.permissionFingerprint({ media: true }), sdk.permissionFingerprint({}));
  // 3D and media are separate grants: what each checks, and what getting it wrong would
  // mean, are different.
  assert.notEqual(sdk.permissionFingerprint({ media: true }), sdk.permissionFingerprint({ models: true }));
  assert.ok(sdk.HOST_CHANNELS.includes('media'));
});

// ---------------------------------------------------------------- all of it at once

test('every kind survives a round trip through the validator', () => {
  const nodes = [
    { kind: 'math', tex: '\\frac{1}{2}', alt: 'One half.' },
    { kind: 'chart', chartType: 'area', title: 'C', alt: 'A', series: [series()] },
    { kind: 'tree', alt: 'A', roots: [{ label: 'root' }] },
    { kind: 'passage', text: 'abc', marks: [{ start: 0, end: 1, label: 'a' }] },
    { kind: 'comparison', before: { label: 'a', text: 'x' }, after: { label: 'b', text: 'y' } },
    { kind: 'map', title: 'M', alt: 'A', geojson: collection(feature({ type: 'Point', coordinates: [0, 0] })) },
    { kind: 'image', attachmentId: ATTACHMENT, title: 'I', alt: 'A', name: 'i.png', mimeType: 'image/png', bytes: 10 },
    { kind: 'audio', attachmentId: ATTACHMENT, title: 'S', alt: 'A', name: 's.mp3', mimeType: 'audio/mpeg', bytes: 10 },
    { kind: 'imageTiles', service: 'https://iiif.example.org/i', title: 'F', alt: 'A', width: 100, height: 100 },
  ];
  const view = sdk.validateViewDocument({ schemaVersion: 1, summary: 'Everything.', nodes });
  assert.deepEqual(view.nodes.map(node => node.kind), nodes.map(node => node.kind));

  // And every one contributes something a reader who cannot see it can still follow.
  const text = sdk.viewToText(view);
  for (const fragment of ['One half.', 'Series: 0=1', 'root', 'abc', 'x', '[M] A', '[I] A', '[S] A', '[F] A']) {
    assert.ok(text.includes(fragment), `the text projection dropped ${fragment}`);
  }
});

// ---------------------------------------------------------------- what the core computes

// Two helpers the core owns rather than the capability: how a difference is found, and how
// overlapping marks are resolved. Both are the reason those kinds carry no rendering
// instructions — every package gets the same answer because there is only one answer.
const renderers = path.join(scratch, 'renderers.cjs');
await build({
  stdin: { contents: `export { diff, splitMarks } from './src/components/capabilityViewData';`, resolveDir: root, loader: 'ts' },
  outfile: renderers, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{
    name: 'test-environment',
    setup(api) {
      // Neither helper touches React, KaTeX or the translations; stubbing them keeps this
      // a test of the algorithm rather than of the component tree.
      for (const filter of [/^react(\/|$)/, /^katex$/, /i18n$/]) api.onResolve({ filter }, () => ({ path: 'stub', namespace: 'mock' }));
      api.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const t = v => v; export default {}; export const useMemo = (fn) => fn(); export const jsx = () => null; export const jsxs = () => null; export const Fragment = null;', loader: 'js' }));
      api.onResolve({ filter: /^@shared\// }, ({ path: value }) => ({ path: path.join(root, 'shared', `${value.slice(8)}.ts`) }));
    },
  }],
});
const { diff, splitMarks } = createRequire(import.meta.url)(renderers);

const changes = (before, after, granularity = 'line') =>
  diff(before, after, granularity).map(hunk => `${hunk.kind[0]}:${hunk.text}`);

test('the difference between two texts is found, not declared', () => {
  assert.deepEqual(changes('same\n', 'same\n'), ['s:same\n'], 'identical texts have no changes');
  assert.deepEqual(changes('a\nb\nc\n', 'a\nB\nc\n'), ['s:a\n', 'r:b\n', 'a:B\n', 's:c\n']);
  assert.deepEqual(changes('a\nc\n', 'a\nb\nc\n'), ['s:a\n', 'a:b\n', 's:c\n'], 'a pure insertion removes nothing');
  assert.deepEqual(changes('a\nb\nc\n', 'a\nc\n'), ['s:a\n', 'r:b\n', 's:c\n'], 'a pure deletion adds nothing');
  assert.deepEqual(changes('', 'new\n'), ['a:new\n']);
  assert.deepEqual(changes('old\n', ''), ['r:old\n']);
  assert.deepEqual(changes('the first edition', 'the second edition', 'word'), ['s:the ', 'r:first ', 'a:second ', 's:edition']);

  // Whatever it reports, the two sides have to reconstruct: anything else would be a
  // comparison that quietly loses text.
  const before = 'alpha\nbeta\ngamma\ndelta\n';
  const after = 'alpha\ngamma\nGAMMA\ndelta\nepsilon\n';
  const hunks = diff(before, after, 'line');
  const rebuild = kinds => hunks.filter(h => kinds.includes(h.kind)).map(h => h.text).join('');
  assert.equal(rebuild(['same', 'removed']), before);
  assert.equal(rebuild(['same', 'added']), after);
  // And adjacent hunks of one kind are merged, so the rendered output has no seams.
  assert.deepEqual(hunks.map(h => h.kind).filter((kind, i, all) => kind === all[i - 1]), []);
});

test('overlapping marks resolve the same way for every package', () => {
  const text = 'Ferrocene was reported in 1951.';
  const pieces = marks => splitMarks(text, marks).map(piece => `${piece.mark ? piece.mark.label : '-'}:${piece.text}`);

  assert.deepEqual(pieces([{ start: 0, end: 9, label: 'name' }]), ['name:Ferrocene', '-: was reported in 1951.']);
  // The one that starts first wins; the loser is dropped rather than nested.
  assert.deepEqual(pieces([{ start: 0, end: 9, label: 'first' }, { start: 4, end: 12, label: 'second' }]),
    ['first:Ferrocene', '-: was reported in 1951.']);
  // Same start: the longer one wins, so the wider claim is the one shown.
  assert.deepEqual(pieces([{ start: 0, end: 4, label: 'short' }, { start: 0, end: 9, label: 'long' }]),
    ['long:Ferrocene', '-: was reported in 1951.']);
  // Order in the array never matters.
  assert.deepEqual(pieces([{ start: 26, end: 30, label: 'year' }, { start: 0, end: 9, label: 'name' }]),
    ['name:Ferrocene', '-: was reported in ', 'year:1951', '-:.']);
  // Whatever the marks, the text comes back whole.
  for (const marks of [[], [{ start: 0, end: 1, label: 'a' }], [{ start: 0, end: 9, label: 'a' }, { start: 4, end: 30, label: 'b' }]]) {
    assert.equal(splitMarks(text, marks).map(piece => piece.text).join(''), text);
  }
});
