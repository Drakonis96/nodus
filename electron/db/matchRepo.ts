// Candidate identity matching + user verdicts for genealogy. Finds person records
// that might be the same individual across sources (never auto-merging), records
// dismissals persistently so they aren't re-proposed, and merges two persons
// losslessly when the user accepts a match.

import { getDb } from './database';
import { getPerson, listPersons, listEvents, updatePerson } from './entitiesRepo';
import { parseHistoricalDate } from '@shared/genealogyDates';
import { normalizeNameKey } from '@shared/recordsExtraction';
import { computeMatchCandidates, pairKey, type MatchCandidate, type MatchPerson } from '@shared/matchCandidates';
import type { Person } from '@shared/types';

function now(): string {
  return new Date().toISOString();
}

function normalizedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** Record that two person records are NOT the same individual. */
export function dismissMatch(a: string, b: string): void {
  const [pa, pb] = normalizedPair(a, b);
  getDb()
    .prepare(
      "INSERT INTO match_feedback (person_a, person_b, verdict, created_at) VALUES (?, ?, 'dismissed', ?) " +
        'ON CONFLICT(person_a, person_b) DO UPDATE SET verdict = excluded.verdict, created_at = excluded.created_at'
    )
    .run(pa, pb, now());
}

export function listDismissedPairs(): Set<string> {
  const rows = getDb().prepare("SELECT person_a, person_b FROM match_feedback WHERE verdict = 'dismissed'").all() as {
    person_a: string;
    person_b: string;
  }[];
  return new Set(rows.map((r) => pairKey(r.person_a, r.person_b)));
}

export interface MatchCandidatePair extends MatchCandidate {
  a: Person;
  b: Person;
}

/** The person's distinct event-place keys, for the place-overlap signal. */
function placeKeysFor(personId: string): string[] {
  const keys = new Set<string>();
  for (const e of listEvents({ personId })) {
    if (e.placeName) keys.add(normalizeNameKey(e.placeName));
  }
  return [...keys];
}

/** Candidate matches over the current person set, dismissed pairs excluded. */
export function findMatchCandidates(): MatchCandidatePair[] {
  const persons = listPersons();
  const byId = new Map(persons.map((p) => [p.personId, p]));
  const matchPersons: MatchPerson[] = persons.map((p) => ({
    id: p.personId,
    displayName: p.displayName,
    tokens: normalizeNameKey(p.displayName).split(' ').filter(Boolean),
    birthYear: parseHistoricalDate(p.birthDate).year,
    placeKeys: placeKeysFor(p.personId),
  }));
  return computeMatchCandidates(matchPersons, listDismissedPairs()).map((c) => ({
    ...c,
    a: byId.get(c.aId)!,
    b: byId.get(c.bId)!,
  }));
}

/**
 * Merge two person records losslessly: names, participations, relationships,
 * evidence and portrait move onto the target, empty target fields are filled from
 * the source, then the source is deleted. Returns the merged target.
 */
export function mergePersons(targetId: string, sourceId: string): Person | null {
  if (targetId === sourceId) return getPerson(targetId);
  const target = getPerson(targetId);
  const source = getPerson(sourceId);
  if (!target || !source) return null;

  const db = getDb();
  const tx = db.transaction(() => {
    // Re-point references; OR IGNORE drops rows that would duplicate an existing one.
    db.prepare('UPDATE OR IGNORE person_names SET person_id = ? WHERE person_id = ?').run(targetId, sourceId);
    db.prepare('UPDATE OR IGNORE event_participants SET person_id = ? WHERE person_id = ?').run(targetId, sourceId);
    db.prepare('UPDATE OR IGNORE relationships SET from_person = ? WHERE from_person = ?').run(targetId, sourceId);
    db.prepare('UPDATE OR IGNORE relationships SET to_person = ? WHERE to_person = ?').run(targetId, sourceId);
    db.prepare('DELETE FROM relationships WHERE from_person = to_person').run();
    db.prepare("UPDATE record_evidence SET target_id = ? WHERE target_kind = 'person' AND target_id = ?").run(targetId, sourceId);
    // Preserve the source's document links (manual user data): move them to the target.
    db.prepare('UPDATE OR IGNORE archive_item_persons SET person_id = ? WHERE person_id = ?').run(targetId, sourceId);
    // Keep the target's portrait if it has one; otherwise adopt the source's.
    db.prepare('UPDATE OR IGNORE person_portraits SET person_id = ? WHERE person_id = ?').run(targetId, sourceId);
    // Merged dismissals: repoint so past decisions about the source still apply.
    db.prepare('UPDATE OR IGNORE match_feedback SET person_a = ? WHERE person_a = ?').run(targetId, sourceId);
    db.prepare('UPDATE OR IGNORE match_feedback SET person_b = ? WHERE person_b = ?').run(targetId, sourceId);
    db.prepare('DELETE FROM match_feedback WHERE person_a = person_b').run();
    // Kinship suggestions are advisory and regenerable; drop any touching the source
    // rather than risk a mis-ordered spouse pair. They will re-surface on the next scan.
    db.prepare('DELETE FROM kinship_suggestions WHERE from_person = ? OR to_person = ?').run(sourceId, sourceId);

    // Fill empty target fields from the source (target values win when present).
    updatePerson(targetId, {
      sex: target.sex !== 'unknown' ? target.sex : source.sex,
      birthDate: target.birthDate ?? source.birthDate,
      deathDate: target.deathDate ?? source.deathDate,
      notes: target.notes ?? source.notes,
    });

    db.prepare('DELETE FROM persons WHERE person_id = ?').run(sourceId);
  });
  tx();
  return getPerson(targetId);
}
