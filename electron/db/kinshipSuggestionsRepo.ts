// Store for evidence-driven kinship SUGGESTIONS. Candidates produced by the pure
// inference (shared/kinshipInference) are accumulated here per person-pair, each with
// its verbatim quote. A suggestion never becomes a tree edge on its own: it surfaces
// for review only once its evidence crosses a threshold, and the user confirms it
// (writing a real ai_confirmed relationship) or dismisses it (persistently — a
// dismissed pair is never re-proposed, even across rescans). The AI proposes here; it
// is structurally unable to assert kinship.

import { getDb } from './database';
import { v4 as uuid } from 'uuid';
import { addRelationship } from './relationshipsRepo';
import { addRecordEvidence } from './entitiesRepo';
import {
  clampScore,
  normalizeSpousePair,
  strengthForScore,
  SURFACE_MIN_SCORE,
  type KinCandidate,
} from '@shared/kinshipInference';
import type {
  KinSignal,
  KinSuggestion,
  KinSuggestionEvidence,
  RecordSourceKind,
  RelationshipSubtype,
  RelationshipType,
} from '@shared/types';

function now(): string {
  return new Date().toISOString();
}

interface SuggestionRow {
  suggestion_id: string;
  from_person: string;
  to_person: string;
  type: RelationshipType;
  subtype: string | null;
  status: string;
  score: number;
  created_at: string;
  updated_at: string;
  from_name: string | null;
  to_name: string | null;
}

interface EvidenceRow {
  id: string;
  suggestion_id: string;
  signal: KinSignal;
  source_kind: RecordSourceKind;
  nodus_id: string | null;
  quote: string | null;
  location: string | null;
  weight: number;
}

function rowToEvidence(row: EvidenceRow): KinSuggestionEvidence {
  return {
    id: row.id,
    suggestionId: row.suggestion_id,
    signal: row.signal,
    sourceKind: row.source_kind,
    nodusId: row.nodus_id,
    quote: row.quote,
    location: row.location,
    weight: row.weight,
  };
}

function evidenceFor(suggestionId: string): KinSuggestionEvidence[] {
  return (
    getDb()
      .prepare('SELECT * FROM kinship_suggestion_evidence WHERE suggestion_id = ? ORDER BY weight DESC, created_at')
      .all(suggestionId) as EvidenceRow[]
  ).map(rowToEvidence);
}

function rowToSuggestion(row: SuggestionRow): KinSuggestion {
  return {
    suggestionId: row.suggestion_id,
    fromPerson: row.from_person,
    toPerson: row.to_person,
    type: row.type,
    subtype: (row.subtype as RelationshipSubtype) ?? null,
    status: row.status as KinSuggestion['status'],
    score: row.score,
    strength: strengthForScore(row.score),
    fromName: row.from_name ?? '—',
    toName: row.to_name ?? '—',
    evidence: evidenceFor(row.suggestion_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SUGGESTION_SELECT = `SELECT s.*, pf.display_name AS from_name, pt.display_name AS to_name
  FROM kinship_suggestions s
  LEFT JOIN persons pf ON pf.person_id = s.from_person
  LEFT JOIN persons pt ON pt.person_id = s.to_person`;

/** True when a real relationship (any provenance) already asserts this pair+type. */
function relationshipExists(from: string, to: string, type: RelationshipType): boolean {
  const row = getDb()
    .prepare('SELECT 1 FROM relationships WHERE from_person = ? AND to_person = ? AND type = ? LIMIT 1')
    .get(from, to, type);
  return Boolean(row);
}

function recomputeScore(suggestionId: string): number {
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(weight), 0) AS total FROM kinship_suggestion_evidence WHERE suggestion_id = ?')
    .get(suggestionId) as { total: number };
  const score = clampScore(row.total);
  getDb().prepare('UPDATE kinship_suggestions SET score = ?, updated_at = ? WHERE suggestion_id = ?').run(score, now(), suggestionId);
  return score;
}

/**
 * Record one inference candidate as evidence toward a kinship suggestion. No-ops when
 * the relationship already exists or the pair was previously dismissed/confirmed —
 * so we never re-propose what the user has already ruled on. Evidence is deduplicated
 * by (signal, source, quote) so re-scanning the same source can't inflate the score.
 */
export function recordKinCandidate(candidate: KinCandidate, source: { sourceKind: RecordSourceKind; nodusId: string | null }): void {
  let { fromPerson, toPerson } = candidate;
  if (candidate.type === 'spouse') [fromPerson, toPerson] = normalizeSpousePair(fromPerson, toPerson);
  if (!fromPerson || !toPerson || fromPerson === toPerson) return;
  if (relationshipExists(fromPerson, toPerson, candidate.type)) return;

  const db = getDb();
  const existing = db
    .prepare('SELECT suggestion_id, status FROM kinship_suggestions WHERE from_person = ? AND to_person = ? AND type = ?')
    .get(fromPerson, toPerson, candidate.type) as { suggestion_id: string; status: string } | undefined;

  // A user's verdict is final: never revive a dismissed/confirmed suggestion.
  if (existing && existing.status !== 'open') return;

  const suggestionId = existing?.suggestion_id ?? `ksg_${uuid()}`;
  const ts = now();
  const tx = db.transaction(() => {
    if (!existing) {
      db.prepare(
        `INSERT INTO kinship_suggestions (suggestion_id, from_person, to_person, type, subtype, status, score, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'open', 0, ?, ?)`
      ).run(suggestionId, fromPerson, toPerson, candidate.type, candidate.subtype ?? null, ts, ts);
    } else if (candidate.subtype === 'adoptive') {
      db.prepare('UPDATE kinship_suggestions SET subtype = ? WHERE suggestion_id = ?').run('adoptive', suggestionId);
    }
    db.prepare(
      `INSERT OR IGNORE INTO kinship_suggestion_evidence (id, suggestion_id, signal, source_kind, nodus_id, quote, location, weight, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `kse_${uuid()}`,
      suggestionId,
      candidate.signal,
      source.sourceKind,
      source.nodusId ?? null,
      candidate.quote ?? null,
      candidate.location ?? null,
      candidate.weight,
      ts
    );
  });
  tx();
  recomputeScore(suggestionId);
}

export function recordKinCandidates(
  candidates: KinCandidate[],
  source: { sourceKind: RecordSourceKind; nodusId: string | null }
): number {
  for (const c of candidates) recordKinCandidate(c, source);
  return openSuggestionCount();
}

/**
 * Open suggestions worth showing: surfaced above the corroboration threshold, and not
 * already asserted as a real relationship (covers a user adding the edge manually).
 * Ordered strongest-first.
 */
export function listOpenSuggestions(): KinSuggestion[] {
  const rows = getDb()
    .prepare(
      `${SUGGESTION_SELECT}
       WHERE s.status = 'open' AND s.score >= ?
         AND NOT EXISTS (
           SELECT 1 FROM relationships r
           WHERE r.from_person = s.from_person AND r.to_person = s.to_person AND r.type = s.type
         )
       ORDER BY s.score DESC, s.updated_at DESC`
    )
    .all(SURFACE_MIN_SCORE) as SuggestionRow[];
  return rows.map(rowToSuggestion);
}

export function listSuggestionsForPerson(personId: string): KinSuggestion[] {
  const rows = getDb()
    .prepare(
      `${SUGGESTION_SELECT}
       WHERE s.status = 'open' AND s.score >= ? AND (s.from_person = ? OR s.to_person = ?)
         AND NOT EXISTS (
           SELECT 1 FROM relationships r
           WHERE r.from_person = s.from_person AND r.to_person = s.to_person AND r.type = s.type
         )
       ORDER BY s.score DESC`
    )
    .all(SURFACE_MIN_SCORE, personId, personId) as SuggestionRow[];
  return rows.map(rowToSuggestion);
}

export function getSuggestion(suggestionId: string): KinSuggestion | null {
  const row = getDb().prepare(`${SUGGESTION_SELECT} WHERE s.suggestion_id = ?`).get(suggestionId) as SuggestionRow | undefined;
  return row ? rowToSuggestion(row) : null;
}

export function openSuggestionCount(): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM kinship_suggestions s
       WHERE s.status = 'open' AND s.score >= ?
         AND NOT EXISTS (
           SELECT 1 FROM relationships r
           WHERE r.from_person = s.from_person AND r.to_person = s.to_person AND r.type = s.type
         )`
    )
    .get(SURFACE_MIN_SCORE) as { c: number };
  return row.c;
}

/**
 * Confirm a suggestion: write the real relationship with provenance 'ai_confirmed'
 * (a user-vetted AI proposal, never a raw AI write), attach the suggestion's evidence
 * quotes to that relationship, and mark the suggestion confirmed.
 */
export function confirmSuggestion(suggestionId: string): boolean {
  const suggestion = getSuggestion(suggestionId);
  if (!suggestion || suggestion.status !== 'open') return false;

  const rel = addRelationship(
    suggestion.fromPerson,
    suggestion.toPerson,
    suggestion.type,
    'ai_confirmed',
    suggestion.subtype,
    null
  );
  if (rel) {
    for (const ev of suggestion.evidence) {
      if (!ev.quote && !ev.location) continue;
      addRecordEvidence({
        targetKind: 'relationship',
        targetId: rel.relId,
        nodusId: ev.nodusId,
        sourceKind: ev.sourceKind,
        quote: ev.quote,
        location: ev.location,
      });
    }
  }
  getDb().prepare("UPDATE kinship_suggestions SET status = 'confirmed', updated_at = ? WHERE suggestion_id = ?").run(now(), suggestionId);
  return true;
}

/** Dismiss a suggestion permanently: it is never surfaced or re-proposed again. */
export function dismissSuggestion(suggestionId: string): boolean {
  const res = getDb()
    .prepare("UPDATE kinship_suggestions SET status = 'dismissed', updated_at = ? WHERE suggestion_id = ? AND status = 'open'")
    .run(now(), suggestionId);
  return res.changes > 0;
}
