# Vault of Worldbuilding — Section **Persons**

> Status: **F0–F7, the Q1–Q8 queue and the world calendar (W1) implemented and
> verified, UNCOMMITTED** (2026-07-27).
> `npm test` 875/875 · `eslint` 0 errors · `typecheck` clean · `build` + `test:e2e`
> in green with `database at schema v93`.
>
> **Pending, with the design already decided (§16):** W2 factions and cultures + belongings,
> W3 secrets and who knows them, W4 scenes and apparitions. They are not blocked: each
> is the minimum version of an advertised section that a writer really needs.
>
> Three things that weren't in the plan and had to be done:
>
> 1. **`shared/types.ts` — `HistoricalEventType` amplified** with fiction vocabulary
> (`first_appearance`, `oath`, `betrayal`, `battle`, `journey`, `ascension`, `exile`,
> `transformation`, `bond`, `loss`, `revelation`). It is safe because no consumer
> goes through the union in an exhaustive way: all are explicit lists
> (`EVENT_TYPE_OPTIONS`, the `Set` of `recordsExtraction`, the `satisfies` of the MCP), thus
> that the two vocabularies share column without ever crossing into one selector.
> 2. **`electron/db/syncTables.ts` — sync group `worldbuilding`.** The engine of
> `.nodussync` requires that ALL table is classified as synchronized or excluded, and
> `test-sync-package` / `test-superseded-versions` enforce it. Unregistered
> `character_profiles` and `event_world_dates`, half the fiction of each character
> would not have traveled between machines. New key in `SyncGroupKey`; the tombstones of
> deleted are generated from that same list, so they fix themselves.
> 3. **`scripts/test-protect-persistence.mjs`** fixed `SCHEMA_VERSION === 90` as
> literal number, so any subsequent migration broke it without saying anything about
> Protect. Now check the consistency of the three values and `>= 90`.
>
> And a deliberate deviation: **`WorldbuildingHome` was advanced from F6 to F2**, because it is
> part of graduating the vault (without it, removing the Preview Start left the tree without
> compile). F6 was reduced to the command palette, which comes out free: derived from
> `NAV_ITEMS` filtered by `isViewAllowedForVaultType`.

<details> <summary>Original plan (2026-07-27)</summary>
> First real section of the vault `worldbuilding`, which today is just a shell * preview*.
> It is built on the ontology of genealogy records (`persons`, `events`,
> `relationships`, `social_relations`, `places`) using an overlap table,
> without touching the behavior of the genealogy vault.

---

## 1. Scope and decisions closed

### 1.1 Decisions taken

| Decision | Election | Consequence |
|---|---|---|
| **Storage** | Reuse `persons` + overlay table `character_profiles` (1:1) | Events, kinship, social relations, places, portrait, fusion and — later on — tree, chronology and map are inherited for free. Genealogy is not modified. |
| **Dates of the world** | Free text to display + optional integer to sort | Any invented calendar works with a column. No era system (stays in line). |
| **Extra phase 1** | Only the ** chip grid** | Multi-image gallery, interviewing the character and warning of confusing names stand in line (§13). |

### 1.2 Entering Phase 1

Parity with the genealogy file, adapted to fiction:

- Create, edit, search and delete characters.
- Names and **typed aliases** (true name, birth, epithet/title, nickname, alias, name in another
  language).
- **Events of his life** (types of fiction) with place, notes and order on the calendar of the
  world.
- **Parents** (reuse `KinshipEditor`) and **relations** (reuse `RelationsSection`).
- **Description**: Appearance · Personality · Transfundo, plus **visual seed**.
- **Biography generated with AI** from the tab.
- **Portrait generated with AI**, and own image upload/frame.
- Markdown notes.
- **View in grid** of tokens with portrait, filterable.
- Graduate `worldbuilding` of type *preview* a valid real, with its sidebar, its violet accent and
  its Home.

### 1.3 NOT Entering

Chronology, map, tree, encyclopedia, factions, cultures, scenes, plots and manuscripts remain
unbuilt: they appear in the sidebar as announced sections (§8.4). The rest, in §13.

---

## 2. What does not fit genealogy (and why is changed)

Five specific points, all verified in the current code:

1. ** `persons.sex` is `male|female|unknown`.** It does not describe a god, a dragon or an AI. It is
   replaced on the tab by `species`, `gender` and `pronouns` on the overlay. The `sex` column
   remains at `'unknown'` on worldbuilding and ** is never shown**.
2. **Dates.** `finishCore` in [genealogyDates.ts:86](../shared/genealogyDates.ts) rejects any year
   outside 1–3000 and only understands real months; <342 T.E.» or <13 of Rain of 1204» return
   `sortKey: null`. Without sort key, the list of events on the tab is in arbitrary order ** without
   warning**. That is why the year of the world is a separate whole (§3.2).
3. **Epistemology is inverted.** Genealogy forbids inventing and demands documentary evidence
   (`BIOGRAPHY_SYSTEM`, `hasBiographyEvidence`). In fiction the author *is* the source: biography is
   written from the tab, not from citations. New prompts (§5.1).
4. **The portrait generator is written as something to avoid** — «Not recommended... is not a real
   photograph» ([PersonDossier.tsx:951](../src/components/PersonDossier.tsx)) and
   `buildReferencePortraitPrompt` force *sepia and heritage* tones
   ([decorativeImages.ts:407](../electron/ai/decorativeImages.ts)). In worldbuilding it is a first
   class function with an eligible style.
5. **`persons.national_id`** does not apply; it is simply not exposed.

---

## 3. Data model — migration **91**

`SCHEMA_VERSION` goes from 90 to 91 in [migrations.ts:10](../electron/db/migrations.ts). Migration
**only CREATE**, without `ALTER`, to be reproducible by the backfill mechanism of `isCreateOnly`.

### 3.1 `character_profiles`

```sql
-- Superposition of fiction over `persons`. A character IS a person (so inherits
-- events, kinship, relationships, places and portrait); this table saves what only
-- It makes sense in an invented world. In a genealogy vault it never has rows.
CREATE TABLE character_profiles (
  person_id        TEXT PRIMARY KEY REFERENCES persons(person_id) ON DELETE CASCADE,

  -- Identity: it replaces persons.sex, who do not describe a god or a dragon.
  species          TEXT,
  gender           TEXT,
  pronouns         TEXT,

  -- Narrative status instead of birth + death to dry.
  -- unknown | alive | dead | missing | undead | immortal | unborn
  life_status      TEXT NOT NULL DEFAULT 'unknown',

  -- protagonist | antagonist | secondary | tertiary | cameo
  narrative_role   TEXT,
  -- Token from the label palette (not a hex), for the grid.
  accent           TEXT,

  -- The biographical description, starting in three so that the image prompt does not
  -- receive also character and the past.
  appearance       TEXT,
  personality      TEXT,
  backstory        TEXT,

  -- Prompt canonical appearance, re-injected into ALL generations of image.
  -- It's the only thing that gets the character to look like himself between images.
  visual_seed      TEXT,

  -- Year of the world. The readable date is still in persons.birth_date / death_date such as
  -- the author writes it; these integers (may be negative) are the only thing that commands.
  birth_year_sort  INTEGER,
  death_year_sort  INTEGER,

  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_character_profiles_birth ON character_profiles(birth_year_sort);
```

### 3.2 `event_world_dates`

```sql
-- Order of an event in an invented calendar. Table apart and not a column in
-- `events` for the migration to remain only-CREATE and not to load the
-- genealogy ontology with a column you will never use.
CREATE TABLE event_world_dates (
  event_id    TEXT PRIMARY KEY REFERENCES events(event_id) ON DELETE CASCADE,
  world_year  INTEGER,
  -- Dispatching within the same year (season, day, chapter) without forcing the author to
  -- Inventing a full calendar.
  world_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_event_world_dates_year ON event_world_dates(world_year, world_order);
```

### 3.3 What **does not** change

- Typing aliases use `person_names.kind`, which is already free text. **No migration.**
- The portrait uses `persons.portrait_*` and `setPersonPortrait`, already existing.
- Notes → `persons.notes`. Biography → `persons.biography` / `biography_at`.

---

## 4. Shared rates — `shared/types.ts`

```ts
export type CharacterLifeStatus =
  | 'unknown' | 'alive' | 'dead' | 'missing' | 'undead' | 'immortal' | 'unborn';

export type CharacterNarrativeRole =
  | 'protagonist' | 'antagonist' | 'secondary' | 'tertiary' | 'cameo';

export interface CharacterProfile {
  personId: string;
  species: string | null;
  gender: string | null;
  pronouns: string | null;
  lifeStatus: CharacterLifeStatus;
  narrativeRole: CharacterNarrativeRole | null;
  accent: string | null;
  appearance: string | null;
  personality: string | null;
  backstory: string | null;
  visualSeed: string | null;
  birthYearSort: number | null;
  deathYearSort: number | null;
  createdAt: string;
  updatedAt: string;
}

/** A character = the shared row of `persons` plus its fiction overlap. */
export interface Character extends Person {
  profile: CharacterProfile;
}

export interface CharacterInput {
  displayName: string;
  species?: string | null;
  gender?: string | null;
  pronouns?: string | null;
  lifeStatus?: CharacterLifeStatus;
  narrativeRole?: CharacterNarrativeRole | null;
  accent?: string | null;
  appearance?: string | null;
  personality?: string | null;
  backstory?: string | null;
  visualSeed?: string | null;
  birthDate?: string | null;      // free text, as written by the author
  deathDate?: string | null;
  birthYearSort?: number | null;
  deathYearSort?: number | null;
}

export interface CharacterFilter {
  search?: string;
  role?: CharacterNarrativeRole;
  status?: CharacterLifeStatus;
}
```

New `shared/characterLabels.ts` file (parallel to `src/components/personLabels.ts`, but shared
because the AI prompt also needs them):

```ts
export const CHARACTER_LIFE_STATUS_LABEL: Record<CharacterLifeStatus, string>;
export const CHARACTER_ROLE_LABEL: Record<CharacterNarrativeRole, string>;
export const CHARACTER_EVENT_TYPE_LABEL: Record<string, string>;
export const CHARACTER_NAME_KINDS: { id: string; label: string }[];
export const CHARACTER_ACCENTS: { id: string; hex: string }[];
```

**Types of fictional event** (replace `EVENT_TYPE_OPTIONS` from genealogy; are saved in the same
column `events.type`, which is free text): `birth`, `death`, `first_appearance`, `oath`, `betrayal`,
`battle`, `journey`, `ascension`, `exile`, `transformation`, `bond`, `loss`, `revelation`, `other`.

**States**: undetermined · alive · dead · missing · undead · immortal · not yet born. **Types of
name**: true name · birth name · epithet or title · nickname · alias · name in another language.

---

## 5. Data layer — `electron/db/charactersRepo.ts`

```ts
listCharacters(filter?: CharacterFilter): Character[]
getCharacter(personId: string): Character | null
createCharacter(input: CharacterInput): Character
updateCharacter(personId: string, patch: Partial<CharacterInput>): Character | null
deleteCharacter(personId: string): void          // delegate to deletePerson; CASCADE cleans overlay
listCharacterEvents(personId: string): HistoricalEvent[]
setEventWorldDate(eventId: string, worldYear: number | null, worldOrder: number): void
characterCounts(): { total: number; byRole: Record<string, number>; byStatus: Record<string, number> }
```

** Implementing rules, non-negotiable:**

- **Never assume that the overlay row exists.** A `Person` created by another way (import, fusion,
  synchronization) will not have it. All readings do `LEFT JOIN character_profiles` and **synthesize
  the default values** in memory; the scriptures use `INSERT … ON CONFLICT(person_id) DO UPDATE`.
  There is no `ensureProfile()` to call and forget: if forgotten, the tab appears empty without
  error.
- **Seek by alias**, not only by `display_name`: `listCharacters({search})` does `EXISTS (SELECT 1
  FROM person_names …)` as `listPersons`.
- **Events order**: `ORDER BY world_year IS NULL, world_year, world_order, date_sort, created_at`.
  The `IS NULL` first prevents SQLite from putting null in front and messing up the tab.
- `updateCharacter` touches `persons` ** and** the overlay in **a transaction**.

---

## 6. AI

### 6.1 Biography — `shared/characterBiographyContext.ts` + `electron/ai/characterBiography.ts`

Mirror of [personBiography.ts](../electron/ai/personBiography.ts), with three differences:

1. **The source is the tab**, not the evidence: appearance, personality, background, alias, status,
   events, kinship and relationships. `hasCharacterMaterial()` returns `true` with only one
   description — in genealogy that did not exist and the user received <there is not enough
   evidence» with the full tab.
2. **New Prompt.**Rules: continuous narrative prose, 150–250 words; **literally use the pronouns and
   name indicated**; do not contradict anything on the tab; do not enter facts, names or places that
   are not in it; without headings or cartoons.
3. **The generated biography is not automatic canon.** It is saved in `persons.biography` as it is
   today, but the tab the label as generated, with its date and a regenerating button. (The "propose
   and fill holes" mode is in queue, §13.)

Model: `synthesisModel ?? extractionModel`, as in genealogy.

### 6.2 Portrait — `electron/ai/decorativeImages.ts`

New export `generateCharacterPortrait(personId, opts: { style, extra? })`, next to
`generatePersonPortraitFromDescription` (which remains intact for genealogy).

Prompt construction, in `shared/characterImagePrompt.ts`:

```
[plantilla de estilo elegido de DECORATIVE_IMAGE_STYLES]
. [visual_seed]                      ← primero, es el ancla de consistencia
. [appearance]
. single character portrait, head and shoulders, plain backdrop
. no text, no letters, no numbers, no logos, no watermark
```

- The style comes out of the existing selector `DECORATIVE_IMAGE_STYLES`; there is no new machine.
- `vaultTypeImagePrompt('worldbuilding')` stays in `''` ** on purpose**: the style is chosen by the
  author per character, it is not imposed by the vault.
- Reuse `callImageProvider` → `optimizedJpegs` → `setPersonPortrait(..., generated=true)`, so the
  `AiBadge` of `PersonPortrait` still works.
- If there is no `imageProvider`/`imageModel`, the same actuable error is already launched.

### 6.3 `promptPack` of the type of vault — `shared/vaultTypes.ts`

Today it is empty. It is written (in Spanish, like the others):

> **VALULT CONTEXT — WORLDBUILDING MODE.** This Vault builds a world of fiction.
> Unlike a documentary corpus, here ** the author is the source of truth**: what
> is canon and is not contradicted or ‘corrected’.
> facts, names, places or kinship that are not in the material provided, and when
> propose something, say it explicitly instead of presenting it as established.
> literally the names, epithets and pronouns as the author writes them:
> translate, normalize, or replace. Note that characters may not be
> and that the calendar, geography and rules of the world are invented.

---

## 7. IPC · preload · `NodusApi`

| Channel | Handler | Signature in `window.nodus` |
|---|---|---|
| `characters:list` | `listCharacters` | `listCharacters(filter?): Promise<Character[]>` |
| `characters:get` | `getCharacter` | `getCharacter(id): Promise<Character \| null>` |
| `characters:create` | `createCharacter` | `createCharacter(input): Promise<Character>` |
| `characters:update` | `updateCharacter` | `updateCharacter(id, patch): Promise<Character \| null>` |
| `characters:delete` | `deleteCharacter` | `deleteCharacter(id): Promise<void>` |
| `characters:listEvents` | `listCharacterEvents` | `listCharacterEvents(id): Promise<HistoricalEvent[]>` |
| `characters:setEventWorldDate` | `setEventWorldDate` | `setCharacterEventWorldDate(eventId, year, order): Promise<void>` |
| `characters:counts` | `characterCounts` | `characterCounts(): Promise<…>` |
| `characters:generateBiography` | `generateCharacterBiography` | `generateCharacterBiography(id): Promise<{biography, noMaterial}>` |
| `characters:generatePortrait` | `generateCharacterPortrait` | `generateCharacterPortrait(id, style): Promise<Character \| null>` |

They are reused without touching: `addPersonName`, `setPersonPortraitFromFile`, `getPersonPortrait`,
`updatePortraitFocus`, `clearPersonPortrait`, `createEvent`, `updateEvent`, `deleteEvent`,
`findOrCreatePlace`, `addRelationship`, `kinOf`, `createSocialRelation`.

Three files to play in parallel, always all three: [ipc.ts](../electron/ipc.ts),
[preload.ts](../electron/preload.ts) and the `NodusApi` interface in `shared/types.ts`.

---

## 8. Interface

### 8.1 `src/views/CharactersView.tsx` — grid

Replaces the list-22rem pattern + detail of `PersonasView`: a grid wants the full width.

- ** Head**: title · counter · search engine · `Nuevo personaje` · two filter selectors (rol,
  status).
- ** Grid**: `grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]`.
- ** Card** (`data-testid="character-card"`):
  - portrait in `aspect-[3/4]` with `<PersonPortrait fill rounded="md" />`;
  - accent strip above with the color of `profile.accent`;
  - name; under, the epithet (first alias of type *epite/title*) or status;
  - narrative role badge on the corner;
  - status point (dead/disappeared in grey off).
- **Empty**: «There are no characters yet» + the create button.
- **Detail**: When pressing a card, the tab occupies the panel with a return button. The scroll of
  the grid is maintained upon return.
- **Virtualization**: unnecessary below ~500 cards; above, apply the same pattern as the gallery
  already virtualized. Note, not implemented.

> **Portrait detail**: with `fill`, the `PersonPortrait` position marker draws
> `<Icon name="user" size={size * 0.5} />` with `size` ** by default of 48**, i.e. a
> tiny icon on a large card ([PersonPortrait.tsx:102](../src/components/PersonPortrait.tsx)).
> You have to pass a coherent `size` or give it your own marker. Also, the silhouette by
> default is chosen from `persons.sex`: with `sex='unknown'` falls on the marker
> neutral, which is right here — **no** you have to "fix" it by mapping `gender` to the
> human silhouettes, because a character may not be human.

### 8.2 `src/components/CharacterDossier.tsx` — tab

Sections in order, reusing `PERSON_DOSSIER_SECTION_CLASS`, `PERSON_DOSSIER_ACTION_BUTTON_CLASS` and
`PERSON_DOSSIER_ADD_BUTTON_CLASS`:

1. ** Head** — portrait with its actions (up · frame · generate with AI · remove), name, epithet,
   `pronouns · species · status`, edit/delete/close buttons.
2. **Description** — three self-saved editors: *Appearance*, *Personality*, *Background*. Below,
   folded, **Visual Seed** with the explanation of what it serves and a button "Use appearance as
   seed".
3. **Biography** — as in genealogy: generate/regenerate, text, date, generated label.
4. **Names and aliases** — chips; the high modal carries a type `<select>` instead of the fixed
   `'variante'` used today `NameVariantsEditor`.
5. **Events of his life**—the same table as genealogy, with two extra fields in the form: *year of
   the world* (integer, he admits negatives) and *order within the year*.
6. **Partnership** — `KinshipEditor` + abstract `KinRow`, reused as it is.
7. **Relations** — `RelationsSection`, reused as it is.
8. **Notes** — `MarkdownNotesEditor` over `persons.notes`.

Basic data editor (`CharacterBasicsEditor`): name, species, gender, pronouns, status, narrative
role, accent, date of birth and death (free text) and his two years of the world.

**Don't behave**: suggestions of identity (fusion), kinship suggested by evidence, conflicting
facts, linked documents, cited evidence and national identifier. They are documentary evidence
surfaces that make no sense with an author as a source.

### 8.3 `src/views/WorldbuildingHome.tsx`

Small, `TeachingHome` style: character counter, «Create character», the last characters played, and
a sober warning that the rest of sections are under construction.

### 8.4 `src/components/WorldbuildingSidebar.tsx`

Replaces [PreviewVaultSidebar.tsx](../src/components/PreviewVaultSidebar.tsx), which is deleted
(worldbuilding was its only user). Follow the
[TeachingSidebar.tsx](../src/components/TeachingSidebar.tsx) pattern: items with `view` navigate,
the others are **disabled with tooltip «Available soon»**.

- **Explore**: Encyclopedia · **Persons → `characters`** · Places · Factions · Cultures · Chronology
  · Map · Relationships
- **Analyze**: World Chat · World Graph · World Rules · Conflicts · Narrative Arcs · Consistency ·
  Open Questions
- **Create**: **Notes → `notes`** (exist already, is universal) · Scenes · Traits · Manuscripts

> ** Decision pending, not blocking.** Teaching turned its unbuilt sections into
> GitHub's permanent threads (`ROADMAP_THREADS`, issues #68‐73) for people to
> mold before it exists. Here would be **18 new issues**, so phase 1 leaves them
> as inert buttons. Uploading them to thread then is one line per section.

### 8.5 Wiring in `src/App.tsx`

- `const isWorldbuilding = activeVault?.type === 'worldbuilding';`
- `document.documentElement.classList.toggle('worldbuilding', isWorldbuilding)`.
- Logo: new `src/assets/nodus-logo-violet.svg` and its entry in `data-vault-logo`.
- Sidebar branch next to that of `isDocencia`: `WorldbuildingSidebar` + ** only** the `tools` group
  of `navGroups` (if not, Explore/Analyze/Write are duplicated).
- Start branch: `view === 'home' && isWorldbuilding` → `WorldbuildingHome`; and **add `&&
  !isWorldbuilding`** to the generic `HomeView` condition ([App.tsx:1354](../src/App.tsx)).
- New path: `view === 'characters'` → `CharactersView` (load deferred with `lazy`, like the rest of
  views per type of vault).
- Entry into the command palette: «People».

### 8.6 `src/index.css` — violet accent

Block `.worldbuilding` decaling of `.docencia` (lines 1405‐1540, 136 rules), with `#7c3aed` and its
scale. **And its twin `.dark.worldbuilding`**: `.docencia` does not replace the utilities `dark:`,
and the components of people are filled with them.

### 8.7 `src/navigation.ts`

- `View` wins `'characters'`.
- `NAV_ITEMS`: `{ id: 'characters', label: 'Personajes', icon: 'users', group: 'explore' }`. Share
  icon with `persons` and `teachingGroups`, which is acceptable because they never match the same
  value.

### 8.8 `shared/vaultTypes.ts`

- `PREVIEW_VAULT_TYPES` → `[]`. **preserves the mechanism** (reusing it `primary_sources` and
  `testimonios` when advertised), but stops having users: the ~12 `!isPreviewVault` saves of
  `App.tsx` become always true. Cleaning them is a separate follow-up, not part of this phase.
- `VAULT_TYPE_SCOPED_VIEWS`: `characters: ['worldbuilding']`.
- `defaultHiddenViews` from `worldbuilding`: the same list as `docencia` **less `notes`** (which the
  sidebar does offer).
- `promptPack`: the text of §6.3.

---

## 9. i18n

All new strings are written in Spanish and translated into the **7** tables: `en`, `fr`, `de`, `it`,
`pt`, `pt-BR`, `tr`.

`scripts/test-i18n-coverage.mjs` sees only the keys you can collect. Label tables
(`CHARACTER_LIFE_STATUS_LABEL`, `CHARACTER_ROLE_LABEL`, `CHARACTER_EVENT_TYPE_LABEL`,
`CHARACTER_NAME_KINDS`) are rendered as `t(LABEL[x])`, i.e. **indirectly**, so you have to add
`shared/characterLabels.ts` to `INDIRECT_KEY_SOURCES`
([test-i18n-coverage.mjs:114](../scripts/test-i18n-coverage.mjs)) or your translations will be
missing in silence — exactly the bug with which the genealogy vault was launched. The same for
`WorldbuildingSidebar.tsx` if your tags live on an array.

---

## 10. Tests

### To be amended

| File | Change |
|---|---|
| `scripts/test-vault-types.mjs` | `worldbuilding` ceases to be preview: remove from the loop of `PREVIEW_VAULT_TYPES`, `isViewAllowedForVaultType('settings','worldbuilding')` passes to `true`, and the test "the worldbuilding preview exhibitions its complete bilingual inert sidebar" is rewritten against `WorldbuildingSidebar`. Add that `characters` is only allowed in `worldbuilding`. |
| `scripts/test-vault-onboarding-ui.mjs` | Check; icon `globe` and color `#7c3aed` do not change. |
| `scripts/test-i18n-coverage.mjs` | Add new indirect font. |

### To be created — `scripts/test-worldbuilding-characters.mjs`

Against a real vault in `mkdtemp` with real migrations:

1. `createCharacter` writes `persons` and the overlay, and `getCharacter` returns them together.
2. **A `Person` without overlay row** is read as a character with default values (the trap of §5).
3. Events are ordered by `world_year`/`world_order`, and **an event without a year does not run at
   first**.
4. `deleteCharacter` cleans the overlay by CASCADE and does not leave `event_world_dates` orphans.
5. The search finds by alias, not just by visible name.
6. `updateCharacter` is atomic: if the overlay part fails, the `persons` part is not written.

### Final checks

`npm run lint` · `npx tsc --noEmit` · `npm test` · `npm run build` ** before** `npm run test:e2e`.

---

## 11. Order of work

| Phase | Content | Done when |
|---|---|---|
| **F0** | Migration 91, shared types, `characterLabels`, `charactersRepo` | `test-worldbuilding-characters.mjs` in green |
| **F1** | IPC + preload + `NodusApi` | `tsc --noEmit` clean |
| **F2** | Vault type graduation: `vaultTypes`, `navigation`, `WorldbuildingSidebar`, violet CSS, logo, `App.tsx` branches | A new Vault worldbuilding opens with its sidebar and accent, and "People" navigates to an empty view |
| **F3** | `CharactersView` (grid, search engine, filters, high) | Characters created and listed |
| **F4** | `CharacterDossier`: basics, description, alias, events, kinship, relationships, notes | Editable complete sheet |
| **F5** | AI: biography and portrait | Both generate with a configured provider and fail with an actionable message without it |
| **F6** | `WorldbuildingHome` + command palette entry | Start of useful vault |
| **F7** | i18n of the 7 tables + updated tests + lint/tsc/test/build/e2e | All green |

---

## 12. Landmines

1. **`test:e2e` does not reconstruct.** With `SCHEMA_VERSION` at 91 and a `dist` rancid, the bug is
   `90 !== 91` and looks like a migration error. Always `npm run build` before.
2. **Do not open real valts with this build.** Test branches with different migration numbering on
   true valts corrupts them (future table already present + `user_version` old → "table X already
   exist" when changing vault). Use an isolated `NODUS_USERDATA`.
3. **Graduate from *preview* lights things up.** `isPreviewVault` Today silences the onboarding,
   recovery assistant, basic tutorial and tour. When you stop being preview, an already created
   worldbuilding vault will see them appear at once. It is correct — it passed to teaching — but you
   have to wait and try it with a pre-existing worldbuilding vault.
4. ** `.worldbuilding` does not recap `dark:`.** `.dark.worldbuilding` is required explicitly.
   People's components often use `dark:`.
5. ** `t()` dynamic escapes from the coverage test.** §9.
6. **The worktree does not have its own `node_modules`**: symbolically link from `main`, no `npm
   install` (break `better-sqlite3`); if necessary, `npx electron-builder install-app-deps`.
7. **Never take anything to `main` without explicit confirmation**, and commit without co-authoring.

---

## 15. W1 — The calendar of the world (migration **93**)

A Vault is **a world**, just like in genealogy a Vault is a family. That’s why the calendar is from
the Vault and does not need owner column.

**It is optional, and that is the main design decision.**No one should have to invent twelve names
of the month before writing their first character. Without calendar, the entire year orders the
chronology exactly as before; defining it adds exact order *within* each year and a date selector
instead of a text box.

- `world_calendar` (single row, with `CHECK (id = 1)`), `world_calendar_eras`,
  `world_calendar_months`; `event_world_dates` wins `era_id`, `month_index`, `day` and `world_day`.
- **`world_day` is DERIVATED and stored**, because SQLite has to be able to `ORDER BY` with it. The
  price is maintenance: *any* edition of the calendar invalidates it — lengthen a month a day moves
  all subsequent dates—so every mutation ends in `recomputeWorldDays()`. Without that the chronology
  rots silently: it would remain orderly, only wrong, which is the worst way to be wrong.
- ** `world_day` is the tiebreaker IN the year, never the main key.** The year always means
  something; `world_day` only exists if there is a calendar. Sorting by it first would mix two
  scales as soon as a vault had dated and year-only facts.
- **No leap years.** They are an accident of the Earth's orbit; modeling them would make all the
  arithmetic of days conditional for something that almost no invented calendar wants. One year is
  the sum of its months, always.
- A single-year date falls on the day 0 of that year, so he orders **before** that everything dated
  within him, which is what those who read "1229" next to "13 of Rain, 1229" expect.
- Days and months out of range are **cut**: a bad value cannot produce an absolute day falling into
  another year.

`shared/worldCalendar.ts` is pure and is covered by 13 cases, including the round-trip `worldDayOf`
`fromWorldDay`. Verified by mutation: removing the day cut makes "out-of-range days and months are
clamped" fail.

---

## 16. Pending, with the design decided

None is blocked: each is the minimum version of an announced section.

- **W2 — fractions and cultures + belongings.** `world_groups` (faction · culture · religion · home
  · order) + `character_affiliations` (person, group, range, period in days of the world). Turn on
  two sections of the sidebar and unlock the item «membership».
- **W3 — Secrets and who knows them.** `world_secrets` (text, optional owner) + `secret_knowers`
  (personage, from what event or day of the world, how did you find out).The "from what chapter" is
  resolved with the event, without the need for Manuscripts.
- **W4 — Scenes and apparitions.** `world_scenes` (title, summary, date of the world, place,
  draft/written state, narrative order) + `scene_characters`. The scene is the real work unit of a
  writer, and gives the "Appearances" section of the tab.

---

## 13. Original phase 1 tail (already implemented except blocked in §15)

In approximate order of value:

- **Multi-image Gallery** per character (portrait, whole body, expressions, ages), each image with
  its saved prompt and one marked as avatar. `decorative_images` already saves prompt, supplier,
  model and slot `prev_*`.
- **Interview the character**: chat in his voice, fed by the tab.
- **Notice of confusing names** between characters (distance of strings).
- **Biography in proposed mode**: fills in gaps and marks it as a suggestion until accepted.
- **Alias secret**: mark of *secret* and "who knows it" (needs column in `person_names`).
- **Arco**: wants · needs · defect · lie believed · wound.
- **Relationships with valence and asymmetry**, and how they change from an event.
- **Voice**: record, tics, crutches and dialog display — audible with the TTS that already exists.
- **Coherence**: to participate in an event after death, impossible ages, two "only heir".
- **Skills with cost and limit.**
- **Relevances**: faction + range + period, culture of origin (wait for these sections).
- **Exportable date** to one page (there is HTML→PDF pipe).
- **World-specific calendar system**, which would replace the whole of order.
- **Archetype plants** and character generation consistent with the world.
- ** Secrets and state of knowledge**: who knows what and from what chapter.
- **Appearances in scenes and manuscript.**
- Reactivate chronology, tree and map for `worldbuilding` (they already work; just expand
  `VAULT_TYPE_SCOPED_VIEWS` and give them the year of the world as an order criterion).

</details>

---

## 14. What was built

| Layer | Files |
|---|---|
| Scheme | `electron/db/migrations.ts` (v91: `character_profiles`, `event_world_dates`) |
| Types | `shared/types.ts` (`Character`, `CharacterProfile`, `CharacterEvent`, ...), `shared/characterLabels.ts` |
| Data | `electron/db/charactersRepo.ts`, `electron/db/syncTables.ts` |
| AI | `shared/characterBiographyContext.ts`, `shared/characterImagePrompt.ts`, `electron/ai/characterBiography.ts`, `generateCharacterPortrait` in `electron/ai/decorativeImages.ts` |
| Bridge | `electron/ipc.ts`, `electron/preload.ts` |
| Vault | `shared/vaultTypes.ts`, `src/navigation.ts`, `src/components/WorldbuildingSidebar.tsx` (replaces `PreviewVaultSidebar.tsx`, deleted), `src/index.css`, `src/assets/nodus-logo-violet.svg`, `src/App.tsx` |
| UI | `src/views/CharactersView.tsx`, `src/views/WorldbuildingHome.tsx`, `src/components/CharacterDossier.tsx`, `src/components/CharacterPortrait.tsx`, `src/components/CharacterPortraitEditor.tsx`, `src/components/NewCharacterModal.tsx` |
| i18n | 115 keys × 7 tables; `shared/characterLabels.ts` recorded in `INDIRECT_KEY_SOURCES` |
| Tests | `scripts/test-worldbuilding-characters.mjs` (new), `scripts/test-vault-types.mjs`, `scripts/test-i18n-coverage.mjs`, `scripts/test-protect-persistence.mjs`, worldbuilding case in `scripts/e2e-smoke.mjs` |

### Second round: the tail of §13 (migration **92**)

All I played scheme was to **one** migration instead of five.

| Item | Where |
|---|---|
| Multi-image gallery | `character_images` + `CharacterGallery.tsx`; each image saves its prompt, supplier and model |
| Arc and voice | columns in `character_profiles` + `CharacterCraftSections.tsx`; dialog can be **listen** |
| Skills with cost and limit | `character_abilities`; tab points to limitless ability |
| Secret aliases | `person_names.secret` / `known_by`; **never** come out on the grid |
| Valencia de relaciones | `social_relations.valence` / `since_event_id`; `RelationsSection` wins a `showValence` that genealogy does not ignite |
| Confused names and consistency | `shared/characterChecks.ts`, pure and tested; the section only exists if you have something to say |
| Biography in proposed mode | `biography_proposed`, own prompt requiring bracketing, and accepting/discarding explicit |
| Interview the character | `shared/characterInterview.ts` + `CharacterInterviewModal.tsx`; ephemeral on purpose |
| Exportable sheet | `shared/characterSheetExport.ts` → Markdown, **no secrets or private notes** |
| Archetype templates | `shared/characterTemplates.ts` |
| Chronology, map, relationships and dynasties | reused; only the chronology needed to adapt to the year of the world |

Three decisions that deserve an explanation:

1. **The avatar is COPIED, not referenced.** `person_portraits` remains the only source of
   truth of the avatar (read the grid, the tree and the header, and it is the one who owns the
   non-destructive frame). A duplicate blob is cheaper than two different answers to "what is the
   image of this character", and deleting the image of the gallery does not leave the avatar blank.
2. **The templates do not write prose.**The first version filled in the fields with questions in
   Spanish; they had to be deleted to write the answer, and they were Spanish text embedded in the
   database, outside the scope of the i18n. Now a template only fixes role and color and says which
   fields of the arch and voice matter: who asks are the *hints*, which are UI and are already
   translated.
3. **The interview is not saved.** It is a tool of thought; what it produces becomes canon by
   editing the tab. Persisting transcriptions would create a second story of the character that
   nothing else reads or maintains.

### Mutations with which tests were found to serve

A passing test proves nothing until it fails. They broke on purpose and all three failed as they
should:

1. Remove `(w.world_year IS NULL)` from `ORDER BY` → fails «events sort by world year...».
2. Make `getCharacter` return `null` without overlay row → fails «a person without an overlay is
   still a character».
3. Cancel the `classList.toggle('worldbuilding', …)` of `App.tsx` → the e2e fails.
4. Patching the arc from stroke to field to field → fails «patching one arc field leaves its
   siblings alone». It is the failure that would cause each blur to erase the four fields you were
   not editing.
5. Getting an image deleted from the gallery deletes the avatar → fails. The first version of that
   assertion burst with a `TypeError` instead of naming the invariant; it was rewritten with a
   previous presence check.
6. Remove the secret filter from `characterEpithet` → **the first version did NOT hunt it**: the
   public epithet won in alphabetical order, not by the filter. Corrected giving the secret a name
   that it ordered before ("The Broken Wing" < "The Raven of Vael"); now both the unitary test and
   the e2e fail.
