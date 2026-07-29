/**
 * Shared archival contracts.
 *
 * These types deliberately keep four layers separate:
 *  1. archival description and provenance;
 *  2. digital representations;
 *  3. text and stable segments;
 *  4. citable excerpts.
 *
 * They are dependency-free so database, preload and renderer code can share the
 * same stable codes without importing an Electron- or React-specific module.
 */

export const ARCHIVAL_LEVELS = [
  'repository',
  'fonds',
  'collection',
  'subfonds',
  'series',
  'subseries',
  'file',
  'item',
  'component',
  'local',
] as const;
export type ArchivalLevel = (typeof ARCHIVAL_LEVELS)[number];

export const ARCHIVE_UNIT_RELATION_KINDS = ['describes', 'represents', 'part_of'] as const;
export type ArchiveUnitRelationKind = (typeof ARCHIVE_UNIT_RELATION_KINDS)[number];

export const ARCHIVE_FILE_ROLES = [
  'master',
  'access',
  'thumbnail',
  'ocr',
  'transcript',
  'derivative',
  'supplement',
] as const;
export type ArchiveFileRole = (typeof ARCHIVE_FILE_ROLES)[number];

export const ARCHIVE_TEXT_KINDS = ['ocr', 'transcription', 'diplomatic', 'normalized', 'translation'] as const;
export type ArchiveTextKind = (typeof ARCHIVE_TEXT_KINDS)[number];

export const ARCHIVE_TEXT_STATUSES = [
  'requested',
  'automatic',
  'in_review',
  'reviewed',
  'closed',
] as const;
export type ArchiveTextStatus = (typeof ARCHIVE_TEXT_STATUSES)[number];

export const ARCHIVE_REVIEW_STATUSES = ['unreviewed', 'in_review', 'reviewed', 'rejected'] as const;
export type ArchiveReviewStatus = (typeof ARCHIVE_REVIEW_STATUSES)[number];

export const ARCHIVE_VERIFICATION_STATUSES = ['pending', 'verified', 'mismatch', 'missing', 'error'] as const;
export type ArchiveVerificationStatus = (typeof ARCHIVE_VERIFICATION_STATUSES)[number];

export const ARCHIVE_DATE_CERTAINTIES = [
  'exact',
  'circa',
  'before',
  'after',
  'between',
  'uncertain',
  'unknown',
] as const;
export type ArchiveDateCertainty = (typeof ARCHIVE_DATE_CERTAINTIES)[number];

export interface ArchiveDate {
  /** The source-facing form, preserved exactly (for example "ca. 1780"). */
  display: string | null;
  /** Inclusive normalized bounds used only for ordering and filtering. */
  startSort: string | null;
  endSort: string | null;
  certainty: ArchiveDateCertainty;
  calendar?: string | null;
}

export interface ArchiveRepository {
  repositoryId: string;
  name: string;
  shortName: string | null;
  identifier: string | null;
  address: string | null;
  websiteUrl: string | null;
  catalogUrl: string | null;
  countryCode: string | null;
  contactNotes: string | null;
  accessNotes: string | null;
  citationTemplate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArchiveDescriptionUnit {
  unitId: string;
  repositoryId: string | null;
  parentUnitId: string | null;
  level: ArchivalLevel;
  /** Required for local levels; null for the controlled levels above. */
  localLevelLabel?: string | null;
  referenceCode: string | null;
  title: string;
  titleType: 'original' | 'supplied' | 'formal' | 'unknown';
  date: ArchiveDate;
  creatorDisplay: string | null;
  extentDisplay: string | null;
  scopeContent: string | null;
  arrangement: string | null;
  administrativeBiographicalHistory: string | null;
  custodialHistory: string | null;
  acquisitionInfo: string | null;
  accessConditions: string | null;
  reproductionConditions: string | null;
  languageCodes: string[];
  scriptCodes: string[];
  physicalCharacteristics: string | null;
  findingAids: string | null;
  relatedUnits: string | null;
  sourceCatalogUrl: string | null;
  position: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ArchiveItemUnitLink {
  itemId: string;
  unitId: string;
  relationKind: ArchiveUnitRelationKind;
  position: number;
  createdAt: string;
}

export interface ArchiveCaptureSession {
  sessionId: string;
  repositoryId: string | null;
  title: string;
  sessionKind: 'consultation' | 'download' | 'digitization' | 'received' | 'born_digital' | 'other';
  startedOn: string | null;
  endedOn: string | null;
  researcher: string | null;
  device: string | null;
  fondsScope: string | null;
  referenceScope: string | null;
  reproductionTerms: string | null;
  namingPattern: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArchiveItemFile {
  fileId: string;
  itemId: string;
  parentFileId: string | null;
  role: ArchiveFileRole;
  versionNo: number;
  sequenceNo: number;
  pageLabel: string | null;
  originalFileName: string | null;
  mimeType: string | null;
  byteSize: number;
  /** List DTOs never carry bytes; a specific blob endpoint streams them. */
  hasContent: boolean;
  externalPath: string | null;
  contentHash: string | null;
  hashAlgorithm: 'sha256' | null;
  transformation: Record<string, unknown> | null;
  captureMetadata: Record<string, unknown> | null;
  createdBy: string | null;
  createdAt: string;
  verifiedAt: string | null;
  verificationStatus: ArchiveVerificationStatus;
  supersededAt: string | null;
}

export interface ArchiveTextVersion {
  textVersionId: string;
  itemId: string;
  fileId: string | null;
  parentVersionId: string | null;
  kind: ArchiveTextKind;
  languageCode: string | null;
  content: string;
  status: ArchiveTextStatus;
  engine: string | null;
  model: string | null;
  confidence: number | null;
  editorialConventions: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
}

export interface ArchiveTextSegment {
  segmentId: string;
  textVersionId: string;
  fileId: string | null;
  sequenceNo: number;
  pageLabel: string | null;
  startOffset: number | null;
  endOffset: number | null;
  content: string;
  bbox: ArchiveRegion | null;
  timeStartMs: number | null;
  timeEndMs: number | null;
  speakerLabel: string | null;
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArchiveRegion {
  /** Coordinates are normalized to the source canvas, from 0 to 1. */
  x: number;
  y: number;
  width: number;
  height: number;
  canvasId?: string | null;
}

/**
 * A locator can combine human archival conventions with technical anchors. The
 * human display string remains authoritative for citation; the structured values
 * make exact reopening possible.
 */
export interface ArchiveLocator {
  page?: number;
  pageLabel?: string;
  folio?: string;
  side?: 'recto' | 'verso';
  canvasId?: string;
  region?: ArchiveRegion;
  segmentId?: string;
  textRange?: { start: number; end: number };
  timeRangeMs?: { start: number; end: number };
  column?: string;
  entry?: string;
  custom?: Record<string, string | number | boolean | null>;
}

export interface ArchiveExcerpt {
  excerptId: string;
  itemId: string;
  fileId: string | null;
  textVersionId: string | null;
  segmentId: string | null;
  locatorDisplay: string;
  locator: ArchiveLocator;
  /** Snapshot of what was cited; it is not rewritten when a text version changes. */
  quotedText: string | null;
  languageCode: string | null;
  description: string | null;
  reviewStatus: ArchiveReviewStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArchiveHierarchyIssue {
  code: 'missing_parent' | 'cycle' | 'self_parent' | 'duplicate_position' | 'missing_local_level_label';
  unitId: string;
  relatedUnitId?: string;
}

/** Pure invariant check used by repositories, migration tests and import previews. */
export function validateArchiveHierarchy(units: readonly ArchiveDescriptionUnit[]): ArchiveHierarchyIssue[] {
  const byId = new Map(units.map((unit) => [unit.unitId, unit]));
  const issues: ArchiveHierarchyIssue[] = [];
  const siblings = new Map<string, Map<number, string>>();

  for (const unit of units) {
    if (unit.level === 'local' && !unit.localLevelLabel?.trim()) {
      issues.push({ code: 'missing_local_level_label', unitId: unit.unitId });
    }
    if (unit.parentUnitId === unit.unitId) {
      issues.push({ code: 'self_parent', unitId: unit.unitId, relatedUnitId: unit.unitId });
      continue;
    }
    if (unit.parentUnitId && !byId.has(unit.parentUnitId)) {
      issues.push({ code: 'missing_parent', unitId: unit.unitId, relatedUnitId: unit.parentUnitId });
      continue;
    }
    const siblingKey = unit.parentUnitId ?? '__root__';
    const positions = siblings.get(siblingKey) ?? new Map<number, string>();
    const existing = positions.get(unit.position);
    if (existing) {
      issues.push({ code: 'duplicate_position', unitId: unit.unitId, relatedUnitId: existing });
    } else {
      positions.set(unit.position, unit.unitId);
    }
    siblings.set(siblingKey, positions);

    const seen = new Set<string>([unit.unitId]);
    let parentId = unit.parentUnitId;
    while (parentId) {
      if (seen.has(parentId)) {
        issues.push({ code: 'cycle', unitId: unit.unitId, relatedUnitId: parentId });
        break;
      }
      seen.add(parentId);
      parentId = byId.get(parentId)?.parentUnitId ?? null;
    }
  }
  return issues;
}

export interface ArchiveLocatorIssue {
  code: 'empty' | 'invalid_page' | 'invalid_region' | 'invalid_text_range' | 'invalid_time_range';
}

export function validateArchiveLocator(locator: ArchiveLocator): ArchiveLocatorIssue[] {
  const issues: ArchiveLocatorIssue[] = [];
  if (Object.keys(locator).length === 0) issues.push({ code: 'empty' });
  if (locator.page !== undefined && (!Number.isInteger(locator.page) || locator.page < 1)) {
    issues.push({ code: 'invalid_page' });
  }
  if (locator.region) {
    const { x, y, width, height } = locator.region;
    if (
      ![x, y, width, height].every(Number.isFinite)
      || x < 0
      || y < 0
      || width <= 0
      || height <= 0
      || x + width > 1
      || y + height > 1
    ) {
      issues.push({ code: 'invalid_region' });
    }
  }
  if (
    locator.textRange
    && (!Number.isInteger(locator.textRange.start)
      || !Number.isInteger(locator.textRange.end)
      || locator.textRange.start < 0
      || locator.textRange.end <= locator.textRange.start)
  ) {
    issues.push({ code: 'invalid_text_range' });
  }
  if (
    locator.timeRangeMs
    && (!Number.isFinite(locator.timeRangeMs.start)
      || !Number.isFinite(locator.timeRangeMs.end)
      || locator.timeRangeMs.start < 0
      || locator.timeRangeMs.end <= locator.timeRangeMs.start)
  ) {
    issues.push({ code: 'invalid_time_range' });
  }
  return issues;
}

export interface ArchiveFileInvariantIssue {
  code: 'missing_hash' | 'master_has_parent' | 'derivative_missing_parent' | 'missing_transformation' | 'invalid_version';
}

export function validateArchiveFile(file: ArchiveItemFile): ArchiveFileInvariantIssue[] {
  const issues: ArchiveFileInvariantIssue[] = [];
  const derivedRole = ['access', 'thumbnail', 'ocr', 'transcript', 'derivative'].includes(file.role);
  if (file.hasContent && (!file.contentHash || file.hashAlgorithm !== 'sha256')) {
    issues.push({ code: 'missing_hash' });
  }
  if (file.role === 'master' && file.parentFileId) issues.push({ code: 'master_has_parent' });
  if (derivedRole && !file.parentFileId) issues.push({ code: 'derivative_missing_parent' });
  if (derivedRole && !file.transformation) issues.push({ code: 'missing_transformation' });
  if (!Number.isInteger(file.versionNo) || file.versionNo < 1) issues.push({ code: 'invalid_version' });
  return issues;
}

/**
 * Master bytes and their identity fields are immutable. A "replacement" must be a
 * new file row/version, never an update to an existing master row.
 */
export function isImmutableMasterPatch(patch: Partial<ArchiveItemFile>): boolean {
  return [
    'hasContent',
    'externalPath',
    'contentHash',
    'hashAlgorithm',
    'byteSize',
    'mimeType',
    'originalFileName',
    'parentFileId',
    'role',
    'captureMetadata',
    'createdAt',
  ].some((key) => Object.prototype.hasOwnProperty.call(patch, key));
}
