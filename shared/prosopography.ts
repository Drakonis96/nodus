/**
 * Canonical, renderer-independent contract for a prosopographical vault.
 *
 * UI copy deliberately says "observación"; `factoid` and `statement` remain the
 * technical names because they describe two different provenance-bearing layers.
 * This module has no Electron or Node dependency so imports, IPC and the renderer
 * all validate the same rules.
 */

export const PROSOP_SCHEMA_VERSION = 1;
export const PROSOP_ENGINE_VERSION = '1.0.0';

export type ProsopId = string;
export type IsoDateTime = string;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const methodologyStatuses = ['draft', 'published', 'retired'] as const;
export type ProsopVersionStatus = (typeof methodologyStatuses)[number];
export const criterionKinds = ['include', 'exclude', 'supporting'] as const;
export type PopulationCriterionKind = (typeof criterionKinds)[number];
export const membershipStatuses = ['candidate', 'included', 'excluded', 'uncertain'] as const;
export type PopulationMembershipStatus = (typeof membershipStatuses)[number];
export const assessmentResults = ['met', 'not_met', 'unknown', 'not_applicable'] as const;
export type CriterionAssessmentResult = (typeof assessmentResults)[number];
export const valueKinds = ['text', 'number', 'boolean', 'date', 'term', 'person', 'place', 'organization', 'event'] as const;
export type ProsopValueKind = (typeof valueKinds)[number];
export const cardinalities = ['one', 'many'] as const;
export type ProsopCardinality = (typeof cardinalities)[number];
export const sensitivities = ['ordinary', 'sensitive', 'restricted'] as const;
export type ProsopSensitivity = (typeof sensitivities)[number];
export const factoidStatuses = ['draft', 'proposed', 'reviewed', 'rejected', 'superseded'] as const;
export type FactoidStatus = (typeof factoidStatuses)[number];
export const statementStatuses = ['draft', 'proposed', 'reviewed', 'rejected', 'superseded'] as const;
export type StatementStatus = (typeof statementStatuses)[number];
export const certaintyValues = ['unknown', 'low', 'medium', 'high'] as const;
export type ProsopCertainty = (typeof certaintyValues)[number];
export const accuracyStatuses = ['unassessed', 'consistent', 'disputed', 'attributed_error'] as const;
export type AccuracyStatus = (typeof accuracyStatuses)[number];
export const missingReasons = [
  'not_researched',
  'source_silent',
  'unknown_after_review',
  'illegible',
  'not_applicable',
  'restricted',
  'unresolved_contradiction',
  'variable_not_active',
] as const;
export type MissingReason = (typeof missingReasons)[number];
export const identityRelations = ['same_as', 'different_from'] as const;
export type IdentityRelation = (typeof identityRelations)[number];
export const decisionStatuses = ['pending', 'accepted', 'rejected', 'superseded'] as const;
export type DecisionStatus = (typeof decisionStatuses)[number];
export const resolutionKinds = [
  'compatible',
  'preferred',
  'contradictory',
  'evolution',
  'reading_error',
  'source_attributed_error',
  'unresolved',
] as const;
export type ResolutionKind = (typeof resolutionKinds)[number];
export const cohortKinds = ['dynamic', 'frozen'] as const;
export type CohortKind = (typeof cohortKinds)[number];
export const networkOrigins = ['explicit', 'derived', 'hypothesis'] as const;
export type NetworkOrigin = (typeof networkOrigins)[number];
export const proposalProducerKinds = ['human', 'import', 'rule', 'ai_local', 'ai_external'] as const;
export type ProposalProducerKind = (typeof proposalProducerKinds)[number];

export interface ProsopDateRange {
  display: string | null;
  startSort: number | null;
  endSort: number | null;
  precision?: 'day' | 'month' | 'year' | 'range' | 'circa' | 'before' | 'after' | 'unknown';
}

export interface ProsopStudy {
  studyId: ProsopId;
  title: string;
  researchQuestion: string;
  description: string;
  unitOfAnalysis: 'person' | 'statement' | 'event' | 'person_period';
  temporalScope: string;
  dateStartSort: number | null;
  dateEndSort: number | null;
  geographicScope: string;
  populationDefinition: string;
  samplingStrategy: string;
  expectedPopulation: number | null;
  sourceStrategy: string;
  knownBiases: string;
  livingPeoplePolicy: 'exclude' | 'restricted' | 'allow_with_consent';
  currentMethodologyVersionId: ProsopId | null;
  currentQuestionnaireVersionId: ProsopId | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type ProsopStudyInput = Partial<Omit<
  ProsopStudy,
  'studyId' | 'currentMethodologyVersionId' | 'currentQuestionnaireVersionId' | 'createdAt' | 'updatedAt'
>> & { title?: string };

export interface ProsopCriterionInput {
  criterionId?: ProsopId;
  kind: PopulationCriterionKind;
  label: string;
  description?: string;
  rule?: ProsopFilterGroup | null;
  weight?: number;
  required?: boolean;
  position?: number;
}

export interface ProsopQuestionnaireDraftInput {
  title: string;
  changeSummary?: string;
  createdBy?: string;
}

export interface ProsopVariableRevisionInput {
  variableId?: ProsopId;
  key: string;
  label: string;
  question: string;
  description?: string;
  valueType: ProsopValueKind;
  cardinality?: ProsopCardinality;
  unit?: string | null;
  vocabularyId?: ProsopId | null;
  applicability?: ProsopFilterGroup | null;
  missingReasons?: MissingReason[];
  analysisPolicy?: ProsopAnalysisPolicy;
  sensitivity?: ProsopSensitivity;
  instructions?: string;
  examples?: JsonValue[];
  position?: number;
}

export interface ProsopPopulationWorkspace {
  study: ProsopStudy;
  methodologies: Array<ProsopMethodologyVersion & { criteria: ProsopPopulationCriterion[] }>;
  questionnaires: Array<ProsopQuestionnaireVersion & { revisions: ProsopVariableRevision[] }>;
  vocabularies: Array<ProsopVocabulary & { terms: ProsopVocabularyTerm[] }>;
}

export interface ProsopMethodologyVersion {
  versionId: ProsopId;
  studyId: ProsopId;
  versionNo: number;
  status: ProsopVersionStatus;
  changeSummary: string;
  populationDefinition: string;
  samplingStrategy: string;
  sourceStrategy: string;
  biasNotes: string;
  createdBy: string;
  createdAt: IsoDateTime;
  publishedAt: IsoDateTime | null;
}

export interface ProsopPopulationCriterion {
  criterionId: ProsopId;
  methodologyVersionId: ProsopId;
  kind: PopulationCriterionKind;
  label: string;
  description: string;
  rule: ProsopFilterGroup | null;
  weight: number;
  required: boolean;
  position: number;
  createdAt: IsoDateTime;
}

export interface ProsopMembership {
  membershipId: ProsopId;
  personId: ProsopId;
  methodologyVersionId: ProsopId;
  status: PopulationMembershipStatus;
  decision: string;
  rationale: string;
  decidedBy: string | null;
  decidedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ProsopQuestionnaireVersion {
  questionnaireVersionId: ProsopId;
  studyId: ProsopId;
  versionNo: number;
  status: ProsopVersionStatus;
  title: string;
  changeSummary: string;
  createdBy: string;
  createdAt: IsoDateTime;
  publishedAt: IsoDateTime | null;
}

export interface ProsopVariable {
  variableId: ProsopId;
  studyId: ProsopId;
  key: string;
  createdAt: IsoDateTime;
  retiredAt: IsoDateTime | null;
}

export interface ProsopVariableRevision {
  revisionId: ProsopId;
  variableId: ProsopId;
  questionnaireVersionId: ProsopId;
  label: string;
  question: string;
  description: string;
  valueType: ProsopValueKind;
  cardinality: ProsopCardinality;
  unit: string | null;
  vocabularyId: ProsopId | null;
  applicability: ProsopFilterGroup | null;
  missingReasons: MissingReason[];
  analysisPolicy: ProsopAnalysisPolicy;
  sensitivity: ProsopSensitivity;
  instructions: string;
  examples: JsonValue[];
  position: number;
  createdAt: IsoDateTime;
}

export interface ProsopVocabulary {
  vocabularyId: ProsopId;
  studyId: ProsopId;
  name: string;
  description: string;
  scopeNotes: string;
  version: string;
  externalUri: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ProsopVocabularyTerm {
  termId: ProsopId;
  vocabularyId: ProsopId;
  parentTermId: ProsopId | null;
  code: string;
  preferredLabel: string;
  definition: string;
  validFrom: string | null;
  validTo: string | null;
  externalUri: string | null;
  status: 'active' | 'deprecated';
  position: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ProsopSource {
  sourceId: ProsopId;
  title: string;
  sourceKind: string;
  citation: string;
  repository: string;
  referenceCode: string;
  date: ProsopDateRange;
  description: string;
  coverageNotes: string;
  reliabilityNotes: string;
  accessStatus: 'open' | 'restricted' | 'embargoed';
  rightsNotes: string;
  targetVaultId: ProsopId | null;
  targetKind: 'archive_item' | 'work' | 'database_row' | 'external' | null;
  targetId: ProsopId | null;
  targetLabelSnapshot: string | null;
  url: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type ProsopSourceInput = Partial<Omit<ProsopSource, 'sourceId' | 'createdAt' | 'updatedAt' | 'date'>> & {
  sourceId?: ProsopId;
  title: string;
  sourceKind: string;
  date?: Partial<ProsopDateRange>;
};

export interface ProsopSourceSegment {
  segmentId: ProsopId;
  sourceId: ProsopId;
  locatorDisplay: string;
  locator: JsonValue;
  quotedText: string;
  transcriptionStatus: 'literal' | 'corrected' | 'uncertain';
  language: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type ProsopSourceSegmentInput = Partial<Omit<ProsopSourceSegment, 'segmentId' | 'createdAt' | 'updatedAt'>> & {
  segmentId?: ProsopId;
  sourceId: ProsopId;
  locatorDisplay: string;
};

export interface ProsopCaptureTemplate {
  templateId: ProsopId;
  studyId: ProsopId;
  name: string;
  sourceKind: string;
  questionnaireVersionId: ProsopId | null;
  fields: JsonValue[];
  mapping: Record<string, JsonValue>;
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ProsopCaptureBatch {
  batchId: ProsopId;
  sourceId: ProsopId | null;
  templateId: ProsopId | null;
  questionnaireVersionId: ProsopId | null;
  fileName: string;
  contentHash: string;
  status: 'staging' | 'reviewing' | 'completed' | 'cancelled';
  rowCount: number;
  acceptedCount: number;
  errorCount: number;
  createdBy: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ProsopCaptureRow {
  captureRowId: ProsopId;
  batchId: ProsopId;
  rowNo: number;
  locatorDisplay: string | null;
  raw: Record<string, JsonValue>;
  status: 'pending' | 'accepted' | 'rejected' | 'error';
  error: JsonValue | null;
  createdAt: IsoDateTime;
  reviewedAt: IsoDateTime | null;
}

export interface ProsopSourcesWorkspace {
  sources: Array<ProsopSource & { segments: ProsopSourceSegment[]; factoidCount: number }>;
  templates: ProsopCaptureTemplate[];
  batches: Array<ProsopCaptureBatch & { rows: ProsopCaptureRow[] }>;
}

export interface ProsopFactoid {
  factoidId: ProsopId;
  sourceId: ProsopId;
  sourceSegmentId: ProsopId;
  captureRowId: ProsopId | null;
  factoidKind: string;
  summary: string;
  status: FactoidStatus;
  extractionCertainty: ProsopCertainty;
  createdBy: string;
  createdAt: IsoDateTime;
  reviewedBy: string | null;
  reviewedAt: IsoDateTime | null;
  updatedAt: IsoDateTime;
}

export type ProsopTypedValue =
  | { kind: 'text'; text: string }
  | { kind: 'number'; number: number; unit: string | null }
  | { kind: 'boolean'; boolean: boolean }
  | { kind: 'date'; date: ProsopDateRange }
  | { kind: 'term'; termId: ProsopId; literal: string | null }
  | { kind: 'person'; personId: ProsopId; literal: string | null }
  | { kind: 'place'; placeId: ProsopId; literal: string | null }
  | { kind: 'organization'; organizationId: ProsopId; literal: string | null }
  | { kind: 'event'; eventId: ProsopId; literal: string | null };

export interface ProsopStatement {
  statementId: ProsopId;
  factoidId: ProsopId;
  variableId: ProsopId | null;
  variableRevisionId: ProsopId | null;
  statementType: string;
  literalValue: string;
  value: ProsopTypedValue;
  negated: boolean;
  sourceModality: 'asserted' | 'reported' | 'inferred_by_source' | 'questioned';
  readingCertainty: ProsopCertainty;
  sourceAssertionCertainty: ProsopCertainty;
  interpretationCertainty: ProsopCertainty;
  temporalPrecision: string | null;
  accuracyStatus: AccuracyStatus;
  status: StatementStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ProsopStatementEntity {
  id: ProsopId;
  statementId: ProsopId;
  entityKind: 'person' | 'place' | 'organization' | 'event' | 'term' | 'possession';
  entityId: ProsopId;
  role: string;
  position: number;
}

export interface ProsopMissingValue {
  missingId: ProsopId;
  personId: ProsopId;
  variableId: ProsopId;
  questionnaireVersionId: ProsopId;
  reason: MissingReason;
  sourceScope: JsonValue;
  note: string;
  status: 'active' | 'superseded';
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ProsopResolution {
  resolutionId: ProsopId;
  personId: ProsopId;
  variableId: ProsopId;
  resolutionKind: ResolutionKind;
  resolvedValue: ProsopTypedValue | ProsopTypedValue[] | null;
  statementIds: ProsopId[];
  rationale: string;
  status: 'draft' | 'reviewed' | 'retired';
  createdBy: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ProsopStatementInput {
  statementId?: ProsopId;
  variableId?: ProsopId | null;
  variableRevisionId?: ProsopId | null;
  statementType: string;
  literalValue: string;
  value: ProsopTypedValue;
  negated?: boolean;
  sourceModality?: ProsopStatement['sourceModality'];
  readingCertainty?: ProsopCertainty;
  sourceAssertionCertainty?: ProsopCertainty;
  interpretationCertainty?: ProsopCertainty;
  temporalPrecision?: string | null;
  accuracyStatus?: AccuracyStatus;
  status?: StatementStatus;
  entities?: Array<Omit<ProsopStatementEntity, 'id' | 'statementId'> & { id?: ProsopId }>;
}

export interface ProsopFactoidInput {
  factoidId?: ProsopId;
  sourceId: ProsopId;
  sourceSegmentId: ProsopId;
  captureRowId?: ProsopId | null;
  factoidKind: string;
  summary?: string;
  status?: FactoidStatus;
  extractionCertainty?: ProsopCertainty;
  createdBy?: string;
  reviewedBy?: string | null;
  statements: ProsopStatementInput[];
}

export interface ProsopMissingValueInput {
  missingId?: ProsopId;
  personId: ProsopId;
  variableId: ProsopId;
  questionnaireVersionId: ProsopId;
  reason: MissingReason;
  sourceScope?: JsonValue;
  note?: string;
}

export interface ProsopResolutionInput {
  resolutionId?: ProsopId;
  personId: ProsopId;
  variableId: ProsopId;
  resolutionKind: ResolutionKind;
  resolvedValue?: ProsopTypedValue | ProsopTypedValue[] | null;
  statementIds: ProsopId[];
  rationale: string;
  status?: ProsopResolution['status'];
  createdBy?: string;
}

export interface ProsopFactoidDossier extends ProsopFactoid {
  sourceTitle: string;
  locatorDisplay: string;
  quotedText: string;
  statements: Array<ProsopStatement & { entities: ProsopStatementEntity[] }>;
}

export interface ProsopObservationsWorkspace {
  factoids: ProsopFactoidDossier[];
  missingValues: ProsopMissingValue[];
  resolutions: ProsopResolution[];
}

export interface ProsopNameAttestation {
  attestationId: ProsopId;
  sourceId: ProsopId | null;
  sourceSegmentId: ProsopId | null;
  factoidId: ProsopId | null;
  literalName: string;
  normalizedSearchName: string;
  personId: ProsopId | null;
  context: string;
  roleOrTitle: string;
  language: string;
  identityStatus: 'unresolved' | 'candidate' | 'resolved';
  certainty: ProsopCertainty;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ProsopIdentityHypothesis {
  hypothesisId: ProsopId;
  leftKind: 'attestation' | 'person';
  leftId: ProsopId;
  rightKind: 'attestation' | 'person';
  rightId: ProsopId;
  relation: IdentityRelation;
  status: DecisionStatus;
  score: number | null;
  rationale: string;
  createdBy: string;
  createdAt: IsoDateTime;
  reviewedBy: string | null;
  reviewedAt: IsoDateTime | null;
}

export interface ProsopPersonProfile {
  personId: ProsopId;
  displayName: string;
  identityStatus: 'provisional' | 'resolved' | 'merged';
  reviewStatus: 'unreviewed' | 'reviewed' | 'disputed';
  preferredNameBasis: string;
  privacyStatus: 'ordinary' | 'sensitive' | 'restricted';
  birthDate: string | null;
  deathDate: string | null;
  attestations: ProsopNameAttestation[];
  authorityIds: ProsopAuthorityId[];
  statementCount: number;
  sourceCount: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ProsopAuthorityId {
  authorityId: ProsopId;
  entityKind: 'person' | 'organization' | 'place';
  entityId: ProsopId;
  scheme: string;
  externalId: string;
  uri: string | null;
  labelSnapshot: string;
  status: 'active' | 'retired';
  factoidId: ProsopId | null;
  createdAt: IsoDateTime;
}

export interface ProsopOrganization {
  organizationId: ProsopId;
  preferredName: string;
  kind: string;
  date: ProsopDateRange;
  placeId: ProsopId | null;
  description: string;
  names: Array<{ id: ProsopId; name: string; kind: string; language: string; validFrom: string | null; validTo: string | null }>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ProsopIdentityWorkspace {
  persons: ProsopPersonProfile[];
  attestations: ProsopNameAttestation[];
  hypotheses: ProsopIdentityHypothesis[];
  organizations: ProsopOrganization[];
}

export interface ProsopNameAttestationInput {
  attestationId?: ProsopId;
  sourceId?: ProsopId | null;
  sourceSegmentId?: ProsopId | null;
  factoidId?: ProsopId | null;
  literalName: string;
  personId?: ProsopId | null;
  context?: string;
  roleOrTitle?: string;
  language?: string;
  certainty?: ProsopCertainty;
}

export interface ProsopIdentityHypothesisInput {
  hypothesisId?: ProsopId;
  leftKind: ProsopIdentityHypothesis['leftKind'];
  leftId: ProsopId;
  rightKind: ProsopIdentityHypothesis['rightKind'];
  rightId: ProsopId;
  relation: IdentityRelation;
  rationale: string;
  score?: number | null;
  factoidIds?: ProsopId[];
  createdBy?: string;
}

export interface ProsopCohort {
  cohortId: ProsopId;
  studyId: ProsopId;
  name: string;
  description: string;
  kind: CohortKind;
  filter: ProsopFilterGroup;
  methodologyVersionId: ProsopId;
  questionnaireVersionId: ProsopId;
  memberIds: ProsopId[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  frozenAt: IsoDateTime | null;
}

export interface ProsopMembershipAssessment {
  assessmentId: ProsopId;
  membershipId: ProsopId;
  criterionId: ProsopId;
  result: 'met' | 'not_met' | 'unknown' | 'not_applicable';
  factoidId: ProsopId | null;
  note: string;
  createdAt: IsoDateTime;
}

export interface ProsopPopulationMembership {
  membershipId: ProsopId;
  personId: ProsopId;
  methodologyVersionId: ProsopId;
  status: PopulationMembershipStatus;
  decision: string;
  rationale: string;
  decidedBy: string | null;
  decidedAt: IsoDateTime | null;
  assessments: ProsopMembershipAssessment[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ProsopMembershipInput {
  personId: ProsopId;
  methodologyVersionId: ProsopId;
  status: PopulationMembershipStatus;
  decision: string;
  rationale: string;
  decidedBy?: string;
  assessments: Array<{
    criterionId: ProsopId;
    result: ProsopMembershipAssessment['result'];
    factoidId?: ProsopId | null;
    note?: string;
  }>;
}

export interface ProsopCohortInput {
  cohortId?: ProsopId;
  name: string;
  description?: string;
  kind: CohortKind;
  filter: ProsopFilterGroup;
  methodologyVersionId: ProsopId;
  questionnaireVersionId: ProsopId;
  memberIds?: ProsopId[];
}

export interface ProsopMembershipWorkspace {
  memberships: ProsopPopulationMembership[];
  cohorts: ProsopCohort[];
  coverage: {
    totalPersons: number;
    included: number;
    excluded: number;
    candidate: number;
    uncertain: number;
    reviewedStatements: number;
    missingValues: number;
  };
}

export type ProsopFilterOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'starts_with'
  | 'in'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'is_missing'
  | 'is_known';

export interface ProsopFilterRule {
  field: string;
  operator: ProsopFilterOperator;
  value?: JsonValue;
}

export interface ProsopFilterGroup {
  conjunction: 'and' | 'or';
  rules: Array<ProsopFilterRule | ProsopFilterGroup>;
}

export type ProsopMultivaluePolicy = 'all' | 'first_chronological' | 'last_chronological' | 'preferred_resolution' | 'explode' | 'exclude';
export type ProsopMissingPolicy = 'separate_category' | 'exclude_from_denominator' | 'include_reason' | 'error';

export interface ProsopAnalysisPolicy {
  multivalue: ProsopMultivaluePolicy;
  missing: ProsopMissingPolicy;
}

export interface ProsopProjectionDefinition {
  grain: 'person' | 'person_period' | 'statement' | 'event_participation';
  personIds: ProsopId[];
  variableIds: ProsopId[];
  questionnaireVersionId: ProsopId;
  methodologyVersionId: ProsopId;
  sourceIds: ProsopId[];
  sourceCutoff: IsoDateTime | null;
  resolutionPolicy: 'reviewed_resolutions' | 'reviewed_statements' | 'all_reviewed';
  variablePolicies: Record<ProsopId, ProsopAnalysisPolicy>;
}

export interface ProsopProjectionCell {
  values: ProsopTypedValue[];
  statementIds: ProsopId[];
  sourceIds: ProsopId[];
  missingReason: MissingReason | null;
  warning: string | null;
}

export interface ProsopProjectionRow {
  rowId: string;
  personId: ProsopId;
  period: ProsopDateRange | null;
  cells: Record<ProsopId, ProsopProjectionCell>;
}

export interface ProsopProjection {
  definition: ProsopProjectionDefinition;
  fingerprint: string;
  rows: ProsopProjectionRow[];
  populationCount: number;
  includedCount: number;
  generatedAt: IsoDateTime;
  warnings: string[];
}

export interface ProsopAnalysisDefinitionRecord {
  analysisId: ProsopId;
  title: string;
  analysisKind: 'frequency' | 'crosstab' | 'trajectory' | 'timeline' | 'map';
  cohortIds: ProsopId[];
  projection: ProsopProjectionDefinition;
  filter: JsonValue;
  questionnaireVersionId: ProsopId;
  sourceCutoff: IsoDateTime | null;
  createdBy: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ProsopAnalysisRunRecord {
  runId: ProsopId;
  analysisId: ProsopId;
  engineVersion: string;
  inputFingerprint: string;
  populationCount: number;
  includedCount: number;
  missingSummary: Record<string, number>;
  result: JsonValue;
  warnings: string[];
  createdAt: IsoDateTime;
}

export interface ProsopAnalysisWorkspace {
  definitions: Array<ProsopAnalysisDefinitionRecord & { runs: ProsopAnalysisRunRecord[] }>;
}

export interface ProsopNetworkLayer {
  layerId: ProsopId;
  studyId: ProsopId;
  name: string;
  kind: string;
  derivationRule: JsonValue | null;
  directionality: 'directed' | 'undirected';
  weightPolicy: string;
  color: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ProsopNetworkEdge {
  edgeId: ProsopId;
  layerId: ProsopId;
  sourcePersonId: ProsopId;
  targetPersonId: ProsopId;
  relationTermId: ProsopId | null;
  date: ProsopDateRange;
  weight: number;
  origin: NetworkOrigin;
  derivationFingerprint: string | null;
  status: 'active' | 'retired';
  factoidIds: ProsopId[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ProsopNetworkLayerInput {
  layerId?: ProsopId;
  name: string;
  kind: string;
  derivationRule?: JsonValue | null;
  directionality?: ProsopNetworkLayer['directionality'];
  weightPolicy?: string;
  color?: string;
}

export interface ProsopNetworkEdgeInput {
  edgeId?: ProsopId;
  layerId: ProsopId;
  sourcePersonId: ProsopId;
  targetPersonId: ProsopId;
  relationTermId?: ProsopId | null;
  date?: ProsopDateRange;
  weight?: number;
  origin: NetworkOrigin;
  derivationFingerprint?: string | null;
  factoidIds: ProsopId[];
}

export interface ProsopNetworksWorkspace {
  layers: Array<ProsopNetworkLayer & { edges: ProsopNetworkEdge[] }>;
  metrics: {
    nodeCount: number;
    edgeCount: number;
    density: number;
    components: ProsopId[][];
    degrees: Record<ProsopId, number>;
    byOrigin: Record<NetworkOrigin, number>;
  };
}

export interface ProsopProposal {
  proposalId: ProsopId;
  proposalKind: string;
  sourceId: ProsopId | null;
  sourceSegmentId: ProsopId | null;
  captureRowId: ProsopId | null;
  targetKind: string;
  targetId: ProsopId | null;
  payload: JsonValue;
  confidence: number | null;
  rationale: string;
  producerKind: ProposalProducerKind;
  producerId: string;
  questionnaireVersionId: ProsopId | null;
  status: DecisionStatus;
  createdAt: IsoDateTime;
  reviewedBy: string | null;
  reviewedAt: IsoDateTime | null;
  decisionNote: string;
}

export interface ProsopSearchHit {
  kind: 'person' | 'mention' | 'source' | 'factoid' | 'statement' | 'organization';
  id: ProsopId;
  title: string;
  subtitle: string;
  sourceId: ProsopId | null;
  factoidId: ProsopId | null;
  personId: ProsopId | null;
  deepLink: string;
}

export interface ProsopNoteLink {
  linkId: ProsopId;
  nodusId: string;
  targetKind: string;
  targetId: ProsopId;
  targetVaultId: string | null;
  relationKind: string;
  createdAt: IsoDateTime;
}

export interface ProsopInvariantIssue {
  code: string;
  entityId: string;
  message: string;
  severity: 'error' | 'warning';
}

function inSet<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

export function isProsopValueKind(value: unknown): value is ProsopValueKind {
  return inSet(value, valueKinds);
}

export function isMissingReason(value: unknown): value is MissingReason {
  return inSet(value, missingReasons);
}

export function isReviewed(status: StatementStatus | FactoidStatus): boolean {
  return status === 'reviewed';
}

export function assertPublishedVersionImmutable(status: ProsopVersionStatus): void {
  if (status === 'published') throw new Error('Una versión publicada es inmutable; crea una nueva versión.');
}

export function validateTypedValue(value: ProsopTypedValue): string[] {
  const errors: string[] = [];
  if (!isProsopValueKind(value?.kind)) return ['Tipo de valor no reconocido.'];
  switch (value.kind) {
    case 'text':
      if (!value.text.trim()) errors.push('El valor textual no puede estar vacío.');
      break;
    case 'number':
      if (!Number.isFinite(value.number)) errors.push('El valor numérico debe ser finito.');
      break;
    case 'boolean':
      if (typeof value.boolean !== 'boolean') errors.push('El valor booleano debe ser verdadero o falso.');
      break;
    case 'date':
      if (value.date.startSort != null && value.date.endSort != null && value.date.startSort > value.date.endSort) {
        errors.push('El inicio de la fecha no puede ser posterior al final.');
      }
      break;
    case 'term':
      if (!value.termId) errors.push('El término normalizado necesita un identificador.');
      break;
    case 'person':
      if (!value.personId) errors.push('La persona necesita un identificador.');
      break;
    case 'place':
      if (!value.placeId) errors.push('El lugar necesita un identificador.');
      break;
    case 'organization':
      if (!value.organizationId) errors.push('La organización necesita un identificador.');
      break;
    case 'event':
      if (!value.eventId) errors.push('El evento necesita un identificador.');
      break;
  }
  return errors;
}

export function validateStatement(statement: ProsopStatement, factoid?: ProsopFactoid): string[] {
  const errors = validateTypedValue(statement.value);
  if (!statement.factoidId) errors.push('Toda afirmación necesita una observación de origen.');
  if (statement.status === 'reviewed' && (!factoid || factoid.factoidId !== statement.factoidId)) {
    errors.push('Una afirmación revisada necesita una observación existente.');
  }
  if (statement.value.kind === 'term' && !statement.literalValue.trim() && !statement.value.literal?.trim()) {
    errors.push('Normalizar un término no puede borrar la forma literal.');
  }
  return errors;
}

export function validateFactoid(factoid: ProsopFactoid, source?: ProsopSource, segment?: ProsopSourceSegment): string[] {
  const errors: string[] = [];
  if (factoid.status === 'reviewed') {
    if (!source || source.sourceId !== factoid.sourceId) errors.push('Una observación revisada necesita una fuente existente.');
    if (!segment || segment.segmentId !== factoid.sourceSegmentId || segment.sourceId !== factoid.sourceId) {
      errors.push('Una observación revisada necesita un segmento citable de su fuente.');
    }
  }
  return errors;
}

export function validateMembership(membership: ProsopMembership): string[] {
  const errors: string[] = [];
  if (membership.status !== 'candidate') {
    if (!membership.decision.trim()) errors.push('La decisión de pertenencia no puede estar vacía.');
    if (!membership.rationale.trim()) errors.push('La decisión de pertenencia necesita una justificación.');
    if (!membership.decidedBy || !membership.decidedAt) errors.push('La decisión de pertenencia necesita autor y fecha.');
  }
  return errors;
}

export function validateCohortMutation(cohort: ProsopCohort): void {
  if (cohort.kind === 'frozen' && cohort.frozenAt) {
    throw new Error('Una cohorte congelada es inmutable; duplícala para cambiarla.');
  }
}

export function canonicalJson(value: unknown): string {
  const walk = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(walk);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .filter(([, item]) => item !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, walk(item)])
      );
    }
    return input;
  };
  return JSON.stringify(walk(value));
}

/** Stable, dependency-free FNV-1a fingerprint for reproducibility checks. */
export function prosopFingerprint(value: unknown): string {
  const source = canonicalJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `prosop-v${PROSOP_SCHEMA_VERSION}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function normalizeUndirectedEdge(sourcePersonId: string, targetPersonId: string): [string, string] {
  if (!sourcePersonId || !targetPersonId) throw new Error('Una arista necesita dos personas.');
  if (sourcePersonId === targetPersonId) throw new Error('Una arista prosopográfica no puede conectarse consigo misma.');
  return sourcePersonId.localeCompare(targetPersonId) <= 0
    ? [sourcePersonId, targetPersonId]
    : [targetPersonId, sourcePersonId];
}

export function auditProsopInvariants(input: {
  study?: ProsopStudy | null;
  methodologies?: ProsopMethodologyVersion[];
  questionnaires?: ProsopQuestionnaireVersion[];
  variables?: ProsopVariable[];
  revisions?: ProsopVariableRevision[];
  sources?: ProsopSource[];
  segments?: ProsopSourceSegment[];
  factoids?: ProsopFactoid[];
  statements?: ProsopStatement[];
  memberships?: ProsopMembership[];
  cohorts?: ProsopCohort[];
  edges?: ProsopNetworkEdge[];
  proposals?: ProsopProposal[];
}): ProsopInvariantIssue[] {
  const issues: ProsopInvariantIssue[] = [];
  const sources = new Map((input.sources ?? []).map((item) => [item.sourceId, item]));
  const segments = new Map((input.segments ?? []).map((item) => [item.segmentId, item]));
  const factoids = new Map((input.factoids ?? []).map((item) => [item.factoidId, item]));
  const variables = new Map((input.variables ?? []).map((item) => [item.variableId, item]));
  const questionnaires = new Map((input.questionnaires ?? []).map((item) => [item.questionnaireVersionId, item]));

  if (input.study) {
    const currentMethod = (input.methodologies ?? []).filter((item) => item.status === 'published');
    if (currentMethod.length > 1) {
      issues.push({ code: 'multiple_active_methodologies', entityId: input.study.studyId, message: 'Solo puede haber una metodología publicada activa.', severity: 'error' });
    }
  }
  for (const revision of input.revisions ?? []) {
    if (!variables.has(revision.variableId) || !questionnaires.has(revision.questionnaireVersionId)) {
      issues.push({ code: 'orphan_variable_revision', entityId: revision.revisionId, message: 'La revisión no pertenece a una variable y versión existentes.', severity: 'error' });
    }
  }
  for (const factoid of factoids.values()) {
    for (const message of validateFactoid(factoid, sources.get(factoid.sourceId), segments.get(factoid.sourceSegmentId))) {
      issues.push({ code: 'invalid_factoid_provenance', entityId: factoid.factoidId, message, severity: 'error' });
    }
  }
  for (const statement of input.statements ?? []) {
    for (const message of validateStatement(statement, factoids.get(statement.factoidId))) {
      issues.push({ code: 'invalid_statement', entityId: statement.statementId, message, severity: 'error' });
    }
  }
  for (const membership of input.memberships ?? []) {
    for (const message of validateMembership(membership)) {
      issues.push({ code: 'invalid_membership', entityId: membership.membershipId, message, severity: 'error' });
    }
  }
  for (const cohort of input.cohorts ?? []) {
    if (cohort.kind === 'frozen' && !cohort.frozenAt) {
      issues.push({ code: 'unsealed_frozen_cohort', entityId: cohort.cohortId, message: 'Una cohorte congelada necesita fecha y miembros materializados.', severity: 'error' });
    }
  }
  for (const edge of input.edges ?? []) {
    if (edge.sourcePersonId === edge.targetPersonId) {
      issues.push({ code: 'self_network_edge', entityId: edge.edgeId, message: 'La arista conecta una persona consigo misma.', severity: 'error' });
    }
    if (edge.origin === 'derived' && !edge.derivationFingerprint) {
      issues.push({ code: 'untraceable_derived_edge', entityId: edge.edgeId, message: 'Una arista derivada necesita la huella de su regla.', severity: 'error' });
    }
    if (edge.origin === 'explicit' && edge.factoidIds.length === 0) {
      issues.push({ code: 'unsupported_explicit_edge', entityId: edge.edgeId, message: 'Una relación documentada necesita al menos una observación.', severity: 'error' });
    }
  }
  for (const proposal of input.proposals ?? []) {
    if (proposal.producerKind.startsWith('ai_') && proposal.status === 'accepted' && !proposal.reviewedBy) {
      issues.push({ code: 'unreviewed_ai_write', entityId: proposal.proposalId, message: 'La IA solo puede producir propuestas revisadas por una persona.', severity: 'error' });
    }
  }
  return issues;
}
