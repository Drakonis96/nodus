# Vault of Worldbuilding — Section **Families**

> Status: **plan, unimplemented** (2026-07-27).
> Second section of the vault`worldbuilding`, on the[Personajes](worldbuilding-characters-plan.md).
> A family groups characters and gives a family tree **per family**, with the same
> functions than the genealogy tree, plus a proper emblem.

---

## 1. What to decide before writing code

Four decisions that condition everything else. The first three I have resolved in the plan; the
fourth I leave it marked because it changes the scope.

### 1.1 ‘Family’ already means something else in the code

`shared/treeFamilies.ts`defines **`TreeFamily`**, and it is not a house or a lineage: it is the unit
of drawing *pair + its children*, with its lanes and connectors. It is the engine of the current
tree and will be reused as it is.

If the new family is called`Family`in the code, anyone reading`treeFamilies.ts`Six months from now,
he's gonna mix both.

> **Decision.** In the UI the word is **Family** (which is correct in Spanish and which
> In the code the type is **`CharacterFamily`** and table`character_families`,
> never`Family`It's dry.`TreeFamily`It stays the way it is.

### 1.2 One character belongs to ONE family... but marries another

You asked "to assign each character to a family (or none)", and this is how it is implemented:
membership has the`person_id`as a primary key, i.e. ** a maximum family**.

But as soon as there is a marriage between houses the question arises: if a character only belongs
to house A, what happens to his spouse in house B when you look at the tree of A? If the tree
filters hard by belonging, **the spouse disappears and the side of marriage hangs from nothing**,
which is just what makes a dynastic tree unreadable.

> **Decision.**The family defines the **root set** of the tree, not a hard filter.
> They draw their members ** and** every character connected to them by kinship, marking
> visually to the outsiders (small emblema of your home, or gray if you don't have it).
> does any genealogy software and eliminates the root problem.
>
> In addition, belonging keeps **how** one belongs — `born | married | adopted | sworn |
> other` — so marrying House A is representative while still being from House B:
> the character is a member`married`of A, and in the tree of B appears as external.
>
> If you later want multiple membership, simply switch the PK to a composite
> `(person_id, family_id)`. It is a content change and I leave it noted in the DDL.

### 1.3 The father/mother branch color does NOT work in worldbuilding

This is the important finding and I checked it in the code.

`deriveTreeKinship`decides the branch like this ([treeKinship.ts:532](../shared/treeKinship.ts)):

```ts
const father = focusParents.find((id) => sexOf.get(id) === 'male');
const mother = focusParents.find((id) => sexOf.get(id) === 'female');
```

A character **never fixed**`persons.sex`— stays in`'unknown'`by the way, because that column does
not describe a god or a dragon. Result: there is no father or mother root, ** all branches come
out`neutral`, the whole tree is drawn in a single gray and the two color selectors do absolutely
nothing**.

Map the free field`gender`a male/female would be the easy solution and it is the wrong one: it
reimposes a binary that it deliberately removed, and fails with any character that does not fit in
it.

> **Decision, and that's what makes this section worthwhile.** In worldbuilding branches
> are colored **per family**, not by sex. In a dynastic tree that is more useful than
> It was never paternal/motherly: at a glance you see which house each line of ancestors comes from.
> The two color selectors are replaced by the legend of families, and each family uses
> your own accent (the palette`CHARACTER_ACCENTS`that already exists).
>
> The *layout* branch model (`branchByPerson`, three values) is left intact: only
> influence the order of the lanes and degrade to`neutral`It's harmless.
> coming from a map`familyByPerson`It is a clean and low-risk separation:
> no touching`treeKinship.ts`.

### 1.4 What I leave to you to decide

**Are families only from worldbuilding, or also from genealogy?** The plan`worldbuilding`Genealogy
has the same problem (grouping by surname/house) and the table would serve the same, but its tree
already uses paternal/motherly and its vocabulary is another. Putting them into genealogy would be a
second product decision, not a consequence of it.

---

## 2. Scope

### 2.1 Enter

- Create, edit, sort and delete families.
- Assign a character to a family **from both ends**: from the Families section (add members) and
  from the character tab (choose family, or create a new one without leaving the tab). Both write
  the same.
- Type of membership (`born | married | adopted | sworn | other`) and range inside the house.
- **Emblem** per family: generated with AI (style catalog, §6) or uploaded by hand.
- ** Tree by family**: family selector, outside characters drawn and marked, branches colored by
  house. All functions of the genealogy tree (§5.2).
- Lema, description, state, headquarters and founder.
- Suggestion of families from the already registered kinship (§7.1).

### 2.2 Does not enter

Alliances between houses such as own graph, inheritance of titles, dynastic chronology and
generation of an entire house with AI. They remain in §11.

---

## 3. Data model — migration **93**

`SCHEMA_VERSION`92 → 93. Migration **CREATE** only, without`ALTER`.

```sql
-- A family: a house, a clan, a lineage. It groups characters and gives a tree of its own.
--
-- DO NOT confuse with`TreeFamily`of shared/treeFamilies.ts, which is the drawing unit
-- ‘partner + children’ of the tree engine and has nothing to do with this.
CREATE TABLE character_families (
  family_id         TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  -- The words of the house. Short by the way: it is a motto, not a description.
  motto             TEXT,
  description       TEXT,
  -- unknown | ruling | declining | exiled | extinct | ascendant
  status            TEXT NOT NULL DEFAULT 'unknown',
  -- Token de CHARACTER_ACCENTS. It is what colors the branches of this house in the tree,
  -- So two families with the same accent are a reading problem: the UI warns.
  accent            TEXT,
  seat_place_id     TEXT REFERENCES places(place_id) ON DELETE SET NULL,
  -- The character for whom the tree is centered when the family opens. SET NULL, no CASCADE:
  -- erasing the founder should not erase the house.
  founder_person_id TEXT REFERENCES persons(person_id) ON DELETE SET NULL,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_character_families_sort ON character_families(sort_order, name);

-- Belonging.`person_id`is the PK, i.e. ONE family per character at most, which is
-- the request. Own table and not a column in`character_profiles`for two reasons:
-- belonging carries your data (how you belong and with what rank), and move on to belonging
-- multiple one day is just to change this PK for (person_id, family_id).
CREATE TABLE character_family_members (
  person_id  TEXT PRIMARY KEY REFERENCES persons(person_id) ON DELETE CASCADE,
  family_id  TEXT NOT NULL REFERENCES character_families(family_id) ON DELETE CASCADE,
  -- born | married | adopted | sworn | other
  membership TEXT NOT NULL DEFAULT 'born',
  -- Range or title within the house: free text, each world has its own.
  rank       TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_character_family_members_family ON character_family_members(family_id);

-- The emblem, in separate table and not in columns of`character_families`, exactly for the
-- same reason as`person_portraits`is separated from`persons`: a BLOB in the row
-- main converts any listing into a megabyte transfer, and remove the
-- emblem must be a DELETE and not seven UPDATE to NULL.
CREATE TABLE character_family_emblems (
  family_id  TEXT PRIMARY KEY REFERENCES character_families(family_id) ON DELETE CASCADE,
  mime_type  TEXT NOT NULL DEFAULT 'image/jpeg',
  bytes      INTEGER NOT NULL DEFAULT 0,
  blob       BLOB,
  -- The prompt that generated it, to be able to iterate instead of guessing again.
  prompt     TEXT,
  provider   TEXT,
  model      TEXT,
  style      TEXT,
  generated  INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
```

**Register the three tables in`electron/db/syncTables.ts`**, group`worldbuilding`Without
that,`test-sync-package`and`test-superseded-versions`They fail with “unclassified” — and rightly so:
a house that does not travel between machines is half a lost vault.

---

## 4. Shared rates

```ts
export type FamilyStatus = 'unknown' | 'ruling' | 'ascendant' | 'declining' | 'exiled' | 'extinct';
export type FamilyMembershipKind = 'born' | 'married' | 'adopted' | 'sworn' | 'other';

export interface CharacterFamily {
  familyId: string;
  name: string;
  motto: string | null;
  description: string | null;
  status: FamilyStatus;
  accent: string | null;
  seatPlaceId: string | null;
  seatPlaceName: string | null;   // resolved by convenience, as in SocialRelation
  founderPersonId: string | null;
  founderName: string | null;
  sortOrder: number;
  /** Just the fact that it exists, never bytes: the list does not charge them. */
  hasEmblem: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterFamilyInput { /* name obligatorio; el resto opcional */ }

export interface FamilyMembership {
  personId: string;
  familyId: string;
  membership: FamilyMembershipKind;
  rank: string | null;
}

/** A member as listed in the family file. */
export interface FamilyMember extends FamilyMembership {
  displayName: string;
  epithet: string | null;
  lifeStatus: CharacterLifeStatus;
  narrativeRole: CharacterNarrativeRole | null;
  birthYear: number | null;
}
```

And in`shared/characterLabels.ts`: `FAMILY_STATUS_LABEL`, `FAMILY_MEMBERSHIP_LABEL`Remember to
register them in`INDIRECT_KEY_SOURCES`— there's the file, but the current patterns
take`label:`/`hint:`and the keys to`Record`So these go in alone.

---

## 5. Interface

### 5.1 `src/views/FamiliesView.tsx`— the section

Same shape as Characters, by coherence: grid above, detail that replaces it.

- **House Grid**: badge with emblem (square, no.3:4 as characters), name, motto in italics, accent
  strip, and accountants (members, generations).
- **Detail of the family**, in this order:
  1. Header: large emblem + name + motto + state + headquarters + actions.
  2. **Emblem** (§6): generate / upload / remove, with your prompt saved and visible.
  3. Description (self-saved field, reused`AutoSavingField`).
  4. **Members**: list with portrait, type of belonging and rank, editable online; add button that
     opens a character selector (reuses`PersonMultiSelect`).
  5. **Family tree**: button that leads to the view of a tree that has already been seen in this
     house.
  6. Founder and headquarters.

### 5.2 Tree by family

`TreeView`wins a prop.`family`and, when present:

| Function of the genealogy tree | What happens in the tree per family |
|---|---|
| Person Selector to Center | **A FAMILY selector is put before him.** When changing houses, the focus jumps to its founder (or to the oldest member per year in the world).Iteration between families you asked for. |
| Search the Tree | Same, on the already scoped set |
| Reverse guidance | Equal (`treeOrientation`) |
| **Paterno/Maternal colours** | **Substituted by the legend of families** (§1.3). Each house with its accent; without house, gray |
| Zoom and panning | Same |
| Click on node → side panel | Same: frame,`KinshipEditor`, complete tab, focus here. **More**: membership and rank in this house |
| Legend of lines | Same |
| Parental age warning | Same, but comparing **years of the world** (§9, landmine 2) |
| Wooden frame per person | The same. *Suggestion*: that the default frame can be fixed **per family**, not just by vault — is a cheap way for each house to look different |

**People from outside the house**: they are drawn (if not, the marriage edges hang from nowhere)
with the small emblem of their own family in the corner of the node, or in grey if they do not have.
A switch "members only" allows them to be hidden for export or printing.

### 5.3 From the character tab

One section **Family** in`CharacterDossier`, between Description and Gallery:

- Family selector with option **"Create new family..."** in the list itself, which opens the high
  modal and assigns the character when saving. This is half of "from characters or from families?":
  both.
- Type of membership and rank.
- Link to the house and button to open the tree centered on this character.

### 5.4 Sidebar

`WorldbuildingSidebar`: **‘Families’** (icon`users`is taken by Characters; use`network`o`shield`)
goes on to Explore just below Characters. And **"Dynasties"**, which today points to`tree`He goes on
to call himself the same, but he opens the tree with the family selector.

---

## 6. The emblem and its prompts

Just like the character's portrait: the style is chosen by the author, the prompt is saved next to
the bytes, and you can upload your own image.

### 6.1 Catalogue —`shared/familyEmblemStyles.ts`

```ts
export const FAMILY_EMBLEM_STYLES = [
  { id: 'heraldic_shield', label: 'Heraldic shield',
    prompt: 'a heraldic coat of arms on a shield, flat vector heraldry, bold tinctures, clean divisions of the field, crisp edges, perfectly symmetrical' },
  { id: 'sigil', label: 'Sigilo',
    prompt: 'a single bold sigil, minimal solid silhouette, extreme contrast, iconic and instantly readable at small size' },
  { id: 'wax_seal', label: 'Sello de lacre',
    prompt: 'an antique wax seal impression, deep relief, softly worn edges, one colour of wax, photographed straight on' },
  { id: 'banner', label: 'Estandarte',
    prompt: 'a hanging cloth banner bearing one emblem, visible weave and heavy folds, muted natural dyes, straight-on view' },
  { id: 'engraved_crest', label: 'Escudo grabado',
    prompt: 'a finely engraved crest, dense line hatching, antique bookplate feel, monochrome ink on aged paper' },
  { id: 'monogram', label: 'Monograma',
    prompt: 'an ornate interlaced monogram of abstract strokes, calligraphic, symmetrical, a single colour' },
  { id: 'totem', label: 'Totem',
    prompt: 'a carved wood and stone totem emblem, tribal geometry, weathered surface, one central motif' },
  { id: 'arcane_glyph', label: 'Glifo arcano',
    prompt: 'a luminous arcane glyph, concentric sacred geometry, fine glowing lines, deep dark field' },
  { id: 'industrial_mark', label: 'Marca industrial',
    prompt: 'a stamped industrial maker\'s mark, stencil geometry, worn painted metal, one colour' },
  { id: 'organic_crest', label: 'Organic crest',
    prompt: 'an emblem grown from living matter: branches, bone, coral or chitin, biological symmetry, natural pigments' },
];
```

### 6.2 How it is composed —`buildFamilyEmblemPrompt(style, { charges, tinctures, extra })`

```
[style template]
. [charges: what appears — "a black raven over a broken tower"]
. [tinctures: the colors — "black and gold on gules"]
. [extra: only for this image]
. a single emblem, centred, square composition, plain flat background, no scene, no landscape
. no text, no words, no letters, no numbers, no motto, no banner scroll, no signature, no watermark
```

Two deliberate things and both matter:

1. **The name of the family does NOT enter the prompt.** If you give "Vandrek House" to the model,
   write "Vandrek House" within the shield. A blazon with invented text and unreadable medium is
   useless, and so the anti-text clause is the longest of the prompt and explicitly mentions the
   scroll of the motto, which is where the models insist on writing.
2. **`charges`and`tinctures`are separated**, not in a single free field. The heraldic is *what
   figure* and *of what color*, and separating them makes the result reproducible: you can change
   the color without the model redrawing another animal.

** Square, no 16:9.**`callImageProvider`request`aspect_ratio: '16:9'`to Google
([decorativeImages.ts:143](../electron/ai/decorativeImages.ts)); a panoramic shield comes out with
two thirds of an empty background. The aspect ratio must be parameterized — it is the only change
that this section requires in code shared with other functions, so it must be an optional parameter
with the current default value, not a change of behavior.

---

## 7. Suggestions from me

Ordained by what they contribute against what they cost. None is mandatory.

### 7.1 Detect families from kinship *(barata, high)*

The characters already have kinship. Strolling the related components by progenitor edges gives, for
free, the groups that ** already are** a family. The section proposes: «6 connected and familyless
characters: Kaelen, Serel... create a house with them?».

It turns the allocation of a world already started from half an hour of clicks into two. And it is
pure:`shared/familySuggestions.ts`Testeable without database.

### 7.2 Repeated accent warning *(trivial, high)*

If the color of the branches identifies the house, two houses with the same accent make the tree
lie. A warning when choosing the color avoids it, and is a three-line check.

### 7.3 Motto and status *(trivial, half a day)*

They are already in the DDL. The motto is the line that gives the most character for less effort,
and feeds the AI. The state (`reinante`, `en declive`, `exiliada`, `extinta`) gives the grid a
reading at a glance that a simple alphabetical listing does not have.

### 7.4 Founder as default focus *(trivial, medium)*

Without him, changing the family centers the tree into an arbitrary character and you have to
reposition by hand each time. With him, iteration between houses is a single click — that’s just
what you asked for.

### 7.5 Wood frame per family *(barato, media)*

`effectiveFrame(personFrame, vaultFrame)`It already solves two levels. Getting the family in between
—`person → family → vault`— makes each house look different without touching any
character.`effectiveFrame`and a selector on the family file.

### 7.6 Alliance panel *(media, medium)* — I would leave it for later

Which houses are united by marriage and by how many bonds. It is deduced whole from what already
exists (spouse aristists crossing belongings) and does not need scheme. It is the natural seed of
the section **Factions**, so it is better to wait to build it there.

### 7.7 Export the tree as an image *(mean, mean)*

The tree is already a`<svg>`Serializing it to PNG or SVG is content, not motor. It fits the
exportable chip that already exists for characters.

---

## 8. Phases

| Phase | Content | Done when |
|---|---|---|
| **G0** | Migration 93 types,`charactersRepo`/`familiesRepo`, `syncTables` | `test-worldbuilding-families.mjs`green |
| **G1** | IPC+preload+`NodusApi` | `npm run build`clean (eye:`tsc --noEmit`does not cover`electron/`) |
| **G2** | `FamiliesView`: grid, high, tab, members | Building houses and assigning characters to them |
| **G3** | Family section on the character tab, with "create new family..." | Allocation from both ends |
| **G4** | Emblem: catalog, generation, rise, aspect ratio | Emblem generated and uploaded, with its prompt visible |
| **G5** | Tree by family: selector, external marked, color by house, year of the world | Iterates between families and the tree comes out colored by house |
| **G6** | Suggestion from families (§7.1) + accent warning (§7.2) | Proposes houses on an already populated world |
| **G7** | i18n in all 7 languages, tests,`lint`/`typecheck`/`test`/`build`/`e2e` | All green |

---

## 9. Landmines

The first three I checked in the code; the rest have already bitten me in this vault.

1. **`sex`It's`'unknown'`in every character**, so paternal/maternal does not exist (§1.3). Do not
   "fix" mapping`gender`.
2. **The year of birth of the tree comes from`parseHistoricalDate(p.birthDate).year`**
   ([TreeView.tsx:99](../src/views/TreeView.tsx)), which with a invented calendar returns`null`.
   Consequences: couples are ordered by id (arbitrary) and the parent age warning never jumps. It
   must be fed with`profile.birthYearSort`.
3. **`TreeFamily`already exists and means something else** (§1.1).
4. **The generation of images requires 16:9**; a shield needs 1:1 (§6.2).
5. **Every new table is going to`syncTables.ts`** or sync tests fail — and rightly so.
6. **`tsc --noEmit`does not cover`electron/`**: only`npm run build`type-check the main.
7. **Duplicate i18n key = TS1117**, and old keys may be **without quotation marks** (`Gallery:`),
   so a detector that only looks`'clave':`He doesn't see them.
8. **`test:e2e`does not reconstruct**: with`dist`rancid the judgment is`92 !== 93`And it looks like
   a migration error.
9. **Do not open royal vaults with this build** as long as migration numbers differ.

---

## 10. Tests

**New`scripts/test-worldbuilding-families.mjs`** (repo, with real migrations):

1. Create family, assign member, read it together with your name and rank.
2. A character can only be in a family: reassign **move**, not duplicate.
3. Clear the family leaves the characters ** alive and without family** (does not delete them).
4. Clear a character cleans his or her membership and leaves no emblems or orphaned members.
5. `listFamilies`**no** brings the bytes of the emblem.
6. The whole tree of a house includes the outside spouses, marked as external.
7. `founderPersonId`survives the erasing of the founder`NULL`Without erasing the house.

**New`scripts/test-family-suggestions.mjs`** (pure): related components, and above all what **no**
should propose (two characters united only by marriage are not a house).

**To be amended**:`test-vault-types.mjs`(view`families`scanned and wired on the
sidebar),`test-i18n-coverage.mjs`, and the case of worldbuilding of`e2e-smoke.mjs`— create a house,
assign it two characters, check that the tree is centered on the founder and that the external
spouse's node appears marked.

And as always: **break on purpose** at least the exclusion of the blob from the list, the "one
family" and the color at home, and see the three fail before they are considered good.

---

## 11. Out of reach

- Alliances between houses as own graph → waits for **Factions** (§7.6).
- Title inheritance and line of succession.
- Dinastic chronology (which house reigned in each year) → waits for **chronology**.
- Generate an entire house with AI (founder, three generations, motto and emblem at once).
- Multiple membership → PK change, content, when needed (§1.2).
