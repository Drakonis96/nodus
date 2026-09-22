# `nodus:maps` — deterministic cartography

Core capability version **1.0.0**, in the SDK **2.1** development integration. It
converts geographic data into a self-contained SVG and a structured result. No model
draws boundaries, chooses coordinates, retrieves credentials, or repairs source
failures inside this capability. Marketplace Skills supply the workflow; this core
knows no country-specific selection rules or discipline-specific interpretation.

Available in Nodus 5.4.0. Dependent Skills must declare 5.4.0 or later as their
minimum version. Cartographic workflows are supplied by compatible Marketplace
Skills rather than embedded as country-specific rules in the application.

## Entry points

Instruction-only Skills declare `"capabilities": ["nodus:maps"]`. When enabled, the
registry advertises `retrieve` and `render` with their JSON schemas. The shared chat
dispatcher executes a `nodus-capability` request, for example:

```json
{
  "skillId": "<actual enabled skill ID>",
  "capabilityId": "nodus:maps",
  "toolId": "render",
  "input": {
    "title": "Selected countries",
    "alt": "France and Japan highlighted in a world map.",
    "projection": "equal-earth",
    "layers": [{
      "query": {"provider": "natural-earth"},
      "colors": {
        "property": "iso",
        "values": [
          {"value": "FRA", "color": "#559f9b"},
          {"value": "JPN", "color": "#628bb3"}
        ]
      }
    }],
    "legend": [
      {"label": "France", "color": "#559f9b"},
      {"label": "Japan", "color": "#628bb3"}
    ]
  }
}
```

Use `layers[].query` for retrieval and rendering in one pass. Chat execution does not
send tool output to a hidden second model turn. `retrieve` alone provides a dataset
inventory and an export; its random dataset handle cannot be guessed or reused in a
later reply. A trusted v2 package can sequence retrieval and rendering in its own
bounded invocation, using the actual returned features to construct exact selections:

```json
{
  "requires": [{"id": "nodus:maps", "minVersion": "1.0.0", "maxVersionExclusive": "2.0.0"}],
  "permissions": {"maps": {"maxCalls": 4, "providers": ["geoboundaries"]}}
}
```

```ts
const dataset = await host.maps.retrieve({
  provider: 'geoboundaries', country: 'ESP', level: 2,
});
const map = await host.maps.render({
  title: 'Administrative divisions', alt: 'Published administrative boundaries.',
  layers: [{ datasetId: dataset.datasetId }],
});
// Return through the existing validated ViewDocument/artifact machinery.
return { view: {
  schemaVersion: 1, summary: 'Administrative map',
  nodes: [{kind: 'svg', svg: map.svg, title: 'Administrative divisions',
    alt: 'Published administrative boundaries.'}],
}};
```

Permission omission denies the entire channel. `providers: []` permits offline rendering
only. Widening the provider set or call allowance triggers the existing permission
expansion review. This optional v2 host channel changes neither the worker wire version
nor the community v1 sandbox: a community runtime does not gain `host.maps`, filesystem,
network, credentials or Node access. A Skill can request the registered native tool.
Trusted v2 workers remain first-party signed code; their signature is the existing
security boundary, not an untrusted-code sandbox.

## Input contract

The authoritative types and validators are `packages/capability-api/src/maps.ts`;
the advertised tool schemas live in `skill-capabilities/builtins/maps/contract.ts`.

| Field | Meaning |
| --- | --- |
| `title`, `alt` | Required bounded text; SVG accessibility and heading. |
| `layers` | Up to four layers, each with exactly one `query`, scope-owned `datasetId`, or `data: {geojson, source}`. |
| `select` | `{property, values}` exact matches; `$id` addresses feature IDs. Every requested value must exist. |
| `fill`, `colors` | Default polygon color and `{property, values: [{value, color}]}` categorical/value overrides. Colors are `#RRGGBB`. Unknown categories fail. |
| `labelProperty` | An existing scalar feature property, drawn at its projected centroid. |
| `markers` | `{coordinates: [longitude, latitude], label?, color?, radius?}`. No geocoding or inferred locations. |
| `routes` | At least two supplied coordinates; `kind: straight`, `curved`, or `great-circle`, plus optional `arrow`, `color`, `width`, `label`. Each consecutive pair is connected. |
| `overlaySource` | Required attribution/source declaration whenever markers or routes are present. |
| `legend` | Explicit `{label, color}` entries; reserved space separate from geometry. |
| `projection` | `equal-earth` (default), `mercator`, or `equirectangular`. |
| `centralMeridian` | Longitude at the center of the projection. |
| `bounds` | Optional `[west, south, east, north]`, with west < east and south < north. Overlays outside these bounds fail. |
| `detail` | `standard` (shared-topology display simplification) or `full`; source geometry is retained in either case. |
| `width`, `height` | 640–1600 × 480–1400; defaults 1100 × 820. |

GeoJSON must be a nonempty WGS84 `FeatureCollection`. All seven standard geometry
types are accepted, with finite two-dimensional coordinates, closed rings, distinct
vertices, bounded nesting, scalar properties, and unique finite/text feature IDs.
Foreign fields such as `crs`, `bbox`, arbitrary URLs, executable styles, and external
geometry references are not interpreted. Supply preconverted WGS84 data. Structural
and geographic validation is not a certification of cadastral accuracy or a complete
self-intersection/topology audit.

Polygon winding is normalized for D3 on a copy. Standard display simplification shares
edges through TopoJSON and preserves tiny rings that simplification would erase. SVG
path coordinates are rounded; exported geometry retains the source vertices. Polygons
are ordinary geographic regions, not complements covering more than a hemisphere.
Mercator overlay latitudes at or beyond ±85.051129° fail. Use `great-circle` for routes
crossing ±180°; straight and curved routes reject that ambiguous input. Connections
are cartographic lines, never road routing or navigation directions. Curvature is a
deterministic visual offset, not evidence of a real travelled path.

Labels are bounded, clamped to the map frame and placed at the anchor their data gives them: a
feature's projected centroid, a marker, a route's middle. One that cannot be placed without
starting outside the frame or covering a label already placed is **omitted** — markers and routes
claim theirs first, polygons largest-first. There is no global collision solver and no automatic
inset layout: a division too small for its own name keeps its geometry and loses the label, which
is the honest answer at that scale. Dense maps still read best with fewer labels or a larger
canvas. SVG exports use their own white canvas and readable ink in either application theme.

## Sources, licensing and provenance

Reviewed on 2026-09-12. Retrieval uses fixed origin/path templates, HTTPS, public DNS,
no credentials/cookies, no redirects and bounded streaming responses. Source metadata
cannot become a fetch URL. Requests cannot select arbitrary repositories or files.

| Provider | Data and terms |
| --- | --- |
| `natural-earth` | World country polygons, 1:110m, pinned tag 5.1.2. [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/) place the data in the public domain. Visible credit is retained even though it is not required. |
| `geoboundaries` | [gbOpen API](https://www.geoboundaries.org/api.html), one ISO alpha-3 country and ADM0, ADM1 or ADM2. Metadata must match the request; downloads are confined to the geoBoundaries repository and its returned revision. Git LFS downloads additionally require exact size and SHA-256. [Catalogue licensing](https://github.com/wmgeolab/geoBoundaries/blob/main/LICENSE) does not override the original source licence. |
| `openhistoricalmap` | [Overpass API](https://overpass-api.openhistoricalmap.org/api/interpreter), admin level 2 or 4 inside the map's own bounds and for one period. [OpenHistoricalMap](https://www.openhistoricalmap.org/copyright) dedicates its data to the public domain under **CC0**, except individual elements carrying their own `license=*`; the adapter refuses those rather than assuming. Two fixed query templates exist — a boundary index and the geometry of the selected relations — and both are rebuilt from validated fields, so no caller text reaches the URL. |

The geoBoundaries adapter accepts explicitly reviewed CC BY 4.0, CC BY 3.0, CC0,
public-domain metadata and the INE Data License on `www.ine.es`; other terms fail closed.
It preserves geoBoundaries attribution, original owner/year, original licence and source
links, revision, download SHA-256, and modification notices. Spain's ADM1 example uses
a published 2017 snapshot; ADM2 uses a 2018 snapshot from INE. The
[INE reuse terms](https://www.ine.es/ss/Satellite?L=0&c=Page&cid=1254735849170&p=1254735849170&pagename=Ayuda%2FINELayout)
require attribution and identifying adapted information; this is included in the map.
Published snapshots are not guaranteed current or authoritative legal boundaries.

The OpenHistoricalMap adapter selects by the element's own dates: a boundary is kept only
when its `start_date` is at or before the period and its `end_date` at or after it, an
element with no start date is not drawn (an undated boundary cannot be placed in a period),
and an element whose centre falls outside the map frame is a neighbour the map is not about.
Its relations carry OSM-detail member ways, so geometry is fetched in batches that fit the
response ceiling, thinned with Douglas-Peucker towards a point budget, and simplified again
by the renderer for the screen; the tolerance used is reported in the provenance, together
with the duplicate relations collapsed, the undated and unclosed elements left out, and the
elements outside the frame. Coverage is community-mapped and uneven: Spanish provinces are
mostly absent, some regions exist only as labels, and a boundary the project has not mapped
is reported as absent rather than approximated. The public endpoint rate-limits bursts and
answers with an HTML error page, which the adapter reports as the service being busy; it
never retries and never substitutes another source.

No OSM tile server is integrated. The [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/)
is not treated as permission to use community servers as an application backend.
`query.period: {from, to}` validates ISO dates (including expanded signed BCE years, such as `-000500-01-01`).
It is **refused before any network request** for `natural-earth` and `geoboundaries`, which
publish only the present; `openhistoricalmap` requires it, because a boundary without a date
cannot be selected or reported. Modern polygons are never substituted for a historical
request. Caller-supplied historical GeoJSON can carry `source.period` and an evidence `url`;
Nodus still marks that provenance as caller-supplied, not provider-verified, and a request
whose supplied sources carry no covering dated period renders as a stated approximate
reconstruction rather than as a dated map.

Every SVG has visible attribution and a `desc#nodus-map-provenance` containing escaped
JSON. The production SVG sanitizer preserves it. The structured result includes:

```ts
{
  schemaVersion: 1, capabilityId: 'nodus:maps', svg,
  geometry, // selected GeoJSON layers, before display simplification
  overlays: {markers, routes}, // original exact coordinates and styles
  provenance: {sources, projection, centralMeridian, bounds?, coordinates, routes}
}
```

Sources include origin (`provider` or `caller`), licence and licence URLs, attribution, SHA-256,
modifications, and provider version/retrieval time where available. Caller inputs cannot
set provider/digest/origin fields. Provider datasets are retained behind scope-owned
random IDs; editing returned data or replaying another scope's ID cannot change them.
Saved chats also receive a downloadable `map-data.json` with geometry and provenance.
It uses compact JSON and the existing 10 MB capability-file ceiling.
Trusted packages may store the result using their existing artifact/file permissions.

## Execution boundaries and failure behavior

Per reply/host-service scope: at most **8 calls**, **4 source retrievals**, and **30 seconds
per call**. The manifest may lower its call limit. Failed/parallel attempts consume the
same counters. Retrieval also consumes the existing chat network allowance. These are
maxima, never quotas to fill. No paid API or model call is part of maps.

Inputs are capped at 12 MB of serialized JSON characters, 5,000 features and 200,000
positions per layer; source responses at 16 MB; SVG at 300,000 characters; overlays at
200 markers / 100 routes of at most 100 coordinates. The chat request envelope retains
the existing tighter 64,000-character limit. Use provider queries or trusted host-owned
datasets for larger geometry. Cancellation propagates to fetch and native rendering,
and cancels pending host services when a worker is cancelled/stopped. Late results are
discarded. There is no automatic retry, source substitution or recursive model call.

Model-authored result/view/artifact blocks are rejected before execution across the
shared chat dispatcher. Native outputs enter as execution results and are not reparsed
as new instructions. A provider failure, unknown region, unsupported licence, exhausted
budget, malformed data or unavailable historical adapter returns an error, not a
successful-looking fabricated map. Attribution assertions from caller data are always
identified as unverified.

## Verification and release

```sh
NODUS_MARKETPLACE_DIR=/path/to/marketplace npm run test:skill-capabilities
npm run build
npm run licenses:verify
npm run verify:maps
node scripts/sync-skill-marketplace.mjs /path/to/marketplace --contracts-only
NODUS_MARKETPLACE_DIR=/path/to/marketplace npm run verify:cross-repo
```

The full suite includes malformed geometry, winding/tiny rings, three projections,
numerical marker/route endpoint checks, source licensing and LFS integrity, HTTP/DNS
restrictions, forged results on all seven chat orchestrators, budgets, cancellation and
real worker permission tests. `verify:maps` retrieves public datasets (cached locally),
renders five examples, verifies the production SVG sanitizer and captures PNGs in
`artifacts/maps/`: administrative communities, provinces, the five colored provinces of
Castilla-La Mancha, world highlights, and multi-point routes with labels and legends.
The fixtures and example choices are outside the generic capability.

The `--contracts-only` export synchronizes the Marketplace's generated validators
without editing Skills or catalog entries. Core `nodus:maps` ships with Nodus and uses
its normal application release process; it is not a separately signed Marketplace
package. Existing Ed25519 signing remains in the protected Marketplace release workflow.
No production keys or signatures are created by this implementation. Human CLA acceptance
remains the human contributor's action. See the [release runbook](capability-release-runbook.md).

## Marketplace workflows

The signed [Research Visuals package](https://github.com/NodusResearch/nodus-research-skill-marketplace/tree/main/plugins/research-visuals) supplies General Maps and Historical Maps. Both delegate rendering to this service. Historical Maps labels what it renders: a source whose declared period covers the request and carries an evidence link produces a dated map, any other supplied geometry or coordinate overlay produces an approximate reconstruction that says so in the map itself, and a `layers[].query` is drawn as a **reference frame** — attributed, described in the map as today's boundaries, and never counted as a dated source. Administrative divisions asked for by name therefore appear even when only the current division is published, and the map says which one it is drawing. [Verification examples](verification/research-visuals/README.md) preserve editable SVG, attribution and visual previews.
