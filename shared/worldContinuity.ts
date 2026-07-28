/**
 * What contradicts what.
 *
 * Six families, all of them DETERMINISTIC: arithmetic over what the author typed, with no
 * model anywhere. That is not a limitation, it is the product — a warning a writer cannot
 * verify is a warning they learn to skip, and one wrong guess from a model teaches them to
 * skip the whole screen.
 *
 * Built on `shared/worldPresence.ts` rather than beside it. That module already answers
 * "where was she, and when" by uniting scenes, events and residences; asking the same
 * question a second way here would give two answers that disagree within a week — which is
 * the reason that module exists in the first place.
 *
 * The one thing every family needs is `world_day`, which is nullable and, in a real vault,
 * empty. That is why the chain of days (`shared/worldSceneDays.ts`) is a precondition of
 * this file and not a nicety: without it, three of the six never fire and the section opens
 * empty while promising to check the world.
 */

import {
  buildJourneys,
  buildTracks,
  findEncounters,
  presenceKey,
  type Presence,
} from './worldPresence';
import { makeFinding, type FindingFamily } from './worldFindings';
import { checkCharacterCoherence } from './characterChecks';
import type { WorldFinding } from './types';

export interface SnapshotCharacter {
  personId: string;
  displayName: string;
  /**
   * In-world YEARS, which is what `character_profiles` actually stores.
   *
   * Not days, and the distinction is the whole correctness of the lifespan family: a
   * scene's `world_day` is a day count from an anchor, a character's death is a year, and
   * comparing 415 with 1204 produces confident nonsense. The check below compares years
   * with years and stays quiet when it cannot.
   */
  birthYear: number | null;
  deathYear: number | null;
  lifeStatus: string;
  deathDate: string | null;
  /** The character's own life events, for the inside-the-sheet coherence checks. */
  events: { type: string; label: string | null; worldYear: number | null }[];
}

export interface SnapshotAffiliation {
  personId: string;
  personName: string;
  groupId: string;
  groupName: string;
  fromWorldDay: number | null;
  toWorldDay: number | null;
}

export interface SnapshotSecret {
  secretId: string;
  title: string;
  ownerPersonId: string | null;
  revealedWorldDay: number | null;
}

export interface SnapshotKnower {
  secretId: string;
  personId: string;
  personName: string;
  sinceWorldDay: number | null;
}

export interface SnapshotPlace {
  placeId: string;
  name: string;
  parentId: string | null;
}

export interface WorldSnapshot {
  characters: SnapshotCharacter[];
  presences: Presence[];
  affiliations: SnapshotAffiliation[];
  secrets: SnapshotSecret[];
  knowers: SnapshotKnower[];
  places: SnapshotPlace[];
  /** Undated scenes and the like — reported as gaps, never as contradictions. */
  scenes: { sceneId: string; title: string; worldDay: number | null; narrativeOrder: number }[];
}

export interface DistanceRow {
  fromPlaceId: string;
  toPlaceId: string;
  /** Whole days the fastest recorded way of travelling needs. */
  days: number;
}

export const CONTINUITY_CHECKS: { id: string; family: FindingFamily; label: string; explains: string }[] = [
  {
    id: 'presence.bilocation',
    family: 'presence',
    label: 'En dos sitios a la vez',
    explains: 'Alguien está en dos lugares distintos el mismo día del mundo.',
  },
  {
    id: 'lifespan.afterDeath',
    family: 'lifespan',
    label: 'Actúa después de morir',
    explains: 'Alguien aparece en una escena o un hecho posterior a su muerte.',
  },
  {
    id: 'lifespan.beforeBirth',
    family: 'lifespan',
    label: 'Actúa antes de nacer',
    explains: 'Alguien aparece antes de la fecha de su nacimiento.',
  },
  {
    id: 'travel.impossible',
    family: 'travel',
    label: 'Viaje imposible',
    explains: 'El tiempo entre dos lugares no da para llegar, según los modos de viaje del mundo.',
  },
  {
    id: 'affiliation.inverted',
    family: 'affiliation',
    label: 'Pertenencia al revés',
    explains: 'La pertenencia acaba antes de empezar.',
  },
  {
    id: 'secret.knownTooEarly',
    family: 'secret',
    label: 'Lo sabe antes que nadie',
    explains: 'Alguien conoce un secreto antes que quien lo guardaba.',
  },
  {
    id: 'secret.neverMet',
    family: 'secret',
    label: 'Nadie pudo contárselo',
    explains: 'Quien lo sabe no coincidió nunca con alguien que ya lo supiera.',
  },
  {
    id: 'character.coherence',
    family: 'lifespan',
    label: 'La ficha se contradice',
    explains: 'La fecha de muerte, el estado vital y los hechos de la ficha no encajan entre sí.',
  },
  {
    id: 'coverage.undatedScenes',
    family: 'presence',
    label: 'Escenas sin día',
    explains: 'Sin día del mundo, las comprobaciones de presencia, viajes y secretos no pueden hablar de ellas.',
  },
  {
    id: 'containment.cycle',
    family: 'containment',
    label: 'Un lugar dentro de sí mismo',
    explains: 'La jerarquía de lugares se cierra en un bucle.',
  },
];

/**
 * Two places on one day.
 *
 * Grouped by (person, day) in a single pass rather than compared pairwise: a world with a
 * thousand presences would otherwise be half a million comparisons to answer a question
 * that is a bucket lookup.
 */
export function findBilocations(snapshot: WorldSnapshot): WorldFinding[] {
  // NOTE on scales: `presenceKey` returns a world DAY when there is one and a year-based
  // key otherwise, so a day-keyed presence never collides with a year-keyed one. That is a
  // false negative, never a false positive — the honest trade, since the alternative is
  // accusing somebody of bilocation because 415 and 1204 are different numbers.
  const byPersonDay = new Map<string, Presence[]>();
  for (const presence of snapshot.presences) {
    const key = presenceKey(presence);
    // This one guard is what excludes undated residences: a home town is not a claim
    // about any particular day, so it cannot contradict one, and `presenceKey` is null
    // for it. A second check on `source` would be a condition that can never fire.
    if (key == null) continue;
    const bucket = `${presence.personId}|${key}`;
    byPersonDay.set(bucket, [...(byPersonDay.get(bucket) ?? []), presence]);
  }

  const findings: WorldFinding[] = [];
  for (const [, group] of byPersonDay) {
    const places = new Map(group.map((presence) => [presence.placeId, presence]));
    if (places.size < 2) continue;
    const [first, second] = [...places.values()];
    findings.push(
      makeFinding(
        'presence.bilocation',
        'presence',
        'contradiction',
        {
          key: '{person} está a la vez en {a} y en {b}',
          vars: { person: first.personName, a: first.placeName ?? '—', b: second.placeName ?? '—' },
        },
        [
          { kind: 'character', id: first.personId, title: first.personName },
          { kind: 'place', id: first.placeId, title: first.placeName ?? '—' },
          { kind: 'place', id: second.placeId, title: second.placeName ?? '—' },
        ],
        { key: 'En {sources}', vars: { sources: [first, second].map((presence) => presence.label ?? '—').join(' · ') } }
      )
    );
  }
  return findings;
}

/** Acting after death, or before birth. */
export function findLifespanBreaches(snapshot: WorldSnapshot): WorldFinding[] {
  const characters = new Map(snapshot.characters.map((character) => [character.personId, character]));
  const findings: WorldFinding[] = [];
  const seen = new Set<string>();

  for (const presence of snapshot.presences) {
    // Years against years, and this also excludes residences, which carry no date at all.
    // A presence the author never placed in a year says nothing about a lifespan, and
    // guessing one from the day chain would be inventing a date.
    const year = presence.worldYear;
    if (year == null) continue;
    const character = characters.get(presence.personId);
    if (!character) continue;

    const breach =
      character.deathYear != null && year > character.deathYear
        ? ('lifespan.afterDeath' as const)
        : character.birthYear != null && year < character.birthYear
          ? ('lifespan.beforeBirth' as const)
          : null;
    if (!breach) continue;

    // One finding per (character, source), not per presence: a character in three scenes
    // after their death is three problems, but the same scene twice is one.
    const dedupe = `${breach}|${presence.personId}|${presence.sourceId}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    findings.push(
      makeFinding(
        breach,
        'lifespan',
        'contradiction',
        {
          key:
            breach === 'lifespan.afterDeath'
              ? '{person} actúa en «{source}» después de morir'
              : '{person} actúa en «{source}» antes de nacer',
          vars: { person: character.displayName, source: presence.label ?? '—' },
        },
        [
          { kind: 'character', id: character.personId, title: character.displayName },
          { kind: presence.source === 'scene' ? 'scene' : 'event', id: presence.sourceId, title: presence.label ?? '—' },
        ]
      )
    );
  }
  return findings;
}

/**
 * The pairs of places a travel check would need a distance for — and ONLY those.
 *
 * Precomputing a distance matrix is the obvious design and the wrong one: two hundred
 * places is forty thousand pairs, of which a manuscript actually uses a few dozen. The
 * journeys come first, the distances after.
 */
export function travelPairsNeeded(snapshot: WorldSnapshot): { fromPlaceId: string; toPlaceId: string }[] {
  const pairs = new Map<string, { fromPlaceId: string; toPlaceId: string }>();
  for (const track of buildTracks(snapshot.presences)) {
    for (const journey of buildJourneys(track.stays)) {
      const key = [journey.fromPlaceId, journey.toPlaceId].sort().join('|');
      if (!pairs.has(key)) pairs.set(key, { fromPlaceId: journey.fromPlaceId, toPlaceId: journey.toPlaceId });
    }
  }
  return [...pairs.values()];
}

export function findTravelBreaches(snapshot: WorldSnapshot, distances: DistanceRow[]): WorldFinding[] {
  const needed = new Map<string, number>();
  for (const row of distances) {
    needed.set([row.fromPlaceId, row.toPlaceId].sort().join('|'), row.days);
  }

  const findings: WorldFinding[] = [];
  for (const track of buildTracks(snapshot.presences)) {
    for (const journey of buildJourneys(track.stays)) {
      const days = needed.get([journey.fromPlaceId, journey.toPlaceId].sort().join('|'));
      // No measured distance is not a warning. A world where nothing is calibrated must
      // stay silent here rather than invent a speed.
      if (days == null) continue;
      const available = journey.arrives - journey.departs;
      if (available >= days) continue;
      findings.push(
        makeFinding(
          'travel.impossible',
          'travel',
          'contradiction',
          {
            key: '{person} va de {from} a {to} en menos tiempo del que se tarda',
            vars: {
              person: journey.personName,
              from: journey.fromPlaceName ?? '—',
              to: journey.toPlaceName ?? '—',
            },
          },
          [
            { kind: 'character', id: journey.personId, title: journey.personName },
            { kind: 'place', id: journey.fromPlaceId, title: journey.fromPlaceName ?? '—' },
            { kind: 'place', id: journey.toPlaceId, title: journey.toPlaceName ?? '—' },
          ]
        )
      );
    }
  }
  return findings;
}

/**
 * Only the inverted window, for now.
 *
 * "Belongs to a guild that was already dissolved" is the check a writer wants here, and it
 * is NOT shipped: the affiliation window is in world days and a group's life is in in-world
 * YEARS, and there is no conversion between the two without a calendar. Comparing them
 * anyway would produce warnings whose arithmetic nobody could reproduce, which is worse
 * than the silence. It is deliberately absent from CONTINUITY_CHECKS too: a catalogue that
 * lists a check that never fires is the section promising to check the world and opening
 * empty.
 */
export function findAffiliationBreaches(snapshot: WorldSnapshot): WorldFinding[] {
  const findings: WorldFinding[] = [];
  for (const affiliation of snapshot.affiliations) {
    if (
      affiliation.fromWorldDay != null &&
      affiliation.toWorldDay != null &&
      affiliation.toWorldDay < affiliation.fromWorldDay
    ) {
      findings.push(
        makeFinding(
          'affiliation.inverted',
          'affiliation',
          'contradiction',
          {
            key: '{person} deja {group} antes de entrar',
            vars: { person: affiliation.personName, group: affiliation.groupName },
          },
          [
            { kind: 'character', id: affiliation.personId, title: affiliation.personName },
            { kind: 'group', id: affiliation.groupId, title: affiliation.groupName },
          ]
        )
      );
    }
  }
  return findings;
}

/**
 * Secrets.
 *
 * The second check is the interesting one, and it is a WARNING rather than a
 * contradiction: somebody may have learned it in a letter, or by seeing it happen. What
 * the vault can say is only that there is no recorded moment where they could have been
 * told — which is exactly the kind of thing a writer wants pointed at, and exactly the
 * kind of thing they must be allowed to wave away.
 */
export function findSecretBreaches(snapshot: WorldSnapshot): WorldFinding[] {
  const findings: WorldFinding[] = [];
  const bySecret = new Map<string, SnapshotKnower[]>();
  for (const knower of snapshot.knowers) {
    bySecret.set(knower.secretId, [...(bySecret.get(knower.secretId) ?? []), knower]);
  }

  const tracks = buildTracks(snapshot.presences);
  const encounters = findEncounters(tracks);

  for (const secret of snapshot.secrets) {
    const knowers = bySecret.get(secret.secretId) ?? [];
    const owner = knowers.find((knower) => knower.personId === secret.ownerPersonId);
    const ownerSince = owner?.sinceWorldDay ?? null;

    for (const knower of knowers) {
      if (knower.personId === secret.ownerPersonId) continue;

      if (ownerSince != null && knower.sinceWorldDay != null && knower.sinceWorldDay < ownerSince) {
        findings.push(
          makeFinding(
            'secret.knownTooEarly',
            'secret',
            'contradiction',
            {
              key: '{person} sabe «{secret}» antes que quien lo guardaba',
              vars: { person: knower.personName, secret: secret.title },
            },
            [
              { kind: 'character', id: knower.personId, title: knower.personName },
              { kind: 'secret', id: secret.secretId, title: secret.title },
            ]
          )
        );
        continue;
      }

      if (knower.sinceWorldDay == null) continue;
      // Who already knew it when this person learned it?
      const earlier = knowers.filter(
        (other) =>
          other.personId !== knower.personId &&
          other.sinceWorldDay != null &&
          other.sinceWorldDay <= (knower.sinceWorldDay as number)
      );
      if (earlier.length === 0) continue;
      const met = encounters.some(
        (encounter) =>
          encounter.people.some((person) => person.personId === knower.personId) &&
          encounter.people.some((person) => earlier.some((other) => other.personId === person.personId))
      );
      if (met) continue;
      findings.push(
        makeFinding(
          'secret.neverMet',
          'secret',
          'warning',
          {
            key: 'Nadie pudo contarle «{secret}» a {person}',
            vars: { secret: secret.title, person: knower.personName },
          },
          [
            { kind: 'character', id: knower.personId, title: knower.personName },
            { kind: 'secret', id: secret.secretId, title: secret.title },
          ],
          { key: 'No hay ninguna escena ni hecho donde coincidiera con alguien que ya lo supiera.' }
        )
      );
    }
  }
  return findings;
}

/** A place inside itself, however long the loop. */
export function findContainmentBreaches(places: SnapshotPlace[]): WorldFinding[] {
  const byId = new Map(places.map((place) => [place.placeId, place]));
  const findings: WorldFinding[] = [];
  const reported = new Set<string>();

  for (const place of places) {
    const seen = new Set<string>([place.placeId]);
    let current = place.parentId;
    while (current) {
      if (seen.has(current)) {
        // Report the loop once, under its lowest id, so a three-place cycle is one finding
        // and not three of the same thing worded differently.
        const cycle = [...seen].sort();
        const key = cycle.join('|');
        if (!reported.has(key)) {
          reported.add(key);
          findings.push(
            makeFinding(
              'containment.cycle',
              'containment',
              'contradiction',
              { key: '{place} acaba conteniéndose a sí mismo', vars: { place: place.name } },
              cycle.map((id) => ({ kind: 'place', id, title: byId.get(id)?.name ?? '—' }))
            )
          );
        }
        break;
      }
      seen.add(current);
      current = byId.get(current)?.parentId ?? null;
    }
  }
  return findings;
}

/**
 * The contradictions INSIDE one sheet: dying before being born, an event after the death,
 * a status that says alive next to a death date.
 *
 * Folded in here rather than painted by the character sheet on its own, which is what it
 * used to do. Two renderings of the same problem in two wordings teaches a writer that the
 * app does not know what it thinks — and the badge is the one that also reaches places,
 * factions and scenes.
 */
export function findCharacterIncoherences(snapshot: WorldSnapshot): WorldFinding[] {
  const findings: WorldFinding[] = [];
  for (const character of snapshot.characters) {
    const checks = checkCharacterCoherence({
      lifeStatus: character.lifeStatus as never,
      birthYear: character.birthYear,
      deathYear: character.deathYear,
      deathDate: character.deathDate,
      events: character.events as never,
    });
    for (const check of checks) {
      findings.push(
        makeFinding(
          `character.${check.id}`,
          'lifespan',
          check.severity === 'error' ? 'contradiction' : 'warning',
          { key: check.message, vars: check.values },
          [{ kind: 'character', id: character.personId, title: character.displayName }]
        )
      );
    }
  }
  return findings;
}

/** Scenes with no day, and the like. Gaps, never contradictions: nothing is wrong, there
 *  is just not enough written down yet for the other checks to say anything. */
export function coverageGaps(snapshot: WorldSnapshot): WorldFinding[] {
  const undated = snapshot.scenes.filter((scene) => scene.worldDay == null);
  if (undated.length === 0) return [];
  return [
    makeFinding(
      'coverage.undatedScenes',
      'presence',
      'gap',
      { key: '{count} escenas no tienen día del mundo', vars: { count: String(undated.length) } },
      undated.slice(0, 8).map((scene) => ({ kind: 'scene', id: scene.sceneId, title: scene.title })),
      { key: 'Sin día, las comprobaciones de presencia, viajes y secretos no pueden decir nada sobre ellas.' }
    ),
  ];
}

/**
 * Everything at once.
 *
 * `distances` is passed in rather than computed: the pairs that need measuring come from
 * `travelPairsNeeded`, and whoever has the maps resolves them. A caller with no calibrated
 * map simply passes `[]` and the travel family stays quiet.
 */
export function runWorldContinuity(
  snapshot: WorldSnapshot,
  options: { families?: FindingFamily[]; distances?: DistanceRow[] } = {}
): WorldFinding[] {
  const wanted = options.families ? new Set(options.families) : null;
  const enabled = (family: FindingFamily) => !wanted || wanted.has(family);
  const findings: WorldFinding[] = [];

  if (enabled('presence')) findings.push(...findBilocations(snapshot), ...coverageGaps(snapshot));
  if (enabled('lifespan')) findings.push(...findLifespanBreaches(snapshot), ...findCharacterIncoherences(snapshot));
  if (enabled('travel')) findings.push(...findTravelBreaches(snapshot, options.distances ?? []));
  if (enabled('affiliation')) findings.push(...findAffiliationBreaches(snapshot));
  if (enabled('secret')) findings.push(...findSecretBreaches(snapshot));
  if (enabled('containment')) findings.push(...findContainmentBreaches(snapshot.places));
  return findings;
}
