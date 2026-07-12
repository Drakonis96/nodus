// Records-lens scan orchestrator: chunk a primary source, extract entities per
// chunk with the model, merge/de-duplicate across chunks (pure core), then persist
// to the entity repo with evidence pointing back at the source work. The per-chunk
// extractor is injected so the orchestration is testable without an AI call.

import { planTextChunks } from '../extraction/textExtractor';
import {
  addRecordEvidence,
  createEvent,
  createPerson,
  findOrCreatePlace,
  getPerson,
  listPersons,
  updatePerson,
} from '../db/entitiesRepo';
import { recordKinCandidates, openSuggestionCount } from '../db/kinshipSuggestionsRepo';
import { completeJson } from './aiClient';
import {
  RECORDS_EXTRACTION_PROMPT,
  buildRecordsInput,
  isRecordsChunkResult,
  mergeRecordsResults,
  normalizeNameKey,
  type MergedPerson,
  type MergedRecords,
  type RecordsChunkResult,
} from '@shared/recordsExtraction';
import { parseHistoricalDate } from '@shared/genealogyDates';
import { shouldLinkToExisting, type MatchPerson } from '@shared/matchCandidates';
import { deriveKinFromEvents, deriveKinFromClaims, type EventForKin, type KinClaim } from '@shared/kinshipInference';
import type { ModelRef, RecordSourceKind } from '@shared/types';

export interface RecordsScanResult {
  persons: number;
  places: number;
  events: number;
  evidence: number;
  /** How many extracted persons were linked to an existing record instead of duplicated. */
  linked: number;
  /** Open kinship suggestions surfaced across the whole vault after this scan. */
  suggestions: number;
}

export type ChunkExtractor = (input: ReturnType<typeof buildRecordsInput>) => Promise<RecordsChunkResult>;

/**
 * Persist a merged record set, attaching every fact's evidence to its source — a
 * Zotero work (sourceKind 'work') or an evidence-archive item (sourceKind 'archive').
 * Persons and places are resolved by normalised name so repeated mentions collapse
 * onto one entity; event participants reuse those same persons.
 */
export function persistRecords(
  sourceId: string,
  merged: MergedRecords,
  sourceKind: RecordSourceKind = 'work'
): RecordsScanResult {
  const workNodusId = sourceId;
  const personIdByKey = new Map<string, string>();
  const placeIdByKey = new Map<string, string>();
  let evidence = 0;
  let linked = 0;

  // Snapshot the persons that existed BEFORE this scan, so reconciliation targets the
  // existing tree — not the records we are about to create. This is what stops a diary
  // that mentions people already in the tree from spawning a pile of duplicates.
  const existingIndex: MatchPerson[] = listPersons().map((p) => ({
    id: p.personId,
    displayName: p.displayName,
    tokens: normalizeNameKey(p.displayName).split(' ').filter(Boolean),
    birthYear: parseHistoricalDate(p.birthDate).year,
    placeKeys: [],
  }));

  const resolvePlace = (name: string, kind?: string | null): string => {
    const key = normalizeNameKey(name);
    const existing = placeIdByKey.get(key);
    if (existing) return existing;
    const place = findOrCreatePlace(name, kind ?? null);
    placeIdByKey.set(key, place.placeId);
    return place.placeId;
  };

  // Fill only EMPTY fields on a linked person from a new record; never overwrite.
  const backfill = (personId: string, p: MergedPerson): void => {
    const existing = getPerson(personId);
    if (!existing) return;
    const patch: Record<string, unknown> = {};
    if (existing.sex === 'unknown' && p.sex && p.sex !== 'unknown') patch.sex = p.sex;
    if (!existing.birthDate && p.birth) patch.birthDate = p.birth;
    if (!existing.deathDate && p.death) patch.deathDate = p.death;
    if (Object.keys(patch).length) updatePerson(personId, patch);
  };

  // Reconcile an extracted person against the pre-scan tree: link to an unambiguous
  // exact match, otherwise create a new record (ambiguous matches flow to the
  // user-adjudicated "Revisar coincidencias" review — never merged silently).
  const reconcile = (name: string, birthYear: number | null, onLink?: (id: string) => void): string => {
    const key = normalizeNameKey(name);
    const cached = personIdByKey.get(key);
    if (cached) return cached;
    const tokens = key.split(' ').filter(Boolean);
    const linkId = shouldLinkToExisting({ tokens, birthYear }, existingIndex);
    if (linkId) {
      linked++;
      onLink?.(linkId);
      personIdByKey.set(key, linkId);
      return linkId;
    }
    const person = createPerson({ displayName: name.trim() });
    personIdByKey.set(key, person.personId);
    return person.personId;
  };

  for (const p of merged.persons) {
    const birthYear = parseHistoricalDate(p.birth).year;
    const cached = personIdByKey.get(p.key);
    let personId: string;
    if (cached) {
      personId = cached;
    } else {
      const tokens = p.key.split(' ').filter(Boolean);
      const linkId = shouldLinkToExisting({ tokens, birthYear }, existingIndex);
      if (linkId) {
        linked++;
        backfill(linkId, p);
        personId = linkId;
      } else {
        personId = createPerson({ displayName: p.name, sex: p.sex, birthDate: p.birth, deathDate: p.death }).personId;
      }
      personIdByKey.set(p.key, personId);
    }
    for (const ev of p.evidence) {
      addRecordEvidence({
        targetKind: 'person',
        targetId: personId,
        nodusId: workNodusId,
        sourceKind,
        quote: ev.quote ?? null,
        location: ev.location ?? null,
      });
      evidence++;
    }
  }

  for (const pl of merged.places) resolvePlace(pl.name, pl.kind);

  const eventsForKin: EventForKin[] = [];
  for (const e of merged.events) {
    const placeId = e.place ? resolvePlace(e.place) : null;
    const participants = e.participants.map((part) => ({ personId: reconcile(part.name, null), role: part.role }));
    const event = createEvent({ type: e.type, label: e.label, date: e.date, placeId, participants });
    if (e.evidence) {
      addRecordEvidence({
        targetKind: 'event',
        targetId: event.eventId,
        nodusId: workNodusId,
        sourceKind,
        quote: e.evidence.quote ?? null,
        location: e.evidence.location ?? null,
      });
      evidence++;
    }
    eventsForKin.push({
      type: e.type,
      participants,
      quote: e.evidence?.quote ?? null,
      location: e.evidence?.location ?? null,
    });
  }

  // Turn structural roles + explicit textual claims into kinship SUGGESTIONS. This
  // never writes to the relationships table; a bare co-mention contributes nothing.
  const claims: KinClaim[] = [];
  for (const r of merged.relations) {
    const subjectId = personIdByKey.get(normalizeNameKey(r.subject));
    const objectId = personIdByKey.get(normalizeNameKey(r.object));
    if (!subjectId || !objectId) continue;
    claims.push({ subjectId, objectId, relation: r.relation, quote: r.quote, location: r.location });
  }
  const candidates = [...deriveKinFromEvents(eventsForKin), ...deriveKinFromClaims(claims)];
  recordKinCandidates(candidates, { sourceKind, nodusId: workNodusId });

  return {
    persons: personIdByKey.size,
    places: placeIdByKey.size,
    events: merged.events.length,
    evidence,
    linked,
    suggestions: openSuggestionCount(),
  };
}

/** Run the records lens over a source's text using the given per-chunk extractor. */
export async function runRecordsScan(
  sourceId: string,
  text: string,
  extractChunk: ChunkExtractor,
  sourceKind: RecordSourceKind = 'work'
): Promise<RecordsScanResult> {
  const { chunks } = planTextChunks(text);
  const results: RecordsChunkResult[] = [];
  for (let i = 0; i < chunks.length; i++) {
    results.push(await extractChunk(buildRecordsInput(chunks[i], i, chunks.length)));
  }
  return persistRecords(sourceId, mergeRecordsResults(results), sourceKind);
}

/** The per-chunk extractor backed by the configured AI model. */
function modelExtractor(model?: ModelRef | null): ChunkExtractor {
  return (input) =>
    completeJson<RecordsChunkResult>(
      { system: RECORDS_EXTRACTION_PROMPT, user: JSON.stringify(input), temperature: 0.15, maxTokens: 8000 },
      isRecordsChunkResult,
      model
    );
}

/** Production entry point for a Zotero work's text. */
export function scanWorkRecords(workNodusId: string, text: string, model?: ModelRef | null): Promise<RecordsScanResult> {
  return runRecordsScan(workNodusId, text, modelExtractor(model), 'work');
}

/** Production entry point for an evidence-archive item's extracted text. */
export function scanArchiveTextRecords(
  itemId: string,
  text: string,
  model?: ModelRef | null
): Promise<RecordsScanResult> {
  return runRecordsScan(itemId, text, modelExtractor(model), 'archive');
}
