# Result kinds — what a capability can return

A capability returns a `ViewDocumentV1`: a list of nodes, each of them data. There is no
HTML, no script, no CSS and no callback anywhere in the contract, so what a package
supplies is always a value the core draws or a file the core opens — never a fragment of
interface that behaves differently from the rest of the application.

This page covers the kinds added in 5.3.2 alongside [`nodus:3d`](capability-3d.md). The
earlier ones — `paragraph`, `badges`, `table`, `notice`, `details`, `links`, `download`,
`status`, `code`, `svg` — are described in
[ADR-006](architecture/adr-006-capability-api-v2.md).

They divide into four groups by what each one is allowed to reach, and that division
is the point.

## Values the core draws

`math`, `chart`, `tree`, `passage`, `comparison`. No permission, no attachment, no host
channel: the capability states values, and the core renders them. Every chart in Nodus is
therefore drawn by the same code, themes with the rest of the interface, and reads the same
way whichever package produced it.

```js
{ kind: 'math', tex: '\\Delta G^\\circ = -RT \\ln K', alt: 'Standard free energy is minus R T times the natural log of K.' }

{ kind: 'chart', chartType: 'line', title: 'Solubility against temperature',
  alt: 'Both salts rise, potassium nitrate steeply.',
  xLabel: 'Temperature (°C)', yLabel: 'g/100 ml',
  series: [{ label: 'KNO₃', points: [[0, 13], [20, 32], [40, 64]] }] }

{ kind: 'tree', alt: 'A three-level classification.',
  roots: [{ label: 'Alcohols', children: [{ label: 'Primary', detail: 'one carbon on the carbinol carbon' }] }] }

{ kind: 'passage', text: 'Ferrocene was reported in 1951.',
  marks: [{ start: 0, end: 9, label: 'compound', tone: 'info' }] }

{ kind: 'comparison', granularity: 'word',
  before: { label: 'Draft', text: '…' }, after: { label: 'Revision', text: '…' } }
```

Three rules worth stating plainly:

- **TeX is typeset in strict mode with `trust` off.** No `\href`, no `\includegraphics`, no
  macro definitions — the things that turn a formula into a link or a request.
- **A mark points inside the text it came with.** Offsets are bounds-checked against the
  passage; a mark that ran past the end would either be dropped in silence or read
  something that is not there. Marks that overlap are allowed, and the core resolves them
  the same way for every package: the one that starts first wins.
- **A comparison cannot say what changed.** There is no field for it. The core runs the
  diff, so two packages cannot disagree about what a difference is, and neither side can
  present a change that is not in the text.

## Files the core opens

`image` and `audio`. These need `permissions.media`, and the bytes go through
`host.media.store(...)`, which stores them beside the conversation and returns an
attachment id.

```js
const { attachmentId, info } = await host.media.store({
  bytes: pngBytes, mimeType: 'image/png', name: 'spectrum.png',
});
```

Accepted: `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/avif`; `audio/mpeg`,
`audio/wav`, `audio/ogg`, `audio/flac`, `audio/mp4`. SVG is **not** a media type here — a
drawing goes through `nodus:svg`, which sanitises it. Neither is anything else: if the
viewer cannot open it, it is not stored.

**The declared type is a claim, and the bytes decide.** `validateMediaAsset` sniffs the
magic bytes and refuses the asset if they disagree with the declared MIME type, so an HTML
document called a PNG is rejected rather than stored under a name that might later be
trusted. The check runs when the capability hands the asset over and again when the bytes
are read back.

## Data that cannot point anywhere else

`map` takes GeoJSON, and GeoJSON is the rare spatial format with no URI mechanism at all:
there is no field in it that could name a remote resource, so a map is safe by
construction rather than by sanitising. Coordinates are checked against the actual bounds
of the Earth, geometries are restricted to the seven GeoJSON types, and feature properties
are rendered as text through `textContent`.

```js
{ kind: 'map', title: 'Findspots', alt: 'Three sites along a river.',
  geojson: { type: 'FeatureCollection', features: [/* … */] } }
```

`basemap` is opt-in and off by default. Switching it on means a tile request to a third
party every time the result is looked at — that is the capability's to ask for, not ours
to add quietly. Without it the map draws the features on an empty ground, which for
findspots, routes and extents is usually what was wanted anyway.

## The one kind that reaches the network

`imageTiles`, for IIIF Image API and other deep-zoom sources. A manuscript folio is not a
file; it is a service, and no amount of validation makes it self-contained.

```js
{ kind: 'imageTiles', service: 'https://iiif.example.org/iiif/2/folio-3r',
  title: 'Folio 3r', alt: 'A manuscript opening.', width: 8000, height: 12000 }
```

This is the only result kind whose presence in an old conversation can cause a request, so
the gate around it is narrow, lives in the main process
(`electron/capabilities/tileProxy.ts`), and holds every time:

- the capability must be **installed now** — a result left behind by a removed package
  stops working;
- the origin must be one that capability's **own manifest already declared**, with `GET`
  and a matching path prefix, so a view cannot widen what its package was granted;
- the tile path must resolve **under the service base the view named**;
- the host must be **public**, checked by resolving the name, so a saved result cannot
  probe the machine it is opened on;
- and the response must be an image type, within the tile ceiling, with redirects refused.

The renderer never holds a remote URL. It asks the host for bytes, and the host decides.
A tiled image also stays closed until a reader opens it, because opening it is what causes
the requests.

## Alt text

Every kind that is looked at rather than read — `math`, `chart`, `tree`, `map`, `image`,
`audio`, `imageTiles`, `model` — requires `alt`, and the validator refuses the node without
it. It is also what `viewToText` puts into the conversation's text projection, so it is
what a later turn reasons over.

## Limits

In `packages/capability-api/src/limits.ts`, shared with the marketplace validator: 4 000
characters of TeX; 12 series of 5 000 points; 2 000 tree nodes, 12 deep; 200 000 characters
of passage or comparison text with 5 000 marks; 5 000 GeoJSON features and 200 000
positions; 32 MB and 80 megapixels of raster; 128 MB of audio; 8 MB and 4 096 pixels per
tile.

## Where each piece lives

| Piece | File |
| --- | --- |
| Node kinds and their validators | `packages/capability-api/src/views.ts` |
| Byte sniffing, shared with the marketplace | `packages/capability-api/src/media.ts` |
| Permission and host channel | `permissions.ts`, `protocol.ts` (`media`) |
| Host implementation | `electron/capabilities/hostServices.ts` |
| Tile gate | `electron/capabilities/tileProxy.ts` |
| Drawn kinds | `src/components/capabilityViewData.tsx` |
| Asset and service kinds | `src/components/capabilityViewAssets.tsx` |
| Tests | `scripts/test-capability-results.mjs`, `scripts/test-capability-tiles.mjs`, `scripts/test-capability-view-layout.mjs` |

## Licences

three.js (MIT), Leaflet (BSD-2-Clause) and KaTeX (MIT) are all compatible with this
repository's AGPL-3.0-only licence. Nothing else was added: the charts, trees, passages and
comparisons are drawn by code in this repository.
