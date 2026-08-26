/**
 * Browser-safe contract for the owner-controlled publication policy and the
 * publisher-scoped personal import channel.
 *
 * Personal annotations are deliberately not part of a canonical snapshot. A
 * snapshot is the corpus everybody in a space can read; this channel is the
 * private, publisher-attributed overlay that a server may accept or discard
 * independently of that corpus.
 */

export const SERVER_PERSONAL_IMPORT_FORMAT = 'nodus.server-personal-import' as const;
export const SERVER_PERSONAL_IMPORT_VERSION = 1 as const;
export const SERVER_PUBLICATION_POLICY_VERSION = 1 as const;

/** Tables that are never allowed into either a canonical or personal import. */
export const PERMANENT_PUBLICATION_DENYLIST = [
  'audio_clips', 'testimony_media', 'testimony_interview_media',
  'social_contacts',
  'testimony_agreements', 'testimony_agreement_versions',
  'teaching_groups', 'teaching_students', 'teaching_assessment_plans',
  'teaching_assessment_items', 'teaching_grade_entries', 'teaching_rubric_evaluations',
  'study_attempts', 'study_attempt_answers', 'study_grading_runs',
  'study_grading_annotations', 'study_mastery', 'study_reviews', 'study_srs_state',
] as const;

export type PermanentlyDeniedPublicationTable = typeof PERMANENT_PUBLICATION_DENYLIST[number];

/**
 * Owner policy is intentionally opt-in. Missing, malformed or unavailable
 * policies resolve to this value; an old server therefore cannot accidentally
 * receive the new projections.
 */
export interface ServerPublicationPolicy {
  version: number;
  allowUserContent: boolean;
  allowPersonalImports: boolean;
  allowLibraryDocuments: boolean;
  allowPassages: boolean;
  allowVectors: boolean;
  allowPrimarySources: boolean;
  allowTestimonies: boolean;
}

export const RESTRICTIVE_SERVER_PUBLICATION_POLICY: ServerPublicationPolicy = {
  version: SERVER_PUBLICATION_POLICY_VERSION,
  allowUserContent: false,
  allowPersonalImports: false,
  allowLibraryDocuments: false,
  allowPassages: false,
  allowVectors: false,
  allowPrimarySources: false,
  allowTestimonies: false,
};

export interface ServerPersonalImportRow {
  table: string;
  key: unknown[];
  row: Record<string, unknown>;
}

export interface ServerPersonalLibraryAnnotation {
  documentId: string;
  annotation: Record<string, unknown>;
}

export interface ServerPersonalImportBatch {
  id: string;
  publisherId: string;
  vaultId: string;
  vaultType: string;
  sourceRevision: string;
  rows: ServerPersonalImportRow[];
  libraryAnnotations: ServerPersonalLibraryAnnotation[];
}

export interface ServerPersonalImportEnvelope {
  format: typeof SERVER_PERSONAL_IMPORT_FORMAT;
  formatVersion: typeof SERVER_PERSONAL_IMPORT_VERSION;
  publisher: { id: string; kind: 'desktop' };
  vault: { id: string; name: string; type: string };
  generatedAt: string;
  batches: ServerPersonalImportBatch[];
  /** Flat additive list consumed by the classic server import endpoint. */
  annotations?: Record<string, unknown>[];
}

/**
 * The server may wrap policy in `{ policy: ... }` or return the document
 * directly. Both forms are accepted so a rolling server upgrade cannot widen
 * the projection by accident.
 */
export function normalizeServerPublicationPolicy(value: unknown): ServerPublicationPolicy {
  const root = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const candidate = root.policy && typeof root.policy === 'object'
    ? root.policy as Record<string, unknown>
    : root;
  const boolean = (key: keyof ServerPublicationPolicy): boolean => candidate[key] === true;
  return {
    version: Number.isSafeInteger(candidate.version) ? Number(candidate.version) : SERVER_PUBLICATION_POLICY_VERSION,
    allowUserContent: boolean('allowUserContent'),
    allowPersonalImports: boolean('allowPersonalImports') || candidate.allowLegacyPublisherImport === true,
    allowLibraryDocuments: boolean('allowLibraryDocuments'),
    allowPassages: boolean('allowPassages'),
    allowVectors: boolean('allowVectors'),
    allowPrimarySources: boolean('allowPrimarySources'),
    allowTestimonies: boolean('allowTestimonies'),
  };
}

export function personalImportEndpoint(baseUrl: string, spaceId: string): string {
  return `${baseUrl}/api/v1/spaces/${encodeURIComponent(spaceId)}/personal-annotations/import`;
}
