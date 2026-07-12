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
} from '../db/entitiesRepo';
import { completeJson } from './aiClient';
import {
  RECORDS_EXTRACTION_PROMPT,
  buildRecordsInput,
  isRecordsChunkResult,
  mergeRecordsResults,
  normalizeNameKey,
  type MergedRecords,
  type RecordsChunkResult,
} from '@shared/recordsExtraction';
import type { ModelRef, PersonSex, RecordSourceKind } from '@shared/types';

export interface RecordsScanResult {
  persons: number;
  places: number;
  events: number;
  evidence: number;
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

  const resolvePerson = (name: string, sex?: PersonSex): string => {
    const key = normalizeNameKey(name);
    const existing = personIdByKey.get(key);
    if (existing) return existing;
    const person = createPerson({ displayName: name.trim(), sex });
    personIdByKey.set(key, person.personId);
    return person.personId;
  };

  const resolvePlace = (name: string, kind?: string | null): string => {
    const key = normalizeNameKey(name);
    const existing = placeIdByKey.get(key);
    if (existing) return existing;
    const place = findOrCreatePlace(name, kind ?? null);
    placeIdByKey.set(key, place.placeId);
    return place.placeId;
  };

  for (const p of merged.persons) {
    const person = createPerson({ displayName: p.name, sex: p.sex, birthDate: p.birth, deathDate: p.death });
    personIdByKey.set(p.key, person.personId);
    for (const ev of p.evidence) {
      addRecordEvidence({
        targetKind: 'person',
        targetId: person.personId,
        nodusId: workNodusId,
        sourceKind,
        quote: ev.quote ?? null,
        location: ev.location ?? null,
      });
      evidence++;
    }
  }

  for (const pl of merged.places) resolvePlace(pl.name, pl.kind);

  for (const e of merged.events) {
    const placeId = e.place ? resolvePlace(e.place) : null;
    const event = createEvent({
      type: e.type,
      label: e.label,
      date: e.date,
      placeId,
      participants: e.participants.map((part) => ({ personId: resolvePerson(part.name), role: part.role })),
    });
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
  }

  return { persons: personIdByKey.size, places: placeIdByKey.size, events: merged.events.length, evidence };
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
