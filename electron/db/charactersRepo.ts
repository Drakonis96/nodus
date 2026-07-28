// Worldbuilding characters (schema v91). A character IS a `persons` row plus the
// `character_profiles` overlay, which is what lets it inherit life events, kinship,
// social relations, places and the portrait without a second ontology.
//
// Two rules this file exists to enforce:
//
//   1. The overlay row is NEVER assumed to exist. A person created by any other path
//      (a merge, a sync package, a future import) has none, and a read that inner-
//      joined would drop the character from the grid — or, worse, show a blank sheet
//      with no error. Reads LEFT JOIN and synthesise the defaults; writes upsert.
//   2. Ordering comes from the in-world integers, not from `date_sort`.
//      parseHistoricalDate rejects every year outside 1..3000 and cannot read an
//      invented month, so "13 de Lluvia, 1204 T.E." yields a NULL sort key and the
//      events list would come back in arbitrary order without a single warning.

import { v4 as uuid } from 'uuid';
import { getDb } from './database';
import {
  createPerson,
  deletePerson,
  getEvent,
  getPerson,
  listPersons,
  setPersonBiography,
  setPersonPortrait,
  updatePerson,
} from './entitiesRepo';
import { listAffiliationsForCharacter } from './worldGroupsRepo';
import { deletePartiesForEntity } from './worldThreadsRepo';
import { deleteCharacterChatConversations } from './characterChatRepo';
import {
  addWorldImage,
  deleteImagesFor,
  deleteWorldImage,
  getWorldImageBlob,
  listWorldImages,
  updateWorldImage,
} from './worldImagesRepo';
import type {
  Character,
  CharacterAbility,
  CharacterAbilityInput,
  CharacterCounts,
  CharacterEvent,
  CharacterFilter,
  CharacterImage,
  CharacterImageKind,
  CharacterInput,
  CharacterLifeStatus,
  CharacterNarrativeRole,
  CharacterProfile,
  Person,
} from '@shared/types';

function newId(prefix: string): string {
  return `${prefix}_${uuid()}`;
}

function now(): string {
  return new Date().toISOString();
}

interface ProfileRow {
  person_id: string;
  species: string | null;
  gender: string | null;
  pronouns: string | null;
  life_status: string | null;
  narrative_role: string | null;
  accent: string | null;
  appearance: string | null;
  personality: string | null;
  backstory: string | null;
  visual_seed: string | null;
  birth_year_sort: number | null;
  death_year_sort: number | null;
  arc_want: string | null;
  arc_need: string | null;
  arc_flaw: string | null;
  arc_lie: string | null;
  arc_wound: string | null;
  voice_register: string | null;
  voice_tics: string | null;
  voice_sample: string | null;
  biography_proposed: string | null;
  biography_proposed_at: string | null;
  created_at: string;
  updated_at: string;
}

const LIFE_STATUSES = new Set<CharacterLifeStatus>([
  'unknown',
  'alive',
  'dead',
  'missing',
  'undead',
  'immortal',
  'unborn',
]);

const NARRATIVE_ROLES = new Set<CharacterNarrativeRole>([
  'protagonist',
  'antagonist',
  'secondary',
  'tertiary',
  'cameo',
]);

/** Coerce a stored status; anything unrecognised degrades to 'unknown', never throws. */
function lifeStatus(value: string | null | undefined): CharacterLifeStatus {
  return value && LIFE_STATUSES.has(value as CharacterLifeStatus) ? (value as CharacterLifeStatus) : 'unknown';
}

function narrativeRole(value: string | null | undefined): CharacterNarrativeRole | null {
  return value && NARRATIVE_ROLES.has(value as CharacterNarrativeRole) ? (value as CharacterNarrativeRole) : null;
}

/** The profile a person has when no overlay row was ever written for them. */
function defaultProfile(person: Person): CharacterProfile {
  return {
    personId: person.personId,
    species: null,
    gender: null,
    pronouns: null,
    lifeStatus: 'unknown',
    narrativeRole: null,
    accent: null,
    appearance: null,
    personality: null,
    backstory: null,
    visualSeed: null,
    birthYearSort: null,
    deathYearSort: null,
    arc: { want: null, need: null, flaw: null, lie: null, wound: null },
    voice: { register: null, tics: null, sample: null },
    biographyProposed: null,
    biographyProposedAt: null,
    createdAt: person.createdAt,
    updatedAt: person.updatedAt,
  };
}

function rowToProfile(row: ProfileRow): CharacterProfile {
  return {
    personId: row.person_id,
    species: row.species,
    gender: row.gender,
    pronouns: row.pronouns,
    lifeStatus: lifeStatus(row.life_status),
    narrativeRole: narrativeRole(row.narrative_role),
    accent: row.accent,
    appearance: row.appearance,
    personality: row.personality,
    backstory: row.backstory,
    visualSeed: row.visual_seed,
    birthYearSort: row.birth_year_sort,
    deathYearSort: row.death_year_sort,
    arc: {
      want: row.arc_want ?? null,
      need: row.arc_need ?? null,
      flaw: row.arc_flaw ?? null,
      lie: row.arc_lie ?? null,
      wound: row.arc_wound ?? null,
    },
    voice: {
      register: row.voice_register ?? null,
      tics: row.voice_tics ?? null,
      sample: row.voice_sample ?? null,
    },
    biographyProposed: row.biography_proposed ?? null,
    biographyProposedAt: row.biography_proposed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Write (or overwrite) the overlay for a person. Creates the row when missing. */
function upsertProfile(personId: string, profile: CharacterProfile): void {
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO character_profiles
        (person_id, species, gender, pronouns, life_status, narrative_role, accent,
         appearance, personality, backstory, visual_seed, birth_year_sort, death_year_sort,
         arc_want, arc_need, arc_flaw, arc_lie, arc_wound,
         voice_register, voice_tics, voice_sample,
         biography_proposed, biography_proposed_at,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(person_id) DO UPDATE SET
         species = excluded.species, gender = excluded.gender, pronouns = excluded.pronouns,
         life_status = excluded.life_status, narrative_role = excluded.narrative_role,
         accent = excluded.accent, appearance = excluded.appearance,
         personality = excluded.personality, backstory = excluded.backstory,
         visual_seed = excluded.visual_seed, birth_year_sort = excluded.birth_year_sort,
         death_year_sort = excluded.death_year_sort,
         arc_want = excluded.arc_want, arc_need = excluded.arc_need, arc_flaw = excluded.arc_flaw,
         arc_lie = excluded.arc_lie, arc_wound = excluded.arc_wound,
         voice_register = excluded.voice_register, voice_tics = excluded.voice_tics,
         voice_sample = excluded.voice_sample,
         biography_proposed = excluded.biography_proposed,
         biography_proposed_at = excluded.biography_proposed_at,
         updated_at = excluded.updated_at`
    )
    .run(
      personId,
      profile.species,
      profile.gender,
      profile.pronouns,
      profile.lifeStatus,
      profile.narrativeRole,
      profile.accent,
      profile.appearance,
      profile.personality,
      profile.backstory,
      profile.visualSeed,
      profile.birthYearSort,
      profile.deathYearSort,
      profile.arc.want,
      profile.arc.need,
      profile.arc.flaw,
      profile.arc.lie,
      profile.arc.wound,
      profile.voice.register,
      profile.voice.tics,
      profile.voice.sample,
      profile.biographyProposed,
      profile.biographyProposedAt,
      ts,
      ts
    );
}

/** Merge an input patch over an existing profile, leaving absent keys untouched. */
function applyPatch(base: CharacterProfile, patch: Partial<CharacterInput>): CharacterProfile {
  const pick = <K extends keyof CharacterProfile>(key: K, value: CharacterProfile[K] | undefined) =>
    value !== undefined ? value : base[key];
  return {
    ...base,
    species: pick('species', patch.species !== undefined ? patch.species?.trim() || null : undefined),
    gender: pick('gender', patch.gender !== undefined ? patch.gender?.trim() || null : undefined),
    pronouns: pick('pronouns', patch.pronouns !== undefined ? patch.pronouns?.trim() || null : undefined),
    lifeStatus: pick('lifeStatus', patch.lifeStatus !== undefined ? lifeStatus(patch.lifeStatus) : undefined),
    narrativeRole: pick(
      'narrativeRole',
      patch.narrativeRole !== undefined ? narrativeRole(patch.narrativeRole) : undefined
    ),
    accent: pick('accent', patch.accent !== undefined ? patch.accent || null : undefined),
    // The three description fields and the visual seed keep their whitespace: they are
    // prose the author is writing, not identifiers.
    appearance: pick('appearance', patch.appearance !== undefined ? patch.appearance || null : undefined),
    personality: pick('personality', patch.personality !== undefined ? patch.personality || null : undefined),
    backstory: pick('backstory', patch.backstory !== undefined ? patch.backstory || null : undefined),
    visualSeed: pick('visualSeed', patch.visualSeed !== undefined ? patch.visualSeed || null : undefined),
    birthYearSort: pick('birthYearSort', patch.birthYearSort !== undefined ? patch.birthYearSort ?? null : undefined),
    deathYearSort: pick('deathYearSort', patch.deathYearSort !== undefined ? patch.deathYearSort ?? null : undefined),
    // The arc and the voice are patched FIELD BY FIELD, not replaced wholesale: the
    // sheet autosaves one textarea at a time, and sending the whole object would let
    // every save wipe the four fields the user was not editing.
    arc: {
      want: patch.arc?.want !== undefined ? patch.arc.want || null : base.arc.want,
      need: patch.arc?.need !== undefined ? patch.arc.need || null : base.arc.need,
      flaw: patch.arc?.flaw !== undefined ? patch.arc.flaw || null : base.arc.flaw,
      lie: patch.arc?.lie !== undefined ? patch.arc.lie || null : base.arc.lie,
      wound: patch.arc?.wound !== undefined ? patch.arc.wound || null : base.arc.wound,
    },
    voice: {
      register: patch.voice?.register !== undefined ? patch.voice.register || null : base.voice.register,
      tics: patch.voice?.tics !== undefined ? patch.voice.tics || null : base.voice.tics,
      sample: patch.voice?.sample !== undefined ? patch.voice.sample || null : base.voice.sample,
    },
  };
}

function getProfileRow(personId: string): CharacterProfile | null {
  const row = getDb().prepare('SELECT * FROM character_profiles WHERE person_id = ?').get(personId) as
    | ProfileRow
    | undefined;
  return row ? rowToProfile(row) : null;
}

// ── Characters ───────────────────────────────────────────────────────────────

export function getCharacter(personId: string): Character | null {
  const person = getPerson(personId);
  if (!person) return null;
  const memberships = listAffiliationsForCharacter(personId);
  return {
    ...person,
    profile: getProfileRow(personId) ?? defaultProfile(person),
    factions: memberships.filter((m) => !['culture', 'species', 'language'].includes(m.groupKind)).map((m) => m.groupName),
    cultures: memberships.filter((m) => ['culture', 'species', 'language'].includes(m.groupKind)).map((m) => m.groupName),
  };
}

/**
 * Every character in the vault, newest name-ordered, with the overlay attached.
 * The person half (including the alias search) is delegated to `listPersons` so the
 * two lists can never drift; the overlays are fetched in ONE query and zipped, and
 * the role/status filters are applied in memory — a world has hundreds of characters,
 * not millions, and pushing them into SQL would mean duplicating the person query.
 */
export function listCharacters(filter: CharacterFilter = {}): Character[] {
  const persons = listPersons({ search: filter.search });
  if (persons.length === 0) return [];
  // Memberships come along for the ride so the grid can facet by faction and culture.
  // Fetched as ONE grouped query rather than per character: the alternative is an N+1
  // that only shows up once a world has a real cast.
  const memberships = new Map<string, { factions: string[]; cultures: string[] }>();
  for (const row of getDb()
    .prepare(
      `SELECT a.person_id, g.name, g.kind FROM character_affiliations a
         JOIN world_groups g ON g.group_id = a.group_id`
    )
    .all() as { person_id: string; name: string; kind: string }[]) {
    const entry = memberships.get(row.person_id) ?? { factions: [], cultures: [] };
    // The two sections group several kinds each; the facet only cares which side it is.
    if (['culture', 'species', 'language'].includes(row.kind)) entry.cultures.push(row.name);
    else entry.factions.push(row.name);
    memberships.set(row.person_id, entry);
  }
  const profiles = new Map(
    (getDb().prepare('SELECT * FROM character_profiles').all() as ProfileRow[]).map((row) => [
      row.person_id,
      rowToProfile(row),
    ])
  );
  return persons
    .map((person) => ({
      ...person,
      profile: profiles.get(person.personId) ?? defaultProfile(person),
      factions: memberships.get(person.personId)?.factions ?? [],
      cultures: memberships.get(person.personId)?.cultures ?? [],
    }))
    .filter((character) => (filter.role ? character.profile.narrativeRole === filter.role : true))
    .filter((character) => (filter.status ? character.profile.lifeStatus === filter.status : true));
}

export function createCharacter(input: CharacterInput): Character {
  const db = getDb();
  const create = db.transaction(() => {
    const person = createPerson({
      displayName: input.displayName,
      // A worldbuilding vault never sets `sex`: it cannot describe a god, a dragon or
      // an AI. Identity lives in the overlay (species / gender / pronouns), and
      // leaving this 'unknown' is what makes PersonPortrait fall back to the neutral
      // placeholder instead of a human silhouette.
      sex: 'unknown',
      birthDate: input.birthDate ?? null,
      deathDate: input.deathDate ?? null,
      notes: input.notes ?? null,
      names: input.names ?? [{ name: input.displayName.trim(), kind: null }],
    });
    upsertProfile(person.personId, applyPatch(defaultProfile(person), input));
    return person.personId;
  });
  return getCharacter(create())!;
}

/**
 * Update the person row and its overlay together. One transaction: a half-written
 * character (renamed but with the old description, or vice versa) is worse than a
 * failed save, because nothing tells the author it happened.
 */
export function updateCharacter(personId: string, patch: Partial<CharacterInput>): Character | null {
  const existing = getCharacter(personId);
  if (!existing) return null;
  const db = getDb();
  const update = db.transaction(() => {
    const touchesPerson =
      patch.displayName !== undefined ||
      patch.birthDate !== undefined ||
      patch.deathDate !== undefined ||
      patch.notes !== undefined;
    if (touchesPerson) {
      updatePerson(personId, {
        displayName: patch.displayName,
        birthDate: patch.birthDate,
        deathDate: patch.deathDate,
        notes: patch.notes,
      });
    }
    upsertProfile(personId, applyPatch(existing.profile, patch));
  });
  update();
  return getCharacter(personId);
}

/**
 * Delete a character.
 *
 * `character_profiles`, `character_abilities` and `character_affiliations` cascade from
 * the person row. `world_images` does NOT: its `entity_id` is polymorphic and therefore
 * has no foreign key, so the CASCADE that character_images used to provide is gone (v94)
 * and the gallery has to be removed by hand. Forgetting this leaks every image of every
 * deleted character — invisibly, since nothing reads them any more.
 */
export function deleteCharacter(personId: string): void {
  const db = getDb();
  const remove = db.transaction(() => {
    deleteCharacterChatConversations(personId);
    deleteImagesFor('character', personId);
    deletePartiesForEntity('character', personId);
    deletePerson(personId);
  });
  remove();
}

export function characterCounts(): CharacterCounts {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) AS c FROM persons').get() as { c: number }).c;
  const byRole: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const rows = db
    .prepare('SELECT narrative_role, life_status, COUNT(*) AS c FROM character_profiles GROUP BY narrative_role, life_status')
    .all() as { narrative_role: string | null; life_status: string | null; c: number }[];
  let profiled = 0;
  for (const row of rows) {
    profiled += row.c;
    const role = narrativeRole(row.narrative_role);
    if (role) byRole[role] = (byRole[role] ?? 0) + row.c;
    const status = lifeStatus(row.life_status);
    byStatus[status] = (byStatus[status] ?? 0) + row.c;
  }
  // People with no overlay row still count, and they count as 'unknown'.
  if (total > profiled) byStatus.unknown = (byStatus.unknown ?? 0) + (total - profiled);
  return { total, byRole, byStatus };
}

// ── Events in the world's own calendar ───────────────────────────────────────

/**
 * A character's life events in world order. `world_year IS NULL` sorts FIRST in
 * SQLite, which would park every unplaced event at the top of the sheet, so the
 * null-ness is the leading sort term. `date_sort` stays as the last tiebreak for the
 * rare world that does use Earth-like dates.
 */
export function listCharacterEvents(personId: string): CharacterEvent[] {
  const rows = getDb()
    .prepare(
      `SELECT e.event_id, w.world_year, w.world_order, w.era_id, w.month_index, w.day, w.world_day
         FROM events e
         JOIN event_participants ep ON ep.event_id = e.event_id
         LEFT JOIN event_world_dates w ON w.event_id = e.event_id
        WHERE ep.person_id = ?
        GROUP BY e.event_id
        ORDER BY (w.world_year IS NULL), w.world_year,
                 -- world_day (v93) is the WITHIN-year tiebreak, never the primary key:
                 -- the year is always meaningful, while world_day only exists once the
                 -- author has defined a calendar. Ordering by world_day first would mix
                 -- two scales the moment a vault has both dated and year-only events.
                 (w.world_day IS NULL), w.world_day, w.world_order,
                 (e.date_sort IS NULL), e.date_sort, e.created_at`
    )
    .all(personId) as WorldDateRow[];
  return hydrateEvents(rows);
}

/**
 * EVERY event in the vault, in world order — the worldbuilding timeline.
 *
 * A separate query from `listEvents` rather than an option on it, because the two order
 * by different things entirely: that one sorts on `date_sort`, which an invented calendar
 * always leaves NULL. Passing through it would produce a timeline in insertion order that
 * looked deliberate.
 */
export function listWorldEvents(): CharacterEvent[] {
  const rows = getDb()
    .prepare(
      `SELECT e.event_id, w.world_year, w.world_order, w.era_id, w.month_index, w.day, w.world_day
         FROM events e
         LEFT JOIN event_world_dates w ON w.event_id = e.event_id
        ORDER BY (w.world_year IS NULL), w.world_year,
                 -- world_day (v93) is the WITHIN-year tiebreak, never the primary key:
                 -- the year is always meaningful, while world_day only exists once the
                 -- author has defined a calendar. Ordering by world_day first would mix
                 -- two scales the moment a vault has both dated and year-only events.
                 (w.world_day IS NULL), w.world_day, w.world_order,
                 (e.date_sort IS NULL), e.date_sort, e.created_at`
    )
    .all() as WorldDateRow[];
  return hydrateEvents(rows);
}

/** Place an event in the world's calendar, or clear it (both values null/0). */
export function setEventWorldDate(eventId: string, worldYear: number | null, worldOrder = 0): void {
  const year = worldYear == null || !Number.isFinite(worldYear) ? null : Math.trunc(worldYear);
  const order = Number.isFinite(worldOrder) ? Math.trunc(worldOrder) : 0;
  if (year == null && order === 0) {
    getDb().prepare('DELETE FROM event_world_dates WHERE event_id = ?').run(eventId);
    return;
  }
  getDb()
    .prepare(
      `INSERT INTO event_world_dates (event_id, world_year, world_order) VALUES (?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET world_year = excluded.world_year, world_order = excluded.world_order`
    )
    .run(eventId, year, order);
}

export function getEventWorldDate(eventId: string): { worldYear: number | null; worldOrder: number } | null {
  const row = getDb().prepare('SELECT world_year, world_order FROM event_world_dates WHERE event_id = ?').get(eventId) as
    | { world_year: number | null; world_order: number }
    | undefined;
  return row ? { worldYear: row.world_year, worldOrder: row.world_order } : null;
}

interface WorldDateRow {
  event_id: string;
  world_year: number | null;
  world_order: number | null;
  era_id: string | null;
  month_index: number | null;
  day: number | null;
  world_day: number | null;
}

/** Attach the world date to each ordered event id, dropping any that vanished. */
function hydrateEvents(rows: WorldDateRow[]): CharacterEvent[] {
  const events: CharacterEvent[] = [];
  for (const row of rows) {
    const event = getEvent(row.event_id);
    if (!event) continue;
    events.push({
      ...event,
      worldYear: row.world_year,
      worldOrder: row.world_order ?? 0,
      eraId: row.era_id,
      monthIndex: row.month_index,
      day: row.day,
      worldDay: row.world_day,
    });
  }
  return events;
}

// ── Image gallery ────────────────────────────────────────────────────────────
// Thin wrappers over the generic repo: one implementation of "the images of a thing",
// shared with places, groups and scenes.

export function listCharacterImages(personId: string): CharacterImage[] {
  const duplicateRows = getDb()
    .prepare(
      `SELECT wi.image_id
         FROM world_images wi
         JOIN person_portraits pp
           ON pp.person_id = wi.entity_id
          AND pp.blob = wi.blob
        WHERE wi.entity_kind = 'character'
          AND wi.entity_id = ?`
    )
    .all(personId) as Array<{ image_id: string }>;
  if (duplicateRows.length === 0) return listWorldImages('character', personId);
  const duplicates = new Set(duplicateRows.map((row) => row.image_id));
  return listWorldImages('character', personId).filter((image) => !duplicates.has(image.imageId));
}

export function getCharacterImageBlob(imageId: string): { blob: Buffer; mime: string } | null {
  return getWorldImageBlob(imageId);
}

export function addCharacterImage(input: {
  personId: string;
  blob: Uint8Array;
  mimeType?: string;
  kind?: CharacterImageKind;
  label?: string | null;
  prompt?: string | null;
  provider?: string | null;
  model?: string | null;
  style?: string | null;
  generated?: boolean;
}): CharacterImage {
  const { personId, ...rest } = input;
  return addWorldImage({ entityKind: 'character', entityId: personId, ...rest });
}

export function updateCharacterImage(
  imageId: string,
  patch: { kind?: CharacterImageKind; label?: string | null }
): void {
  updateWorldImage(imageId, patch);
}

export function deleteCharacterImage(imageId: string): void {
  deleteWorldImage(imageId);
}

/**
 * Promote a gallery image to the character's avatar.
 *
 * This COPIES the bytes into `person_portraits` rather than pointing at the gallery row,
 * because that table is the single source of truth every other surface reads (the card
 * grid, the kinship tree, the dossier header) and it owns the non-destructive framing.
 * One duplicated blob is cheaper than two competing answers to "which image is this
 * character" — and deleting the gallery copy must not blank the avatar.
 */
export function setCharacterAvatarFromImage(imageId: string): void {
  const row = getDb()
    .prepare("SELECT entity_id, blob, mime_type FROM world_images WHERE image_id = ? AND entity_kind = 'character'")
    .get(imageId) as { entity_id: string; blob: Buffer | null; mime_type: string } | undefined;
  if (!row?.blob) return;
  setPersonPortrait(row.entity_id, row.blob, row.mime_type, { focusX: 0.5, focusY: 0.42, scale: 1 }, true);
}

// ── Abilities ────────────────────────────────────────────────────────────────

interface AbilityRow {
  ability_id: string;
  person_id: string;
  name: string;
  description: string | null;
  cost: string | null;
  limits: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function rowToAbility(row: AbilityRow): CharacterAbility {
  return {
    abilityId: row.ability_id,
    personId: row.person_id,
    name: row.name,
    description: row.description,
    cost: row.cost,
    limits: row.limits,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listCharacterAbilities(personId: string): CharacterAbility[] {
  return (
    getDb()
      .prepare('SELECT * FROM character_abilities WHERE person_id = ? ORDER BY sort_order, created_at')
      .all(personId) as AbilityRow[]
  ).map(rowToAbility);
}

export function addCharacterAbility(personId: string, input: CharacterAbilityInput): CharacterAbility {
  const db = getDb();
  const id = newId('cab');
  const ts = now();
  const nextOrder =
    input.sortOrder ??
    ((db.prepare('SELECT MAX(sort_order) AS m FROM character_abilities WHERE person_id = ?').get(personId) as {
      m: number | null;
    }).m ?? -1) + 1;
  db.prepare(
    `INSERT INTO character_abilities
      (ability_id, person_id, name, description, cost, limits, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    personId,
    input.name.trim(),
    input.description ?? null,
    input.cost ?? null,
    input.limits ?? null,
    nextOrder,
    ts,
    ts
  );
  return listCharacterAbilities(personId).find((ability) => ability.abilityId === id)!;
}

export function updateCharacterAbility(
  abilityId: string,
  patch: Partial<CharacterAbilityInput>
): CharacterAbility | null {
  const row = getDb().prepare('SELECT * FROM character_abilities WHERE ability_id = ?').get(abilityId) as
    | AbilityRow
    | undefined;
  if (!row) return null;
  const current = rowToAbility(row);
  getDb()
    .prepare(
      'UPDATE character_abilities SET name = ?, description = ?, cost = ?, limits = ?, sort_order = ?, updated_at = ? WHERE ability_id = ?'
    )
    .run(
      patch.name?.trim() ?? current.name,
      patch.description !== undefined ? patch.description || null : current.description,
      patch.cost !== undefined ? patch.cost || null : current.cost,
      patch.limits !== undefined ? patch.limits || null : current.limits,
      patch.sortOrder ?? current.sortOrder,
      now(),
      abilityId
    );
  const updated = getDb().prepare('SELECT * FROM character_abilities WHERE ability_id = ?').get(abilityId) as AbilityRow;
  return rowToAbility(updated);
}

export function deleteCharacterAbility(abilityId: string): void {
  getDb().prepare('DELETE FROM character_abilities WHERE ability_id = ?').run(abilityId);
}

// ── Aliases with a secret flag ───────────────────────────────────────────────

/**
 * Add or update one of a character's names, including whether it is a secret and who
 * knows it. Separate from `addPersonName` because that one is the genealogy path and
 * must stay unaware of the two worldbuilding columns.
 */
export function setCharacterName(
  personId: string,
  name: string,
  kind: string | null,
  secret = false,
  knownBy: string | null = null
): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  getDb()
    .prepare(
      `INSERT INTO person_names (id, person_id, name, kind, secret, known_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(person_id, name) DO UPDATE SET
         kind = excluded.kind, secret = excluded.secret, known_by = excluded.known_by`
    )
    .run(newId('pn'), personId, trimmed, kind, secret ? 1 : 0, knownBy?.trim() || null);
}

export function deleteCharacterName(personId: string, name: string): void {
  getDb().prepare('DELETE FROM person_names WHERE person_id = ? AND name = ?').run(personId, name);
}

/** Store an AI-proposed biography WITHOUT touching the accepted one. */
export function setProposedBiography(personId: string, proposal: string | null): void {
  const existing = getCharacter(personId);
  if (!existing) return;
  upsertProfile(personId, {
    ...existing.profile,
    biographyProposed: proposal,
    biographyProposedAt: proposal ? now() : null,
  });
}

/**
 * Accept the proposal as canon: it becomes the biography and stops being a proposal.
 * Returns null when there was nothing to accept.
 */
export function acceptProposedBiography(personId: string): Character | null {
  const existing = getCharacter(personId);
  const proposal = existing?.profile.biographyProposed;
  if (!existing || !proposal) return null;
  const db = getDb();
  const accept = db.transaction(() => {
    setPersonBiography(personId, proposal);
    upsertProfile(personId, { ...existing.profile, biographyProposed: null, biographyProposedAt: null });
  });
  accept();
  return getCharacter(personId);
}
