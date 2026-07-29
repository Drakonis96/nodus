import { createHash } from 'node:crypto';
import { v4 as uuid } from 'uuid';
import type { EventInput, ParticipantRole, PersonSex, RelationshipType } from '@shared/types';
import type {
  PrimarySourceEntityProposal,
  PrimarySourceEntityResolution,
  PrimarySourceEvidenceRole,
  PrimarySourceEvidenceTargetKind,
  PrimarySourceProposalAcceptanceInput,
  PrimarySourceProposalAcceptanceResult,
  PrimarySourceProposalCandidate,
  PrimarySourceProposalCandidateSet,
  PrimarySourceProposalDecision,
  PrimarySourceProposalDecisionInput,
  PrimarySourceProposalKind,
  PrimarySourceProposalStatus,
} from '@shared/primarySourcesTypes';
import { normalizeNameKey } from '@shared/recordsExtraction';
import { getDb } from './database';
import {
  createEvent,
  createPerson,
  findOrCreatePlace,
  getEvent,
  getPerson,
  getPlace,
  listEvents,
  listPersons,
  listPlaces,
} from './entitiesRepo';
import {
  createPersonMention,
  createPlaceMention,
  createPrimarySourceEvidence,
  getArchiveExcerpt,
  getPrimarySourceEvidence,
} from './archiveEvidenceRepo';
import { addRelationship } from './relationshipsRepo';
import { recordArchiveAudit } from './archiveAuditRepo';
import { createSocialRelation } from './socialRepo';
import { parseHistoricalDate } from '@shared/genealogyDates';

const now = () => new Date().toISOString();
const parsePayload = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const text = (value: unknown): string | null => {
  const result = typeof value === 'string' ? value.trim() : '';
  return result || null;
};
const certainty = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
};
const objectArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    : [];

type ProposalRow = {
  proposal_id: string; item_id: string; excerpt_id: string | null; proposal_kind: PrimarySourceProposalKind;
  payload_json: string; matched_target_id: string | null; status: PrimarySourceProposalStatus;
  confidence: number | null; rationale: string | null; source_engine: string | null;
  source_model: string | null; fingerprint: string; created_at: string; reviewed_at: string | null;
  reviewed_by: string | null; decision_note: string | null;
};
const fromRow = (row: ProposalRow): PrimarySourceEntityProposal => ({
  proposalId: row.proposal_id, itemId: row.item_id, excerptId: row.excerpt_id,
  proposalKind: row.proposal_kind, payload: parsePayload(row.payload_json),
  matchedTargetId: row.matched_target_id, status: row.status, confidence: row.confidence,
  rationale: row.rationale, sourceEngine: row.source_engine, sourceModel: row.source_model,
  fingerprint: row.fingerprint, createdAt: row.created_at, reviewedAt: row.reviewed_at,
  reviewedBy: row.reviewed_by, decisionNote: row.decision_note,
});

type DecisionRow = {
  decision_id: string; proposal_id: string; item_id: string;
  decision: PrimarySourceProposalDecision['decision'];
  original_payload_json: string; decided_payload_json: string; matched_target_id: string | null;
  materialized_target_kind: PrimarySourceEvidenceTargetKind | null;
  materialized_target_id: string | null; evidence_id: string | null;
  evidence_role: PrimarySourceEvidenceRole | null; reviewer: string | null;
  note: string | null; created_at: string;
};
const decisionFromRow = (row: DecisionRow): PrimarySourceProposalDecision => ({
  decisionId: row.decision_id,
  proposalId: row.proposal_id,
  itemId: row.item_id,
  decision: row.decision,
  originalPayload: parsePayload(row.original_payload_json),
  decidedPayload: parsePayload(row.decided_payload_json),
  matchedTargetId: row.matched_target_id,
  materializedTargetKind: row.materialized_target_kind,
  materializedTargetId: row.materialized_target_id,
  evidenceId: row.evidence_id,
  evidenceRole: row.evidence_role,
  reviewer: row.reviewer,
  note: row.note,
  createdAt: row.created_at,
});

export function proposalFingerprint(input: {
  itemId: string; excerptId?: string | null; proposalKind: PrimarySourceProposalKind;
  payload: Record<string, unknown>; sourceEngine?: string | null; sourceModel?: string | null;
  /** Stable identity supplied by an extractor when prose/evidence wording may vary
   * between otherwise equivalent model runs. */
  dedupeKey?: string | null;
}): string {
  return createHash('sha256').update(stable({
    itemId: input.itemId, excerptId: input.excerptId ?? null, proposalKind: input.proposalKind,
    identity: input.dedupeKey?.trim() || input.payload,
    sourceEngine: input.sourceEngine ?? null, sourceModel: input.sourceModel ?? null,
  })).digest('hex');
}

export function createEntityProposal(
  input: Omit<PrimarySourceEntityProposal, 'proposalId' | 'fingerprint' | 'status' | 'createdAt' | 'reviewedAt' | 'reviewedBy' | 'decisionNote'>
    & { dedupeKey?: string | null }
): PrimarySourceEntityProposal {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM archive_items WHERE item_id=?').get(input.itemId)) {
    throw new Error('La fuente ya no existe.');
  }
  if (input.excerptId) {
    const excerpt = getArchiveExcerpt(input.excerptId);
    if (!excerpt || excerpt.itemId !== input.itemId) {
      throw new Error('La propuesta debe apuntar a un fragmento de la misma fuente.');
    }
  }
  const fingerprint = proposalFingerprint(input);
  const existing = db.prepare('SELECT * FROM archive_entity_proposals WHERE fingerprint=?').get(fingerprint) as ProposalRow | undefined;
  if (existing) return fromRow(existing);
  const proposalId = `aep_${uuid()}`;
  const createdAt = now();
  db.prepare(
    `INSERT INTO archive_entity_proposals (
      proposal_id, item_id, excerpt_id, proposal_kind, payload_json, matched_target_id,
      status, confidence, rationale, source_engine, source_model, fingerprint, created_at,
      reviewed_at, reviewed_by, decision_note
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`
  ).run(
    proposalId, input.itemId, input.excerptId ?? null, input.proposalKind, stable(input.payload),
    input.matchedTargetId ?? null, input.confidence ?? null, input.rationale ?? null,
    input.sourceEngine ?? null, input.sourceModel ?? null, fingerprint, createdAt
  );
  return getEntityProposal(proposalId)!;
}

export function getEntityProposal(proposalId: string): PrimarySourceEntityProposal | null {
  const row = getDb().prepare('SELECT * FROM archive_entity_proposals WHERE proposal_id=?').get(proposalId) as ProposalRow | undefined;
  return row ? fromRow(row) : null;
}

export function listEntityProposals(options: {
  itemId?: string; status?: PrimarySourceProposalStatus; kind?: PrimarySourceProposalKind;
} = {}): PrimarySourceEntityProposal[] {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (options.itemId) { clauses.push('item_id=?'); values.push(options.itemId); }
  if (options.status) { clauses.push('status=?'); values.push(options.status); }
  if (options.kind) { clauses.push('proposal_kind=?'); values.push(options.kind); }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  return (getDb().prepare(
    `SELECT * FROM archive_entity_proposals${where} ORDER BY
      CASE status WHEN 'pending' THEN 0 WHEN 'deferred' THEN 1 WHEN 'accepted' THEN 2 ELSE 3 END,
      created_at`
  ).all(...values) as ProposalRow[]).map(fromRow);
}

export function getProposalDecision(decisionId: string): PrimarySourceProposalDecision | null {
  const row = getDb().prepare(
    'SELECT * FROM archive_proposal_decisions WHERE decision_id=?'
  ).get(decisionId) as DecisionRow | undefined;
  return row ? decisionFromRow(row) : null;
}

export function listProposalDecisions(options: { itemId?: string; proposalId?: string } = {}): PrimarySourceProposalDecision[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.itemId) { clauses.push('item_id=?'); params.push(options.itemId); }
  if (options.proposalId) { clauses.push('proposal_id=?'); params.push(options.proposalId); }
  return (getDb().prepare(
    `SELECT * FROM archive_proposal_decisions${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY created_at DESC, decision_id DESC`
  ).all(...params) as DecisionRow[]).map(decisionFromRow);
}

function insertDecision(input: {
  proposal: PrimarySourceEntityProposal;
  decision: PrimarySourceProposalDecision['decision'];
  payload: Record<string, unknown>;
  matchedTargetId: string | null;
  materializedTargetKind?: PrimarySourceEvidenceTargetKind | null;
  materializedTargetId?: string | null;
  evidenceId?: string | null;
  evidenceRole?: PrimarySourceEvidenceRole | null;
  reviewer?: string | null;
  note?: string | null;
}): PrimarySourceProposalDecision {
  const decisionId = `apd_${uuid()}`;
  getDb().prepare(
    `INSERT INTO archive_proposal_decisions (
      decision_id, proposal_id, item_id, decision, original_payload_json,
      decided_payload_json, matched_target_id, materialized_target_kind,
      materialized_target_id, evidence_id, evidence_role, reviewer, note, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    decisionId, input.proposal.proposalId, input.proposal.itemId, input.decision,
    stable(input.proposal.payload), stable(input.payload), input.matchedTargetId,
    input.materializedTargetKind ?? null, input.materializedTargetId ?? null,
    input.evidenceId ?? null, input.evidenceRole ?? null, input.reviewer ?? null,
    input.note ?? null, now()
  );
  return getProposalDecision(decisionId)!;
}

/** Reject/defer without mutating the model payload. A later human may still edit and
 * accept it; an AI rerun finds the same fingerprint and cannot reset the decision. */
export function decideEntityProposal(
  proposalId: string,
  status: Exclude<PrimarySourceProposalStatus, 'pending' | 'accepted'>,
  input: PrimarySourceProposalDecisionInput = {}
): PrimarySourceEntityProposal | null {
  const db = getDb();
  return db.transaction(() => {
    const proposal = getEntityProposal(proposalId);
    if (!proposal) return null;
    if (proposal.status === 'accepted') throw new Error('Una propuesta aceptada no puede rechazarse ni aplazarse.');
    const payload = input.payload ?? proposal.payload;
    const matchedTargetId = input.matchedTargetId !== undefined
      ? input.matchedTargetId
      : proposal.matchedTargetId;
    const ts = now();
    insertDecision({
      proposal, decision: status, payload, matchedTargetId,
      reviewer: input.reviewer ?? 'primary_sources_user', note: input.note,
    });
    db.prepare(
      `UPDATE archive_entity_proposals
       SET status=?, reviewed_at=?, reviewed_by=?, decision_note=?, matched_target_id=?
       WHERE proposal_id=?`
    ).run(status, ts, input.reviewer ?? 'primary_sources_user', input.note ?? null, matchedTargetId, proposalId);
    recordArchiveAudit({
      itemId: proposal.itemId,
      action: 'proposal_decided',
      createdBy: input.reviewer ?? 'primary_sources_user',
      details: { proposalId, decision: status, edited: stable(payload) !== stable(proposal.payload) },
    });
    return getEntityProposal(proposalId);
  })();
}

function exactPersonId(name: string | null): string | null {
  if (!name) return null;
  const key = normalizeNameKey(name);
  const matches = listPersons().filter((person) => normalizeNameKey(person.displayName) === key);
  return matches.length === 1 ? matches[0].personId : null;
}

function exactPlaceId(name: string | null): string | null {
  if (!name) return null;
  const key = normalizeNameKey(name);
  const matches = listPlaces().filter((place) => normalizeNameKey(place.name) === key);
  return matches.length === 1 ? matches[0].placeId : null;
}

function ensurePerson(targetId: string | null, payload: Record<string, unknown>): { id: string; created: boolean } {
  if (targetId) {
    if (!getPerson(targetId)) throw new Error('La persona seleccionada ya no existe.');
    return { id: targetId, created: false };
  }
  const displayName = text(payload.displayName) ?? text(payload.name) ?? text(payload.originalLabel);
  if (!displayName) throw new Error('La propuesta de persona necesita un nombre.');
  const sex = ['male', 'female', 'unknown'].includes(String(payload.sex))
    ? payload.sex as PersonSex
    : 'unknown';
  const person = createPerson({
    displayName,
    sex,
    birthDate: text(payload.birthDate) ?? text(payload.birth),
    deathDate: text(payload.deathDate) ?? text(payload.death),
    notes: text(payload.notes),
  });
  getDb().prepare("UPDATE persons SET identity_status='provisional' WHERE person_id=?").run(person.personId);
  return { id: person.personId, created: true };
}

function ensurePlace(targetId: string | null, payload: Record<string, unknown>): { id: string; created: boolean } {
  if (targetId) {
    if (!getPlace(targetId)) throw new Error('El lugar seleccionado ya no existe.');
    return { id: targetId, created: false };
  }
  const name = text(payload.name) ?? text(payload.originalLabel);
  if (!name) throw new Error('La propuesta de lugar necesita un nombre.');
  const before = exactPlaceId(name);
  const place = findOrCreatePlace(name, text(payload.kind));
  return { id: place.placeId, created: before === null };
}

function participantRole(value: unknown): ParticipantRole {
  const role = String(value ?? 'principal') as ParticipantRole;
  return ['principal', 'spouse', 'father', 'mother', 'child', 'witness', 'officiant', 'other'].includes(role)
    ? role
    : 'other';
}

function eventInput(payload: Record<string, unknown>): EventInput {
  const allowed = new Set(['birth', 'baptism', 'marriage', 'death', 'burial', 'census', 'residence', 'migration', 'occupation', 'other']);
  const type = allowed.has(String(payload.type)) ? String(payload.type) as EventInput['type'] : 'other';
  const placeId = text(payload.placeId) ?? exactPlaceId(text(payload.place));
  const participants = objectArray(payload.participants).flatMap((entry) => {
    const id = text(entry.targetId) ?? text(entry.personId) ?? exactPersonId(text(entry.name));
    return id && getPerson(id) ? [{ personId: id, role: participantRole(entry.role) }] : [];
  });
  return {
    type,
    label: text(payload.label),
    date: text(payload.date),
    placeId: placeId && getPlace(placeId) ? placeId : null,
    notes: text(payload.notes),
    participants,
  };
}

function peopleFromRelationPayload(payload: Record<string, unknown>): { subjectId: string; objectId: string } {
  const subjectId = text(payload.subjectTargetId) ?? exactPersonId(text(payload.subject));
  const objectId = text(payload.objectTargetId) ?? exactPersonId(text(payload.object));
  if (!subjectId || !objectId || !getPerson(subjectId) || !getPerson(objectId)) {
    throw new Error('Resuelve las dos personas antes de aceptar la relación.');
  }
  if (subjectId === objectId) throw new Error('Una relación necesita dos personas distintas.');
  return { subjectId, objectId };
}

function kinshipFromPayload(payload: Record<string, unknown>): {
  from: string; to: string; type: RelationshipType;
} | null {
  const { subjectId, objectId } = peopleFromRelationPayload(payload);
  const relation = String(payload.relation ?? '').toLowerCase();
  if (['father', 'mother', 'parent'].includes(relation)) return { from: subjectId, to: objectId, type: 'parent' };
  if (['son', 'daughter', 'child'].includes(relation)) return { from: objectId, to: subjectId, type: 'parent' };
  if (['husband', 'wife', 'spouse'].includes(relation)) return { from: subjectId, to: objectId, type: 'spouse' };
  if (relation === 'sibling') return { from: subjectId, to: objectId, type: 'sibling' };
  return null;
}

function acceptedDecision(proposalId: string): PrimarySourceProposalDecision | null {
  const row = getDb().prepare(
    "SELECT * FROM archive_proposal_decisions WHERE proposal_id=? AND decision='accepted'"
  ).get(proposalId) as DecisionRow | undefined;
  return row ? decisionFromRow(row) : null;
}

export function acceptEntityProposal(
  proposalId: string,
  input: PrimarySourceProposalAcceptanceInput = {}
): PrimarySourceProposalAcceptanceResult {
  const db = getDb();
  return db.transaction(() => {
    const proposal = getEntityProposal(proposalId);
    if (!proposal) throw new Error('La propuesta ya no existe.');
    const previous = acceptedDecision(proposalId);
    if (previous) {
      const evidence = previous.evidenceId ? getPrimarySourceEvidence(previous.evidenceId) : null;
      if (!evidence) throw new Error('La materialización existe, pero su evidencia fue eliminada.');
      return { proposal, decision: previous, evidence, idempotent: true };
    }
    if (!proposal.excerptId) throw new Error('Solo puede aceptarse una propuesta anclada a un fragmento.');
    const excerpt = getArchiveExcerpt(proposal.excerptId);
    if (!excerpt || excerpt.itemId !== proposal.itemId) throw new Error('El fragmento de la propuesta ya no existe.');
    const payload = input.payload ?? proposal.payload;
    const matchedTargetId = input.matchedTargetId !== undefined
      ? input.matchedTargetId
      : proposal.matchedTargetId;
    const role = input.evidenceRole ?? 'supports';
    const evidenceCertainty = certainty(input.certainty) ?? proposal.confidence;
    let targetKind: PrimarySourceEvidenceTargetKind;
    let targetId: string;

    if (proposal.proposalKind === 'person') {
      const resolved = ensurePerson(matchedTargetId, payload);
      targetKind = 'person';
      targetId = resolved.id;
      const mention = createPersonMention({
        itemId: proposal.itemId,
        excerptId: proposal.excerptId,
        personId: targetId,
        originalLabel: text(payload.originalLabel) ?? text(payload.displayName) ?? text(payload.name) ?? '—',
        role: text(payload.role),
        certainty: evidenceCertainty,
        identityStatus: resolved.created ? 'provisional' : 'confirmed',
      });
      if (!resolved.created) {
        createEntityResolution({
          entityKind: 'person',
          sourceEntityId: mention.mentionId,
          targetEntityId: targetId,
          decision: 'confirm',
          rationale: input.note ?? 'Coincidencia confirmada al revisar una propuesta.',
          createdBy: input.reviewer ?? 'primary_sources_user',
          itemId: proposal.itemId,
        });
      }
    } else if (proposal.proposalKind === 'place') {
      const resolved = ensurePlace(matchedTargetId, payload);
      targetKind = 'place';
      targetId = resolved.id;
      const mention = createPlaceMention({
        itemId: proposal.itemId,
        excerptId: proposal.excerptId,
        placeId: targetId,
        originalLabel: text(payload.originalLabel) ?? text(payload.name) ?? '—',
        role: ([
          'creation', 'mentioned', 'event', 'route_origin', 'route_destination',
          'custody', 'repository', 'consultation', 'physical_location',
        ] as const).includes(payload.role as never)
          ? payload.role as import('@shared/primarySourcesTypes').PrimarySourcePlaceRole
          : 'mentioned',
        certainty: evidenceCertainty,
        status: 'resolved',
      });
      if (!resolved.created) {
        createEntityResolution({
          entityKind: 'place',
          sourceEntityId: mention.mentionId,
          targetEntityId: targetId,
          decision: 'confirm',
          rationale: input.note ?? 'Coincidencia confirmada al revisar una propuesta.',
          createdBy: input.reviewer ?? 'primary_sources_user',
          itemId: proposal.itemId,
        });
      }
    } else if (proposal.proposalKind === 'event') {
      if (matchedTargetId) {
        if (!getEvent(matchedTargetId)) throw new Error('El evento seleccionado ya no existe.');
        targetId = matchedTargetId;
      } else {
        targetId = createEvent(eventInput(payload)).eventId;
      }
      targetKind = 'event';
    } else if (proposal.proposalKind === 'date') {
      const date = text(payload.date);
      if (!date) throw new Error('La propuesta de fecha necesita una fecha literal.');
      if (matchedTargetId) {
        if (!getEvent(matchedTargetId)) throw new Error('El evento seleccionado ya no existe.');
        targetId = matchedTargetId;
      } else {
        targetId = createEvent({
          type: 'other',
          label: text(payload.context) ?? 'Fecha documentada',
          date,
          notes: text(payload.notes),
        }).eventId;
      }
      targetKind = 'event';
    } else if (proposal.proposalKind === 'relation') {
      const relation = kinshipFromPayload(payload);
      if (relation) {
        const materialized = addRelationship(
          relation.from, relation.to, relation.type, 'user_asserted', null,
          text(payload.notes) ?? `Aceptada desde ${proposal.excerptId}`
        );
        if (!materialized) throw new Error('No se pudo crear la relación.');
        targetKind = 'relationship';
        targetId = materialized.relId;
      } else {
        const { subjectId, objectId } = peopleFromRelationPayload(payload);
        const dateDisplay = text(payload.dateDisplay) ?? text(payload.date);
        const parsed = parseHistoricalDate(dateDisplay);
        const direction = ['directed', 'undirected', 'mutual'].includes(String(payload.direction))
          ? payload.direction as 'directed' | 'undirected' | 'mutual'
          : 'directed';
        const materialized = createSocialRelation({
          personId: subjectId,
          targetKind: 'person',
          targetId: objectId,
          role: text(payload.relation) ?? text(payload.role) ?? 'relación documentada',
          notes: text(payload.notes) ?? `Aceptada desde ${proposal.excerptId}`,
          status: 'confirmed',
          certainty: evidenceCertainty,
          dateDisplay,
          dateStartSort: parsed.sortKey,
          dateEndSort: parsed.endSortKey,
          direction,
        });
        targetKind = 'social_relation';
        targetId = materialized.relationId;
      }
    } else {
      throw new Error('Este tipo de propuesta todavía no tiene una entidad canónica compatible.');
    }

    const evidence = createPrimarySourceEvidence({
      targetKind,
      targetId,
      itemId: proposal.itemId,
      excerptId: proposal.excerptId,
      evidenceRole: role,
      certainty: evidenceCertainty,
      reviewStatus: 'reviewed',
      sourceVersionId: excerpt.textVersionId,
      quote: excerpt.quotedText,
      location: excerpt.locatorDisplay,
      createdBy: input.reviewer ?? 'primary_sources_user',
    });
    if (targetKind === 'event') {
      db.prepare("UPDATE events SET review_status='reviewed', updated_at=? WHERE event_id=?")
        .run(now(), targetId);
    }
    const decision = insertDecision({
      proposal,
      decision: 'accepted',
      payload,
      matchedTargetId,
      materializedTargetKind: targetKind,
      materializedTargetId: targetId,
      evidenceId: evidence.evidenceId,
      evidenceRole: role,
      reviewer: input.reviewer ?? 'primary_sources_user',
      note: input.note,
    });
    const ts = now();
    db.prepare(
      `UPDATE archive_entity_proposals SET status='accepted', reviewed_at=?, reviewed_by=?,
       decision_note=?, matched_target_id=? WHERE proposal_id=?`
    ).run(ts, input.reviewer ?? 'primary_sources_user', input.note ?? null, matchedTargetId, proposalId);
    recordArchiveAudit({
      itemId: proposal.itemId,
      action: 'proposal_materialized',
      createdBy: input.reviewer ?? 'primary_sources_user',
      details: {
        proposalId,
        decisionId: decision.decisionId,
        targetKind,
        targetId,
        evidenceId: evidence.evidenceId,
        evidenceRole: role,
        edited: stable(payload) !== stable(proposal.payload),
      },
    });
    return {
      proposal: getEntityProposal(proposalId)!,
      decision,
      evidence,
      idempotent: false,
    };
  })();
}

export function listProposalCandidates(itemId: string): PrimarySourceProposalCandidateSet[] {
  const people = listPersons();
  const places = listPlaces();
  const find = (
    needleValue: string | null,
    field: PrimarySourceProposalCandidate['field'],
    targetKind: 'person' | 'place'
  ): PrimarySourceProposalCandidate[] => {
    const needle = normalizeNameKey(needleValue ?? '');
    if (!needle) return [];
    const source = targetKind === 'person'
      ? people.map((entry) => ({
          targetKind: 'person' as const,
          targetId: entry.personId,
          label: entry.displayName,
          detail: [entry.birthDate, entry.deathDate].filter(Boolean).join(' – ') || null,
        }))
      : places.map((entry) => ({
          targetKind: 'place' as const,
          targetId: entry.placeId,
          label: entry.name,
          detail: [entry.admin1, entry.country].filter(Boolean).join(', ') || entry.kind,
        }));
    const tokens = new Set(needle.split(' '));
    return source.flatMap((entry) => {
      const key = normalizeNameKey(entry.label);
      const overlap = key.split(' ').filter((token) => tokens.has(token)).length;
      if (key !== needle && overlap === 0 && !key.includes(needle) && !needle.includes(key)) return [];
      return [{ ...entry, field, match: key === needle ? 'exact' as const : 'similar' as const }];
    }).sort((a, b) =>
      a.match === b.match ? a.label.localeCompare(b.label) : a.match === 'exact' ? -1 : 1
    ).slice(0, 8);
  };
  return listEntityProposals({ itemId }).map((proposal) => {
    if (proposal.proposalKind === 'relation') {
      return {
        proposalId: proposal.proposalId,
        candidates: [
          ...find(text(proposal.payload.subject), 'subject', 'person'),
          ...find(text(proposal.payload.object), 'object', 'person'),
        ],
      };
    }
    if (proposal.proposalKind === 'event' || proposal.proposalKind === 'date') {
      const proposedDate = text(proposal.payload.date);
      const proposedLabel = normalizeNameKey(
        text(proposal.payload.label) ?? text(proposal.payload.context) ?? ''
      );
      const candidates: PrimarySourceProposalCandidate[] = listEvents().flatMap((event) => {
        const sameDate = Boolean(proposedDate && event.date === proposedDate);
        const eventLabel = normalizeNameKey(event.label ?? '');
        const sameLabel = Boolean(proposedLabel && eventLabel === proposedLabel);
        if (!sameDate && !sameLabel) return [];
        return [{
          field: 'target' as const,
          targetKind: 'event' as const,
          targetId: event.eventId,
          label: event.label ?? event.type,
          detail: [event.date, event.placeName].filter(Boolean).join(' · ') || null,
          match: sameDate && (!proposedLabel || sameLabel) ? 'exact' as const : 'similar' as const,
        }];
      });
      return {
        proposalId: proposal.proposalId,
        candidates: candidates
          .sort((a, b) => a.match === b.match ? a.label.localeCompare(b.label) : a.match === 'exact' ? -1 : 1)
          .slice(0, 8),
      };
    }
    if (proposal.proposalKind !== 'person' && proposal.proposalKind !== 'place') {
      return { proposalId: proposal.proposalId, candidates: [] };
    }
    return {
      proposalId: proposal.proposalId,
      candidates: find(
        text(proposal.payload.displayName) ?? text(proposal.payload.name) ?? text(proposal.payload.originalLabel),
        'target',
        proposal.proposalKind
      ),
    };
  });
}

type ResolutionRow = {
  resolution_id: string; entity_kind: 'person' | 'place'; source_entity_id: string;
  target_entity_id: string | null; decision: PrimarySourceEntityResolution['decision'];
  rationale: string | null; status: PrimarySourceEntityResolution['status'];
  created_by: string | null; created_at: string; reverted_at: string | null;
};
const resolutionFromRow = (row: ResolutionRow): PrimarySourceEntityResolution => ({
  resolutionId: row.resolution_id,
  entityKind: row.entity_kind,
  sourceEntityId: row.source_entity_id,
  targetEntityId: row.target_entity_id,
  decision: row.decision,
  rationale: row.rationale,
  status: row.status,
  createdBy: row.created_by,
  createdAt: row.created_at,
  revertedAt: row.reverted_at,
});

export function createEntityResolution(input: Omit<
  PrimarySourceEntityResolution,
  'resolutionId' | 'status' | 'createdAt' | 'revertedAt'
> & { itemId?: string }): PrimarySourceEntityResolution {
  if (input.decision === 'merge' || input.decision === 'confirm') {
    if (!input.targetEntityId) throw new Error('La resolución necesita una entidad de destino.');
    const targetExists = input.entityKind === 'person'
      ? getPerson(input.targetEntityId)
      : getPlace(input.targetEntityId);
    if (!targetExists) throw new Error('La entidad de destino ya no existe.');
  }
  const db = getDb();
  return db.transaction(() => {
    db.prepare(
      `UPDATE entity_resolutions SET status='reverted', reverted_at=?
       WHERE entity_kind=? AND source_entity_id=? AND status='active'`
    ).run(now(), input.entityKind, input.sourceEntityId);
    const resolutionId = `ers_${uuid()}`;
    db.prepare(
      `INSERT INTO entity_resolutions (
        resolution_id, entity_kind, source_entity_id, target_entity_id, decision,
        rationale, status, created_by, created_at, reverted_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL)`
    ).run(
      resolutionId, input.entityKind, input.sourceEntityId, input.targetEntityId,
      input.decision, input.rationale, input.createdBy, now()
    );
    if (input.itemId) {
      recordArchiveAudit({
        itemId: input.itemId,
        action: 'entity_resolution_created',
        createdBy: input.createdBy,
        details: { resolutionId, entityKind: input.entityKind, decision: input.decision },
      });
    }
    return resolutionFromRow(
      db.prepare('SELECT * FROM entity_resolutions WHERE resolution_id=?').get(resolutionId) as ResolutionRow
    );
  })();
}

export function listEntityResolutions(itemId?: string): PrimarySourceEntityResolution[] {
  const sql = itemId
    ? `SELECT DISTINCT r.* FROM entity_resolutions r
       LEFT JOIN archive_person_mentions pm ON pm.mention_id=r.source_entity_id
       LEFT JOIN archive_place_mentions lm ON lm.mention_id=r.source_entity_id
       LEFT JOIN archive_person_mentions source_person ON source_person.person_id=r.source_entity_id
       LEFT JOIN archive_person_mentions target_person ON target_person.person_id=r.target_entity_id
       WHERE pm.item_id=? OR lm.item_id=?
         OR source_person.item_id=? OR target_person.item_id=?
       ORDER BY r.created_at DESC`
    : 'SELECT * FROM entity_resolutions ORDER BY created_at DESC';
  const rows = itemId
    ? getDb().prepare(sql).all(itemId, itemId, itemId, itemId)
    : getDb().prepare(sql).all();
  return (rows as ResolutionRow[]).map(resolutionFromRow);
}

export function revertEntityResolution(resolutionId: string, itemId?: string): PrimarySourceEntityResolution | null {
  const db = getDb();
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM entity_resolutions WHERE resolution_id=?').get(resolutionId) as ResolutionRow | undefined;
    if (!row) return null;
    if (row.status === 'active') {
      db.prepare(
        "UPDATE entity_resolutions SET status='reverted', reverted_at=? WHERE resolution_id=?"
      ).run(now(), resolutionId);
      if (itemId) {
        recordArchiveAudit({
          itemId,
          action: 'entity_resolution_reverted',
          createdBy: 'primary_sources_user',
          details: { resolutionId, entityKind: row.entity_kind },
        });
      }
    }
    return resolutionFromRow(
      db.prepare('SELECT * FROM entity_resolutions WHERE resolution_id=?').get(resolutionId) as ResolutionRow
    );
  })();
}
