/**
 * Where a character is, and when.
 *
 * ## Why there is no `character_positions` table
 *
 * The vault already answers this question three times over:
 *
 *   - `world_scenes` ⋈ `scene_characters` — the unit a novelist actually works in, and
 *     the richest source: a scene has a place AND a day.
 *   - `events` ⋈ `event_participants` ⋈ `event_world_dates` — births, battles, journeys.
 *   - `person_places` — residences, inherited from genealogy.
 *
 * A fourth table would be a fourth answer to one question, and the four would disagree
 * inside a week. So this module UNIONS them instead, and the writes stay where the author
 * already makes them: dragging a character onto the map at the playhead creates an
 * *event*, not a row in a private table.
 *
 * ## Residences are the BACKGROUND
 *
 * `person_places` has no `world_day` (it stores Earth-shaped `date`/`date_sort`), and the
 * decision was NOT to give it one. A residence is a default state, not an occurrence: it
 * says where someone is when nothing else says otherwise. So it enters with `worldDay:
 * null`, loses every tie against a dated scene or event, and — this is the part that
 * matters — **never generates a journey**. You cannot interpolate a trip against
 * something that has no date, and pretending otherwise would put a character on the road
 * between two places they were never recorded leaving.
 *
 * Pure and dependency-free: all of it is unit-tested without a database.
 */

export type PresenceSource = 'scene' | 'event' | 'residence';

export interface Presence {
  personId: string;
  personName: string;
  placeId: string;
  placeName: string | null;
  /** Absolute day in the world's calendar. Null for an undated residence. */
  worldDay: number | null;
  /**
   * Fallback ordering when the world has no calendar: the in-world year plus the
   * tie-break within it. Mirrors what `TimelineView` already does.
   */
  worldYear: number | null;
  worldOrder: number;
  source: PresenceSource;
  sourceId: string;
  /** The scene's title, the event's label, "residencia"… */
  label: string | null;
}

/**
 * The single sort key, so nothing downstream has to branch on "is there a calendar".
 *
 * A world with months gets `worldDay`; one without falls back to the year scaled far
 * enough apart that the tie-break cannot spill into the next year. Both are the same
 * number line, which is what lets the playhead, the transits and the encounter finder be
 * written once.
 */
export const ORDER_SCALE = 1_000_000;

export function presenceKey(presence: Pick<Presence, 'worldDay' | 'worldYear' | 'worldOrder'>): number | null {
  if (presence.worldDay != null) return presence.worldDay;
  if (presence.worldYear != null) return presence.worldYear * ORDER_SCALE + presence.worldOrder;
  return null;
}

/**
 * Dated presences first, in order; undated ones keep their relative order at the end.
 *
 * PARTITIONED, not sorted with a comparator that returns a constant for nulls. Such a
 * comparator is *inconsistent* — it claims both `a < b` and `b < a` when either side is
 * undated — and the result then depends on which algorithm V8 happens to use for that
 * array length. Measured: flipping the null branch changed nothing for a three-element
 * array, so a test could not tell a correct implementation from a broken one. Partitioning
 * makes the rule hold by construction instead of by luck.
 *
 * An undated presence is kept, not dropped: a residence is real information, it just has
 * no place on the timeline. Same rule `buildMigrationPath` already uses for the genealogy
 * map.
 */
export function sortPresences(presences: Presence[]): Presence[] {
  const dated: { presence: Presence; key: number }[] = [];
  const undated: Presence[] = [];
  for (const presence of presences) {
    const key = presenceKey(presence);
    if (key == null) undated.push(presence);
    else dated.push({ presence, key });
  }
  dated.sort((a, b) => a.key - b.key);
  return [...dated.map((entry) => entry.presence), ...undated];
}

export interface Stay {
  personId: string;
  personName: string;
  placeId: string;
  placeName: string | null;
  /** When the character is first recorded here. Null for an undated residence. */
  from: number | null;
  /** When they are last recorded here before moving on. Null while they stay. */
  to: number | null;
  /** Everything that put them here, in order. */
  presences: Presence[];
}

/**
 * Consecutive presences at the SAME place collapse into one stay.
 *
 * Staying is not moving: three scenes in Aldermoor are one stay, not three arrivals, and
 * treating them as three would draw two journeys of zero length and make the character
 * flicker on the map.
 */
export function buildStays(presences: Presence[]): Stay[] {
  const stays: Stay[] = [];
  for (const presence of sortPresences(presences)) {
    const last = stays[stays.length - 1];
    if (last && last.placeId === presence.placeId) {
      last.presences.push(presence);
      const key = presenceKey(presence);
      if (key != null) last.to = key;
      continue;
    }
    const key = presenceKey(presence);
    stays.push({
      personId: presence.personId,
      personName: presence.personName,
      placeId: presence.placeId,
      placeName: presence.placeName,
      from: key,
      to: key,
      presences: [presence],
    });
  }
  return stays;
}

export interface Journey {
  personId: string;
  personName: string;
  fromPlaceId: string;
  toPlaceId: string;
  fromPlaceName: string | null;
  toPlaceName: string | null;
  /** The day they were last seen at the origin. */
  departs: number;
  /** The day they are first seen at the destination. */
  arrives: number;
}

/**
 * The gaps between stays: a character is TRAVELLING, not teleporting.
 *
 * Only between two DATED stays. A journey out of, or into, an undated residence has no
 * duration and no direction in time, and inventing one would put a character on the road
 * between two places they were never recorded leaving — and would then feed the
 * impossible-journey report a warning about a trip nobody ever took.
 */
export function buildJourneys(stays: Stay[]): Journey[] {
  const journeys: Journey[] = [];
  for (let i = 1; i < stays.length; i += 1) {
    const previous = stays[i - 1];
    const next = stays[i];
    if (previous.to == null || next.from == null) continue;
    if (next.from < previous.to) continue; // out of order; nothing sensible to draw
    journeys.push({
      personId: next.personId,
      personName: next.personName,
      fromPlaceId: previous.placeId,
      toPlaceId: next.placeId,
      fromPlaceName: previous.placeName,
      toPlaceName: next.placeName,
      departs: previous.to,
      arrives: next.from,
    });
  }
  return journeys;
}

export interface Position {
  personId: string;
  personName: string;
  /** Where they are, or where they set out from while travelling. */
  placeId: string;
  placeName: string | null;
  /** Set while in transit; null while staying put. */
  towardsPlaceId: string | null;
  towardsPlaceName: string | null;
  /** 0 at departure, 1 on arrival. Null while staying put. */
  progress: number | null;
  /** True before the character's first recorded appearance. */
  beforeFirst: boolean;
}

/**
 * Where one character is at a given moment on the number line.
 *
 * Returns null when there is nothing to say — no presences at all. Before their first
 * dated appearance they are reported AT that first place with `beforeFirst`, so the map
 * can draw them faintly instead of having them pop into existence: a reader scrubbing
 * backwards wants to see where someone came from, not an empty map.
 */
export function positionAt(stays: Stay[], journeys: Journey[], at: number | null): Position | null {
  if (stays.length === 0) return null;
  const dated = stays.filter((stay) => stay.from != null);
  // With no playhead, or nothing dated, the last known place is the answer.
  if (at == null || dated.length === 0) {
    const last = stays[stays.length - 1];
    return {
      personId: last.personId,
      personName: last.personName,
      placeId: last.placeId,
      placeName: last.placeName,
      towardsPlaceId: null,
      towardsPlaceName: null,
      progress: null,
      beforeFirst: false,
    };
  }

  const first = dated[0];
  if (at < first.from!) {
    return {
      personId: first.personId,
      personName: first.personName,
      placeId: first.placeId,
      placeName: first.placeName,
      towardsPlaceId: null,
      towardsPlaceName: null,
      progress: null,
      beforeFirst: true,
    };
  }

  const journey = journeys.find((entry) => at > entry.departs && at < entry.arrives);
  if (journey) {
    const span = journey.arrives - journey.departs;
    return {
      personId: journey.personId,
      personName: journey.personName,
      placeId: journey.fromPlaceId,
      placeName: journey.fromPlaceName,
      towardsPlaceId: journey.toPlaceId,
      towardsPlaceName: journey.toPlaceName,
      // A zero-length span cannot happen here (`at` is strictly between the two), but
      // dividing by it would produce Infinity and a pin at the edge of the world.
      progress: span > 0 ? (at - journey.departs) / span : 0,
      beforeFirst: false,
    };
  }

  // Not travelling: the last stay that had begun by now.
  let current = first;
  for (const stay of dated) {
    if (stay.from! <= at) current = stay;
    else break;
  }
  return {
    personId: current.personId,
    personName: current.personName,
    placeId: current.placeId,
    placeName: current.placeName,
    towardsPlaceId: null,
    towardsPlaceName: null,
    progress: null,
    beforeFirst: false,
  };
}

/** Everything about one character's movements, computed once. */
export interface CharacterTrack {
  personId: string;
  personName: string;
  stays: Stay[];
  journeys: Journey[];
}

export function buildTracks(presences: Presence[]): CharacterTrack[] {
  const byPerson = new Map<string, Presence[]>();
  for (const presence of presences) {
    const list = byPerson.get(presence.personId);
    if (list) list.push(presence);
    else byPerson.set(presence.personId, [presence]);
  }
  return [...byPerson.values()]
    .map((list) => {
      const stays = buildStays(list);
      return {
        personId: list[0].personId,
        personName: list[0].personName,
        stays,
        journeys: buildJourneys(stays),
      };
    })
    .sort((a, b) => a.personName.localeCompare(b.personName));
}

/**
 * The span the playhead sweeps: first to last DATED moment across the given tracks.
 *
 * Deliberately not the calendar's full extent. A world may span ten thousand years while
 * the story happens over eleven days, and a slider over ten thousand years cannot be
 * dragged to a useful place.
 */
export function trackRange(tracks: CharacterTrack[]): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const track of tracks) {
    for (const stay of track.stays) {
      if (stay.from != null) {
        min = Math.min(min, stay.from);
        max = Math.max(max, stay.from);
      }
      if (stay.to != null) max = Math.max(max, stay.to);
    }
  }
  return min === Infinity ? null : { min, max };
}

/**
 * The moments something actually happens, so "next event" can skip the empty stretches.
 *
 * In a world with 360-day years, stepping day by day between two scenes half a year apart
 * is unusable; this is what the skip button walks.
 */
export function trackMilestones(tracks: CharacterTrack[]): number[] {
  const moments = new Set<number>();
  for (const track of tracks) {
    for (const stay of track.stays) {
      if (stay.from != null) moments.add(stay.from);
      if (stay.to != null) moments.add(stay.to);
    }
    for (const journey of track.journeys) {
      moments.add(journey.departs);
      moments.add(journey.arrives);
    }
  }
  return [...moments].sort((a, b) => a - b);
}

export function nextMilestone(milestones: number[], from: number, direction: 1 | -1): number | null {
  if (direction === 1) return milestones.find((moment) => moment > from) ?? null;
  const earlier = milestones.filter((moment) => moment < from);
  return earlier.length > 0 ? earlier[earlier.length - 1] : null;
}

// ── encounters ──────────────────────────────────────────────────────────────────

export interface Encounter {
  placeId: string;
  placeName: string | null;
  from: number;
  to: number;
  people: { personId: string; personName: string }[];
}

/**
 * When could these characters have met?
 *
 * Intersects the dated stays of two or more characters at the same place. This answers,
 * from the data the author already wrote, a question that today can only be answered by
 * re-reading — and it is the same shape as the secrets layer's "who could plausibly have
 * said this out loud".
 *
 * Undated stays are excluded: "they might both have lived there at some point" is not an
 * encounter, and reporting it as one would bury the real answers.
 */
export function findEncounters(tracks: CharacterTrack[]): Encounter[] {
  const encounters: Encounter[] = [];
  for (let i = 0; i < tracks.length; i += 1) {
    for (let j = i + 1; j < tracks.length; j += 1) {
      for (const a of tracks[i].stays) {
        if (a.from == null || a.to == null) continue;
        for (const b of tracks[j].stays) {
          if (b.from == null || b.to == null) continue;
          if (a.placeId !== b.placeId) continue;
          const from = Math.max(a.from, b.from);
          const to = Math.min(a.to, b.to);
          if (from > to) continue;
          encounters.push({
            placeId: a.placeId,
            placeName: a.placeName,
            from,
            to,
            people: [
              { personId: a.personId, personName: a.personName },
              { personId: b.personId, personName: b.personName },
            ],
          });
        }
      }
    }
  }
  return encounters.sort((x, y) => x.from - y.from);
}

// ── which map shows this place ──────────────────────────────────────────────────

/**
 * The subset of a map and its markers that map-following needs. Plain shapes rather than
 * the full rows, so this stays pure and the tests can build a world in five lines.
 */
export interface MapFocusCandidate {
  mapId: string;
  /** The place this map IS of, when it is of one. */
  placeId: string | null;
  /** Places drawn on it, whatever the geometry. */
  markerPlaceIds: string[];
  /** Temporal validity of the map itself ("the Empire in year 300"). */
  fromWorldDay?: number | null;
  toWorldDay?: number | null;
}

export interface MapFocus {
  mapId: string;
  /** The place actually drawn there — the character's own, or a container of it. */
  shownPlaceId: string;
  /** How many steps up the containment chain we had to walk. 0 = the place itself. */
  depth: number;
}

function mapValidAt(map: MapFocusCandidate, at: number | null): boolean {
  if (at == null) return true;
  if (map.fromWorldDay != null && at < map.fromWorldDay) return false;
  if (map.toWorldDay != null && at > map.toWorldDay) return false;
  return true;
}

/**
 * Which map should be on screen to show a character standing in `placeId`.
 *
 * Walks UP the place containment chain — the room, then the castle, then the city, then
 * the realm — and takes the first level any map draws. A scene set in a kitchen shows on
 * the city map if that is as specific as the atlas gets, instead of showing nothing.
 *
 * The preference order is the whole design:
 *
 *   1. **The map already on screen**, if it can show them at all. Without this the view
 *      changes map every other day and the reader is seasick — this single rule is what
 *      makes auto-following usable rather than a strobe.
 *   2. The map whose own subject (`placeId`) is the most specific match: the map OF
 *      Aldermoor beats a continental map that merely has a dot for it.
 *   3. `preferredMapIds`, most-recently-used first, so the view returns to maps the
 *      author has actually been working in.
 *
 * Returns null when no map can show them: they are somewhere the atlas does not cover,
 * and the cast strip has to say so rather than the view jumping somewhere arbitrary.
 */
export function resolveMapFocus(
  placeId: string,
  maps: MapFocusCandidate[],
  parentOf: (placeId: string) => string | null,
  options: { currentMapId?: string | null; preferredMapIds?: string[]; at?: number | null } = {},
): MapFocus | null {
  const { currentMapId = null, preferredMapIds = [], at = null } = options;
  const usable = maps.filter((map) => mapValidAt(map, at));

  // The containment chain, most specific first. The `seen` set is not paranoia: a cycle
  // in the place tree would hang the renderer with no error to follow, and this runs on
  // every tick of the playhead.
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | null = placeId;
  while (current && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = parentOf(current);
  }

  for (const [depth, candidatePlace] of chain.entries()) {
    const showing = usable.filter((map) => map.markerPlaceIds.includes(candidatePlace));
    if (showing.length === 0) continue;
    const stay = showing.find((map) => map.mapId === currentMapId);
    if (stay) return { mapId: stay.mapId, shownPlaceId: candidatePlace, depth };
    const subject = showing.find((map) => map.placeId === candidatePlace);
    if (subject) return { mapId: subject.mapId, shownPlaceId: candidatePlace, depth };
    const preferred = preferredMapIds
      .map((mapId) => showing.find((map) => map.mapId === mapId))
      .find((map): map is MapFocusCandidate => !!map);
    if (preferred) return { mapId: preferred.mapId, shownPlaceId: candidatePlace, depth };
    return { mapId: showing[0].mapId, shownPlaceId: candidatePlace, depth };
  }
  return null;
}

/**
 * Should the view follow automatically?
 *
 * Only with EXACTLY one character selected. With five characters on four maps, following
 * would be a slideshow nobody asked for — and worse, following one of them means losing
 * the other four. With several selected the cast strip reports where everyone is and the
 * reader jumps on purpose.
 */
export function shouldAutoFollow(selectedCount: number, enabled: boolean): boolean {
  return enabled && selectedCount === 1;
}

// ── impossible journeys (M7) ────────────────────────────────────────────────────

export interface ImpossibleJourney {
  journey: Journey;
  /** How far apart the two places are, in the map's own unit. */
  distance: number;
  unit: string;
  /** Days the story allows. */
  allowed: number;
  /** Days the fastest mode would need. */
  needed: number;
  /** The fastest mode that still cannot make it. */
  modeName: string;
}

export interface JourneyCheckInput {
  /** Distance between two places, in the checking unit. Null when it cannot be measured. */
  distanceBetween: (fromPlaceId: string, toPlaceId: string) => number | null;
  unit: string;
  /** Days needed to cover `distance` at the FASTEST available pace. Null if unknown. */
  fastest: (distance: number) => { days: number; modeName: string } | null;
}

/**
 * Journeys the story does not leave time for.
 *
 * The flagship of the whole feature, and the thing that justifies having a scale at all:
 * "Kestra is in Aldermoor on day 120 and in Vael on day 122, but that is 400 leagues —
 * twenty days on horseback."
 *
 * It is deliberately CONSERVATIVE. It reports only what the fastest available mode still
 * cannot manage, and only where the distance is actually measurable. A consistency report
 * that cries wolf is one nobody reads, and a writer's world is full of dragons, portals
 * and ships nobody has told Nodus about.
 *
 * A journey with zero days available is impossible for any distance above nothing — that
 * is the case worth catching, and it is the one a writer makes most often.
 */
export function findImpossibleJourneys(
  tracks: CharacterTrack[],
  check: JourneyCheckInput,
  tolerance = 1.15,
): ImpossibleJourney[] {
  const found: ImpossibleJourney[] = [];
  for (const track of tracks) {
    for (const journey of track.journeys) {
      const distance = check.distanceBetween(journey.fromPlaceId, journey.toPlaceId);
      // No scale, or a place that is not on any map: nothing can be said, and saying
      // something anyway is how a report loses its credibility.
      if (distance == null || !(distance > 0)) continue;
      const fastest = check.fastest(distance);
      if (!fastest) continue;
      const allowed = journey.arrives - journey.departs;
      if (fastest.days <= allowed * tolerance) continue;
      found.push({
        journey,
        distance,
        unit: check.unit,
        allowed,
        needed: fastest.days,
        modeName: fastest.modeName,
      });
    }
  }
  // Worst first: the reader wants the three-hundred-league day, not an hour's slack.
  return found.sort((a, b) => b.needed / Math.max(1, b.allowed) - a.needed / Math.max(1, a.allowed));
}
