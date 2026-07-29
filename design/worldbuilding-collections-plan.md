# Worldbuilding — Collections, Places and Filters

> ## Where I was going (handoff)
>
> **Schema v96.** All green: `npm test` 891/891, `tsc --noEmit`, `eslint` (0 errors),
> i18n in 7 languages, `npm run build` and `npm run test:e2e`.
>
> Finished: F0–F7 and the Q1–Q8 queue (see the character plan), W1 world calendar,
> W2 factions and cultures, W3 secrets, W4 scenes, and C0–C6 of this plan.
>
> **What is NOT done**, in case you return: there is no demo of worldbuilding (as there is
> for genealogy or teaching), there is no guided tour of the Vault, and the Encyclopedia sections,
> World Chat, World Graph, World Rules, Conflicts, Narrative Arches,
> Consistency, Open Questions, Traits and Manuscripts remain inert in the sidebar to
> purpose.
>
> **It takes an isolated profile to prove it.**This build leads to six new migrations
> (91→96) and opening a real vault with him corrupts him:
>
> D
> NODUS_USERDATA=/tmp/nodus-worldbuilding ./node_modules/.bin/electron .
> D

> Status: **C0–C5 implemented and verified; C6 (final verification) pending** (2026-07-27).
> **Schema v95.** `npm test` 891/891 · typecheck, lint and i18n (7 languages) clean ·
> `build` + `test:e2e` in green with `database at schema v95`.
>
> **C3 made:** Places like tree, `place_profiles` (v95), 37 types with scale, warning of
> scale, cycle keeper before writing, and delete that it LEARNS the content in
> the gallery was extracted to `worldImagesRepo` + `WorldGallery` and
> `charactersRepo` delegates: a single implementation of "the images of a thing".
>
> **C4 and C5 made:**Factions and Cultures as two filtered views of `world_groups`
> from a single parameterized descriptor, section of Belonging on the
> character, and facets of faction and culture in the grid. The belongings travel with
> the list in ONE query grouped, not one per character.
>
> Verified by mutation: the cycle keeper, and send `language` next to the
> factions (the naive distribution by `!== 'culture'`) — both fail as they should.
>
> **C1 made:** `src/components/world/WorldWorkspace.tsx` (head, finder, facets,
> collection in grid/tree/list and tab) + `WorldFilterBar.tsx`. `CharactersView` pass
> of 220 lines to a descriptor: only retains what is truly characters (the
> The layout is as proposed in §1.1:
> Full width collection without selection, left rail + tab when selecting.
>
> The proof that the refactor didn't change the behavior is that **e2e of characters
> went by without touching it**. Then a assertion was added for the party layout, which is what
> unique new, tested by mutation (return to the behavior of replacing the collection
> causes the e2e to fail).
>
> `CharactersView.tsx` was also recorded in `INDIRECT_KEY_SOURCES`: the texts of the
> descriptor arrive by `t(section.title)` and passed by by by miracle, because they were already
> translated from when they were direct calls to `t()`.
> **Schema v94.** `npm test` 891/891 · clean typecheck and lint · `build` + `test:e2e` en
> green with `database at schema v94`.
>
> **C2 made:** `world_images` (with copy from `character_images` and deletion of that
> table), `world_groups` and `character_affiliations`, plus `electron/db/worldGroupsRepo.ts`.
> Factions and cultures share table, as proposed in §4.
>
> Two things it took to see:
>
> 1. When making `world_images.entity_id` polymorphic ** the `ON DELETE CASCADE`** is lost
> give `character_images`. `deleteCharacter` deletes gallery by hand; forget filter
> all the images of each character deleted, and invisiblely because no one
> Check by mutation.
> 2. The first version of the test ** did not prove the data copy at all**: it created the database
> directly in v94, where `character_images` never existed, so remove the
> `INSERT…SELECT` integer didn't break anything. Now there's a case that raises a BD in **v93**,
> puts in an image and applies the 94 — the only route that proves what will happen to a
> actual vault when updated.
> Facts: `shared/worldFilters.ts` (additive faces) and `shared/placeKinds.ts` (vocabulary
> with scale, suggested parent, scale check and cycle detection), with 16 cases in
> `scripts/test-world-collections.mjs`. `npm test` 891/891.
> Mutation checks: combine dimensions with OR instead of AND, and remove the
> set of cycle detector visitors — both fail as they should.
>
> The decisions of §6 are applied in the design of these two pieces:
> filters is that of databases with facet interface, and the scale of places already
> Feeds suggested father and consistency.
> Continue [`worldbuilding-characters-plan.md`](worldbuilding-characters-plan.md), which left
> F0–F7, tail Q1–Q8 and W1 (calendar) on **schema v93**.
>
> Objective: To generalize the Characters view to the other collections of the Vault
> (Places, Factions, Cultures and, later, Scenes), with a search engine and filters
> facetated additives shared.

---

## 1. The central idea: a collection, a tab

Today `CharactersView` mixes three different things: how the characters are loaded**, how they are
presented** and how their **fiche** is. All three would be repeated literally in Places, Factions
and Cultures. A single container, `WorldWorkspace`, is extracted, parameterized by a section
descriptor.

### 1.1 Layout, and a discrepancy to be resolved now

You asked "on the left what we have been adding and on the right the forms." The Characters section
today ** doesn't** do that: the grid occupies the whole width and the tab replaces it*. The two
forms are good for different things — the wide grid to *see* the cast, the game to *work* jumping
between elements — so I propose to stay with the two in one component:

```
┌──────────────────────────────────────────────┐   ┌──────────┬───────────────────────┐
│  buscador · facetas · nuevo                  │   │ buscador │  ficha                │
├──────────────────────────────────────────────┤   ├──────────┤  (formulario de la    │
│  ▢ ▢ ▢ ▢ ▢   full-width collection           │ → │ ▢ ▢      │   section)            │
│  ▢ ▢ ▢ ▢ ▢   (nada seleccionado)             │   │ ▢ ▢      │                       │
└──────────────────────────────────────────────┘   └──────────┴───────────────────────┘
```

Without selection, the collection occupies the entire width. When selected, it **shrews to a rail of
18–22 rem to the left** and the tile appears to the right. A button fixes the rail folded or
deployed, and the preference is remembered by section.

> **Decision that I need from you:** if you prefer the fixed match always (rail + chip,
> without wide mode), it is a less state line. I designed it with both because for
> Characters the wide grid is what makes the Vault feel a world and not a
> board, but it's your call.

### 1.2 Three presentations, one by nature of the data

The collection is painted in three ways, and each section chooses theirs because **the data
commands**:

| Presentation | Sections | Why |
|---|---|---|
| **Card grid** | Characters, Factions, Cultures | They navigate by image: face, emblem, motif. |
| **hierarchical tree** | Locations | One place *is inside* another. A flat grid of 200 places is useless; the tree is the natural browser. |
| **Chronological list** | Scenes (W4) | They navigate in narrative order, not by aspect. |

### 1.3 The section descriptor

```ts
// src/components/world/worldSections.ts
export interface WorldSectionDef<T> {
  id: 'characters' | 'places' | 'factions' | 'cultures' | 'scenes';
  icon: string;
  labels: { title: string; empty: string; create: string; searchPlaceholder: string };
  presentation: 'grid' | 'tree' | 'list';
  load: (filter: WorldFilterState) => Promise<T[]>;
  /** Only for 'tree': where each item hangs from. */
  parentOf?: (item: T) => string | null;
  idOf: (item: T) => string;
  facets: WorldFacetDef[];
  Card: React.ComponentType<{ item: T; compact: boolean; onOpen: () => void }>;
  Sheet: React.ComponentType<{ item: T; onChanged: () => Promise<void>; onBack: () => void }>;
  CreateModal: React.ComponentType<{ onClose: () => void; onCreated: (id: string) => Promise<void> }>;
}
```

`CharactersView` becomes `WorldWorkspace` + the character descriptor. It is a refactoring at real
cost but limited, and it is the one that avoids writing four times the same search engine, the same
filter bar and the same selection management.

---

## 2. Faceted filters

### 2.1 What is reused and what is not

You describe "additive, searchable and various values per type" filters. That is exactly the
behavior of the **face bar of the File**
([`ArchiveFilterBar.tsx`](../src/components/ArchiveFilterBar.tsx)), not the builder of database
conditions. But the **model** of databases ([`databaseFilters.ts`](../shared/databaseFilters.ts))
already has what it takes: `FilterCondition` with operators `isAnyOf` / `isNoneOf` / `isEmpty`.

Proposal: **database model, facet interface.**

- Each active facet is saved as a `FilterCondition` with `op: 'isAnyOf'`.
- The default bar shows a chip per dimension; each chip opens a `SearchableMultiSelect` (the one
  that already uses social relationships).
- As it is the same model, the **saved views** and an advanced mode of conditions, without migrating
  anything, are later available free of charge.

```ts
// shared/worldFilters.ts
export interface WorldFacetDef {
  id: string;
  label: string;
  /** Where the values come from: a fixed vocabulary or values present in the vault. */
  source: 'vocabulary' | 'distinct';
  vocabulary?: { id: string; label: string }[];
}
export interface WorldFilterState {
  search: string;
  /** dimension → selected values. Empty = unfiltered by that dimension. */
  facets: Record<string, string[]>;
}
```

**Additives between dimensions (AND), cumulative within a (OR).** «Rol: protagonist or antagonist»
** and** «Culture: Vael» is what a writer expects when he clicks two values on one chip and one on
another.

### 2.2 Facets per section

| Section | Facets |
|---|---|
| Characters | Narrative role · Vital state · Species · Faction · Culture · Color label |
| Locations | Type of place · Scale · Inside · With images |
| Factions | Type · Status (active / extinct / latent) · Alignment |
| Cultures | Type · Language |
| Scenes | Status (delete/written) · Place · Character appearing |

Those of `source: 'distinct'` (species, language, within) are calculated from what is in the vault: a
world with three species should not offer a list of thirty.

### 2.3 Honest accountant

The header shows `12 de 87` when there are active filters, and a button to remove them. A filtered
count that is presented as the total is the easiest way for anyone to believe that they have lost
half of their world.

---

## 3. Places

### 3.1 What already exists (and is a lot)

`places` has **`parent_id` and `kind` since migration 33**. The hierarchy and classifier do not need
a new schema: they need a vocabulary and a view.

### 3.2 Type vocabulary, with scale

`shared/placeKinds.ts`, with a numerical **scale** by type:

| Scale | Types |
|---|---|
| 0 | Plano · Universe |
| 1 | Galaxy · Cluster |
| 2 | System · Star |
| 3 | Planet · Moon |
| 4 | Continent · Ocean |
| 5 | Region · Cordillera · Forest · Desert · Sea |
| 6 | Country · Kingdom · Empire |
| 7 | Province · County · County |
| 8 | City · Village · Village |
| 9 | Barrio · District · Fortress · Temple · Ruin |
| 10 | Building · Inn · Room · Camera |

The **scale is not decorative**: it gives three things for free.

1. **Father by default** when creating: from a City, the type suggested for a child is Barrio.
2. **Consistency check**, in the same line as the characters: «A Continent within a City» is almost
   always a drag error, and detecting it costs a comparison of integers. Notice, no error: a world
   can have a city that contains an entire plane, and that is a decision, not a mistake.
3. **Aggregation of the tree** and consistent bleeding.

> **Landmine:** `places` is **shared with genealogy**, which already writes
> `kind: 'municipality'`. The two vocabulary shares column and **never share**
> selector — exactly the pattern already used by event types
> (`EVENT_TYPE_OPTIONS` versus `CHARACTER_EVENT_TYPES`). The worldbuilding selector
> list only types of fiction; genealogy, only yours.

### 3.3 Gallery of the place

Top of the tab, as you asked.

- **Images of the place**, with the same machinery as the gallery of characters, including the
  visual seed**: without it, two images of the same city do not resemble each other.
- **Scenes spent there**, when W4. Until then the strip is not drawn (a permanently empty section
  teaches the eye to skip it).

**This requires generalizing `character_images`.** Today it is character-specific; the same table
should serve places, factions and cultures. Proposal: migration that creates
`world_images(entity_kind, entity_id, …)`, copies existing rows with `entity_kind = 'character'` and
removes `character_images`. A table by concept, not two.

> **Cost to accept:** that migration **is not just-CREATE**, so you can't
> play the backfill mechanism. And if you have already created a worldbuilding vault with
> this build, the copy is made over real data. It is the reason to do it **now**, with
> the gallery just put in and almost without rows, and not within three sections.

### 3.4 Location sheet

Header with gallery · Description (Appearance · Atmosphere · History) and visual seed · Type and
place parent · Inhabitants (characters with `person_places` pointing here — **already exists**, is
what genealogy uses for residences) · Events occurring here (the `events` with `place_id`, **already
exists**) · Factions and cultures present · Notes.

Almost the entire tab feeds on tables that are already populated.

---

## 4. Factions and cultures: one table, not two

Faction and Culture have the same form: name, type, description, image, members, period of
existence. Designing them separately would duplicate everything.

```sql
CREATE TABLE world_groups (
  group_id   TEXT PRIMARY KEY,
  -- faction | culture | religion | house | order | species | language
  kind       TEXT NOT NULL,
  name       TEXT NOT NULL,
  ...
  parent_id  TEXT REFERENCES world_groups(group_id) ON DELETE SET NULL,
  seat_place_id TEXT REFERENCES places(place_id) ON DELETE SET NULL
);
CREATE TABLE character_affiliations (
  affiliation_id TEXT PRIMARY KEY,
  person_id      TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
  group_id       TEXT NOT NULL REFERENCES world_groups(group_id) ON DELETE CASCADE,
  rank           TEXT,
  from_world_day INTEGER,
  to_world_day   INTEGER,
  notes          TEXT
);
```

**Factions and Cultures become two filtered views of the same collection**, with the same descriptor
and different `kind`. Add «Religions» or «Houses» then costs an entry in the vocabulary and one of
the sidebar. And the facets *Faction* and *Culture* of Characters leave here without extra work.

---

## 5. Phases

| Phase | Content | Done when |
|---|---|---|
| **C0** | `shared/worldFilters.ts` + `WorldFilterBar` (search engine faces) | Pure green filtering tests |
| **C1** | `WorldWorkspace` + descriptors; **Persons migrated to it** without functional change | The character e2e keeps going without touching it |
| **C2** | Migration: `world_images` (with copy from `character_images`) + `world_groups` + `character_affiliations` | Repo test; character gallery still works |
| **C3** | Places: vocabulary with scale, tree, tab with gallery, scale check | A hierarchy is created and navigated |
| **C4** | Factions and cultures about `world_groups` + belongings on the character tab | A character belongs to a faction with rank and period |
| **C5** | New Facets of Characters (faction, culture, species) | Combined filtering |
| **C6** | i18n ×7, tests, lint, typecheck, build, e2e | All green |

W3 (secrets) and W4 (scenes) continue afterwards, with the container and filters made.

---

## 6. My suggestions

The ones I find most relevant, in order:

1. **Fussion Factions and Cultures on a table** (§4). It is what saves the most work and what makes
   adding Religions or Houses trivial. Strongly recommended.
2. **Generalize `character_images` → `world_images` now** (§3.3), while the gallery has four rows.
   In three sections it will cost a real data migration.
3. **Number scale in place types** (§3.2). A field that gives suggested parent, consistency check
   and tree grouping.
4. **Base model with facet interface** (§2.1), not one or the other: the behavior you ask for is
   facet, but save it as `FilterCondition` leaves the door open to saved views without migrating
   anything.
5. **Reusing `person_places` for the inhabitants** of a place instead of inventing a table: it
   already exists, it already has a role and period, and it is already populated by the character
   tab.
6. **Visual seed also in places.** It's the only thing that makes two images of the same city look
   like characters.
7. **A single `SearchView` of the world, then.**With the facets already defined by section, a global
   search engine that returns characters, places and factions together is almost free. I would not
   put it in these phases, but it is advisable not to close the door.

And two things that **no** would do:

- **No** put a map on the location tab yet. The Map View exists and works on real coordinates of a
  ground gazetteer; an invented world needs an image map with chink, which is another whole
  functionality.
- **No** give places own events separate from `events`. A fact occurs in a place *and* happens to
  someone; duplicating the concept creates two chronologies that contradict each other.

---

## 7. Known Landmines

- **Ciclos in the tree of places.** "A within B within A" hangs the render. The keeper has to reject
  the cycle, and the tree has to defend itself equally with a group of visitors.
- **`places.kind` is shared with genealogy** (§3.2): two vocabulary, one selector each.
- **`world_images` is not only-CREATE**: it is not replicated by the backfill (§3.3).
- **The e2e of characters is the safety net of C1.** Migrating the view to the shared container
  without touching that test is just what proves that the behavior hasn't changed.
- **`tsc --noEmit` does not cover `electron/`**: always check with `npm run build`.
- Any new table goes to `syncTables.ts` or does not travel between machines.
