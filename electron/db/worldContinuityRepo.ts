// Continuity: one snapshot of the world, and the checks run over it (schema v99).
//
// Ten SELECTs and then pure arithmetic. Everything that decides whether something is a
// contradiction lives in `shared/worldContinuity.ts`, which has no database in it — this
// file only fetches, and then stores what the author has asked to stop hearing about.
//
// The snapshot is built WHOLE and handed to the renderer, because the badge on a character
// sheet and the list in the section are the same findings: `findingsFor(ref, findings)`
// filters what is already loaded instead of paying for a second round of IPC per sheet.

import { getDb } from './database';
import { listPresences } from './worldPresenceRepo';
import {
  CONTINUITY_CHECKS,
  runWorldContinuity,
  travelPairsNeeded,
  type DistanceRow,
  type WorldSnapshot,
} from '@shared/worldContinuity';
import { applyMutes, sortFindings } from '@shared/worldFindings';
import { checkThreads } from '@shared/worldThreads';
import { listWorldBeats, listWorldThreads } from './worldThreadsRepo';
import { ruleFindings } from './worldRulesRepo';
import { manuscriptFindings } from './worldManuscriptRepo';
import type { MuteReasonCode, WorldFinding, WorldNoticeMute } from '@shared/types';

function now(): string {
  return new Date().toISOString();
}

/** Everything the checks read, in ten queries. */
export function buildWorldSnapshot(): WorldSnapshot {
  const db = getDb();

  // Life events, grouped in ONE query. Per character this would be an N+1 that only shows
  // up once a world has a real cast — the same trap `listCharacters` documents.
  const eventsByPerson = new Map<string, { type: string; label: string | null; worldYear: number | null }[]>();
  for (const row of db
    .prepare(
      `SELECT ep.person_id, e.type, e.label, w.world_year
         FROM event_participants ep
         JOIN events e ON e.event_id = ep.event_id
         LEFT JOIN event_world_dates w ON w.event_id = e.event_id`
    )
    .all() as { person_id: string; type: string; label: string | null; world_year: number | null }[]) {
    eventsByPerson.set(row.person_id, [
      ...(eventsByPerson.get(row.person_id) ?? []),
      { type: row.type, label: row.label, worldYear: row.world_year },
    ]);
  }

  const characters = (
    db
      .prepare(
        `SELECT p.person_id, p.display_name, p.death_date, c.birth_year_sort, c.death_year_sort, c.life_status
           FROM persons p
           LEFT JOIN character_profiles c ON c.person_id = p.person_id`
      )
      .all() as {
      person_id: string;
      display_name: string;
      death_date: string | null;
      birth_year_sort: number | null;
      death_year_sort: number | null;
      life_status: string | null;
    }[]
  ).map((row) => ({
    personId: row.person_id,
    displayName: row.display_name,
    birthYear: row.birth_year_sort,
    deathYear: row.death_year_sort,
    // A person created by another path has no overlay row, so the default is synthesised
    // here rather than assumed to exist — an INNER JOIN would drop them entirely.
    lifeStatus: row.life_status ?? 'unknown',
    deathDate: row.death_date,
    events: eventsByPerson.get(row.person_id) ?? [],
  }));

  const affiliations = (
    db
      .prepare(
        `SELECT a.person_id, p.display_name, a.group_id, g.name AS group_name,
                a.from_world_day, a.to_world_day
           FROM character_affiliations a
           JOIN persons p ON p.person_id = a.person_id
           JOIN world_groups g ON g.group_id = a.group_id`
      )
      .all() as {
      person_id: string;
      display_name: string;
      group_id: string;
      group_name: string;
      from_world_day: number | null;
      to_world_day: number | null;
    }[]
  ).map((row) => ({
    personId: row.person_id,
    personName: row.display_name,
    groupId: row.group_id,
    groupName: row.group_name,
    fromWorldDay: row.from_world_day,
    toWorldDay: row.to_world_day,
  }));

  const secrets = (
    db.prepare('SELECT secret_id, title, owner_person_id, revealed_world_day FROM world_secrets').all() as {
      secret_id: string;
      title: string;
      owner_person_id: string | null;
      revealed_world_day: number | null;
    }[]
  ).map((row) => ({
    secretId: row.secret_id,
    title: row.title,
    ownerPersonId: row.owner_person_id,
    revealedWorldDay: row.revealed_world_day,
  }));

  const knowers = (
    db
      .prepare(
        `SELECT k.secret_id, k.person_id, p.display_name, k.since_world_day
           FROM secret_knowers k
           JOIN persons p ON p.person_id = k.person_id`
      )
      .all() as { secret_id: string; person_id: string; display_name: string; since_world_day: number | null }[]
  ).map((row) => ({
    secretId: row.secret_id,
    personId: row.person_id,
    personName: row.display_name,
    sinceWorldDay: row.since_world_day,
  }));

  const places = (
    db.prepare('SELECT place_id, name, parent_id FROM places').all() as {
      place_id: string;
      name: string;
      parent_id: string | null;
    }[]
  ).map((row) => ({ placeId: row.place_id, name: row.name, parentId: row.parent_id }));

  const scenes = (
    db.prepare('SELECT scene_id, title, world_day, narrative_order FROM world_scenes').all() as {
      scene_id: string;
      title: string;
      world_day: number | null;
      narrative_order: number;
    }[]
  ).map((row) => ({
    sceneId: row.scene_id,
    title: row.title,
    worldDay: row.world_day,
    narrativeOrder: row.narrative_order,
  }));

  return { characters, presences: listPresences(), affiliations, secrets, knowers, places, scenes };
}

/**
 * How long the fastest recorded way of travelling takes between two places.
 *
 * Only for the pairs a journey actually uses — the caller asks `travelPairsNeeded` first.
 * Two hundred places is forty thousand pairs and a manuscript uses a few dozen, so a
 * distance matrix would be almost entirely wasted work.
 *
 * Returns nothing when the world has no calibrated map or no travel mode, and that silence
 * is correct: inventing a speed to have something to say would produce warnings whose
 * arithmetic the author cannot reproduce.
 */
export function resolveDistances(pairs: { fromPlaceId: string; toPlaceId: string }[]): DistanceRow[] {
  if (pairs.length === 0) return [];
  const db = getDb();
  const fastest = db
    .prepare('SELECT MAX(distance_per_day) AS best FROM map_travel_modes')
    .get() as { best: number | null };
  if (!fastest?.best) return [];

  // A place's position comes from its marker on a calibrated map. Anything not pinned, or
  // pinned on a map with no scale, has no measurable distance.
  const markers = db
    .prepare(
      `SELECT m.place_id, m.x, m.y, w.scale_x0, w.scale_y0, w.scale_x1, w.scale_y1,
              w.scale_distance, w.map_id
         FROM map_markers m
         JOIN world_maps w ON w.map_id = m.map_id
        WHERE m.place_id IS NOT NULL AND w.scale_distance IS NOT NULL`
    )
    .all() as {
    place_id: string;
    x: number;
    y: number;
    scale_x0: number | null;
    scale_y0: number | null;
    scale_x1: number | null;
    scale_y1: number | null;
    scale_distance: number;
    map_id: string;
  }[];

  const byPlace = new Map<string, (typeof markers)[number]>();
  for (const marker of markers) if (!byPlace.has(marker.place_id)) byPlace.set(marker.place_id, marker);

  const rows: DistanceRow[] = [];
  for (const pair of pairs) {
    const a = byPlace.get(pair.fromPlaceId);
    const b = byPlace.get(pair.toPlaceId);
    // Two pins on DIFFERENT maps are not comparable: their normalized coordinates mean
    // different things, and subtracting them would be arithmetic on unrelated units.
    if (!a || !b || a.map_id !== b.map_id) continue;
    if (a.scale_x0 == null || a.scale_y0 == null || a.scale_x1 == null || a.scale_y1 == null) continue;
    const scaleLength = Math.hypot(a.scale_x1 - a.scale_x0, a.scale_y1 - a.scale_y0);
    if (scaleLength === 0) continue;
    const unitsPerNormalized = a.scale_distance / scaleLength;
    const distance = Math.hypot(b.x - a.x, b.y - a.y) * unitsPerNormalized;
    rows.push({
      fromPlaceId: pair.fromPlaceId,
      toPlaceId: pair.toPlaceId,
      // Rounded DOWN, so the check only fires when the trip is impossible by a whole day.
      // Rounding up would turn every tight-but-legal journey into a warning.
      days: Math.floor(distance / fastest.best),
    });
  }
  return rows;
}

/**
 * The thread findings, produced by `shared/worldThreads.ts`.
 *
 * Continuity DISPLAYS them; it does not reimplement one of them. Two implementations of
 * "this conflict was declared and forgotten" would word it two ways and disagree the first
 * time somebody archived a thread.
 */
function threadFindings(): WorldFinding[] {
  const db = getDb();
  const sceneCounts = new Map(
    (db.prepare('SELECT person_id, COUNT(*) AS c FROM scene_characters GROUP BY person_id').all() as {
      person_id: string;
      c: number;
    }[]).map((row) => [row.person_id, row.c])
  );
  const characters = (
    db
      .prepare(
        `SELECT p.person_id, p.display_name, c.narrative_role
           FROM persons p LEFT JOIN character_profiles c ON c.person_id = p.person_id`
      )
      .all() as { person_id: string; display_name: string; narrative_role: string | null }[]
  ).map((row) => ({
    id: row.person_id,
    name: row.display_name,
    narrativeRole: row.narrative_role,
    sceneCount: sceneCounts.get(row.person_id) ?? 0,
  }));
  const scenes = (
    db.prepare('SELECT scene_id, title, narrative_order FROM world_scenes').all() as {
      scene_id: string;
      title: string;
      narrative_order: number;
    }[]
  ).map((row) => ({ sceneId: row.scene_id, title: row.title, narrativeOrder: row.narrative_order }));

  return checkThreads({ threads: listWorldThreads(), beats: listWorldBeats(), scenes, characters });
}

function allFindings(): WorldFinding[] {
  const snapshot = buildWorldSnapshot();
  const distances = resolveDistances(travelPairsNeeded(snapshot));
  return [
    ...runWorldContinuity(snapshot, { distances }),
    ...threadFindings(),
    ...ruleFindings(),
    ...manuscriptFindings(),
  ];
}

export function runContinuity(): WorldFinding[] {
  return sortFindings(applyMutes(allFindings(), listNoticeMutes()));
}

/** Everything, including what has been silenced — for the exceptions screen. */
export function runContinuityUnfiltered(): WorldFinding[] {
  return sortFindings(allFindings());
}

/**
 * What was actually checked.
 *
 * This exists for the empty state, and the empty state is the reason to reopen a screen
 * that found nothing: "Sin contradicciones" alone is indistinguishable from "no he mirado".
 * The counts are real — they come from the same snapshot the checks ran over — because an
 * invented number here would be the one lie that discredits the whole section.
 */
export function continuitySummary(): { families: number; facts: number; checks: number } {
  const snapshot = buildWorldSnapshot();
  return {
    families: new Set(CONTINUITY_CHECKS.map((check) => check.family)).size,
    checks: CONTINUITY_CHECKS.length,
    facts:
      snapshot.presences.length +
      snapshot.affiliations.length +
      snapshot.knowers.length +
      snapshot.places.length +
      snapshot.scenes.length +
      snapshot.characters.length,
  };
}

// ── The silence ──────────────────────────────────────────────────────────────

interface MuteRow {
  fingerprint: string;
  check_id: string;
  scope: string;
  subjects: string;
  headline: string | null;
  reason_code: string;
  reason: string | null;
  created_at: string;
}

function rowToMute(row: MuteRow): WorldNoticeMute {
  let subjects: WorldNoticeMute['subjects'] = [];
  try {
    const parsed = JSON.parse(row.subjects ?? '[]');
    if (Array.isArray(parsed)) subjects = parsed;
  } catch {
    // Half-written JSON costs one row's detail, never the list.
  }
  return {
    fingerprint: row.fingerprint,
    checkId: row.check_id,
    scope: row.scope === 'check' ? 'check' : 'finding',
    subjects,
    headline: row.headline,
    reasonCode: (['double', 'told', 'deliberate', 'unknown'] as MuteReasonCode[]).includes(
      row.reason_code as MuteReasonCode
    )
      ? (row.reason_code as MuteReasonCode)
      : 'deliberate',
    reason: row.reason,
    createdAt: row.created_at,
  };
}

export function listNoticeMutes(): WorldNoticeMute[] {
  return (
    getDb().prepare('SELECT * FROM world_notice_mutes ORDER BY created_at DESC').all() as MuteRow[]
  ).map(rowToMute);
}

/**
 * Silence one finding, or a whole check.
 *
 * The fingerprint is the primary key and is derived from the check and its subjects, so
 * muting the same thing twice overwrites one row instead of accumulating rows — and, with
 * the tombstone triggers, instead of accumulating phantom deletions.
 *
 * The headline is stored RESOLVED, as it read when it was silenced. Six months later a
 * list of fingerprints is unreadable, and re-deriving the sentence would show the message
 * the app produces today rather than the one the author judged.
 */
export function muteNotice(input: {
  fingerprint: string;
  checkId: string;
  scope?: 'finding' | 'check';
  subjects: WorldNoticeMute['subjects'];
  headline: string | null;
  reasonCode: MuteReasonCode;
  reason?: string | null;
}): WorldNoticeMute[] {
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO world_notice_mutes
         (fingerprint, check_id, scope, subjects, headline, reason_code, reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(fingerprint) DO UPDATE SET reason_code = excluded.reason_code,
         reason = excluded.reason, headline = excluded.headline, updated_at = excluded.updated_at`
    )
    .run(
      input.scope === 'check' ? `check|${input.checkId}` : input.fingerprint,
      input.checkId,
      input.scope ?? 'finding',
      JSON.stringify(input.subjects ?? []),
      input.headline,
      input.reasonCode,
      input.reason ?? null,
      ts,
      ts
    );
  return listNoticeMutes();
}

export function unmuteNotice(fingerprint: string): WorldNoticeMute[] {
  getDb().prepare('DELETE FROM world_notice_mutes WHERE fingerprint = ?').run(fingerprint);
  return listNoticeMutes();
}
