# Worldbuilding — Maps

> Status: **M0–M7 implemented. The plan is complete** (2026-07-27). Schema in **v97**.
> `npm test`1023/1023 · typecheck, lint (0 errors), i18n (7 languages) and`build`Green.
> ** WITHOUT COMMIT.**
>
> | Phase | Deliverable |
> |---|---|
> | M0 | Migration v97 (5 tables), pure `shared/worldMapGeometry.ts`, two repositories, IPC, dedicated image path, `syncTables` |
> | M1 | Maps section (replaces "Map" in worldbuilding), grid, image upload, Leaflet `CRS.Simple` viewer, breadcrumbs |
> | M2 | Two-point calibration, native scale bar and compass rose, distance ruler with travel times, travel modes |
> | M3 | Point → circle → polygon → route with manual vertex editing, layers, bidirectional links to places |
> | M4 | `shared/worldPresence.ts` (scenes + events + residence as background), playback timeline, interpolated travel |
> | M5 | `resolveMapFocus`, automatic character following, cast strip with jumps between maps |
> | M6 | `shared/mapPrompt.ts` (10 styles), per-provider capabilities with honest fallback, non-AI cropping, AI zoom, outpainting, vision annotation |
> | M7 | Scenes on the map, impossible journeys, encounter finder, PNG export |
>
> Verified **on screen** in addition to tests: click → exact normalized coordinate in
> five tests; 224 km measured on a map of 400 km with 8,9/4,1/1,9 days;
> exact scale at three zoom levels; and a dragged vertex from (0.45 · 0.25) to
> (0,622 · 0.162) with a single commit.
>
> **Five real bugs caught watching the screen, none for the tests:**
> 1. `@napi-rs/canvas`use WebP quality **0–100, no 0–1**: with`0.88`a map of 4096 px
> I was going out 16 kb of puree.
> 2. The scale bar depended on`setTick`(stable) instead of`tick`: calculated as one
> time and never again.
> 3. The`fitBounds`initial ran with container still without size → zoom minimum. Race.
> 4. `pointsRef.current = points`assigned in render: **drag a vertex no
> He kept nothing**.
> 5. `mapCoverage`collided with the research map — and`tsc --noEmit`no
> cover`electron/`So only the build saw it.
>
> **Two test gaps that were only mutating** and led to rewrite code:
> the comparator of`sortPresences`was *inconsistent* with null (the result depended on
> of the internal algorithm of V8, so now it participates instead of comparing), and the guard of
> nil`buildJourneys`was not exercised with all the presences without date.
>
> What you could NOT exercise with a real gesture: add a vertex dragging a
> intermediate point and delete it with Alt+click. Covered by unit tests of
> `insertVertex`/`removeVertex`/`midpoints`and by assertions about the handlers.

> Original design (2026-07-27). Current schema **v96**; this plan introduces **v97**.
>
> The five open decisions were resolved on 2026-07-27 and are implemented in the
> the body of the document; §13 collects them with its motif.
>
> Precedents:[worldbuilding-characters-plan.md](worldbuilding-characters-plan.md),
> [worldbuilding-collections-plan.md](worldbuilding-collections-plan.md),
> [worldbuilding-families-plan.md](worldbuilding-families-plan.md).

---

## 0. On what is built (what YA exists)

Before inventing anything, it is best to fix what is there, because half of this design consists of
**do not duplicate it**.

| Piece | Where | What does it bring? |
|---|---|---|
| `places` + `place_profiles`(v95) | `electron/db/worldPlacesRepo.ts` | The places, their hierarchy (`parent_id`), its sorter (`kind`) and the layer of fiction (appearance, atmosphere, history,`visual_seed`, accent). |
| `person_places` | genealogy | Person ↔ place with`label`and`date`/`date_sort`. **The column is called`label`, no`role`.** |
| `events` + `event_participants` + `event_world_dates` | genealogy + v91 | A fact with`place_id`their participants and their`world_day`Absolutely. |
| `world_scenes` + `scene_characters`(v96) | `worldStoryRepo.ts` | The writer's real unity of work: place,`world_day`, `narrative_order`, status. |
| `worldCalendar.ts` | `shared/` | You were, months, and the date conversion invented.`world_day`No leap years, by design. |
| `world_images`(v94) | `worldImagesRepo.ts` | Polymorphic gallery (`entity_kind`/`entity_id`) with blobs. |
| `callImageProvider` | `electron/ai/decorativeImages.ts` | Google / OpenAI / OpenRouter / Nodus local,`(provider, model, prompt) → bytes`. |
| `aiClient`with`images` | `electron/ai/aiClient.ts` | Entry **multimodal**: a text model can *see* an image. |
| Leaflet 1.9.4 | `src/components/PlacesMap.tsx` | Genealogy uses it with real OSM tiles. |
| `WorldWorkspace` + `worldFilters` | `src/components/world/` | Header, finder, facets and tab: the housing of all Vault collection. |

**What to throw away.**Today the "Map" entry of the worldbuilding sidebar points to`MapView`, the
genealogy map, which projects lat/lon on OpenStreetMap tessels. In a invented world places do not
have gacetero coordinates, so that view comes out **always empty**: it is not that it is
improveable, it cannot work.

**Decided: replaces it.** "Map" becomes the new view and there is no second entry.`MapView`remains
intact and remains that of genealogy —`VAULT_TYPE_SCOPED_VIEWS`you already know how to distribute
views by type of vault, which is exactly the mechanism that is needed.

The case we lose — historical fiction of geocoded real places — has exit without a second entry in
the menu: a map with`projection = 'globe'`and a real background film does the same work within the
new view. If one day demand for truth appears, the correct way is not to duplicate the section but
to admit a tessela origin as a`kind`more map.

---

## 1. The conceptual model

### 1.1 A map is a canvas, not a place

The structural decision of the whole design. A **map** is an image with a coordinate system; a
**place** is an entity of the world. They are not the same and the relationship between them is from
many to many:

- A city ** appears as a chincheta** on the map of the continent, on the map of the kingdom and on
  the map of trade routes.
- That same city **has its own map**, and that map contains bedbugs from its neighborhoods.
- A map may not be from anywhere: "the positions of the battle of Vael, day 3".

Hence the user requirement ("as many maps as there are places can be created even"): it is not that
each place *has* a map, it is that **anywhere can have one**, and the map is anchored to the place
with`world_maps.place_id`.

### 1.2 The map hierarchy

`world_maps.parent_map_id`+ the rectangle it occupies within the parent (`parent_x0/y0/x1/y1`This
gives three free things:

1. **Deep navigation.** Double click on the Aldermoor china → opens the map of Aldermoor. Back →
   breadcrumbs`Mundo › Norte › Aldermoor › La Ciudadela`.
2. **Scale inheritance** (§3.3).
3. **Pinch projection** when zooming with AI (§7.4): the bedbugs falling inside the rectangle are
   already placed on the child map.

The hierarchy of maps ** is not required to coincide** with that of places. It will coincide almost
always, but a map of "silk paths" crosses five kingdoms and does not hang from any.

### 1.3 Coordinates: standardized, always

All coordinates (chinchetas, vertices, rectangles, calibration) are stored as **real 0.1** relative
to the width and height of the image, never in pixels.

Reason: the base image ** is going to change**. It regenerates with another style, it uploads a
version in more resolution, it expands by an edge. With pixels, each of those gestures moves all the
chinks. With standardized coordinates, only the *outpainting* moves them — and there the
transformation is a familiar and explicit affin (§7.5).

`world_maps`saves also`width_px`/`height_px`natives, because to measure distances it is necessary to
correct the aspect ratio: a displacement of 0.1 in X and another of 0.1 in Y are not the same
distance unless the image is square.

---

## 2. Scheme (migration v97)

```sql
-- ── Maps ────────────────────────────────────────────────────────────────────
CREATE TABLE world_maps (
  map_id        TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  -- world | continent | region | city | town | building | interior | dungeon
  -- | battle | route | schematic | other
  kind          TEXT NOT NULL DEFAULT 'region',
  -- ‘This map is that of this place’. SET NULL: erasing the place should not take the
  -- map, which can still have value as a foil.
  place_id      TEXT REFERENCES places(place_id) ON DELETE SET NULL,

  parent_map_id TEXT REFERENCES world_maps(map_id) ON DELETE SET NULL,
  -- Where this map falls within the father, in normalized coordinates of the father.
  parent_x0 REAL, parent_y0 REAL, parent_x1 REAL, parent_y1 REAL,

  image_id      TEXT,               -- → map_images.image_id (current base)
  width_px      INTEGER NOT NULL DEFAULT 0,
  height_px     INTEGER NOT NULL DEFAULT 0,

  -- Calibration: ‘this segment measures so much’.
  -- length, to survive any renormalization (§3.1).
  scale_x0 REAL, scale_y0 REAL, scale_x1 REAL, scale_y1 REAL,
  scale_distance REAL,              -- How much that segment measures...
  scale_unit     TEXT,              -- ...in this unit (km, mi, league, m, ft, custom)

  -- flat (default) | globe. `globe` treats the image as equirectangular over
  -- a given radio planet and measure with havingsine.
  projection     TEXT NOT NULL DEFAULT 'flat',
  planet_radius  REAL,
  planet_radius_unit TEXT,

  -- A map can be of one epoch: "the Empire in the year 300".
  from_world_day INTEGER,
  to_world_day   INTEGER,

  -- Visual consistency anchor, as well as`place_profiles.visual_seed`.
  visual_seed    TEXT,
  style          TEXT,              -- the cartographic style with which it was generated
  -- 0 = Nodus marker (default); 1 = the model is asked to write the names.
  model_labels   INTEGER NOT NULL DEFAULT 0,
  notes          TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_world_maps_place  ON world_maps(place_id);
CREATE INDEX idx_world_maps_parent ON world_maps(parent_map_id);

-- ── Images ──────────────────────────────────────────────────────────────────
-- Own table and NO`world_images`: maps need high native resolution and
-- `optimizedJpegs`cut to 1280 px (§12, landmine no1). Also here we save the
-- version history, which a gallery doesn't have.
CREATE TABLE map_images (
  image_id   TEXT PRIMARY KEY,
  map_id     TEXT NOT NULL REFERENCES world_maps(map_id) ON DELETE CASCADE,
  -- base | previous | reference   (`previous`= undo a regeneration)
  role       TEXT NOT NULL DEFAULT 'base',
  mime_type  TEXT NOT NULL DEFAULT 'image/webp',
  width      INTEGER NOT NULL DEFAULT 0,
  height     INTEGER NOT NULL DEFAULT 0,
  bytes      INTEGER NOT NULL DEFAULT 0,
  blob       BLOB,
  thumbnail  BLOB,
  prompt     TEXT,
  provider   TEXT,
  model      TEXT,
  style      TEXT,
  generated  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_map_images_map ON map_images(map_id, role);

-- • Layers
CREATE TABLE map_layers (
  layer_id   TEXT PRIMARY KEY,
  map_id     TEXT NOT NULL REFERENCES world_maps(map_id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  -- political | physical | routes | climate | culture | battle | custom
  kind       TEXT NOT NULL DEFAULT 'custom',
  color      TEXT,
  opacity    REAL NOT NULL DEFAULT 1,
  visible    INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_map_layers_map ON map_layers(map_id, sort_order);

-- ── Markers and shapes ──────────────────────────────────────────────────────
CREATE TABLE map_markers (
  marker_id     TEXT PRIMARY KEY,
  map_id        TEXT NOT NULL REFERENCES world_maps(map_id) ON DELETE CASCADE,
  layer_id      TEXT REFERENCES map_layers(layer_id) ON DELETE SET NULL,

  -- The link to the world. NULL = decorative chink or still unallocated.
  place_id      TEXT REFERENCES places(place_id) ON DELETE SET NULL,
  -- Double click enter here. Normally the map of the same place, but not mandatory.
  child_map_id  TEXT REFERENCES world_maps(map_id) ON DELETE SET NULL,
  label         TEXT,               -- override; NULL = use place name

  -- point | circle | polygon | path
  geometry_kind TEXT NOT NULL DEFAULT 'point',
  x REAL NOT NULL, y REAL NOT NULL, -- anchor (centroid in shapes)
  radius REAL,                      -- circle; normalised against X-axis
  points TEXT,                      -- JSON [[x,y],...] for polygon/path

  icon  TEXT,
  color TEXT,
  -- Temporary validity: borders move, cities fall.
  from_world_day INTEGER,
  to_world_day   INTEGER,

  notes      TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_map_markers_map   ON map_markers(map_id, sort_order);
CREATE INDEX idx_map_markers_place ON map_markers(place_id);

-- Travel modes (from the Vault, not from a map)
CREATE TABLE map_travel_modes (
  mode_id    TEXT PRIMARY KEY,
  name       TEXT NOT NULL,          -- ‘foot’, ‘horse’, ‘carro’, ‘boat’
  distance_per_day REAL NOT NULL,
  unit       TEXT NOT NULL,
  icon       TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**There is no table of "character positions".** It is deliberate and is the most important decision
of §6: where a character is already registered three times (events, scenes,`person_places`A fourth
table would be a fourth answer to the same question and would diverge within a week.

**Synchronization:** the four new tables go to the
group`worldbuilding`of`electron/db/syncTables.ts`. A table that is not there does not travel . . . .
and its erased ones resurrect . . . . . . . . . . . . . . . . . . . . .

---

## 3. Scales: generation and calculation

The user explicitly asks that the scale count ** both when generating and when calculating**. They
are two uses of the same data and should be treated together.

### 3.1 Calibrate

The author traces a segment on the map and writes how much it measures: «this is 200 leagues». The
two standard ends plus distance and unit are saved. The conversion is:

```
pixelLength = hypot((x1-x0) * width_px, (y1-y0) * height_px)
unitsPerPixel = scale_distance / pixelLength
```

Saving the ends and not the length is what makes the calibration ** survive an image regeneration in
another resolution**: the ends are still the same two points in the drawing.

If there is no calibration, the view does not lie: the scale bar shows "no scale" and the distance
tools are offered disabled with a link to calibrate. Never a invented distance.

### 3.2 Projection

- **`flat`** (default): Euclidean geometry. It is the right thing for almost everything — a region,
  a city, a dungeon.
- **`globe`**: the image is interpreted as equirectangular on a planet with radius
  `planet_radius`. X ↔ longitude [-180, 180], Y ↔ latitude [90, -90], with Haversine distances. It only makes sense on a
  world map, and there it matters: in plane, the distance between two arctic points goes wild. It
  also allows to say "my world is 0.8 Earths", which is a decision that writers make and then they
  cannot use at all.

Reuse the vocabulary of`shared/mapProjection.ts`; new logic lives in`shared/worldMapGeometry.ts`,
pure and with tests.

### 3.3 Inheritance and consistency between maps

A map son with`parent_map_id`and known rectangle ** can derive its scale from the father** without
the author calibre anything:

```
childUnitsPerPixel = parentUnitsPerPixel * (parent_x1 - parent_x0) * parentWidthPx / childWidthPx
```

And when there are both—inherited and calibrated by hand—Nodus **tell if they don't fit**:

> «The map of Aldermoor is calibrated to 4 km wide, but its footprint on *The North* measures
> 40 km. One of the two is wrong."

This snitch is cheap (a comparison) and hunts down a mistake that if not discovered three months
later, writing a chase scene.

### 3.4 The scale in the prompt

In generating (§7) the author says the intended extension: «a region about 600 km wide». That does
two things:

1. Enter the prompt. A model draws different things if you ask for 600 km (cordilleras, several
   kingdoms) or 6 km (a valley, a village and its fields). Without that data come maps with the
   wrong detail density, which is the most common failure of the generated maps.
2. **Precalibrates the resulting map**:`scale_distance`= 600 km above the segment (0.0.5)→(1.0.5).
   The map is measurable. The author can recalibrate if the model deviated, but not part of zero.

---

## 4. Chinches: from point to exact shape

The user asks: chinches, approximate radius of action, hand adjustable radius, be able to **add
adjustment points** and edit them "to fit the shape of a place to perfection". That is a four-step
ladder, and the design makes it continuous:

| Sling | `geometry_kind` | Gesto |
|---|---|---|
| 1. One point | `point` | Click on the map. |
| 2. A radio | `circle` | Drag the edge shooter, or type "12 km" on the tab. |
| 3. A form | `polygon` | «Convert into shape» → the circle becomes a polygon of 12 drawable vertices. |
| 4. An exact form | `polygon` | Drag vertices; the **intermediate pullers** (one at the midpoint of each edge) add vertex by dragging them;`Alt`+click removes. |
| — | `path` | Open line: rivers, roads, walls, the route of a march. |

Point 3 is the key to this feeling as *one* tool and not four: the polygon ** is born from the
circle**, with the vertices already in place. No one begins to draw the contour of a forest from
scratch; what they want is to dent a circle.

The radius is stored against the X-axis and displayed in units of the world when there is a scale. A
radius in km written by hand is converted when saved.

**Decided: edition of vertices by hand, without new
dependence.**`leaflet-editable`o`leaflet-draw`they would solve this, but they are ~40 KB and an API
that needs to be tamed for the 20% we would use, and their appearance is not that of the rest of the
app.`L.marker`Towable by vertex plus another by midpoint are ~200 lines with total control, and it
fits with how this code base has solved the tour engine or the center of the badge: by hand,
measured, without dependency.

What you have to do right to make it count, and that goes in the tests:

- **Undo by gesture**, not by vertex: drag and drop is ONE action. Without this, undoing an outline
  of thirty points is thirty pulsations.
- **Track threshold** (~4 px) before moving: without it, a click to select scrolls the vertex one or
  two pixels and the contour degrades only by looking at it.
- **The shooters do not re-escalate with zoom** (they go in screen pixels, not in map units), or
  when they move away they become unreachable.
- **`Alt`+click removes**, with at least 3 vertices in polygons and 2 in routes.

---

## 5. Linking to places

### 5.1 From map to location

Click on a chinheta without place → a search engine for the places already saved (the
same`SearchableMultiSelect`that use the scenes), with "create new place" at the end. It is exactly
the flow that the user asks for: *"when the user clicks on a chinheta will add a place that he has
already saved"*.

When assigning, the chinheta inherits name, icon by`kind`and accent colour of the place
(`place_profiles.accent`), and ** the kind suggests geometry**: a`city`is born circle, a`river`is
born`path`, a`realm`is born polygon. Suggestion, not imposition.

### 5.2 From place to map

The location tab wins a section **"On the maps"**: thumbnail cut around your chinheta on each map
where it appears, and a "Create the map of this place" button that creates
a`world_maps`with`place_id`post and`parent_map_id`to the map where it is already punctured, with the
rectangle taken from the radius of the chincheta. The back and back are symmetrical.

### 5.3 Navigation

Breadcrumbs by`parent_map_id`. Double click on a chincheta with`child_map_id`a minimap in the corner
shows the rectangle of the current map inside your father — what in an atlas is the box "you are
here".

---

## 6. The Temporary Layer

The heart of what the user asks, and where this design is separated from the genealogy map: there
the time line sweeps **years**; here sweeps **days of the world**, and the characters do not appear
and disappear, ** move**.

### 6.1 Resolve where someone is:`shared/worldPresence.ts`

A pure function that unites the three existing fonts and returns, per character, an ordered list of
presences:

```ts
interface Presence {
  personId: string;
  placeId: string;
  worldDay: number | null;      // null = dateless
  source: 'scene' | 'event' | 'residence';
  sourceId: string;
  label: string | null;         // ‘residency’, the title of the scene...
}
```

- `world_scenes` ⋈ `scene_characters`→ the main source for a novelist.
- `events` ⋈ `event_participants` ⋈ `event_world_dates`→ births, battles, trips.
- `person_places`→ Long term residences (come without`world_day`; see §6.5).

Rules, all testable without database:

1. ** Consecutive presences in the same place collapse** in an interval — just
   like`buildMigrationPath`The repeated stops collapse. Being is not moving.
2. Between two presences in different places there is a **transit**: `[departureDay, arrivalDay]` from A
   to B. The character doesn't teleport, travels.
3. A presence without a date is not ruled out: it anchors at the end, visible but outside the sweep
   (same criterion that`buildMigrationPath`).

### 6.2 Reproduction

A head on`world_day`, not over the year. Controls: play/pause, speed (×0.5 ×1 ×2 ×5), step by day,
and **jump to the next event** — because in a world with 360 days per year, advance one by one
between two scenes separated by half a year is insufferable. The default range goes from the first
to the last event of the selected cast, not from the entire calendar.

During a transit the character's chincheta is **interpola** along the path and the discontinuous
trail is drawn. If there is a`path`(a road) between the two places, the path follows it; if not,
straight.

No defined calendar, all degrades to`world_year` + `world_order`, exactly as it already
does`TimelineView`The map works on the first day, without the author having invented twelve months.

### 6.3 Follow a character between maps

The user's most specific requirement: *"if we click to play temporarily and we are on one map but
the character jumps to another, we will do it too"*.

The head is **global**, not the map. The view solves in each instant which map it looks at, with a
pure function`resolveMapFocus(placeId, maps, markers, currentMapId)`:

1. Climb the chain of ancestors of the place (`places.parent_id`), from the most specific to the
   most general.
2. For each ancestor, look for maps where that place has chinheta **valid on that day**.
3. He prefers, in this order: **the current map** (do not change if not necessary) → the map
   whose`place_id`be the most specific ancestor → the most recently used.

Point 3 matters: without it, the view jumps off the map every two days and tidal.

**Autotracking: switch, active by default only with A selected character.** With five characters on
four maps, following automatically would be a screen dance. With several selected ones appears
instead a ** delivery strip**: a chip per character with his portrait, where he is and on which map;
those outside the current map are shown attenuated and with the name of the map, and a click jumps
there. It is seen all without anything moving alone.

The transition between maps is a cross-fade with the name of the new map, not a cut: if not, it is
impossible to know that you have changed places.

### 6.4 Changing borders

`map_markers.from_world_day` / `to_world_day`They are not only for chinchettes: a **polygon** with
temporary validity is a border. When moving the head, the empire expands, the city falls, the forest
burns. It is the same machinery and makes the timeline on the map much more than moving points.

### 6.5 Long-term presences

`person_places`has no`world_day`(save`date`/`date_sort`, Earth format).

**Decided: the residence is the FUND.** Where someone is when no scene or event says anything else,
without a proper date. It does not touch scheme, and a residence is conceptually a default state,
not an event.

As a result`worldPresence.ts`: the residence enters with`worldDay: null`When solving a particular
day, it always wins the scene or the dated event; the residence only fills the gaps and ** does not
generate transits** (you cannot interpolate a trip against something that has no date). It is drawn
attenuated and with the label "residency", so that it is seen to be an assumption and not a data.

If in real use it is missed to say "lived in Vael from the day 200 to 900", the exit is a bridge
table`person_place_world_dates`analogous to`event_world_dates`. It is additive: it does not migrate
anything that the author has written by then.

---

## 7. Generation with AI

### 7.1 Cartographic Styles

`shared/mapPrompt.ts`, pure and with tests, shaped in structure
to`shared/characterImagePrompt.ts`(where only ORDEN matters):

```
style → world visual_seed → framing by map type → required content
       → intended scale → label policy → negative prompts
```

Styles:`parchment`(classical pergamino),`inked_atlas`(recorded to down),`painted_fantasy`,
`watercolour`, `satellite`, `blueprint`, `isometric`, `hand_drawn_sketch`, `dark_grimoire`,
`nautical_chart`.

Frames by`kind`: world / continent / region / walled city zenith view / floor plan / dungeon /
interior / battle deployment / route map.

**`visual_seed`at the level of map and world.** Just as the portrait of a character is anchored in
his`visual_seed`, here are two anchors: the one of the world (pallet, height of mountains, type of
coast) so that all the maps of the Vault seem of the same atlas, and the map so that it regenerates
it does not make it another place.

### 7.2 Labels are NOT drawn by the model (default)

The product decision that will be most noticeable. **Decided: Nodus draws by default, with a box per
map to leave to the model.**

The image models write unreadable or faulty text, and a map is full of text. By default the prompt
has an explicit negative — "without text, without letters, without signs, without legend, without
wind rose, without frame" — and **Nodus draws the labels above**, taken from the real names of the
places.

Advantages that are not only aesthetic: the labels remain **right**, searchable, translatable,
hidden by layer, and continue well when the author renames a place. The rose of the winds and the
scale bar are also drawn natively, and therefore remain correct after an enlargement.

The box ‘let the model write the names’ (`world_maps.model_labels`) is for anyone who wants the look
of an old hand-printed map. When it is active, Nodus **does not turn off their tags**: it leaves
them hidden per layer, because the result of the model can be unreadable and you have to be able to
recover the names without regenerating. Next to the box, a notice of a line that the names write the
model and can come out with faults.

### 7.3 Required content: the map knows which world it draws

The creation prompt incorporates the places that the author marks to include, with their type and
—if they are already punctured on a parent map — **their relative disposition**: «Aldermoor, port
city walled to the northwest; Vael, mountain fortress to the southeast; the Cano Forest between
them». That is what makes regenerate a map give a map *of the same world* and not of any other.

### 7.4 Enlargement: the three roads

The user asks, "You should see how to generate enlargement." There are three different answers and
all three have room:

**(1) Cut, without AI — the one to be offered first.** The author traces a rectangle; Nodus cuts the
base image to native resolution and creates the son map with those pixels. It is instant, free,
works offline and is **geographically accurate**. It loses detail, yes; but for those who have
commissioned their map to an illustrator it is exactly what they want, and for all others it is the
basis on which to then ask for detail.

**(2) Zoom with AI (detail) — trimming, improved.** The above cut is sent as **reference image**
along with a prompt detail: «a more detailed map of this region; preserves coasts, rivers and relief
exactly; adds the detail proper to a scale of X km». A new son map comes out.

**(3) Canvas extension (outpainting) — the map grows by an edge.** The author chooses border
(N/S/E/O) and how much. Nodus composes a larger canvas with the existing image placed on its site
and asks for continuation.

In **(1)** and **(2)**, bedbugs falling inside the rectangle are automatically reprojected** to the
child:

```
xHijo = (xPadre - parent_x0) / (parent_x1 - parent_x0)
```

That's what makes the gesture feel magical: you expand the northwest and the three cities that you
already had flattened appear placed on the new map, without touching anything.

### 7.5 Outpainting and related transformation

**The most dangerous operation of all functionality.**As the canvas grows, *all* normalized
coordinates of the map cease to be valid: chinches, vertices of polygons, route points, calibration
ends and rectangle within the parent.

The transformation is known and simple — a similar scale and displacement — but it has to be applied
**to everything, in a single transaction**, and deserves its own test with a map that has all four
geometries, calibration and a parent. If it fails halfway, the map is useless and the author has no
way to repair it by hand.

In addition, calibration is preserved by itself: by keeping the ends as points (§3.1) and
transforming them with the rest, the scale of the expanded map remains correct without
recalibrating. That is the return of having kept it this way.

### 7.6 Capabilities per Provider: The Honest Part

`callImageProvider(provider, model, prompt)`Today it does not accept input image. It has to be
extended to`callImageProvider(provider, model, prompt, { referenceImages })`** and declare which
provider can do so**:

| Provider | Text→image | Image→image | Notes |
|---|---|---|---|
| Google (Gemini) | Yes | Yes | `interactions.create`accepts input image. |
| OpenAI | Yes | Yes | `/v1/images/edits`, different endpoint from generation. |
| OpenRouter | Yes | **depends on the model** | We have to degrade by model, not by supplier. |
| Local Nodus | Yes | probably not. | Check before you promise. |

When the chosen provider **no** can take reference, the degraded — and honest — path is: a model of
**vision** (which`aiClient`already supports) describes the trimming in prose, and that description
enters a prompt from text to image. It comes out worse and you have to **tell it in the interface**,
do not simulate it silently: "Your image model cannot start from a reference; the result will look
like the trimming only approximately".

### 7.7 Resolution

Maps ** do not pass through`optimizedJpegs`** (cuts to 1280 px). Own path: up to ~4096 px on the
larger side, WebP with quality ~88 (quite smaller than JPEG at equal quality), plus 480 px miniature
for grids. A map of 4096 px round 3–6 MB; ten maps, ~50 MB on the`.db`, which also travel in copies
and in`.nodussync`. It has to be said in the interface and offered to "reduce resolution" by map.

** Eye with the encoder:**`nativeImage`Electron only knows`toPNG()`and`toJPEG()`; does not have
WebP. The WebP must be removed from`@napi-rs/canvas` (`canvas.toBuffer('image/webp')`), which is
already dependent and that`decorativeImages.ts`only uses today as plan B to rasterize. Checked on
this tree: png, jpeg, webp and avif respond. If you prefer not to rely on canvas on the main route,
the alternative is JPEG with`nativeImage`and ~30 % more bytes.

### 7.8 Write down a map with vision

The prompt that does not generate image and is probably the most useful of all: a multimodal model
** looks at the map** — uploaded or generated — and proposes chinchetas: «I see a bay here, a
mountain range here, three settlements here». The author accepts the ones he wants and assigns them
to existing places or creates those missing.

It is the quick way to move from "I have a PNG" to "I have a living map", and it uses a capacity
(`aiClient`with`images`) that is already paid and proven. Modest precision, but since it is a
question of suggestions that the author accepts one by one, the cost of a bug is a click.

---

## 8. Attach your own map

Drag or choose PNG / JPG / WebP. The native **bytes** are saved, without recompressing above 4096
px. Upon completion, a two-step wizard that cannot jump unintentionally:

1. **Calibra** ("trace a line over the map scale bar and tell me how much it measures").
2. **Place your places** — the list of places in the vault that are not yet on any map, to click on
   them; or the §7.8 shortcut.

An uncalibrated map without chinks is a beautiful and inert sheet; these two steps make it a map.

Extra cheap: a single page PDF can be passed through the Toolkit converter, which already exists.

---

## 9. Rendering

**Leaflet with`L.CRS.Simple`** and`L.imageOverlay`. No tessela server, no network, no attribution.
Limits are set at`[[0,0],[1000, 1000·aspect]]`so that the standard coordinates are a multiplication.

- Chinches:`L.marker`with`divIcon`(Character portrait, icon of the place).
- Circles:`L.circle`(radio in map units; scale well with zoom, unlike`circleMarker`).
- Forms and routes:`L.polygon` / `L.polyline`.
- Tags:`divIcon`own with simple anti-collision (if two tags overlap at the current zoom level, wins
  the most important place by`kind`This is the kind of detail that separates a map from a diagram.
- **Dark mode:**`.pm-dark .leaflet-tile`today applies an inversion filter to OSM tiles. That
  selector ** would also reach the`imageOverlay`** of an authoral map and would destroy it.`.pm-dark
  .leaflet-tile-pane .leaflet-tile`It's on the list of landmines for something.

---

## 10. Extras for the writer

Beyond the request. Everything here comes almost free of charge from the model already described,
which is precisely the criterion for proposing it.

1. **Rule and travel calculator.** Click on two chinks → distance in world units and **time travel
   per mode** (`map_travel_modes`). If there is a route (`path`) that unites them, is measured by
   the route. It is the utility that every fantasy writer ends up making by hand in a napkin.

2. **Notice of impossible travel.** With dated presences and stopover, Nodus can check every
   transit: *"Kestra is in Aldermoor on the 120th and in Vael on the 122nd; they are 400 leagues, 20
   days on horseback"*. A report of consistency with the impossible journeys of the manuscript. This
   ** is only possible because there is a stopover**, and justifies the whole §3 alone.

3. **Capa of knowledge (narrative war fog).** A map *as a character knows it*: regions marked as
   unknown to X until day D. It serves not to make the protagonist mention a kingdom that he has not
   heard of. It is the same idea that`secret_knowers`, applied to space.

4. **Finder of encounters.** With several selected characters, lists the days when two of them
   coincide in the same place: *«When could Kestra and Doran be known?»*. Intersection of intervals,
   pure function, and answers a question that can only be answered today by rereading.

5. **The scenes, on the map.** Filter by chapter or by act and see **where your story occurs.** A
   writer discovers in two seconds that the entire second act happens in the same room, or that
   there is an entire continent that no one has ever gone to.

6. **Hot map of presence.**Where time passes a character in the selected interval. It reveals
   sedentary and secondary ubiquitous protagonists.

7. **Automatic legend** from layers and`kind`place present, and **export to PNG** with embedded
   tags, paths and scale bar, to print resolution. A map that the author can send to his editor or
   put in the book keeper.

8. **Compare two moments** in parallel: the same map on day 100 and day 900, with the borders of
   each. The history of the world, at a glance.

9. **Battle cap.** Chinches with "bando" and temporary validity in turns: moving the head reproduces
   the development of the battle. It is the same machine of §6, with another time scale.

10. **Coherent names.** When creating a place from the map, suggest the name with the text model
    using the **culture** of the container site (`world_groups`of a kind`culture`The mountains of
    the north sound north.

---

## 11. Phases

| Phase | Scope | Verifiable deliverable |
|---|---|---|
| **M0** | Scheme v97, rests (`worldMapsRepo`, `mapMarkersRepo`), IPC,`syncTables`. `shared/worldMapGeometry.ts`Pure. | Schema and geometry tests; the vault opens to v97. |
| **M1** | Section **Maps** on sidebar (replaces`MapView`in worldbuilding: grid of maps on`WorldWorkspace`, create map **upping image**, Leaflet viewer`CRS.Simple`Breadcrumbs. | Upload a PNG and zoom it in. |
| **M2** | Calibration, scale bar, wind rose, distance rule,`map_travel_modes`. | Measure two points and get km and days on horseback. |
| **M3** | Chinches: point → circle → polygon → route, vertice editing, layers, link with places in both directions, «On maps» on the place tab. Close with the **annotation by vision** (§7.8), which only needs the chinches to exist. | Draw the outline of a forest and assign it to a place; climb a PNG and have AI propose the chinkets. |
| **M4** | `shared/worldPresence.ts`, time line with reproduction, selection of one or more characters, steles and interpolation of transits, temporary validity of markers. | Play and watch a character move between two cities. |
| **M5** | Multi-temporal map:`resolveMapFocus`, self-following, delivery strip, transition between maps. | Play and have the view jump from map following the character. |
| **M6** | Generation with AI:`shared/mapPrompt.ts`styles,`callImageProvider`with references + capabilities per provider, creation from scratch, cutting without AI, zooming with AI, outsourcing with related transformation. | Generate a map, expand a region, and see the reworked chinchettes. |
| **M7** | Extras from §10, in the order below. | The consistency report lists a real impossible journey. |

M1–M5 does not depend on AI at all: whoever uploads his own map has complete product at the end of
M5. M6 is additive. Such separation is deliberate — functionality cannot be held hostage by the
author having key from an image provider.

### 11.1 Order within M7

The criterion is twofold: **first what the M4 presence engine reuses while it is cool**, and within
that, cheaper before.

| # | Extra | Why there? |
|---|---|---|
| 1 | **Scenes on the map** (§10.5) | The cheapest of all: the scenes already have`place_id`and`world_day`It's a layer and a filter, and that's what the writer opens every day. |
| 2 | **Impossible travel** (§10.2) | The star piece, and the one that justifies the whole §3. Needs scale (M2), modes of travel (M2) and presences (M4): all three are ready and nothing else combines them. |
| 3 | **Meeting seeker** (§10.4) | Intersection of the same intervals that just built point 2. Doing it here is almost free; doing it in another phase forces you to reread the whole engine. |
| 4 | **Export to PNG** (§10.7) | Regardless of temporality: you only need tags, paths and scale bar (M2–M3). Close the cycle — a map that can be sent to the editor. |
| 5 | Fog of knowledge, heat map, compare two moments, battle layer, names by culture | The four are good, but each opens its own model (who knows what, aggregation, split view, sides) and none is prerequisite for anything. |

**The annotation by vision (§7.8) is advanced and does NOT go into M7.** When ordering this it is
clear that it does not depend on M6 at all: use`aiClient`with`images`(a vision model),
no`callImageProvider`. Their only requirement is that there be chinches, i.e. **M3**. And that's
where it's worth ten times as much: it's the shortcut from "I have a PNG" to "I have a living map",
just when the author has just uploaded his map and has a half hour ahead of him to puncture places
by hand. It goes at the end of M3.

---

## 12. Landmines

1. **`optimizedJpegs`trims to 1280 px.** Reusing the decorative image path would turn any map into a
   blurred miniature. Own path (§7.7).
2. **Outpainting moves ALL coordinates.** Chinches, vertices, routes, calibration ends and rectangle
   in the parent. A transaction, a test with the four geometries (§7.5).
3. **`.pm-dark .leaflet-tile`would reach the`imageOverlay`** and would reverse the author's map. To
   narrow down the selector before writing the view (§9).
4. **Table not in`syncTables.ts`does not travel** — and their erased ones resurrect, because the
   tombstones are generated from that same list.`worldbuilding`.
5. **No calendar,`world_day`is NULL.** Already bitten on the character vault. All §6 has to degrade
   to`world_year` + `world_order`no special branches everywhere: a single command function that
   returns the correct key.
6. **`person_places`use`label`, no`role`.** It already cost a failure in execution time.
7. **`tsc --noEmit`does not cover`electron/`.** New repos need to be checked with the build.
8. **The size of the`.db`.** Ten large maps are ~50 MB entering copies, in`.nodussync`and at the
   start. Measure and warn.
9. **Not all providers make image→image.** Degrade by *model* in OpenRouter, not by supplier, and
   say so in the interface (§7.6).
10. **Prove with isolated profile.**This plan uploads the schema; opening a real vault with a
    different numbering build corrupts it:`NODUS_USERDATA=/tmp/nodus-maps
    ./node_modules/.bin/electron .`

---

## 13. Decisions taken (2026-07-27)

| # | Decision | Reason | Where |
|---|---|---|---|
| 1 | The **residency is the background**, with no date of its own. There is no bridge table. | A residence is a default state, not an event. It does not touch scheme, and output (`person_place_world_dates`) is additive if any day is needed. | §6.5 |
| 2 | The new section ** replaces** to "Map" in worldbuilding. No second entry. | The view of genealogy is always empty in an invented world: it is not improveable, it cannot work.`VAULT_TYPE_SCOPED_VIEWS`already distributes views by type of vault. | §0 |
| 3 | **Nodus marker by default**, with box by map (`model_labels`) to leave it to the model. | Models write unreadable text or with faults and a map is almost all text. By labeling us, the names are correct, searchable, translatable and follow when renaming a place. | §7.2 |
| 4 | **Edition of vertices by hand**, without`leaflet-editable`. | ~200 lines with total gesture control versus 40 KB and an API to tame for the 20% we would use. Same criterion as the tour engine. The four details to nail are listed. | §4 |
| 5 | Order of M7: **scenes on the map → impossible trips → encounters → export PNG**; the rest, later. **annotation by vision advances to M3**. | First what reuses the M4 presences engine while cool, and within that cheaper before. The annotation does not depend on M6 (use vision, not image generation) and is worth ten times more just when the author has just uploaded his map. | §11.1 |

### What's still open, but doesn't block

- **§6.5** — if in real use it is missed «lived in Vael from the day 200 to 900», the bridge board
  enters. Decision postponed on purpose: it is additive.
- **§3.2** — `projection = 'globe'`is in the schema from the beginning but can be implemented in M2
  or wait; it only matters on a world map.
- **§7.6** — which specific OpenRouter models accept a reference image, it must be checked against
  the API, not decided here.
