import type {
  ArchiveDateCertainty,
  ArchiveDescriptionUnit,
  ArchiveExcerpt,
  ArchiveFileRole,
  ArchiveItemFile,
  ArchiveLocator,
  ArchiveRepository,
  ArchiveReviewStatus,
  ArchiveCaptureSession,
  ArchiveTextKind,
  ArchiveTextSegment,
  ArchiveTextStatus,
  ArchiveTextVersion,
  ArchiveVerificationStatus,
} from './archiveTypes';
import type { ArchiveFolder, ArchiveItem, GazetteerPlace, Note, Place } from './types';

export const PRIMARY_SOURCES_DOMAIN_VERSION = 1 as const;

export const PRIMARY_SOURCE_ACCESS_STATUSES = ['open', 'private', 'restricted', 'embargoed', 'unknown'] as const;
export type PrimarySourceAccessStatus = (typeof PRIMARY_SOURCE_ACCESS_STATUSES)[number];

export const PRIMARY_SOURCE_SENSITIVITIES = ['normal', 'personal', 'sensitive', 'highly_sensitive'] as const;
export type PrimarySourceSensitivity = (typeof PRIMARY_SOURCE_SENSITIVITIES)[number];

export const PRIMARY_SOURCE_PROCESSING_STATUSES = [
  'imported',
  'needs_description',
  'ready',
  'processing',
  'error',
  'archived',
] as const;
export type PrimarySourceProcessingStatus = (typeof PRIMARY_SOURCE_PROCESSING_STATUSES)[number];

export const PRIMARY_SOURCE_DESCRIPTION_STATUSES = [
  'minimal',
  'provenance_incomplete',
  'described',
  'citation_ready',
] as const;
export type PrimarySourceDescriptionStatus = (typeof PRIMARY_SOURCE_DESCRIPTION_STATUSES)[number];

export const PRIMARY_SOURCE_ANALYSIS_STATUSES = ['not_started', 'draft', 'reviewed'] as const;
export type PrimarySourceAnalysisStatus = (typeof PRIMARY_SOURCE_ANALYSIS_STATUSES)[number];

export const PRIMARY_SOURCE_CITATION_STATUSES = ['not_ready', 'general_locator', 'ready'] as const;
export type PrimarySourceCitationStatus = (typeof PRIMARY_SOURCE_CITATION_STATUSES)[number];

export interface PrimarySourceItemProfile {
  itemId: string;
  /** Canonical place where the source originated; independent from places mentioned in its content. */
  provenancePlaceId: string | null;
  dateCertainty: ArchiveDateCertainty;
  accessStatus: PrimarySourceAccessStatus;
  embargoUntil: string | null;
  rightsStatement: string | null;
  reproductionConditions: string | null;
  sensitivity: PrimarySourceSensitivity;
  processingStatus: PrimarySourceProcessingStatus;
  descriptionStatus: PrimarySourceDescriptionStatus;
  analysisStatus: PrimarySourceAnalysisStatus;
  citationStatus: PrimarySourceCitationStatus;
  captureSessionId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export const PRIMARY_SOURCE_PROPOSAL_KINDS = [
  'person',
  'place',
  'date',
  'event',
  'relation',
  'organization',
  'document_reference',
] as const;
export type PrimarySourceProposalKind = (typeof PRIMARY_SOURCE_PROPOSAL_KINDS)[number];

export const PRIMARY_SOURCE_PROPOSAL_STATUSES = ['pending', 'accepted', 'rejected', 'deferred'] as const;
export type PrimarySourceProposalStatus = (typeof PRIMARY_SOURCE_PROPOSAL_STATUSES)[number];

export interface PrimarySourceEntityProposal {
  proposalId: string;
  itemId: string;
  excerptId: string | null;
  proposalKind: PrimarySourceProposalKind;
  payload: Record<string, unknown>;
  matchedTargetId: string | null;
  status: PrimarySourceProposalStatus;
  confidence: number | null;
  rationale: string | null;
  sourceEngine: string | null;
  sourceModel: string | null;
  /** Stable input+kind+model fingerprint; rejected proposals remain idempotent. */
  fingerprint: string;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  decisionNote: string | null;
}

export type PrimarySourceProposalDecisionKind = Exclude<PrimarySourceProposalStatus, 'pending'>;

/** Append-only human decision. The model payload remains immutable on the proposal;
 * an edited review is captured separately in decidedPayload. */
export interface PrimarySourceProposalDecision {
  decisionId: string;
  proposalId: string;
  itemId: string;
  decision: PrimarySourceProposalDecisionKind;
  originalPayload: Record<string, unknown>;
  decidedPayload: Record<string, unknown>;
  matchedTargetId: string | null;
  materializedTargetKind: PrimarySourceEvidenceTargetKind | null;
  materializedTargetId: string | null;
  evidenceId: string | null;
  evidenceRole: PrimarySourceEvidenceRole | null;
  reviewer: string | null;
  note: string | null;
  createdAt: string;
}

export interface PrimarySourceProposalCandidate {
  field: 'target' | 'subject' | 'object';
  targetKind: 'person' | 'place' | 'event';
  targetId: string;
  label: string;
  detail: string | null;
  match: 'exact' | 'similar';
}

export interface PrimarySourceProposalAcceptanceInput {
  payload?: Record<string, unknown>;
  matchedTargetId?: string | null;
  evidenceRole?: PrimarySourceEvidenceRole;
  certainty?: number | null;
  reviewer?: string | null;
  note?: string | null;
}

export interface PrimarySourceProposalDecisionInput {
  payload?: Record<string, unknown>;
  matchedTargetId?: string | null;
  reviewer?: string | null;
  note?: string | null;
}

export interface PrimarySourceProposalAcceptanceResult {
  proposal: PrimarySourceEntityProposal;
  decision: PrimarySourceProposalDecision;
  evidence: PrimarySourceEvidence;
  /** True when a previous accepted decision was returned without creating anything. */
  idempotent: boolean;
}

export interface PrimarySourceProposalExtractionInput {
  itemId: string;
  excerptId: string;
}

export interface PrimarySourceProposalExtractionResult {
  created: number;
  reused: number;
  proposals: PrimarySourceEntityProposal[];
  sourceEngine: string;
  sourceModel: string;
}

export const PRIMARY_SOURCE_EVIDENCE_ROLES = ['supports', 'contradicts', 'contextualizes', 'mentions'] as const;
export type PrimarySourceEvidenceRole = (typeof PRIMARY_SOURCE_EVIDENCE_ROLES)[number];

export const PRIMARY_SOURCE_EVIDENCE_TARGET_KINDS = [
  'person',
  'place',
  'event',
  'event_participant',
  'relationship',
  'social_relation',
  'identity_resolution',
  'archive_item',
] as const;
export type PrimarySourceEvidenceTargetKind = (typeof PRIMARY_SOURCE_EVIDENCE_TARGET_KINDS)[number];

export interface PrimarySourceEvidence {
  evidenceId: string;
  targetKind: PrimarySourceEvidenceTargetKind;
  targetId: string;
  itemId: string;
  excerptId: string | null;
  evidenceRole: PrimarySourceEvidenceRole;
  certainty: number | null;
  reviewStatus: ArchiveReviewStatus;
  sourceVersionId: string | null;
  /** Compatibility projections retained for simple legacy exports. */
  quote: string | null;
  location: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export const PRIMARY_SOURCE_IDENTITY_STATUSES = [
  'unresolved_mention',
  'provisional',
  'confirmed',
  'merged',
  'discarded',
] as const;
export type PrimarySourceIdentityStatus = (typeof PRIMARY_SOURCE_IDENTITY_STATUSES)[number];

export interface PrimarySourcePersonMention {
  mentionId: string;
  itemId: string;
  excerptId: string | null;
  personId: string | null;
  originalLabel: string;
  role: string | null;
  certainty: number | null;
  identityStatus: PrimarySourceIdentityStatus;
  createdAt: string;
  updatedAt: string;
}

export type PrimarySourcePersonFilter = 'all' | 'provisional' | 'confirmed' | 'discrepant';

export interface PrimarySourcePersonVariant {
  value: string;
  kind: 'preferred' | 'registered_variant' | 'documentary_mention';
  /** Number of documentary mentions carrying this exact original form. */
  mentionCount: number;
}

export interface PrimarySourcePersonSummary {
  personId: string;
  displayName: string;
  identityStatus: Exclude<PrimarySourceIdentityStatus, 'unresolved_mention' | 'merged' | 'discarded'>;
  variants: PrimarySourcePersonVariant[];
  mentionCount: number;
  sourceCount: number;
  evidenceCount: number;
  discrepancyCount: number;
  identityMemberCount: number;
  updatedAt: string;
}

export interface PrimarySourcePersonIdentityMember {
  personId: string;
  displayName: string;
  identityStatus: PrimarySourceIdentityStatus;
  isPreferred: boolean;
  sourceCount: number;
  mentionCount: number;
}

export interface PrimarySourcePersonDocumentMention extends PrimarySourcePersonMention {
  sourceTitle: string;
  referenceCode: string | null;
  repositoryName: string | null;
  excerptLocator: string | null;
  quotedText: string | null;
  evidenceRole: PrimarySourceEvidenceRole | null;
  evidenceId: string | null;
}

export type PrimarySourcePersonAssertionField =
  | 'name'
  | 'birth_date'
  | 'death_date'
  | 'sex'
  | 'occupation'
  | 'role'
  | 'other';

/** One documentary assertion. Assertions without a stable excerpt are deliberately
 * omitted from person dossiers, so every visible value can reopen its source. */
export interface PrimarySourcePersonAssertion {
  assertionId: string;
  field: PrimarySourcePersonAssertionField;
  value: string;
  personId: string;
  itemId: string;
  excerptId: string;
  sourceTitle: string;
  referenceCode: string | null;
  excerptLocator: string;
  quotedText: string | null;
  evidenceId: string | null;
  evidenceRole: PrimarySourceEvidenceRole;
  certainty: number | null;
}

export interface PrimarySourcePersonDiscrepancy {
  field: PrimarySourcePersonAssertionField;
  /** Alternative values remain separate and retain their complete source assertions. */
  alternatives: Array<{
    value: string;
    assertions: PrimarySourcePersonAssertion[];
  }>;
}

export interface PrimarySourcePersonComparisonCandidate {
  personId: string;
  displayName: string;
  variants: string[];
  sourceCount: number;
  mentionCount: number;
  score: number;
  reasons: Array<'same_name' | 'similar_name' | 'shared_variant' | 'compatible_dates' | 'shared_source'>;
}

export interface PrimarySourcePersonDossier {
  summary: PrimarySourcePersonSummary;
  identityMembers: PrimarySourcePersonIdentityMember[];
  mentions: PrimarySourcePersonDocumentMention[];
  assertions: PrimarySourcePersonAssertion[];
  discrepancies: PrimarySourcePersonDiscrepancy[];
  candidates: PrimarySourcePersonComparisonCandidate[];
  resolutions: PrimarySourceEntityResolution[];
}

export const PRIMARY_SOURCE_PLACE_ROLES = [
  'creation',
  'mentioned',
  'event',
  'route_origin',
  'route_destination',
  'custody',
  'repository',
  'consultation',
  'physical_location',
] as const;
export type PrimarySourcePlaceRole = (typeof PRIMARY_SOURCE_PLACE_ROLES)[number];

export interface PrimarySourcePlaceMention {
  mentionId: string;
  itemId: string;
  excerptId: string | null;
  placeId: string | null;
  originalLabel: string;
  role: PrimarySourcePlaceRole;
  certainty: number | null;
  status: 'unresolved' | 'proposed' | 'resolved' | 'rejected';
  createdAt: string;
  updatedAt: string;
}

// ── Evidence-first derived views ─────────────────────────────────────────────

/** A compact citation carried by every confirmed event, map point and graph edge. */
export interface PrimarySourceEvidenceTrace {
  evidenceId: string;
  targetKind: PrimarySourceEvidenceTargetKind;
  targetId: string;
  itemId: string;
  sourceTitle: string;
  referenceCode: string | null;
  repositoryName: string | null;
  excerptId: string;
  locator: string;
  quote: string;
  role: PrimarySourceEvidenceRole;
  certainty: number | null;
  reviewStatus: ArchiveReviewStatus;
}

export interface PrimarySourceDerivedFilterOption {
  id: string;
  label: string;
}

export interface PrimarySourceTimelineParticipant {
  personId: string;
  displayName: string;
  role: string;
}

export interface PrimarySourceTimelineEvent {
  eventId: string;
  type: string;
  label: string;
  dateDisplay: string | null;
  dateStartSort: string | null;
  dateEndSort: string | null;
  dateCertainty: string;
  reviewStatus: ArchiveReviewStatus;
  placeId: string | null;
  placeName: string | null;
  notes: string | null;
  participants: PrimarySourceTimelineParticipant[];
  evidence: PrimarySourceEvidenceTrace[];
  sourceIds: string[];
  repositoryNames: string[];
  /** A manual/provisional event has no accepted archival support and is hidden by default. */
  hypothesis: boolean;
  hasContradiction: boolean;
  dateAlternatives: Array<{
    dateDisplay: string;
    role: PrimarySourceEvidenceRole;
    evidenceId: string;
  }>;
}

export interface PrimarySourceTimelineWorkspace {
  events: PrimarySourceTimelineEvent[];
  sources: PrimarySourceDerivedFilterOption[];
  repositories: PrimarySourceDerivedFilterOption[];
  persons: PrimarySourceDerivedFilterOption[];
  places: PrimarySourceDerivedFilterOption[];
  eventTypes: string[];
}

export type PrimarySourceMapRole = PrimarySourcePlaceRole | 'event_location' | 'provenance';
export type PrimarySourceMapLayer =
  | 'provenance'
  | 'mentions'
  | 'events'
  | 'movements'
  | 'repositories'
  | 'custody'
  | 'consultation'
  | 'physical';

export interface PrimarySourcePlaceResolutionDecision {
  resolutionId: string;
  placeId: string;
  mentionId: string | null;
  selectedCandidate: import('./types').GazetteerPlace;
  alternatives: import('./types').GazetteerPlace[];
  coordinatePrecision: string | null;
  historicalContext: string | null;
  validFromDisplay: string | null;
  validToDisplay: string | null;
  rationale: string | null;
  status: 'active' | 'reverted';
  createdBy: string | null;
  createdAt: string;
  revertedAt: string | null;
}

export interface PrimarySourceToponymResolutionInput {
  placeId: string;
  mentionId?: string | null;
  selectedCandidate: import('./types').GazetteerPlace;
  alternatives?: import('./types').GazetteerPlace[];
  coordinatePrecision?: string | null;
  historicalContext?: string | null;
  validFromDisplay?: string | null;
  validToDisplay?: string | null;
  rationale?: string | null;
  createdBy?: string | null;
}

export interface PrimarySourceMapPoint {
  pointId: string;
  /** Human-readable source title for provenance points and accessible map popovers. */
  sourceTitle: string | null;
  placeId: string;
  mentionId: string | null;
  eventId: string | null;
  originalLabel: string;
  normalizedName: string;
  role: PrimarySourceMapRole;
  layer: PrimarySourceMapLayer;
  latitude: number | null;
  longitude: number | null;
  coordinatePrecision: string | null;
  authority: Record<string, unknown> | null;
  historicalContext: string | null;
  validFromDisplay: string | null;
  validToDisplay: string | null;
  dateDisplay: string | null;
  dateStartSort: string | null;
  dateEndSort: string | null;
  certainty: number | null;
  resolutionStatus: 'unresolved' | 'proposed' | 'resolved' | 'rejected';
  sensitivity: PrimarySourceSensitivity;
  hypothesis: boolean;
  evidence: PrimarySourceEvidenceTrace[];
  sourceIds: string[];
  personIds: string[];
  eventType: string | null;
  sourceTypes: string[];
  repositoryNames: string[];
  collectionIds: string[];
  resolution: PrimarySourcePlaceResolutionDecision | null;
}

export interface PrimarySourceMapWorkspace {
  points: PrimarySourceMapPoint[];
  sources: PrimarySourceDerivedFilterOption[];
  /** Sources whose record still has no provenance place assigned. */
  unassignedSources: PrimarySourceDerivedFilterOption[];
  persons: PrimarySourceDerivedFilterOption[];
  events: PrimarySourceDerivedFilterOption[];
  sourceTypes: string[];
  repositories: PrimarySourceDerivedFilterOption[];
  collections: PrimarySourceDerivedFilterOption[];
  roles: PrimarySourceMapRole[];
  layers: PrimarySourceMapLayer[];
}

export interface PrimarySourceRelationNode {
  nodeId: string;
  displayName: string;
  status: 'confirmed' | 'provisional' | 'contact';
}

export interface PrimarySourceRelationEdge {
  edgeId: string;
  edgeKind: 'kinship' | 'social';
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  relationType: string;
  historicalLabel: string;
  direction: 'directed' | 'undirected' | 'mutual';
  dateDisplay: string | null;
  dateStartSort: string | null;
  dateEndSort: string | null;
  certainty: number | null;
  status: 'confirmed' | 'proposal';
  notes: string | null;
  hypothesis: boolean;
  hasContradiction: boolean;
  evidence: PrimarySourceEvidenceTrace[];
  sourceIds: string[];
}

export interface PrimarySourceRelationsWorkspace {
  nodes: PrimarySourceRelationNode[];
  edges: PrimarySourceRelationEdge[];
  sources: PrimarySourceDerivedFilterOption[];
  relationTypes: string[];
}

export interface PrimarySourceAnalysis {
  analysisId: string;
  itemId: string;
  originNotes: string | null;
  purposeAudience: string | null;
  contentForm: string | null;
  perspectiveBias: string | null;
  silencesLimits: string | null;
  authenticityNotes: string | null;
  representativeness: string | null;
  corroboration: string | null;
  questions: string | null;
  status: PrimarySourceAnalysisStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PrimarySourceEntityResolution {
  resolutionId: string;
  entityKind: 'person' | 'place';
  sourceEntityId: string;
  targetEntityId: string | null;
  decision: 'merge' | 'separate' | 'confirm' | 'discard';
  rationale: string | null;
  status: 'active' | 'reverted';
  createdBy: string | null;
  createdAt: string;
  revertedAt: string | null;
}

export interface PrimarySourceProposalCandidateSet {
  proposalId: string;
  candidates: PrimarySourceProposalCandidate[];
}

export interface PrimarySourceNoteLink {
  linkId: string;
  nodusId: string;
  targetKind:
    | 'archive_item'
    | 'archive_unit'
    | 'archive_file'
    | 'archive_text_version'
    | 'archive_excerpt'
    | 'person'
    | 'event'
    | 'place'
    | 'social_relation'
    | 'saved_search';
  targetId: string;
  excerptId: string | null;
  relationKind: 'references' | 'quotes' | 'interprets' | 'questions' | 'contradicts';
  createdAt: string;
}

// ── Archive workspace / ingestion ────────────────────────────────────────────

export interface PrimarySourceDescriptionTemplate {
  templateId: string;
  name: string;
  documentType: string | null;
  defaultLevel: ArchiveDescriptionUnit['level'];
  unitDefaults: Partial<ArchiveDescriptionUnit>;
  profileDefaults: Partial<PrimarySourceItemProfile>;
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PrimarySourceArchiveRow {
  item: ArchiveItem;
  unit: ArchiveDescriptionUnit;
  profile: PrimarySourceItemProfile;
  repositoryName: string | null;
  /** Best gallery representation; the binary payload stays behind nodus-archive:. */
  previewFile: ArchiveItemFile | null;
  masterCount: number;
  derivativeCount: number;
  textVersionCount: number;
  /** Optimistic-concurrency token used by safe batch edits. */
  revision: string;
}

export interface PrimarySourceArchiveWorkspace {
  rows: PrimarySourceArchiveRow[];
  repositories: ArchiveRepository[];
  units: ArchiveDescriptionUnit[];
  sessions: ArchiveCaptureSession[];
  collections: ArchiveFolder[];
  /** Shared geographic catalogue used by source records and the provenance map. */
  places: Place[];
  templates: PrimarySourceDescriptionTemplate[];
  page: {
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
    unitsTruncated: boolean;
  };
}

export interface PrimarySourceIngestInput {
  paths: string[];
  title?: string | null;
  description?: string | null;
  documentType?: string | null;
  /** Values for the shared Genealogy/Archive document-type catalogue. */
  documentMetadata?: Record<string, string> | null;
  /** Renderer icon chosen for the source; stored independently from typed metadata. */
  documentIcon?: string | null;
  templateId?: string | null;
  repositoryId?: string | null;
  parentUnitId?: string | null;
  referenceCode?: string | null;
  creatorDisplay?: string | null;
  dateDisplay?: string | null;
  dateStartSort?: string | null;
  dateEndSort?: string | null;
  dateCertainty?: ArchiveDateCertainty;
  captureSessionId?: string | null;
  collectionIds?: string[];
  tags?: string[];
  accessStatus?: PrimarySourceAccessStatus;
  sensitivity?: PrimarySourceSensitivity;
  /**
   * Canonical real-world place of provenance selected from the bundled offline gazetteer.
   * Free-form coordinates are deliberately not accepted by this workflow.
   */
  place?: GazetteerPlace | null;
}

export interface PrimarySourceIngestSummary {
  added: number;
  duplicates: number;
  rows: PrimarySourceArchiveRow[];
}

export interface PrimarySourceUnitCreateInput {
  title: string;
  level: ArchiveDescriptionUnit['level'];
  localLevelLabel?: string | null;
  repositoryId?: string | null;
  parentUnitId?: string | null;
  referenceCode?: string | null;
  creatorDisplay?: string | null;
  dateDisplay?: string | null;
  dateStartSort?: string | null;
  dateEndSort?: string | null;
  dateCertainty?: ArchiveDateCertainty;
  scopeContent?: string | null;
  position?: number;
}

export interface PrimarySourceBulkPatch {
  accessStatus?: PrimarySourceAccessStatus;
  sensitivity?: PrimarySourceSensitivity;
  processingStatus?: PrimarySourceProcessingStatus;
  descriptionStatus?: PrimarySourceDescriptionStatus;
  captureSessionId?: string | null;
  addTags?: string[];
  removeTags?: string[];
  collectionIds?: string[];
}

export interface PrimarySourceBulkPreview {
  itemIds: string[];
  affected: number;
  missing: string[];
  revisions: Record<string, string>;
  warnings: string[];
}

export interface PrimarySourceArchiveEditInput {
  expectedRevision: string;
  unit?: Partial<ArchiveDescriptionUnit>;
  profile?: Partial<Omit<PrimarySourceItemProfile, 'itemId' | 'createdAt' | 'updatedAt'>>;
}

// ── Source dossier / digital representations ────────────────────────────────

export interface PrimarySourceIntegrityCheck {
  checkId: string;
  fileId: string;
  algorithm: 'sha256';
  expectedHash: string | null;
  observedHash: string | null;
  status: ArchiveVerificationStatus;
  checkedAt: string;
  details: string | null;
}

export interface PrimarySourceAuditEvent {
  eventId: string;
  itemId: string;
  fileId: string | null;
  action:
    | 'file_created'
    | 'master_version_added'
    | 'file_superseded'
    | 'file_metadata_updated'
    | 'integrity_checked'
    | 'thumbnail_regenerated'
    | 'file_exported'
    | 'file_opened_external'
    | 'text_version_created'
    | 'text_review_status_changed'
    | 'excerpt_created'
    | 'excerpt_review_status_changed'
    | 'source_analysis_saved'
    | 'proposal_extraction_completed'
    | 'proposal_decided'
    | 'proposal_materialized'
    | 'entity_resolution_created'
    | 'entity_resolution_reverted'
    | 'toponym_resolved'
    | 'toponym_resolution_reverted';
  details: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
}

export interface PrimarySourceDossier {
  row: PrimarySourceArchiveRow;
  files: ArchiveItemFile[];
  textVersions: ArchiveTextVersion[];
  textSegments: ArchiveTextSegment[];
  excerpts: ArchiveExcerpt[];
  analysis: PrimarySourceAnalysis | null;
  proposals: PrimarySourceEntityProposal[];
  proposalDecisions: PrimarySourceProposalDecision[];
  proposalCandidates: PrimarySourceProposalCandidateSet[];
  evidence: PrimarySourceEvidence[];
  resolutions: PrimarySourceEntityResolution[];
  integrityChecks: PrimarySourceIntegrityCheck[];
  history: PrimarySourceAuditEvent[];
  integrity: {
    verified: number;
    pending: number;
    missing: number;
    mismatch: number;
    error: number;
    orphanDerivatives: number;
    unhashed: number;
  };
}

export interface PrimarySourceTextSegmentInput {
  fileId?: string | null;
  sequenceNo: number;
  pageLabel?: string | null;
  startOffset?: number | null;
  endOffset?: number | null;
  content: string;
  bbox?: ArchiveTextSegment['bbox'];
  timeStartMs?: number | null;
  timeEndMs?: number | null;
  speakerLabel?: string | null;
  confidence?: number | null;
}

/**
 * Text content is append-only. A correction, normalization or translation always
 * creates a child version; the referenced parent remains byte-for-byte unchanged.
 */
export interface PrimarySourceTextVersionCreateInput {
  itemId: string;
  fileId?: string | null;
  parentVersionId?: string | null;
  kind: ArchiveTextKind;
  languageCode?: string | null;
  content: string;
  status?: ArchiveTextStatus;
  engine?: string | null;
  model?: string | null;
  confidence?: number | null;
  editorialConventions?: string | null;
  createdBy?: string | null;
  segments?: PrimarySourceTextSegmentInput[];
}

export interface PrimarySourceExcerptCreateInput {
  itemId: string;
  textVersionId: string;
  fileId?: string | null;
  segmentId?: string | null;
  startOffset: number;
  endOffset: number;
  locatorDisplay: string;
  locator?: Omit<ArchiveLocator, 'textRange' | 'segmentId'>;
  languageCode?: string | null;
  description?: string | null;
  reviewStatus?: ArchiveReviewStatus;
  createdBy?: string | null;
}

export interface PrimarySourceTextDeepLink {
  itemId: string;
  excerptId: string;
}

export interface PrimarySourceFileImportInput {
  itemId: string;
  paths: string[];
  role: ArchiveFileRole;
  parentFileId?: string | null;
  /** A new master version supersedes this row but never changes or removes its bytes. */
  supersedesFileId?: string | null;
  sequenceNo?: number;
  pageLabel?: string | null;
  transformation?: Record<string, unknown> | null;
  captureMetadata?: Record<string, unknown> | null;
}

export interface PrimarySourceFileMetadataPatch {
  sequenceNo?: number;
  pageLabel?: string | null;
  /** Human-authored description used as image alternative text in the viewer. */
  alternativeText?: string | null;
}

export interface PrimarySourceFileImportResult {
  added: ArchiveItemFile[];
  dossier: PrimarySourceDossier;
}

// ── Cross-corpus search, research notes and operational home ────────────────

export type PrimarySourceSearchLayer =
  | 'metadata'
  | 'ocr'
  | 'transcription'
  | 'excerpt'
  | 'person'
  | 'event'
  | 'place'
  | 'relation'
  | 'note'
  | 'tag'
  | 'collection';

export type PrimarySourceSearchTargetKind =
  | 'source'
  | 'unit'
  | 'text_version'
  | 'excerpt'
  | 'person'
  | 'event'
  | 'place'
  | 'relation'
  | 'saved_search'
  | 'note';

export interface PrimarySourceSearchFilters {
  layers?: PrimarySourceSearchLayer[];
  dateFrom?: string | null;
  dateTo?: string | null;
  repositoryId?: string | null;
  level?: string | null;
  format?: string | null;
  personId?: string | null;
  placeId?: string | null;
  reviewStatus?: string | null;
  accessStatus?: PrimarySourceAccessStatus | null;
}

export interface PrimarySourceSearchRequest {
  query: string;
  filters?: PrimarySourceSearchFilters;
  limit?: number;
  /** Explicit local opt-ins. Restricted content remains hidden unless enabled. */
  allowPrivateContent?: boolean;
  allowRestrictedContent?: boolean;
  allowUnknownRightsContent?: boolean;
}

export interface PrimarySourceSearchResult {
  resultId: string;
  layer: PrimarySourceSearchLayer;
  targetKind: PrimarySourceSearchTargetKind;
  targetId: string;
  itemId: string | null;
  excerptId: string | null;
  textVersionId: string | null;
  startOffset: number | null;
  endOffset: number | null;
  noteId: string | null;
  title: string;
  matchText: string;
  matchStart: number;
  matchLength: number;
  repositoryId: string | null;
  repositoryName: string | null;
  hierarchy: string[];
  referenceCode: string | null;
  dateDisplay: string | null;
  documentType: string | null;
  level: string | null;
  format: string | null;
  personIds: string[];
  placeIds: string[];
  reviewStatus: string | null;
  accessStatus: PrimarySourceAccessStatus | null;
  locator: string | null;
  interpretation: boolean;
  unreviewedText: boolean;
  restrictedContentHidden: boolean;
}

export interface PrimarySourceSearchFacet {
  id: string;
  label: string;
  count: number;
}

export interface PrimarySourceSearchResponse {
  queryText: string;
  parsedTerms: string[];
  results: PrimarySourceSearchResult[];
  total: number;
  elapsedMs: number;
  indexStrategy: 'sqlite_like' | 'fts5';
  ftsRecommended: boolean;
  facets: {
    layers: PrimarySourceSearchFacet[];
    repositories: PrimarySourceSearchFacet[];
    levels: PrimarySourceSearchFacet[];
    formats: PrimarySourceSearchFacet[];
    persons: PrimarySourceSearchFacet[];
    places: PrimarySourceSearchFacet[];
    reviewStatuses: PrimarySourceSearchFacet[];
    accessStatuses: PrimarySourceSearchFacet[];
  };
}

export const PRIMARY_SOURCE_NOTE_TYPES = [
  'observation',
  'question',
  'hypothesis',
  'comparison',
  'task',
  'method_memo',
] as const;
export type PrimarySourceNoteType = (typeof PRIMARY_SOURCE_NOTE_TYPES)[number];

export const PRIMARY_SOURCE_NOTE_STATUSES = ['draft', 'in_review', 'stable', 'archived'] as const;
export type PrimarySourceNoteStatus = (typeof PRIMARY_SOURCE_NOTE_STATUSES)[number];

export type PrimarySourceNoteRelationKind =
  | 'references'
  | 'quotes'
  | 'interprets'
  | 'questions'
  | 'supports'
  | 'contradicts';

export interface PrimarySourceNoteProfile {
  noteId: string;
  noteType: PrimarySourceNoteType;
  status: PrimarySourceNoteStatus;
  collection: string | null;
  accessStatus: PrimarySourceAccessStatus;
  sensitivity: PrimarySourceSensitivity;
  createdAt: string;
  updatedAt: string;
}

export interface PrimarySourceResearchNoteLink {
  linkId: string;
  noteId: string;
  noteTitle: string;
  targetKind: PrimarySourceSearchTargetKind;
  targetId: string;
  targetLabel: string;
  itemId: string | null;
  excerptId: string | null;
  relationKind: PrimarySourceNoteRelationKind;
  repositoryName: string | null;
  referenceCode: string | null;
  locator: string | null;
  quote: string | null;
  /** The excerpt snapshot changed or disappeared; the historical link is retained. */
  citationChanged: boolean;
  createdAt: string;
}

export interface PrimarySourceResearchNote extends Note {
  profile: PrimarySourceNoteProfile;
  links: PrimarySourceResearchNoteLink[];
  backlinkCount: number;
}

export interface PrimarySourceNoteWorkspace {
  notes: PrimarySourceResearchNote[];
  collections: string[];
  linkTargets: PrimarySourceDerivedFilterOption[];
}

export interface PrimarySourceNoteProfilePatch {
  noteType?: PrimarySourceNoteType;
  status?: PrimarySourceNoteStatus;
  collection?: string | null;
  accessStatus?: PrimarySourceAccessStatus;
  sensitivity?: PrimarySourceSensitivity;
}

export interface PrimarySourceNoteLinkInput {
  noteId: string;
  targetKind: PrimarySourceSearchTargetKind;
  targetId: string;
  excerptId?: string | null;
  relationKind?: PrimarySourceNoteRelationKind;
}

export interface PrimarySourceCitationInsertion {
  link: PrimarySourceResearchNoteLink;
  markdown: string;
}

export type PrimarySourceDashboardTaskKind =
  | 'missing_provenance'
  | 'missing_reference'
  | 'ocr_review'
  | 'pending_proposals'
  | 'provisional_identities'
  | 'event_evidence'
  | 'relation_evidence'
  | 'ambiguous_places'
  | 'restricted_export'
  | 'integrity';

export interface PrimarySourceDashboardTask {
  kind: PrimarySourceDashboardTaskKind;
  label: string;
  count: number;
  view: 'archive' | 'persons' | 'timeline' | 'map' | 'relations';
  /** Bounded ids used to open the destination as the promised filtered list. */
  targetIds: string[];
}

export interface PrimarySourceDashboardActivity {
  id: string;
  kind: 'source' | 'text' | 'proposal' | 'note' | 'citation' | 'export';
  label: string;
  detail: string | null;
  occurredAt: string;
  view: 'archive' | 'notes';
  targetId: string | null;
}

export interface PrimarySourceOperationalDashboard {
  metrics: {
    descriptionUnits: number;
    preservedMasters: number;
    citationReadySources: number;
    identifiedPersons: number;
    documentedEvents: number;
    resolvedPlaces: number;
  };
  tasks: PrimarySourceDashboardTask[];
  recentActivity: PrimarySourceDashboardActivity[];
  preservation: {
    lastBackupAt: string | null;
    lastInventoryAt: string | null;
    verifiedFiles: number;
    pendingFiles: number;
    missingFiles: number;
    failedChecks: number;
    orphanDerivatives: number;
    unhashedLegacyFiles: number;
    originalsWithoutCopy: number;
    vaultSizeBytes: number;
  };
  latestSource: { itemId: string; title: string; excerptId: string | null } | null;
}

export type PrimarySourcePolicyAction =
  | 'view_local'
  | 'search_content'
  | 'local_ai'
  | 'external_ai'
  | 'sync'
  | 'export_file'
  | 'export_metadata';

export type PrimarySourcePolicyDecision = 'allow' | 'confirm' | 'redact' | 'block';

export interface PrimarySourcePolicyContext {
  accessStatus: PrimarySourceAccessStatus;
  sensitivity: PrimarySourceSensitivity;
  action: PrimarySourcePolicyAction;
  now?: string;
  embargoUntil?: string | null;
  /** Explicit vault-level opt-ins never override a hard embargo or highly sensitive external use. */
  allowPrivateSearch?: boolean;
  allowRestrictedSearch?: boolean;
  allowPrivateSync?: boolean;
  allowRestrictedSync?: boolean;
  allowRestrictedLocalAi?: boolean;
  allowPrivateExternalAi?: boolean;
}

export interface PrimarySourcePolicyResult {
  decision: PrimarySourcePolicyDecision;
  reason:
    | 'open'
    | 'private_confirmation'
    | 'restricted'
    | 'embargo_active'
    | 'embargo_review_required'
    | 'unknown_rights'
    | 'sensitive_external_processing'
    | 'vault_policy';
}

/**
 * Backend policy primitive. Renderer badges may explain the result, but IPC,
 * export and AI context assembly must all call the same decision function.
 */
export function decidePrimarySourcePolicy(context: PrimarySourcePolicyContext): PrimarySourcePolicyResult {
  const { accessStatus, sensitivity, action } = context;
  const external = action === 'external_ai';

  if (sensitivity === 'highly_sensitive' && external) {
    return { decision: 'block', reason: 'sensitive_external_processing' };
  }
  if (accessStatus === 'embargoed') {
    const now = Date.parse(context.now ?? new Date().toISOString());
    const until = context.embargoUntil ? Date.parse(context.embargoUntil) : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(until) || until > now) return { decision: 'block', reason: 'embargo_active' };
    return { decision: 'confirm', reason: 'embargo_review_required' };
  }
  if (accessStatus === 'unknown') {
    if (action === 'view_local') return { decision: 'allow', reason: 'unknown_rights' };
    if (action === 'export_metadata') return { decision: 'redact', reason: 'unknown_rights' };
    return { decision: 'confirm', reason: 'unknown_rights' };
  }
  if (accessStatus === 'restricted') {
    if (action === 'view_local') return { decision: 'confirm', reason: 'restricted' };
    if (action === 'local_ai' && context.allowRestrictedLocalAi) {
      return { decision: 'allow', reason: 'vault_policy' };
    }
    if (action === 'search_content' && context.allowRestrictedSearch) {
      return { decision: 'allow', reason: 'vault_policy' };
    }
    if (action === 'sync' && context.allowRestrictedSync) {
      return { decision: 'allow', reason: 'vault_policy' };
    }
    if (action === 'export_metadata') return { decision: 'redact', reason: 'restricted' };
    return { decision: 'block', reason: 'restricted' };
  }
  if (accessStatus === 'private') {
    if (action === 'view_local' || action === 'local_ai') {
      return { decision: 'allow', reason: 'private_confirmation' };
    }
    if (action === 'search_content' && context.allowPrivateSearch) {
      return { decision: 'allow', reason: 'vault_policy' };
    }
    if (action === 'sync' && context.allowPrivateSync) {
      return { decision: 'allow', reason: 'vault_policy' };
    }
    if (external) {
      return context.allowPrivateExternalAi
        ? { decision: 'confirm', reason: 'vault_policy' }
        : { decision: 'block', reason: 'vault_policy' };
    }
    if (action === 'export_metadata') return { decision: 'allow', reason: 'private_confirmation' };
    return { decision: 'confirm', reason: 'private_confirmation' };
  }
  return { decision: 'allow', reason: 'open' };
}

export interface PrimarySourceCitationInput {
  repositoryName: string | null;
  referenceCode: string | null;
  unitTitle: string | null;
  excerpt: Pick<ArchiveExcerpt, 'locatorDisplay'> | null;
  hasPreservedMaster: boolean;
}

export interface PrimarySourceCitationAssessment {
  status: PrimarySourceCitationStatus;
  missing: Array<'repository' | 'reference' | 'unit' | 'locator' | 'master'>;
}

// ── Governed Toolkit, citations, export and recovery ────────────────────────

export const PRIMARY_SOURCE_TOOLKIT_OPERATION_IDS = [
  'run_ocr',
  'transcribe',
  'segment_pages',
  'translate_text',
  'describe_image',
  'suggest_document_type',
  'extract_mentions',
  'compare_documents',
  'detect_duplicates',
  'summarize_metadata',
  'critical_questions',
  'normalize_dates',
  'suggest_toponyms',
  'prepare_table',
  'generate_inventory',
  'review_description_quality',
] as const;
export type PrimarySourceToolkitOperationId = (typeof PRIMARY_SOURCE_TOOLKIT_OPERATION_IDS)[number];
export type PrimarySourceProcessingLocation = 'local' | 'external';

export interface PrimarySourceToolkitOperationDefinition {
  id: PrimarySourceToolkitOperationId;
  label: string;
  description: string;
  resultKind: 'text_version' | 'proposal' | 'comparison' | 'inventory' | 'quality_report';
  minItems: number;
  localCapable: boolean;
  externalCapable: boolean;
}

export interface PrimarySourcePolicySettings {
  allowPrivateSearch: boolean;
  allowRestrictedSearch: boolean;
  allowPrivateSync: boolean;
  allowRestrictedSync: boolean;
  allowRestrictedLocalAi: boolean;
  allowPrivateExternalAi: boolean;
  requireExternalConfirmation: boolean;
  retainAutomaticResultsDays: number;
  exportPrivateFiles: boolean;
  reviewExpiredEmbargoes: boolean;
  redactPhysicalLocations: boolean;
  redactPersonalMetadata: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PrimarySourcePolicySettingsPatch = Partial<Omit<PrimarySourcePolicySettings, 'createdAt' | 'updatedAt'>>;

export type PrimarySourceCitationField =
  | 'repository'
  | 'hierarchy'
  | 'reference'
  | 'title'
  | 'date'
  | 'locator'
  | 'version_url'
  | 'accessed';

export interface PrimarySourceCitationSettings {
  fieldOrder: PrimarySourceCitationField[];
  repositoryAliases: Record<string, string>;
  requiredFields: Array<'repository' | 'reference' | 'title' | 'locator' | 'master'>;
  includeAccessedDate: boolean;
  updatedAt: string;
}

export interface PrimarySourceToolkitSelectionItem {
  itemId: string;
  title: string;
  referenceCode: string | null;
  accessStatus: PrimarySourceAccessStatus;
  sensitivity: PrimarySourceSensitivity;
  fileCount: number;
  textVersionCount: number;
  byteSize: number;
}

export interface PrimarySourceToolkitRequest {
  operationId: PrimarySourceToolkitOperationId;
  itemIds: string[];
  processingLocation: PrimarySourceProcessingLocation;
  /** Required for policy decisions that return confirm; hard blocks cannot be overridden. */
  authorizedItemIds?: string[];
}

export interface PrimarySourceToolkitContextPreview {
  request: PrimarySourceToolkitRequest;
  items: PrimarySourceToolkitSelectionItem[];
  includedItemIds: string[];
  blockedItemIds: string[];
  confirmationItemIds: string[];
  /** Selected items that cannot supply the file type required by this operation. */
  incompatibleItemIds: string[];
  filesSent: number;
  textVersionsSent: number;
  contextBytes: number;
  provider: string | null;
  model: string | null;
  leavesDevice: boolean;
  estimatedCost: string | null;
  expectedResult: PrimarySourceToolkitOperationDefinition['resultKind'];
  policy: Array<{
    itemId: string;
    decision: PrimarySourcePolicyDecision;
    reason: PrimarySourcePolicyResult['reason'];
  }>;
  canRun: boolean;
}

export interface PrimarySourceToolkitResult {
  runId: string;
  operationId: PrimarySourceToolkitOperationId;
  status: 'completed' | 'blocked' | 'failed';
  resultKind: PrimarySourceToolkitOperationDefinition['resultKind'];
  /** Results are proposals/reports or append-only text versions, never canonical replacements. */
  outputs: Array<{
    itemId: string;
    label: string;
    summary: string;
    targetId: string | null;
    targetKind: 'text_version' | 'proposal' | 'report';
  }>;
  preview: PrimarySourceToolkitContextPreview;
  completedAt: string;
}

export interface PrimarySourceAiAuditEntry {
  runId: string;
  operationId: string;
  processingLocation: PrimarySourceProcessingLocation;
  selectionCount: number;
  provider: string | null;
  model: string | null;
  contextBytes: number;
  leftDevice: boolean;
  policyDecision: string;
  status: 'previewed' | 'running' | 'completed' | 'blocked' | 'failed';
  resultKind: string | null;
  createdAt: string;
  completedAt: string | null;
  errorCode: string | null;
}

export interface PrimarySourceCitationBuildRequest {
  itemId: string;
  excerptId?: string | null;
  accessedAt?: string | null;
  customText?: string | null;
}

export interface PrimarySourceBuiltCitation {
  itemId: string;
  excerptId: string | null;
  text: string;
  markdown: string;
  deepLink: string;
  structured: Partial<Record<PrimarySourceCitationField, string>>;
  assessment: PrimarySourceCitationAssessment;
  editedText: boolean;
}

export const PRIMARY_SOURCE_EXPORT_PROFILES = [
  'inventory',
  'source_package',
  'evidence_dossier',
  'interoperable',
] as const;
export type PrimarySourceExportProfile = (typeof PRIMARY_SOURCE_EXPORT_PROFILES)[number];
export type PrimarySourceInventoryFormat = 'csv' | 'xlsx' | 'json';

export interface PrimarySourceExportRequest {
  profile: PrimarySourceExportProfile;
  itemIds: string[];
  inventoryFormat?: PrimarySourceInventoryFormat;
  includeFiles?: boolean;
  includeTextVersions?: boolean;
  includeNotes?: boolean;
  includeDerivatives?: boolean;
  authorizedItemIds?: string[];
  noteIds?: string[];
  authorizedNoteIds?: string[];
  evidenceTarget?: {
    kind: 'person' | 'event' | 'relationship';
    id: string;
  } | null;
}

export interface PrimarySourceExportPreview {
  request: PrimarySourceExportRequest;
  includedItemIds: string[];
  excludedByRestriction: string[];
  confirmationRequired: string[];
  metadataRedacted: string[];
  includedNoteIds: string[];
  excludedNoteIds: string[];
  confirmationNoteIds: string[];
  notesExcluded: number;
  missingFiles: number;
  incompleteReferences: number;
  includedFiles: number;
  estimatedBytes: number;
  canExport: boolean;
  blockers: string[];
}

export interface PrimarySourceResearchManifestFile {
  path: string;
  sha256: string;
  bytes: number;
  itemId: string | null;
  fileId: string | null;
  role: string | null;
}

export interface PrimarySourceResearchManifest {
  format: 'nodus.primary-sources-research-package';
  formatVersion: 1;
  appVersion: string;
  schemaVersion: number;
  vaultId: string;
  vaultName: string;
  createdAt: string;
  profile: PrimarySourceExportProfile;
  inventoryFormat: PrimarySourceInventoryFormat;
  selection: {
    requested: number;
    included: number;
    excluded: number;
    evidenceTarget?: PrimarySourceExportRequest['evidenceTarget'];
  };
  policy: {
    restrictedExcluded: number;
    metadataRedacted: number;
    privateAuthorized: number;
  };
  tables: Record<string, number>;
  files: PrimarySourceResearchManifestFile[];
  exclusions: Array<{ itemId: string; reason: string }>;
  verification: {
    status: 'verified';
    checkedEntries: number;
    missingEntries: number;
    mismatchedEntries: number;
  };
}

export interface PrimarySourceExportResult {
  canceled: boolean;
  path: string | null;
  exportId: string | null;
  packageHash: string | null;
  manifest: PrimarySourceResearchManifest | null;
}

export interface PrimarySourcePackageValidation {
  valid: boolean;
  packageHash: string;
  manifest: PrimarySourceResearchManifest | null;
  missingEntries: string[];
  mismatchedEntries: string[];
  unsafeEntries: string[];
  errors: string[];
}

export interface PrimarySourceRestoreReport {
  reportId: string;
  status: 'validated' | 'restored' | 'rejected' | 'failed';
  packageHash: string;
  sourceSchema: number | null;
  resultVaultId: string | null;
  missingFiles: number;
  invalidFiles: number;
  message: string;
  createdAt: string;
}

export interface PrimarySourceGovernanceWorkspace {
  policy: PrimarySourcePolicySettings;
  citations: PrimarySourceCitationSettings;
  operations: PrimarySourceToolkitOperationDefinition[];
  items: PrimarySourceToolkitSelectionItem[];
  notes: Array<{
    noteId: string;
    title: string;
    accessStatus: PrimarySourceAccessStatus;
    sensitivity: PrimarySourceSensitivity;
    linkedItemIds: string[];
  }>;
  evidenceTargets: Array<{
    kind: 'person' | 'event' | 'relationship';
    id: string;
    label: string;
  }>;
  recentAiAudit: PrimarySourceAiAuditEntry[];
  recentExports: Array<{
    exportId: string;
    profile: string;
    includedFiles: number;
    excludedFiles: number;
    packageHash: string | null;
    verifiedAt: string | null;
    createdAt: string;
  }>;
  recentRestores: PrimarySourceRestoreReport[];
  retentionReviewDue: {
    textVersions: number;
    proposals: number;
  };
  inventory: {
    schemaVersion: number;
    tables: Record<string, number>;
    classifiedPortableTables: string[];
    unclassifiedPrimarySourceTables: string[];
  };
}

export type PrimarySourceLocalMetricName =
  | 'archive_list'
  | 'archive_filter'
  | 'dossier_open'
  | 'research_search'
  | 'demo_seed'
  | 'package_export'
  | 'package_restore';

export interface PrimarySourceLocalMetricSummary {
  enabled: boolean;
  localOnly: true;
  contentFree: true;
  total: number;
  oldestAt: string | null;
  newestAt: string | null;
  events: Array<{
    eventName: PrimarySourceLocalMetricName;
    runs: number;
    failures: number;
    averageDurationMs: number;
    p95DurationMs: number;
  }>;
}

export function assessPrimarySourceCitation(input: PrimarySourceCitationInput): PrimarySourceCitationAssessment {
  const missing: PrimarySourceCitationAssessment['missing'] = [];
  if (!input.repositoryName?.trim()) missing.push('repository');
  if (!input.referenceCode?.trim()) missing.push('reference');
  if (!input.unitTitle?.trim()) missing.push('unit');
  if (!input.excerpt?.locatorDisplay.trim()) missing.push('locator');
  if (!input.hasPreservedMaster) missing.push('master');
  return {
    status: missing.length === 0 ? 'ready' : missing.length === 1 && missing[0] === 'locator' ? 'general_locator' : 'not_ready',
    missing,
  };
}

/** Orthogonal dimensions: no state string is allowed to encode another dimension. */
export const PRIMARY_SOURCE_STATE_DIAGRAM = {
  processing: PRIMARY_SOURCE_PROCESSING_STATUSES,
  description: PRIMARY_SOURCE_DESCRIPTION_STATUSES,
  analysis: PRIMARY_SOURCE_ANALYSIS_STATUSES,
  citation: PRIMARY_SOURCE_CITATION_STATUSES,
  access: PRIMARY_SOURCE_ACCESS_STATUSES,
  sensitivity: PRIMARY_SOURCE_SENSITIVITIES,
} as const;
