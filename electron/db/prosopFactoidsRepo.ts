import { v4 as uuid } from 'uuid';
import type {
  ProsopFactoid,
  ProsopFactoidDossier,
  ProsopFactoidInput,
  ProsopMissingValue,
  ProsopMissingValueInput,
  ProsopObservationsWorkspace,
  ProsopResolution,
  ProsopResolutionInput,
  ProsopStatement,
  ProsopStatementEntity,
  ProsopStatementInput,
  ProsopTypedValue,
} from '@shared/prosopography';
import { getDb } from './database';

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${uuid()}`;

function typedValue(row: Record<string, unknown>): ProsopTypedValue {
  switch (String(row.value_kind)) {
    case 'number': return { kind: 'number', number: Number(row.value_number), unit: row.unit == null ? null : String(row.unit) };
    case 'boolean': return { kind: 'boolean', boolean: Boolean(row.value_boolean) };
    case 'date': return { kind: 'date', date: {
      display: row.value_date_display == null ? null : String(row.value_date_display),
      startSort: row.value_date_start_sort == null ? null : Number(row.value_date_start_sort),
      endSort: row.value_date_end_sort == null ? null : Number(row.value_date_end_sort),
    } };
    case 'term': return { kind: 'term', termId: String(row.value_term_id), literal: String(row.literal_value || '') || null };
    case 'person': return { kind: 'person', personId: String(row.value_person_id), literal: String(row.literal_value || '') || null };
    case 'place': return { kind: 'place', placeId: String(row.value_place_id), literal: String(row.literal_value || '') || null };
    case 'organization': return { kind: 'organization', organizationId: String(row.value_organization_id), literal: String(row.literal_value || '') || null };
    case 'event': return { kind: 'event', eventId: String(row.value_event_id), literal: String(row.literal_value || '') || null };
    default: return { kind: 'text', text: String(row.value_text ?? '') };
  }
}

function statement(row: Record<string, unknown>): ProsopStatement {
  return {
    statementId: String(row.statement_id), factoidId: String(row.factoid_id),
    variableId: row.variable_id == null ? null : String(row.variable_id),
    variableRevisionId: row.variable_revision_id == null ? null : String(row.variable_revision_id),
    statementType: String(row.statement_type), literalValue: String(row.literal_value ?? ''),
    value: typedValue(row), negated: Boolean(row.negated),
    sourceModality: row.source_modality as ProsopStatement['sourceModality'],
    readingCertainty: row.reading_certainty as ProsopStatement['readingCertainty'],
    sourceAssertionCertainty: row.source_assertion_certainty as ProsopStatement['sourceAssertionCertainty'],
    interpretationCertainty: row.interpretation_certainty as ProsopStatement['interpretationCertainty'],
    temporalPrecision: row.temporal_precision == null ? null : String(row.temporal_precision),
    accuracyStatus: row.accuracy_status as ProsopStatement['accuracyStatus'],
    status: row.status as ProsopStatement['status'], createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function entity(row: Record<string, unknown>): ProsopStatementEntity {
  return { id: String(row.id), statementId: String(row.statement_id),
    entityKind: row.entity_kind as ProsopStatementEntity['entityKind'], entityId: String(row.entity_id),
    role: String(row.role), position: Number(row.position) };
}

function factoid(row: Record<string, unknown>): ProsopFactoid {
  return {
    factoidId: String(row.factoid_id), sourceId: String(row.source_id), sourceSegmentId: String(row.source_segment_id),
    captureRowId: row.capture_row_id == null ? null : String(row.capture_row_id), factoidKind: String(row.factoid_kind),
    summary: String(row.summary ?? ''), status: row.status as ProsopFactoid['status'],
    extractionCertainty: row.extraction_certainty as ProsopFactoid['extractionCertainty'],
    createdBy: String(row.created_by), createdAt: String(row.created_at),
    reviewedBy: row.reviewed_by == null ? null : String(row.reviewed_by),
    reviewedAt: row.reviewed_at == null ? null : String(row.reviewed_at), updatedAt: String(row.updated_at),
  };
}

function missing(row: Record<string, unknown>): ProsopMissingValue {
  return {
    missingId: String(row.missing_id), personId: String(row.person_id), variableId: String(row.variable_id),
    questionnaireVersionId: String(row.questionnaire_version_id), reason: row.reason as ProsopMissingValue['reason'],
    sourceScope: JSON.parse(String(row.source_scope_json ?? '{}')), note: String(row.note ?? ''),
    status: row.status as ProsopMissingValue['status'], createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function resolution(row: Record<string, unknown>, statementIds: string[]): ProsopResolution {
  return {
    resolutionId: String(row.resolution_id), personId: String(row.person_id), variableId: String(row.variable_id),
    resolutionKind: row.resolution_kind as ProsopResolution['resolutionKind'],
    resolvedValue: row.resolved_value_json == null ? null : JSON.parse(String(row.resolved_value_json)),
    statementIds, rationale: String(row.rationale ?? ''), status: row.status as ProsopResolution['status'],
    createdBy: String(row.created_by), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export function getProsopObservationsWorkspace(): ProsopObservationsWorkspace {
  const db = getDb();
  const factoids = (db.prepare(
    `SELECT f.*,s.title AS source_title,g.locator_display,g.quoted_text
     FROM prosop_factoids f JOIN prosop_sources s ON s.source_id=f.source_id
     JOIN prosop_source_segments g ON g.segment_id=f.source_segment_id
     ORDER BY f.created_at DESC`
  ).all() as Record<string, unknown>[]).map((row): ProsopFactoidDossier => {
    const item = factoid(row);
    const statements = (db.prepare('SELECT * FROM prosop_statements WHERE factoid_id=? ORDER BY created_at').all(item.factoidId) as Record<string, unknown>[])
      .map(statement).map((value) => ({ ...value, entities: (db.prepare('SELECT * FROM prosop_statement_entities WHERE statement_id=? ORDER BY position').all(value.statementId) as Record<string, unknown>[]).map(entity) }));
    return { ...item, sourceTitle: String(row.source_title), locatorDisplay: String(row.locator_display),
      quotedText: String(row.quoted_text ?? ''), statements };
  });
  const missingValues = (db.prepare('SELECT * FROM prosop_missing_values ORDER BY created_at DESC').all() as Record<string, unknown>[]).map(missing);
  const resolutions = (db.prepare('SELECT * FROM prosop_resolutions ORDER BY created_at DESC').all() as Record<string, unknown>[]).map((row) => resolution(
    row,
    (db.prepare('SELECT statement_id FROM prosop_resolution_statements WHERE resolution_id=? ORDER BY statement_id').all(String(row.resolution_id)) as Array<{ statement_id: string }>).map((item) => item.statement_id),
  ));
  return { factoids, missingValues, resolutions };
}

function valueColumns(value: ProsopTypedValue): Array<unknown> {
  const columns: Record<string, unknown> = {
    text: null, number: null, boolean: null, dateDisplay: null, dateStart: null, dateEnd: null,
    term: null, person: null, place: null, organization: null, event: null, unit: null,
  };
  if (value.kind === 'text') columns.text = value.text;
  if (value.kind === 'number') { columns.number = value.number; columns.unit = value.unit; }
  if (value.kind === 'boolean') columns.boolean = value.boolean ? 1 : 0;
  if (value.kind === 'date') { columns.dateDisplay = value.date.display; columns.dateStart = value.date.startSort; columns.dateEnd = value.date.endSort; }
  if (value.kind === 'term') columns.term = value.termId;
  if (value.kind === 'person') columns.person = value.personId;
  if (value.kind === 'place') columns.place = value.placeId;
  if (value.kind === 'organization') columns.organization = value.organizationId;
  if (value.kind === 'event') columns.event = value.eventId;
  return [columns.text, columns.number, columns.boolean, columns.dateDisplay, columns.dateStart, columns.dateEnd,
    columns.term, columns.person, columns.place, columns.organization, columns.event, columns.unit];
}

function validateStatement(input: ProsopStatementInput): void {
  if (!input.statementType.trim()) throw new Error('La observación necesita un tipo.');
  if (!input.literalValue.trim()) throw new Error('Conserva el valor literal de la fuente.');
  if (!input.value || !['text','number','boolean','date','term','person','place','organization','event'].includes(input.value.kind)) {
    throw new Error('La observación necesita exactamente un valor tipado.');
  }
}

export function saveProsopFactoid(input: ProsopFactoidInput): ProsopFactoidDossier {
  if (!input.sourceId || !input.sourceSegmentId) throw new Error('Toda observación necesita fuente y segmento.');
  if (!input.factoidKind.trim()) throw new Error('El pasaje necesita un tipo.');
  if (!input.statements.length) throw new Error('El pasaje necesita al menos una observación.');
  input.statements.forEach(validateStatement);
  const db = getDb();
  const segment = db.prepare('SELECT source_id FROM prosop_source_segments WHERE segment_id=?').get(input.sourceSegmentId) as { source_id: string } | undefined;
  if (!segment || segment.source_id !== input.sourceId) throw new Error('El segmento no pertenece a la fuente seleccionada.');
  const ts = now(); const factoidId = input.factoidId ?? id('pfc');
  const existing = db.prepare('SELECT created_at,created_by FROM prosop_factoids WHERE factoid_id=?').get(factoidId) as { created_at: string; created_by: string } | undefined;
  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO prosop_factoids
       (factoid_id,source_id,source_segment_id,capture_row_id,factoid_kind,summary,status,extraction_certainty,
        created_by,created_at,reviewed_by,reviewed_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(factoid_id) DO UPDATE SET source_id=excluded.source_id,source_segment_id=excluded.source_segment_id,
        capture_row_id=excluded.capture_row_id,factoid_kind=excluded.factoid_kind,summary=excluded.summary,
        status=excluded.status,extraction_certainty=excluded.extraction_certainty,
        reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,updated_at=excluded.updated_at`
    ).run(factoidId,input.sourceId,input.sourceSegmentId,input.captureRowId ?? null,input.factoidKind.trim(),input.summary ?? '',
      input.status ?? 'draft',input.extractionCertainty ?? 'unknown',existing?.created_by ?? input.createdBy ?? 'human',
      existing?.created_at ?? ts,input.reviewedBy ?? null,input.status === 'reviewed' ? ts : null,ts);
    const oldIds = (db.prepare('SELECT statement_id FROM prosop_statements WHERE factoid_id=?').all(factoidId) as Array<{ statement_id: string }>).map((row) => row.statement_id);
    for (const statementId of oldIds) db.prepare('DELETE FROM prosop_statement_entities WHERE statement_id=?').run(statementId);
    db.prepare('DELETE FROM prosop_statements WHERE factoid_id=?').run(factoidId);
    const insertStatement = db.prepare(
      `INSERT INTO prosop_statements
       (statement_id,factoid_id,variable_id,variable_revision_id,statement_type,value_kind,literal_value,
        value_text,value_number,value_boolean,value_date_display,value_date_start_sort,value_date_end_sort,
        value_term_id,value_person_id,value_place_id,value_organization_id,value_event_id,unit,negated,
        source_modality,reading_certainty,source_assertion_certainty,interpretation_certainty,temporal_precision,
        accuracy_status,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    for (const item of input.statements) {
      const statementId = item.statementId ?? id('pst'); const values = valueColumns(item.value);
      insertStatement.run(statementId,factoidId,item.variableId ?? null,item.variableRevisionId ?? null,item.statementType.trim(),
        item.value.kind,item.literalValue,...values,item.negated ? 1 : 0,item.sourceModality ?? 'asserted',
        item.readingCertainty ?? 'unknown',item.sourceAssertionCertainty ?? 'unknown',
        item.interpretationCertainty ?? 'unknown',item.temporalPrecision ?? null,item.accuracyStatus ?? 'unassessed',
        item.status ?? (input.status === 'reviewed' ? 'reviewed' : 'draft'),ts,ts);
      (item.entities ?? []).forEach((entry, position) => db.prepare(
        'INSERT INTO prosop_statement_entities (id,statement_id,entity_kind,entity_id,role,position) VALUES (?,?,?,?,?,?)'
      ).run(entry.id ?? id('pse'),statementId,entry.entityKind,entry.entityId,entry.role,entry.position ?? position));
    }
    db.prepare(
      `INSERT INTO prosop_audit_log (audit_id,entity_kind,entity_id,action,before_json,after_json,reason,actor,created_at)
       VALUES (?,?,?,?,NULL,?,?,?,?)`
    ).run(id('pau'),'factoid',factoidId,existing ? 'updated' : 'created',
      JSON.stringify({ sourceId: input.sourceId, statementCount: input.statements.length }),
      existing ? 'Edición del pasaje y sus afirmaciones.' : 'Creación de pasaje documentado.',input.createdBy ?? 'human',ts);
  });
  run();
  return getProsopObservationsWorkspace().factoids.find((item) => item.factoidId === factoidId)!;
}

export function reviewProsopFactoid(factoidId: string, status: 'reviewed' | 'rejected', reviewedBy = 'human'): ProsopFactoidDossier {
  const db = getDb(); const ts = now();
  const count = Number((db.prepare('SELECT COUNT(*) AS c FROM prosop_statements WHERE factoid_id=?').get(factoidId) as { c: number }).c);
  if (!count) throw new Error('No se puede revisar un pasaje sin observaciones.');
  const run = db.transaction(() => {
    db.prepare('UPDATE prosop_factoids SET status=?,reviewed_by=?,reviewed_at=?,updated_at=? WHERE factoid_id=?').run(status,reviewedBy,ts,ts,factoidId);
    db.prepare('UPDATE prosop_statements SET status=?,updated_at=? WHERE factoid_id=? AND status NOT IN (\'rejected\',\'superseded\')').run(status,ts,factoidId);
  });
  run();
  const item = getProsopObservationsWorkspace().factoids.find((entry) => entry.factoidId === factoidId);
  if (!item) throw new Error('Pasaje no encontrado.');
  return item;
}

export function saveProsopMissingValue(input: ProsopMissingValueInput): ProsopMissingValue {
  const ts = now(); const missingId = input.missingId ?? id('pmv');
  getDb().prepare(
    `INSERT INTO prosop_missing_values
     (missing_id,person_id,variable_id,questionnaire_version_id,reason,source_scope_json,note,status,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,'active',?,?)
     ON CONFLICT(person_id,variable_id,questionnaire_version_id) DO UPDATE SET
      reason=excluded.reason,source_scope_json=excluded.source_scope_json,note=excluded.note,status='active',updated_at=excluded.updated_at`
  ).run(missingId,input.personId,input.variableId,input.questionnaireVersionId,input.reason,JSON.stringify(input.sourceScope ?? {}),input.note ?? '',ts,ts);
  return getProsopObservationsWorkspace().missingValues.find((item) =>
    item.personId === input.personId && item.variableId === input.variableId && item.questionnaireVersionId === input.questionnaireVersionId)!;
}

export function saveProsopResolution(input: ProsopResolutionInput): ProsopResolution {
  if (!input.rationale.trim()) throw new Error('La resolución necesita una justificación.');
  if (!input.statementIds.length) throw new Error('La resolución debe citar al menos una observación.');
  const db = getDb(); const ts = now(); const resolutionId = input.resolutionId ?? id('prs');
  const existing = db.prepare('SELECT created_at,created_by FROM prosop_resolutions WHERE resolution_id=?').get(resolutionId) as { created_at: string; created_by: string } | undefined;
  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO prosop_resolutions
       (resolution_id,person_id,variable_id,resolution_kind,resolved_value_json,rationale,status,created_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(resolution_id) DO UPDATE SET resolution_kind=excluded.resolution_kind,
        resolved_value_json=excluded.resolved_value_json,rationale=excluded.rationale,status=excluded.status,updated_at=excluded.updated_at`
    ).run(resolutionId,input.personId,input.variableId,input.resolutionKind,
      input.resolvedValue === undefined ? null : JSON.stringify(input.resolvedValue),input.rationale.trim(),
      input.status ?? 'draft',existing?.created_by ?? input.createdBy ?? 'human',existing?.created_at ?? ts,ts);
    db.prepare('DELETE FROM prosop_resolution_statements WHERE resolution_id=?').run(resolutionId);
    const insert = db.prepare('INSERT INTO prosop_resolution_statements (resolution_id,statement_id,role) VALUES (?,?,?)');
    input.statementIds.forEach((statementId) => insert.run(resolutionId,statementId,'considered'));
  });
  run();
  return getProsopObservationsWorkspace().resolutions.find((item) => item.resolutionId === resolutionId)!;
}

export function retireProsopResolution(resolutionId: string): void {
  getDb().prepare("UPDATE prosop_resolutions SET status='retired',updated_at=? WHERE resolution_id=?").run(now(),resolutionId);
}
