import type {
  PrimarySourceEntityProposal,
  PrimarySourceProposalExtractionInput,
  PrimarySourceProposalExtractionResult,
  PrimarySourceProposalKind,
} from '@shared/primarySourcesTypes';
import {
  buildRecordsInput,
  isRecordsChunkResult,
  mergeRecordsResults,
  normalizeNameKey,
} from '@shared/recordsExtraction';
import { primarySourceProposalPrompt } from '@shared/primarySourceProposalPrompts';
import { getSettings } from '../db/settingsRepo';
import { getArchiveExcerpt } from '../db/archiveEvidenceRepo';
import {
  createEntityProposal,
  listEntityProposals,
  proposalFingerprint,
} from '../db/archiveProposalsRepo';
import { listPersons, listPlaces } from '../db/entitiesRepo';
import { recordArchiveAudit } from '../db/archiveAuditRepo';
import { completeJson } from './aiClient';

const exactTarget = (
  name: string,
  candidates: Array<{ id: string; name: string }>
): string | null => {
  const key = normalizeNameKey(name);
  const matches = candidates.filter((candidate) => normalizeNameKey(candidate.name) === key);
  return matches.length === 1 ? matches[0].id : null;
};

function stableExtractionIdentity(
  kind: PrimarySourceProposalKind,
  payload: Record<string, unknown>,
): string {
  const key = (value: unknown) => normalizeNameKey(typeof value === 'string' ? value : '');
  if (kind === 'person') {
    return `person:${key(payload.displayName ?? payload.originalLabel ?? payload.name)}`;
  }
  if (kind === 'place') {
    return `place:${key(payload.name ?? payload.originalLabel)}`;
  }
  if (kind === 'relation') {
    let subject = key(payload.subject);
    let object = key(payload.object);
    const relation = key(payload.relation);
    if (['son', 'daughter', 'child'].includes(relation)) {
      [subject, object] = [object, subject];
      return `relation:${subject}:parent:${object}`;
    }
    if (['father', 'mother', 'parent'].includes(relation)) {
      return `relation:${subject}:parent:${object}`;
    }
    if (['husband', 'wife', 'spouse'].includes(relation)) {
      return `relation:${[subject, object].sort().join(':')}:spouse`;
    }
    return `relation:${subject}:${relation}:${object}`;
  }
  if (kind === 'event') {
    // Participant lists and short labels are generative descriptions of the same
    // occurrence and may be more or less complete on a rerun. The occurrence
    // itself is identified by its explicit type/date/place inside this excerpt.
    return `event:${key(payload.type)}:${key(payload.date)}:${key(payload.place)}`;
  }
  if (kind === 'date') {
    // A person's birth/death proposal has a stable subject; an event-date
    // proposal does not, and its generated context/label must not affect identity.
    return `date:${key(payload.date)}:${key(payload.subject)}`;
  }
  return `${kind}:${key(JSON.stringify(payload))}`;
}

export async function extractPrimarySourceProposals(
  input: PrimarySourceProposalExtractionInput
): Promise<PrimarySourceProposalExtractionResult> {
  const excerpt = getArchiveExcerpt(input.excerptId);
  if (!excerpt || excerpt.itemId !== input.itemId) {
    throw new Error('Selecciona un fragmento localizable de esta fuente.');
  }
  if (!excerpt.quotedText?.trim()) {
    throw new Error('El fragmento no contiene texto que pueda analizarse.');
  }
  const settings = getSettings();
  const model = settings.extractionModel ?? settings.synthesisModel ?? null;
  if (!model) throw new Error('Configura un modelo de extracción en Ajustes.');
  const raw = await completeJson(
    {
      system: primarySourceProposalPrompt(settings.uiLanguage),
      user: JSON.stringify(buildRecordsInput(excerpt.quotedText, 0, 1)),
      temperature: 0,
      maxTokens: 7000,
    },
    isRecordsChunkResult,
    model
  );
  const merged = mergeRecordsResults([raw]);
  const persons = listPersons().map((person) => ({ id: person.personId, name: person.displayName }));
  const places = listPlaces().map((place) => ({ id: place.placeId, name: place.name }));
  const sourceEngine = model.provider;
  const sourceModel = model.model;
  const specs: Array<{
    proposalKind: PrimarySourceProposalKind;
    payload: Record<string, unknown>;
    matchedTargetId: string | null;
    confidence: number | null;
    rationale: string;
  }> = [];

  for (const person of merged.persons) {
    specs.push({
      proposalKind: 'person',
      payload: {
        displayName: person.name,
        originalLabel: person.name,
        sex: person.sex,
        birthDate: person.birth,
        deathDate: person.death,
        quote: person.evidence[0]?.quote ?? excerpt.quotedText,
        location: person.evidence[0]?.location ?? excerpt.locatorDisplay,
      },
      matchedTargetId: exactTarget(person.name, persons),
      confidence: null,
      rationale: 'explicit_person_mention',
    });
    if (person.birth) {
      specs.push({
        proposalKind: 'date',
        payload: {
          date: person.birth,
          context: `Nacimiento de ${person.name}`,
          subject: person.name,
          quote: person.evidence[0]?.quote ?? excerpt.quotedText,
          location: person.evidence[0]?.location ?? excerpt.locatorDisplay,
        },
        matchedTargetId: null,
        confidence: null,
        rationale: 'explicit_birth_date',
      });
    }
    if (person.death) {
      specs.push({
        proposalKind: 'date',
        payload: {
          date: person.death,
          context: `Defunción de ${person.name}`,
          subject: person.name,
          quote: person.evidence[0]?.quote ?? excerpt.quotedText,
          location: person.evidence[0]?.location ?? excerpt.locatorDisplay,
        },
        matchedTargetId: null,
        confidence: null,
        rationale: 'explicit_death_date',
      });
    }
  }
  for (const place of merged.places) {
    specs.push({
      proposalKind: 'place',
      payload: {
        name: place.name,
        originalLabel: place.name,
        kind: place.kind,
        quote: excerpt.quotedText,
        location: excerpt.locatorDisplay,
      },
      matchedTargetId: exactTarget(place.name, places),
      confidence: null,
      rationale: 'explicit_place_mention',
    });
  }
  for (const event of merged.events) {
    specs.push({
      proposalKind: 'event',
      payload: {
        type: event.type,
        date: event.date,
        place: event.place,
        placeId: event.place ? exactTarget(event.place, places) : null,
        label: event.label,
        participants: event.participants.map((participant) => ({
          name: participant.name,
          role: participant.role,
          targetId: exactTarget(participant.name, persons),
        })),
        quote: event.evidence?.quote ?? excerpt.quotedText,
        location: event.evidence?.location ?? excerpt.locatorDisplay,
      },
      matchedTargetId: null,
      confidence: null,
      rationale: 'explicit_event',
    });
    if (event.date) {
      specs.push({
        proposalKind: 'date',
        payload: {
          date: event.date,
          context: event.label ?? event.type,
          quote: event.evidence?.quote ?? excerpt.quotedText,
          location: event.evidence?.location ?? excerpt.locatorDisplay,
        },
        matchedTargetId: null,
        confidence: null,
        rationale: 'explicit_event_date',
      });
    }
  }
  for (const relation of merged.relations) {
    specs.push({
      proposalKind: 'relation',
      payload: {
        subject: relation.subject,
        subjectTargetId: exactTarget(relation.subject, persons),
        relation: relation.relation,
        object: relation.object,
        objectTargetId: exactTarget(relation.object, persons),
        quote: relation.quote ?? excerpt.quotedText,
        location: relation.location ?? excerpt.locatorDisplay,
      },
      matchedTargetId: null,
      confidence: null,
      rationale: 'explicit_kinship_claim',
    });
  }

  const proposals: PrimarySourceEntityProposal[] = [];
  const existingFingerprints = new Set(
    listEntityProposals({ itemId: input.itemId }).map((proposal) => proposal.fingerprint)
  );
  let created = 0;
  let reused = 0;
  for (const spec of specs) {
    const dedupeKey = stableExtractionIdentity(spec.proposalKind, spec.payload);
    const fingerprint = proposalFingerprint({
      itemId: input.itemId,
      excerptId: input.excerptId,
      proposalKind: spec.proposalKind,
      payload: spec.payload,
      sourceEngine,
      sourceModel,
      dedupeKey,
    });
    const proposal = createEntityProposal({
      itemId: input.itemId,
      excerptId: input.excerptId,
      ...spec,
      sourceEngine,
      sourceModel,
      dedupeKey,
    });
    if (existingFingerprints.has(fingerprint)) reused += 1;
    else {
      created += 1;
      existingFingerprints.add(fingerprint);
    }
    proposals.push(proposal);
  }
  recordArchiveAudit({
    itemId: input.itemId,
    action: 'proposal_extraction_completed',
    createdBy: 'primary_sources_ai',
    details: {
      excerptId: input.excerptId,
      sourceEngine,
      sourceModel,
      proposals: proposals.length,
      created,
      reused,
      canonicalWrites: 0,
    },
  });
  return { created, reused, proposals, sourceEngine, sourceModel };
}
