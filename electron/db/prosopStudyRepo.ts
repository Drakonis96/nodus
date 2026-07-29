import { v4 as uuid } from 'uuid';
import type {
  ProsopCriterionInput,
  ProsopMethodologyVersion,
  ProsopPopulationCriterion,
  ProsopStudy,
  ProsopStudyInput,
} from '@shared/prosopography';
import { assertPublishedVersionImmutable } from '@shared/prosopography';
import { getDb } from './database';

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${uuid()}`;

function studyFromRow(row: Record<string, unknown>): ProsopStudy {
  return {
    studyId: String(row.study_id),
    title: String(row.title),
    researchQuestion: String(row.research_question ?? ''),
    description: String(row.description ?? ''),
    unitOfAnalysis: (row.unit_of_analysis as ProsopStudy['unitOfAnalysis']) ?? 'person',
    temporalScope: String(row.temporal_scope ?? ''),
    dateStartSort: row.date_start_sort == null ? null : Number(row.date_start_sort),
    dateEndSort: row.date_end_sort == null ? null : Number(row.date_end_sort),
    geographicScope: String(row.geographic_scope ?? ''),
    populationDefinition: String(row.population_definition ?? ''),
    samplingStrategy: String(row.sampling_strategy ?? ''),
    expectedPopulation: row.expected_population == null ? null : Number(row.expected_population),
    sourceStrategy: String(row.source_strategy ?? ''),
    knownBiases: String(row.known_biases ?? ''),
    livingPeoplePolicy: (row.living_people_policy as ProsopStudy['livingPeoplePolicy']) ?? 'restricted',
    currentMethodologyVersionId: row.current_methodology_version_id == null ? null : String(row.current_methodology_version_id),
    currentQuestionnaireVersionId: row.current_questionnaire_version_id == null ? null : String(row.current_questionnaire_version_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function methodologyFromRow(row: Record<string, unknown>): ProsopMethodologyVersion {
  return {
    versionId: String(row.version_id),
    studyId: String(row.study_id),
    versionNo: Number(row.version_no),
    status: row.status as ProsopMethodologyVersion['status'],
    changeSummary: String(row.change_summary ?? ''),
    populationDefinition: String(row.population_definition ?? ''),
    samplingStrategy: String(row.sampling_strategy ?? ''),
    sourceStrategy: String(row.source_strategy ?? ''),
    biasNotes: String(row.bias_notes ?? ''),
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    publishedAt: row.published_at == null ? null : String(row.published_at),
  };
}

function criterionFromRow(row: Record<string, unknown>): ProsopPopulationCriterion {
  return {
    criterionId: String(row.criterion_id),
    methodologyVersionId: String(row.methodology_version_id),
    kind: row.kind as ProsopPopulationCriterion['kind'],
    label: String(row.label),
    description: String(row.description ?? ''),
    rule: row.rule_json ? JSON.parse(String(row.rule_json)) : null,
    weight: Number(row.weight ?? 1),
    required: Boolean(row.required),
    position: Number(row.position ?? 0),
    createdAt: String(row.created_at),
  };
}

export function getProsopStudy(): ProsopStudy | null {
  const row = getDb().prepare('SELECT * FROM prosop_studies ORDER BY created_at LIMIT 1').get() as Record<string, unknown> | undefined;
  return row ? studyFromRow(row) : null;
}

export function ensureProsopStudy(input: ProsopStudyInput = {}): ProsopStudy {
  const existing = getProsopStudy();
  if (existing) return existing;
  const ts = now();
  const studyId = id('pst');
  getDb().prepare(
    `INSERT INTO prosop_studies
      (study_id, title, research_question, description, unit_of_analysis, temporal_scope,
       date_start_sort, date_end_sort, geographic_scope, population_definition,
       sampling_strategy, expected_population, source_strategy, known_biases,
       living_people_policy, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    studyId, input.title?.trim() || 'Estudio prosopográfico', input.researchQuestion ?? '',
    input.description ?? '', input.unitOfAnalysis ?? 'person', input.temporalScope ?? '',
    input.dateStartSort ?? null, input.dateEndSort ?? null, input.geographicScope ?? '',
    input.populationDefinition ?? '', input.samplingStrategy ?? '', input.expectedPopulation ?? null,
    input.sourceStrategy ?? '', input.knownBiases ?? '', input.livingPeoplePolicy ?? 'restricted', ts, ts
  );
  return getProsopStudy()!;
}

export function updateProsopStudy(patch: ProsopStudyInput, actor = 'human'): ProsopStudy {
  const current = ensureProsopStudy();
  const next = { ...current, ...patch, title: patch.title?.trim() || current.title, updatedAt: now() };
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare(
      `UPDATE prosop_studies SET title=?, research_question=?, description=?, unit_of_analysis=?,
       temporal_scope=?, date_start_sort=?, date_end_sort=?, geographic_scope=?,
       population_definition=?, sampling_strategy=?, expected_population=?, source_strategy=?,
       known_biases=?, living_people_policy=?, updated_at=? WHERE study_id=?`
    ).run(
      next.title, next.researchQuestion, next.description, next.unitOfAnalysis, next.temporalScope,
      next.dateStartSort, next.dateEndSort, next.geographicScope, next.populationDefinition,
      next.samplingStrategy, next.expectedPopulation, next.sourceStrategy, next.knownBiases,
      next.livingPeoplePolicy, next.updatedAt, current.studyId
    );
    db.prepare(
      `INSERT INTO prosop_audit_log
       (audit_id, entity_kind, entity_id, action, before_json, after_json, reason, actor, created_at)
       VALUES (?, 'study', ?, 'update', ?, ?, '', ?, ?)`
    ).run(id('aud'), current.studyId, JSON.stringify(current), JSON.stringify(next), actor, next.updatedAt);
  });
  run();
  return getProsopStudy()!;
}

export function listProsopMethodologies(studyId = ensureProsopStudy().studyId): ProsopMethodologyVersion[] {
  return (getDb().prepare('SELECT * FROM prosop_methodology_versions WHERE study_id=? ORDER BY version_no DESC').all(studyId) as Record<string, unknown>[])
    .map(methodologyFromRow);
}

export function getProsopCriteria(versionId: string): ProsopPopulationCriterion[] {
  return (getDb().prepare('SELECT * FROM prosop_population_criteria WHERE methodology_version_id=? ORDER BY position, created_at').all(versionId) as Record<string, unknown>[])
    .map(criterionFromRow);
}

export function createProsopMethodologyDraft(actor = 'human'): ProsopMethodologyVersion {
  const study = ensureProsopStudy();
  const existingDraft = listProsopMethodologies(study.studyId).find((item) => item.status === 'draft');
  if (existingDraft) return existingDraft;
  const latest = listProsopMethodologies(study.studyId)[0];
  const versionId = id('pmv');
  const ts = now();
  const versionNo = (latest?.versionNo ?? 0) + 1;
  getDb().prepare(
    `INSERT INTO prosop_methodology_versions
     (version_id, study_id, version_no, status, change_summary, population_definition,
      sampling_strategy, source_strategy, bias_notes, created_by, created_at)
     VALUES (?, ?, ?, 'draft', '', ?, ?, ?, ?, ?, ?)`
  ).run(
    versionId, study.studyId, versionNo, study.populationDefinition, study.samplingStrategy,
    study.sourceStrategy, study.knownBiases, actor, ts
  );
  if (latest) {
    const insert = getDb().prepare(
      `INSERT INTO prosop_population_criteria
       (criterion_id, methodology_version_id, kind, label, description, rule_json, weight, required, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const criterion of getProsopCriteria(latest.versionId)) {
      insert.run(id('pcr'), versionId, criterion.kind, criterion.label, criterion.description,
        criterion.rule ? JSON.stringify(criterion.rule) : null, criterion.weight, criterion.required ? 1 : 0,
        criterion.position, ts);
    }
  }
  return listProsopMethodologies(study.studyId).find((item) => item.versionId === versionId)!;
}

export function replaceProsopCriteria(versionId: string, criteria: ProsopCriterionInput[]): ProsopPopulationCriterion[] {
  const version = listProsopMethodologies().find((item) => item.versionId === versionId);
  if (!version) throw new Error('Versión metodológica no encontrada.');
  assertPublishedVersionImmutable(version.status);
  const db = getDb();
  const ts = now();
  const run = db.transaction(() => {
    db.prepare('DELETE FROM prosop_population_criteria WHERE methodology_version_id=?').run(versionId);
    const insert = db.prepare(
      `INSERT INTO prosop_population_criteria
       (criterion_id, methodology_version_id, kind, label, description, rule_json, weight, required, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    criteria.forEach((criterion, position) => {
      if (!criterion.label.trim()) throw new Error('Cada criterio necesita una etiqueta.');
      insert.run(
        criterion.criterionId ?? id('pcr'), versionId, criterion.kind, criterion.label.trim(),
        criterion.description ?? '', criterion.rule ? JSON.stringify(criterion.rule) : null,
        criterion.weight ?? 1, criterion.required ? 1 : 0, criterion.position ?? position, ts
      );
    });
  });
  run();
  return getProsopCriteria(versionId);
}

export function publishProsopMethodology(versionId: string, changeSummary: string, actor = 'human'): ProsopMethodologyVersion {
  const study = ensureProsopStudy();
  const version = listProsopMethodologies(study.studyId).find((item) => item.versionId === versionId);
  if (!version) throw new Error('Versión metodológica no encontrada.');
  if (version.status !== 'draft') throw new Error('Solo se puede publicar un borrador.');
  const criteria = getProsopCriteria(versionId);
  if (!version.populationDefinition.trim() && !study.populationDefinition.trim()) throw new Error('Define la población antes de publicar.');
  if (!criteria.some((item) => item.kind === 'include')) throw new Error('Añade al menos un criterio de inclusión.');
  const ts = now();
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare("UPDATE prosop_methodology_versions SET status='retired' WHERE study_id=? AND status='published'").run(study.studyId);
    db.prepare(
      `UPDATE prosop_methodology_versions SET status='published', change_summary=?,
       population_definition=?, sampling_strategy=?, source_strategy=?, bias_notes=?,
       published_at=? WHERE version_id=?`
    ).run(
      changeSummary, study.populationDefinition, study.samplingStrategy, study.sourceStrategy,
      study.knownBiases, ts, versionId
    );
    db.prepare('UPDATE prosop_studies SET current_methodology_version_id=?, updated_at=? WHERE study_id=?')
      .run(versionId, ts, study.studyId);
    db.prepare(
      `INSERT INTO prosop_audit_log
       (audit_id, entity_kind, entity_id, action, after_json, reason, actor, created_at)
       VALUES (?, 'methodology', ?, 'publish', ?, ?, ?, ?)`
    ).run(id('aud'), versionId, JSON.stringify({ versionNo: version.versionNo }), changeSummary, actor, ts);
  });
  run();
  return listProsopMethodologies(study.studyId).find((item) => item.versionId === versionId)!;
}
