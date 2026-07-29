import { v4 as uuid } from 'uuid';
import type {
  ProsopAuthorityId,
  ProsopIdentityHypothesis,
  ProsopIdentityHypothesisInput,
  ProsopIdentityWorkspace,
  ProsopNameAttestation,
  ProsopNameAttestationInput,
  ProsopOrganization,
  ProsopPersonProfile,
} from '@shared/prosopography';
import type { PersonInput } from '@shared/types';
import { getDb } from './database';
import { addPersonName, createPerson } from './entitiesRepo';

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${uuid()}`;
export const normalizeProsopName = (value: string) => value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function attestation(row: Record<string, unknown>): ProsopNameAttestation {
  return {
    attestationId: String(row.attestation_id), sourceId: row.source_id == null ? null : String(row.source_id),
    sourceSegmentId: row.source_segment_id == null ? null : String(row.source_segment_id),
    factoidId: row.factoid_id == null ? null : String(row.factoid_id), literalName: String(row.literal_name),
    normalizedSearchName: String(row.normalized_search_name), personId: row.person_id == null ? null : String(row.person_id),
    context: String(row.context ?? ''), roleOrTitle: String(row.role_or_title ?? ''), language: String(row.language ?? ''),
    identityStatus: row.identity_status as ProsopNameAttestation['identityStatus'],
    certainty: row.certainty as ProsopNameAttestation['certainty'], createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}
function hypothesis(row: Record<string, unknown>): ProsopIdentityHypothesis {
  return {
    hypothesisId: String(row.hypothesis_id), leftKind: row.left_kind as ProsopIdentityHypothesis['leftKind'],
    leftId: String(row.left_id), rightKind: row.right_kind as ProsopIdentityHypothesis['rightKind'], rightId: String(row.right_id),
    relation: row.relation as ProsopIdentityHypothesis['relation'], status: row.status as ProsopIdentityHypothesis['status'],
    score: row.score == null ? null : Number(row.score), rationale: String(row.rationale ?? ''), createdBy: String(row.created_by),
    createdAt: String(row.created_at), reviewedBy: row.reviewed_by == null ? null : String(row.reviewed_by),
    reviewedAt: row.reviewed_at == null ? null : String(row.reviewed_at),
  };
}
function authority(row: Record<string, unknown>): ProsopAuthorityId {
  return {
    authorityId: String(row.authority_id), entityKind: row.entity_kind as ProsopAuthorityId['entityKind'],
    entityId: String(row.entity_id), scheme: String(row.scheme), externalId: String(row.external_id),
    uri: row.uri == null ? null : String(row.uri), labelSnapshot: String(row.label_snapshot ?? ''),
    status: row.status as ProsopAuthorityId['status'], factoidId: row.factoid_id == null ? null : String(row.factoid_id),
    createdAt: String(row.created_at),
  };
}
function organization(row: Record<string, unknown>): ProsopOrganization {
  const db = getDb(); const organizationId = String(row.organization_id);
  return {
    organizationId, preferredName: String(row.preferred_name), kind: String(row.kind ?? ''),
    date: { display: [row.date_start,row.date_end].filter(Boolean).join('–') || null,
      startSort: row.date_start_sort == null ? null : Number(row.date_start_sort), endSort: row.date_end_sort == null ? null : Number(row.date_end_sort) },
    placeId: row.place_id == null ? null : String(row.place_id), description: String(row.description ?? ''),
    names: (db.prepare('SELECT * FROM prosop_organization_names WHERE organization_id=? ORDER BY name').all(organizationId) as Record<string, unknown>[]).map((name) => ({
      id: String(name.id), name: String(name.name), kind: String(name.kind), language: String(name.language ?? ''),
      validFrom: name.valid_from == null ? null : String(name.valid_from), validTo: name.valid_to == null ? null : String(name.valid_to),
    })), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export function getProsopIdentityWorkspace(): ProsopIdentityWorkspace {
  const db = getDb();
  const attestations = (db.prepare('SELECT * FROM prosop_name_attestations ORDER BY created_at DESC').all() as Record<string, unknown>[]).map(attestation);
  const persons = (db.prepare(
    `SELECT p.person_id,p.display_name,p.birth_date,p.death_date,p.created_at,p.updated_at,
      x.identity_status,x.review_status,x.preferred_name_basis,x.privacy_status
     FROM persons p JOIN prosop_person_profiles x ON x.person_id=p.person_id ORDER BY p.display_name`
  ).all() as Record<string, unknown>[]).map((row): ProsopPersonProfile => {
    const personId = String(row.person_id);
    return {
      personId, displayName: String(row.display_name), identityStatus: row.identity_status as ProsopPersonProfile['identityStatus'],
      reviewStatus: row.review_status as ProsopPersonProfile['reviewStatus'], preferredNameBasis: String(row.preferred_name_basis ?? ''),
      privacyStatus: row.privacy_status as ProsopPersonProfile['privacyStatus'],
      birthDate: row.birth_date == null ? null : String(row.birth_date), deathDate: row.death_date == null ? null : String(row.death_date),
      attestations: attestations.filter((item) => item.personId === personId),
      authorityIds: (db.prepare("SELECT * FROM prosop_authority_ids WHERE entity_kind='person' AND entity_id=? ORDER BY scheme").all(personId) as Record<string, unknown>[]).map(authority),
      statementCount: Number((db.prepare("SELECT COUNT(*) AS c FROM prosop_statement_entities WHERE entity_kind='person' AND entity_id=?").get(personId) as { c: number }).c),
      sourceCount: Number((db.prepare(
        `SELECT COUNT(DISTINCT f.source_id) AS c FROM prosop_statement_entities e
         JOIN prosop_statements s ON s.statement_id=e.statement_id JOIN prosop_factoids f ON f.factoid_id=s.factoid_id
         WHERE e.entity_kind='person' AND e.entity_id=?`
      ).get(personId) as { c: number }).c),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  });
  return {
    persons, attestations,
    hypotheses: (db.prepare('SELECT * FROM prosop_identity_hypotheses ORDER BY created_at DESC').all() as Record<string, unknown>[]).map(hypothesis),
    organizations: (db.prepare('SELECT * FROM prosop_organizations ORDER BY preferred_name').all() as Record<string, unknown>[]).map(organization),
  };
}

export function createProsopPerson(input: PersonInput & { preferredNameBasis?: string; privacyStatus?: ProsopPersonProfile['privacyStatus'] }): ProsopPersonProfile {
  if (!input.displayName.trim()) throw new Error('La persona necesita un nombre preferido.');
  const person = createPerson(input); const ts = now();
  getDb().prepare(
    `INSERT INTO prosop_person_profiles
     (person_id,identity_status,review_status,preferred_name_basis,privacy_status,created_at,updated_at)
     VALUES (?,'provisional','unreviewed',?,?,?,?)`
  ).run(person.personId,input.preferredNameBasis ?? '',input.privacyStatus ?? 'ordinary',ts,ts);
  return getProsopIdentityWorkspace().persons.find((item) => item.personId === person.personId)!;
}

export function saveProsopNameAttestation(input: ProsopNameAttestationInput): ProsopNameAttestation {
  if (!input.literalName.trim()) throw new Error('La mención necesita conservar la grafía literal.');
  const db = getDb(); const ts = now(); const attestationId = input.attestationId ?? id('pna');
  const existing = db.prepare('SELECT created_at FROM prosop_name_attestations WHERE attestation_id=?').get(attestationId) as { created_at: string } | undefined;
  db.prepare(
    `INSERT INTO prosop_name_attestations
     (attestation_id,source_id,source_segment_id,factoid_id,literal_name,normalized_search_name,person_id,
      context,role_or_title,language,identity_status,certainty,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(attestation_id) DO UPDATE SET literal_name=excluded.literal_name,
      normalized_search_name=excluded.normalized_search_name,person_id=excluded.person_id,context=excluded.context,
      role_or_title=excluded.role_or_title,language=excluded.language,identity_status=excluded.identity_status,
      certainty=excluded.certainty,updated_at=excluded.updated_at`
  ).run(attestationId,input.sourceId ?? null,input.sourceSegmentId ?? null,input.factoidId ?? null,input.literalName.trim(),
    normalizeProsopName(input.literalName),input.personId ?? null,input.context ?? '',input.roleOrTitle ?? '',input.language ?? '',
    input.personId ? 'resolved' : 'unresolved',input.certainty ?? 'unknown',existing?.created_at ?? ts,ts);
  return getProsopIdentityWorkspace().attestations.find((item) => item.attestationId === attestationId)!;
}

export function searchProsopIdentityCandidates(literalName: string, limit = 10): Array<ProsopPersonProfile & { score: number; reasons: string[] }> {
  const query = normalizeProsopName(literalName); const qTokens = new Set(query.split(' ').filter(Boolean));
  return getProsopIdentityWorkspace().persons.filter((item) => item.identityStatus !== 'merged').map((person) => {
    const variants = [person.displayName,...person.attestations.map((item) => item.literalName)].map(normalizeProsopName);
    const exact = variants.includes(query);
    const bestOverlap = Math.max(0,...variants.map((value) => {
      const tokens = new Set(value.split(' ')); const common = [...qTokens].filter((token) => tokens.has(token)).length;
      return common / Math.max(qTokens.size,tokens.size,1);
    }));
    return { ...person, score: exact ? 1 : bestOverlap, reasons: exact ? ['same_normalized_name'] : bestOverlap ? ['token_overlap'] : [] };
  }).filter((item) => item.score > 0).sort((a,b) => b.score - a.score || a.displayName.localeCompare(b.displayName)).slice(0,limit);
}

export function saveProsopIdentityHypothesis(input: ProsopIdentityHypothesisInput): ProsopIdentityHypothesis {
  if (input.leftId === input.rightId && input.leftKind === input.rightKind) throw new Error('Una identidad no puede compararse consigo misma.');
  if (!input.rationale.trim()) throw new Error('La hipótesis necesita una justificación.');
  const db = getDb(); const ts = now(); const hypothesisId = input.hypothesisId ?? id('pih');
  db.prepare(
    `INSERT INTO prosop_identity_hypotheses
     (hypothesis_id,left_kind,left_id,right_kind,right_id,relation,status,score,rationale,created_by,created_at)
     VALUES (?,?,?,?,?,?,'pending',?,?,?,?)`
  ).run(hypothesisId,input.leftKind,input.leftId,input.rightKind,input.rightId,input.relation,input.score ?? null,input.rationale,input.createdBy ?? 'human',ts);
  const insertEvidence = db.prepare(
    `INSERT INTO prosop_identity_decision_evidence (id,hypothesis_id,factoid_id,role,note,created_at)
     VALUES (?,?,?,'supports','',?)`
  );
  (input.factoidIds ?? []).forEach((factoidId) => insertEvidence.run(id('pie'),hypothesisId,factoidId,ts));
  return getProsopIdentityWorkspace().hypotheses.find((item) => item.hypothesisId === hypothesisId)!;
}

export function decideProsopIdentityHypothesis(hypothesisId: string, status: 'accepted' | 'rejected', reviewedBy = 'human'): ProsopIdentityHypothesis {
  const db = getDb(); const ts = now();
  const item = db.prepare('SELECT * FROM prosop_identity_hypotheses WHERE hypothesis_id=?').get(hypothesisId) as Record<string, unknown> | undefined;
  if (!item) throw new Error('Hipótesis no encontrada.');
  const run = db.transaction(() => {
    db.prepare('UPDATE prosop_identity_hypotheses SET status=?,reviewed_by=?,reviewed_at=? WHERE hypothesis_id=?').run(status,reviewedBy,ts,hypothesisId);
    if (status === 'accepted' && item.relation === 'same_as') {
      if (item.left_kind === 'attestation' && item.right_kind === 'person') {
        db.prepare("UPDATE prosop_name_attestations SET person_id=?,identity_status='resolved',updated_at=? WHERE attestation_id=?").run(item.right_id,ts,item.left_id);
      } else if (item.right_kind === 'attestation' && item.left_kind === 'person') {
        db.prepare("UPDATE prosop_name_attestations SET person_id=?,identity_status='resolved',updated_at=? WHERE attestation_id=?").run(item.left_id,ts,item.right_id);
      }
    }
  });
  run();
  return getProsopIdentityWorkspace().hypotheses.find((entry) => entry.hypothesisId === hypothesisId)!;
}

export function mergeProsopPersons(survivorId: string, absorbedId: string, rationale: string, actor = 'human'): string {
  if (survivorId === absorbedId) throw new Error('No se puede fusionar una persona consigo misma.');
  if (!rationale.trim()) throw new Error('La fusión necesita una justificación.');
  const db = getDb(); const ts = now(); const mergeId = id('merge');
  const snapshot = {
    survivorId, absorbedId,
    attestationIds: (db.prepare('SELECT attestation_id FROM prosop_name_attestations WHERE person_id=?').all(absorbedId) as Array<{ attestation_id: string }>).map((row) => row.attestation_id),
    entityIds: (db.prepare("SELECT id FROM prosop_statement_entities WHERE entity_kind='person' AND entity_id=?").all(absorbedId) as Array<{ id: string }>).map((row) => row.id),
    valueStatementIds: (db.prepare("SELECT statement_id FROM prosop_statements WHERE value_kind='person' AND value_person_id=?").all(absorbedId) as Array<{ statement_id: string }>).map((row) => row.statement_id),
  };
  const run = db.transaction(() => {
    db.prepare("UPDATE prosop_name_attestations SET person_id=?,identity_status='resolved',updated_at=? WHERE person_id=?").run(survivorId,ts,absorbedId);
    db.prepare("UPDATE prosop_statement_entities SET entity_id=? WHERE entity_kind='person' AND entity_id=?").run(survivorId,absorbedId);
    db.prepare("UPDATE prosop_statements SET value_person_id=? WHERE value_kind='person' AND value_person_id=?").run(survivorId,absorbedId);
    db.prepare("UPDATE prosop_person_profiles SET identity_status='merged',updated_at=? WHERE person_id=?").run(ts,absorbedId);
    db.prepare("UPDATE prosop_person_profiles SET identity_status='resolved',updated_at=? WHERE person_id=?").run(ts,survivorId);
    const absorbed = db.prepare('SELECT display_name FROM persons WHERE person_id=?').get(absorbedId) as { display_name: string };
    addPersonName(survivorId,absorbed.display_name,'merged');
    db.prepare(
      `INSERT INTO prosop_audit_log
       (audit_id,entity_kind,entity_id,action,before_json,after_json,reason,actor,created_at)
       VALUES (?,'person_merge',?,'merged',NULL,?,?,?,?)`
    ).run(mergeId,survivorId,JSON.stringify(snapshot),rationale,actor,ts);
  });
  run(); return mergeId;
}

export function reverseProsopPersonMerge(mergeId: string, actor = 'human'): void {
  const db = getDb(); const row = db.prepare("SELECT * FROM prosop_audit_log WHERE audit_id=? AND entity_kind='person_merge' AND action='merged'").get(mergeId) as Record<string, unknown> | undefined;
  if (!row) throw new Error('Fusión reversible no encontrada.');
  const snapshot = JSON.parse(String(row.after_json)) as { survivorId: string; absorbedId: string; attestationIds: string[]; entityIds: string[]; valueStatementIds: string[] };
  const ts = now(); const run = db.transaction(() => {
    const updateAttestation = db.prepare("UPDATE prosop_name_attestations SET person_id=?,identity_status='resolved',updated_at=? WHERE attestation_id=?");
    snapshot.attestationIds.forEach((entry) => updateAttestation.run(snapshot.absorbedId,ts,entry));
    const updateEntity = db.prepare("UPDATE prosop_statement_entities SET entity_id=? WHERE id=?");
    snapshot.entityIds.forEach((entry) => updateEntity.run(snapshot.absorbedId,entry));
    const updateValue = db.prepare("UPDATE prosop_statements SET value_person_id=? WHERE statement_id=?");
    snapshot.valueStatementIds.forEach((entry) => updateValue.run(snapshot.absorbedId,entry));
    db.prepare("UPDATE prosop_person_profiles SET identity_status='resolved',updated_at=? WHERE person_id IN (?,?)").run(ts,snapshot.survivorId,snapshot.absorbedId);
    db.prepare("UPDATE prosop_audit_log SET action='reversed',reason=reason || ? WHERE audit_id=?").run(` · Revertida por ${actor}.`,mergeId);
  });
  run();
}

export function saveProsopAuthorityId(input: Omit<ProsopAuthorityId,'authorityId'|'createdAt'|'status'> & { authorityId?: string }): ProsopAuthorityId {
  if (!input.scheme.trim() || !input.externalId.trim()) throw new Error('El identificador necesita esquema y valor.');
  const authorityId = input.authorityId ?? id('pai'); const ts = now();
  getDb().prepare(
    `INSERT INTO prosop_authority_ids
     (authority_id,entity_kind,entity_id,scheme,external_id,uri,label_snapshot,status,factoid_id,created_at)
     VALUES (?,?,?,?,?,?,?,'active',?,?)
     ON CONFLICT(entity_kind,entity_id,scheme,external_id) DO UPDATE SET uri=excluded.uri,label_snapshot=excluded.label_snapshot,status='active'`
  ).run(authorityId,input.entityKind,input.entityId,input.scheme.trim(),input.externalId.trim(),input.uri,input.labelSnapshot,input.factoidId,ts);
  return getProsopIdentityWorkspace().persons.flatMap((item) => item.authorityIds).find((item) =>
    item.entityKind === input.entityKind && item.entityId === input.entityId && item.scheme === input.scheme && item.externalId === input.externalId)!;
}

export function saveProsopOrganization(input: Partial<ProsopOrganization> & { preferredName: string }): ProsopOrganization {
  if (!input.preferredName.trim()) throw new Error('La organización necesita un nombre.');
  const db = getDb(); const ts = now(); const organizationId = input.organizationId ?? id('por');
  const existing = db.prepare('SELECT created_at FROM prosop_organizations WHERE organization_id=?').get(organizationId) as { created_at: string } | undefined;
  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO prosop_organizations
       (organization_id,preferred_name,kind,date_start,date_start_sort,date_end,date_end_sort,place_id,description,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(organization_id) DO UPDATE SET preferred_name=excluded.preferred_name,kind=excluded.kind,
        date_start=excluded.date_start,date_start_sort=excluded.date_start_sort,date_end=excluded.date_end,
        date_end_sort=excluded.date_end_sort,place_id=excluded.place_id,description=excluded.description,updated_at=excluded.updated_at`
    ).run(organizationId,input.preferredName.trim(),input.kind ?? '',input.date?.display ?? null,input.date?.startSort ?? null,
      input.date?.display ?? null,input.date?.endSort ?? null,input.placeId ?? null,input.description ?? '',existing?.created_at ?? ts,ts);
    if (input.names) {
      db.prepare('DELETE FROM prosop_organization_names WHERE organization_id=?').run(organizationId);
      const insert = db.prepare('INSERT INTO prosop_organization_names (id,organization_id,name,kind,language,valid_from,valid_to) VALUES (?,?,?,?,?,?,?)');
      input.names.forEach((name) => insert.run(name.id ?? id('pon'),organizationId,name.name,name.kind,name.language,name.validFrom,name.validTo));
    }
  });
  run();
  return getProsopIdentityWorkspace().organizations.find((item) => item.organizationId === organizationId)!;
}
