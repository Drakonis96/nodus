import { v4 as uuid } from 'uuid';
import type {
  ProsopQuestionnaireDraftInput,
  ProsopQuestionnaireVersion,
  ProsopVariableRevision,
  ProsopVariableRevisionInput,
  ProsopVocabulary,
  ProsopVocabularyTerm,
} from '@shared/prosopography';
import { assertPublishedVersionImmutable, missingReasons } from '@shared/prosopography';
import { normalizeVariableKey, validateVariableDraft } from '@shared/prosopographyVariables';
import { getDb } from './database';
import { ensureProsopStudy } from './prosopStudyRepo';

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${uuid()}`;

function questionnaire(row: Record<string, unknown>): ProsopQuestionnaireVersion {
  return {
    questionnaireVersionId: String(row.questionnaire_version_id),
    studyId: String(row.study_id),
    versionNo: Number(row.version_no),
    status: row.status as ProsopQuestionnaireVersion['status'],
    title: String(row.title),
    changeSummary: String(row.change_summary ?? ''),
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    publishedAt: row.published_at == null ? null : String(row.published_at),
  };
}

function revision(row: Record<string, unknown>): ProsopVariableRevision {
  return {
    revisionId: String(row.revision_id),
    variableId: String(row.variable_id),
    questionnaireVersionId: String(row.questionnaire_version_id),
    label: String(row.label),
    question: String(row.question),
    description: String(row.description ?? ''),
    valueType: row.value_type as ProsopVariableRevision['valueType'],
    cardinality: row.cardinality as ProsopVariableRevision['cardinality'],
    unit: row.unit == null ? null : String(row.unit),
    vocabularyId: row.vocabulary_id == null ? null : String(row.vocabulary_id),
    applicability: row.applicability_json ? JSON.parse(String(row.applicability_json)) : null,
    missingReasons: JSON.parse(String(row.missing_reasons_json ?? '[]')),
    analysisPolicy: JSON.parse(String(row.analysis_policy_json ?? '{}')),
    sensitivity: row.sensitivity as ProsopVariableRevision['sensitivity'],
    instructions: String(row.instructions ?? ''),
    examples: JSON.parse(String(row.examples_json ?? '[]')),
    position: Number(row.position ?? 0),
    createdAt: String(row.created_at),
  };
}

export function listProsopQuestionnaires(studyId = ensureProsopStudy().studyId): ProsopQuestionnaireVersion[] {
  return (getDb().prepare('SELECT * FROM prosop_questionnaire_versions WHERE study_id=? ORDER BY version_no DESC').all(studyId) as Record<string, unknown>[])
    .map(questionnaire);
}

export function listProsopVariableRevisions(questionnaireVersionId: string): ProsopVariableRevision[] {
  return (getDb().prepare('SELECT * FROM prosop_variable_revisions WHERE questionnaire_version_id=? ORDER BY position, created_at').all(questionnaireVersionId) as Record<string, unknown>[])
    .map(revision);
}

export function createProsopQuestionnaireDraft(input: ProsopQuestionnaireDraftInput): ProsopQuestionnaireVersion {
  const study = ensureProsopStudy();
  const versions = listProsopQuestionnaires(study.studyId);
  const draft = versions.find((item) => item.status === 'draft');
  if (draft) return draft;
  const latest = versions[0];
  const versionId = id('pqv');
  const ts = now();
  getDb().prepare(
    `INSERT INTO prosop_questionnaire_versions
     (questionnaire_version_id, study_id, version_no, status, title, change_summary, created_by, created_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)`
  ).run(versionId, study.studyId, (latest?.versionNo ?? 0) + 1, input.title.trim() || 'Cuestionario', input.changeSummary ?? '', input.createdBy ?? 'human', ts);
  if (latest) {
    const db = getDb();
    const insert = db.prepare(
      `INSERT INTO prosop_variable_revisions
       (revision_id, variable_id, questionnaire_version_id, label, question, description,
        value_type, cardinality, unit, vocabulary_id, applicability_json, missing_reasons_json,
        analysis_policy_json, sensitivity, instructions, examples_json, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const item of listProsopVariableRevisions(latest.questionnaireVersionId)) {
      insert.run(
        id('pvr'), item.variableId, versionId, item.label, item.question, item.description,
        item.valueType, item.cardinality, item.unit, item.vocabularyId,
        item.applicability ? JSON.stringify(item.applicability) : null,
        JSON.stringify(item.missingReasons), JSON.stringify(item.analysisPolicy), item.sensitivity,
        item.instructions, JSON.stringify(item.examples), item.position, ts
      );
    }
  }
  return listProsopQuestionnaires(study.studyId).find((item) => item.questionnaireVersionId === versionId)!;
}

export function saveProsopVariableRevision(questionnaireVersionId: string, input: ProsopVariableRevisionInput): ProsopVariableRevision {
  const version = listProsopQuestionnaires().find((item) => item.questionnaireVersionId === questionnaireVersionId);
  if (!version) throw new Error('Versión de cuestionario no encontrada.');
  assertPublishedVersionImmutable(version.status);
  const errors = validateVariableDraft({
    key: input.key, label: input.label, question: input.question, valueType: input.valueType,
    cardinality: input.cardinality ?? 'one', unit: input.unit, vocabularyId: input.vocabularyId,
    missingReasons: input.missingReasons, sensitivity: input.sensitivity,
  });
  if (errors.length) throw new Error(errors.join(' '));
  const db = getDb();
  const study = ensureProsopStudy();
  const ts = now();
  const key = normalizeVariableKey(input.key || input.label);
  let variableId = input.variableId;
  const run = db.transaction(() => {
    if (!variableId) {
      const existing = db.prepare('SELECT variable_id FROM prosop_variables WHERE study_id=? AND key=?').get(study.studyId, key) as { variable_id: string } | undefined;
      variableId = existing?.variable_id ?? id('pva');
      if (!existing) db.prepare('INSERT INTO prosop_variables (variable_id, study_id, key, created_at) VALUES (?, ?, ?, ?)').run(variableId, study.studyId, key, ts);
    }
    const existingRevision = db.prepare('SELECT revision_id FROM prosop_variable_revisions WHERE variable_id=? AND questionnaire_version_id=?').get(variableId, questionnaireVersionId) as { revision_id: string } | undefined;
    const revisionId = existingRevision?.revision_id ?? id('pvr');
    db.prepare(
      `INSERT INTO prosop_variable_revisions
       (revision_id, variable_id, questionnaire_version_id, label, question, description,
        value_type, cardinality, unit, vocabulary_id, applicability_json, missing_reasons_json,
        analysis_policy_json, sensitivity, instructions, examples_json, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(variable_id, questionnaire_version_id) DO UPDATE SET
        label=excluded.label, question=excluded.question, description=excluded.description,
        value_type=excluded.value_type, cardinality=excluded.cardinality, unit=excluded.unit,
        vocabulary_id=excluded.vocabulary_id, applicability_json=excluded.applicability_json,
        missing_reasons_json=excluded.missing_reasons_json, analysis_policy_json=excluded.analysis_policy_json,
        sensitivity=excluded.sensitivity, instructions=excluded.instructions,
        examples_json=excluded.examples_json, position=excluded.position`
    ).run(
      revisionId, variableId, questionnaireVersionId, input.label.trim(), input.question.trim(),
      input.description ?? '', input.valueType, input.cardinality ?? 'one', input.unit ?? null,
      input.vocabularyId ?? null, input.applicability ? JSON.stringify(input.applicability) : null,
      JSON.stringify(input.missingReasons ?? missingReasons),
      JSON.stringify(input.analysisPolicy ?? { multivalue: 'preferred_resolution', missing: 'include_reason' }),
      input.sensitivity ?? 'ordinary', input.instructions ?? '', JSON.stringify(input.examples ?? []),
      input.position ?? listProsopVariableRevisions(questionnaireVersionId).length, ts
    );
  });
  run();
  return listProsopVariableRevisions(questionnaireVersionId).find((item) => item.variableId === variableId)!;
}

export function deleteProsopVariableRevision(questionnaireVersionId: string, variableId: string): void {
  const version = listProsopQuestionnaires().find((item) => item.questionnaireVersionId === questionnaireVersionId);
  if (!version) throw new Error('Versión de cuestionario no encontrada.');
  assertPublishedVersionImmutable(version.status);
  getDb().prepare('DELETE FROM prosop_variable_revisions WHERE questionnaire_version_id=? AND variable_id=?').run(questionnaireVersionId, variableId);
}

export function publishProsopQuestionnaire(questionnaireVersionId: string, changeSummary: string, actor = 'human'): ProsopQuestionnaireVersion {
  const study = ensureProsopStudy();
  const version = listProsopQuestionnaires(study.studyId).find((item) => item.questionnaireVersionId === questionnaireVersionId);
  if (!version || version.status !== 'draft') throw new Error('Solo se puede publicar un borrador de cuestionario.');
  if (!listProsopVariableRevisions(questionnaireVersionId).length) throw new Error('Añade al menos una variable antes de publicar.');
  const db = getDb();
  const ts = now();
  const run = db.transaction(() => {
    db.prepare("UPDATE prosop_questionnaire_versions SET status='retired' WHERE study_id=? AND status='published'").run(study.studyId);
    db.prepare("UPDATE prosop_questionnaire_versions SET status='published', change_summary=?, published_at=? WHERE questionnaire_version_id=?")
      .run(changeSummary, ts, questionnaireVersionId);
    db.prepare('UPDATE prosop_studies SET current_questionnaire_version_id=?, updated_at=? WHERE study_id=?')
      .run(questionnaireVersionId, ts, study.studyId);
    db.prepare(
      `INSERT INTO prosop_audit_log
       (audit_id, entity_kind, entity_id, action, after_json, reason, actor, created_at)
       VALUES (?, 'questionnaire', ?, 'publish', ?, ?, ?, ?)`
    ).run(id('aud'), questionnaireVersionId, JSON.stringify({ versionNo: version.versionNo }), changeSummary, actor, ts);
  });
  run();
  return listProsopQuestionnaires(study.studyId).find((item) => item.questionnaireVersionId === questionnaireVersionId)!;
}

function vocabulary(row: Record<string, unknown>): ProsopVocabulary {
  return {
    vocabularyId: String(row.vocabulary_id), studyId: String(row.study_id), name: String(row.name),
    description: String(row.description ?? ''), scopeNotes: String(row.scope_notes ?? ''),
    version: String(row.version ?? '1'), externalUri: row.external_uri == null ? null : String(row.external_uri),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function term(row: Record<string, unknown>): ProsopVocabularyTerm {
  return {
    termId: String(row.term_id), vocabularyId: String(row.vocabulary_id),
    parentTermId: row.parent_term_id == null ? null : String(row.parent_term_id), code: String(row.code),
    preferredLabel: String(row.preferred_label), definition: String(row.definition ?? ''),
    validFrom: row.valid_from == null ? null : String(row.valid_from), validTo: row.valid_to == null ? null : String(row.valid_to),
    externalUri: row.external_uri == null ? null : String(row.external_uri),
    status: row.status as ProsopVocabularyTerm['status'], position: Number(row.position ?? 0),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export function listProsopVocabularies(studyId = ensureProsopStudy().studyId): Array<ProsopVocabulary & { terms: ProsopVocabularyTerm[] }> {
  return (getDb().prepare('SELECT * FROM prosop_vocabularies WHERE study_id=? ORDER BY name').all(studyId) as Record<string, unknown>[])
    .map(vocabulary)
    .map((item) => ({
      ...item,
      terms: (getDb().prepare('SELECT * FROM prosop_vocabulary_terms WHERE vocabulary_id=? ORDER BY position, preferred_label').all(item.vocabularyId) as Record<string, unknown>[]).map(term),
    }));
}

export function saveProsopVocabulary(input: Partial<ProsopVocabulary> & { name: string }): ProsopVocabulary {
  const study = ensureProsopStudy();
  if (!input.name.trim()) throw new Error('El vocabulario necesita un nombre.');
  const ts = now();
  const vocabularyId = input.vocabularyId ?? id('pvo');
  getDb().prepare(
    `INSERT INTO prosop_vocabularies
     (vocabulary_id, study_id, name, description, scope_notes, version, external_uri, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(vocabulary_id) DO UPDATE SET name=excluded.name, description=excluded.description,
       scope_notes=excluded.scope_notes, version=excluded.version, external_uri=excluded.external_uri,
       updated_at=excluded.updated_at`
  ).run(vocabularyId, study.studyId, input.name.trim(), input.description ?? '', input.scopeNotes ?? '', input.version ?? '1', input.externalUri ?? null, input.createdAt ?? ts, ts);
  return listProsopVocabularies(study.studyId).find((item) => item.vocabularyId === vocabularyId)!;
}

export function saveProsopVocabularyTerm(input: Partial<ProsopVocabularyTerm> & { vocabularyId: string; code: string; preferredLabel: string }): ProsopVocabularyTerm {
  if (!input.code.trim() || !input.preferredLabel.trim()) throw new Error('El término necesita código y etiqueta.');
  const ts = now();
  const termId = input.termId ?? id('pvt');
  getDb().prepare(
    `INSERT INTO prosop_vocabulary_terms
     (term_id, vocabulary_id, parent_term_id, code, preferred_label, definition, valid_from,
      valid_to, external_uri, status, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(term_id) DO UPDATE SET parent_term_id=excluded.parent_term_id, code=excluded.code,
       preferred_label=excluded.preferred_label, definition=excluded.definition,
       valid_from=excluded.valid_from, valid_to=excluded.valid_to, external_uri=excluded.external_uri,
       status=excluded.status, position=excluded.position, updated_at=excluded.updated_at`
  ).run(termId, input.vocabularyId, input.parentTermId ?? null, input.code.trim(), input.preferredLabel.trim(),
    input.definition ?? '', input.validFrom ?? null, input.validTo ?? null, input.externalUri ?? null,
    input.status ?? 'active', input.position ?? 0, input.createdAt ?? ts, ts);
  return listProsopVocabularies().flatMap((item) => item.terms).find((item) => item.termId === termId)!;
}
