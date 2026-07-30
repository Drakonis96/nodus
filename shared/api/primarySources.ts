// The primarySources slice of the window.nodus contract. NodusApi extends it, so the
// renderer surface stays flat and every call site is unchanged.
// Declared in shared/types.ts itself; the resulting cycle is types-only and erased at build time.
import type {
  ArchiveFolder,
} from '../types';

export interface PrimarySourcesApi {
  // Primary Sources: canonical archival workspace over the compatible archive.
  getPrimarySourcesWorkspace(
    search?: string,
    offset?: number,
    limit?: number
  ): Promise<import('../primarySourcesTypes').PrimarySourceArchiveWorkspace>;
  getPrimarySourceDossier(itemId: string): Promise<import('../primarySourcesTypes').PrimarySourceDossier | null>;
  choosePrimarySourceFiles(): Promise<string[]>;
  ingestPrimarySources(
    input: import('../primarySourcesTypes').PrimarySourceIngestInput
  ): Promise<import('../primarySourcesTypes').PrimarySourceIngestSummary>;
  createPrimarySourceUnit(
    input: import('../primarySourcesTypes').PrimarySourceUnitCreateInput
  ): Promise<import('../archiveTypes').ArchiveDescriptionUnit>;
  createPrimarySourceRepository(
    input: Pick<import('../archiveTypes').ArchiveRepository, 'name'> &
      Partial<Omit<import('../archiveTypes').ArchiveRepository, 'repositoryId' | 'name' | 'createdAt' | 'updatedAt'>>
  ): Promise<import('../archiveTypes').ArchiveRepository>;
  createPrimarySourceCaptureSession(
    input: Pick<import('../archiveTypes').ArchiveCaptureSession, 'title'> &
      Partial<Omit<import('../archiveTypes').ArchiveCaptureSession, 'sessionId' | 'title' | 'createdAt' | 'updatedAt'>>
  ): Promise<import('../archiveTypes').ArchiveCaptureSession>;
  createPrimarySourceCollection(name: string, parentId?: string | null): Promise<ArchiveFolder>;
  createPrimarySourceDescriptionTemplate(input: {
    name: string;
    documentType?: string | null;
    defaultLevel?: import('../archiveTypes').ArchiveDescriptionUnit['level'];
    unitDefaults?: Partial<import('../archiveTypes').ArchiveDescriptionUnit>;
    profileDefaults?: Partial<import('../primarySourcesTypes').PrimarySourceItemProfile>;
  }): Promise<import('../primarySourcesTypes').PrimarySourceDescriptionTemplate>;
  updatePrimarySourceArchiveRecord(
    itemId: string,
    input: import('../primarySourcesTypes').PrimarySourceArchiveEditInput
  ): Promise<import('../primarySourcesTypes').PrimarySourceArchiveRow>;
  previewPrimarySourceBulkEdit(itemIds: string[]): Promise<import('../primarySourcesTypes').PrimarySourceBulkPreview>;
  applyPrimarySourceBulkEdit(input: {
    itemIds: string[];
    patch: import('../primarySourcesTypes').PrimarySourceBulkPatch;
    expectedRevisions: Record<string, string>;
  }): Promise<import('../primarySourcesTypes').PrimarySourceArchiveRow[]>;
  addPrimarySourceFiles(
    input: import('../primarySourcesTypes').PrimarySourceFileImportInput
  ): Promise<import('../primarySourcesTypes').PrimarySourceFileImportResult>;
  updatePrimarySourceFileMetadata(
    fileId: string,
    patch: import('../primarySourcesTypes').PrimarySourceFileMetadataPatch
  ): Promise<import('../primarySourcesTypes').PrimarySourceDossier>;
  reorderPrimarySourceFileGroups(
    itemId: string,
    rootFileIds: string[]
  ): Promise<import('../primarySourcesTypes').PrimarySourceDossier>;
  verifyPrimarySourceFiles(itemId: string): Promise<import('../primarySourcesTypes').PrimarySourceDossier>;
  regeneratePrimarySourceThumbnail(parentFileId: string): Promise<import('../primarySourcesTypes').PrimarySourceDossier>;
  savePrimarySourceFile(fileId: string): Promise<string | null>;
  openPrimarySourceFileExternal(fileId: string): Promise<boolean>;
  createPrimarySourceTextVersion(
    input: import('../primarySourcesTypes').PrimarySourceTextVersionCreateInput
  ): Promise<import('../primarySourcesTypes').PrimarySourceDossier>;
  setPrimarySourceTextReviewStatus(
    textVersionId: string,
    status: import('../archiveTypes').ArchiveTextStatus
  ): Promise<import('../primarySourcesTypes').PrimarySourceDossier>;
  createPrimarySourceExcerpt(
    input: import('../primarySourcesTypes').PrimarySourceExcerptCreateInput
  ): Promise<import('../primarySourcesTypes').PrimarySourceDossier>;
  setPrimarySourceExcerptReviewStatus(
    excerptId: string,
    status: import('../archiveTypes').ArchiveReviewStatus
  ): Promise<import('../primarySourcesTypes').PrimarySourceDossier>;
  savePrimarySourceAnalysis(
    itemId: string,
    patch: Partial<Omit<
      import('../primarySourcesTypes').PrimarySourceAnalysis,
      'analysisId' | 'itemId' | 'createdAt' | 'updatedAt'
    >>
  ): Promise<import('../primarySourcesTypes').PrimarySourceDossier>;
  extractPrimarySourceProposals(
    input: import('../primarySourcesTypes').PrimarySourceProposalExtractionInput
  ): Promise<{
    result: import('../primarySourcesTypes').PrimarySourceProposalExtractionResult;
    dossier: import('../primarySourcesTypes').PrimarySourceDossier;
  }>;
  acceptPrimarySourceProposal(
    proposalId: string,
    input: import('../primarySourcesTypes').PrimarySourceProposalAcceptanceInput
  ): Promise<{
    result: import('../primarySourcesTypes').PrimarySourceProposalAcceptanceResult;
    dossier: import('../primarySourcesTypes').PrimarySourceDossier;
  }>;
  decidePrimarySourceProposal(
    proposalId: string,
    status: 'rejected' | 'deferred',
    input: import('../primarySourcesTypes').PrimarySourceProposalDecisionInput
  ): Promise<import('../primarySourcesTypes').PrimarySourceDossier>;
  revertPrimarySourceEntityResolution(
    itemId: string,
    resolutionId: string
  ): Promise<import('../primarySourcesTypes').PrimarySourceDossier>;
  listPrimarySourcePersons(
    search?: string,
    filter?: import('../primarySourcesTypes').PrimarySourcePersonFilter
  ): Promise<import('../primarySourcesTypes').PrimarySourcePersonSummary[]>;
  getPrimarySourcePersonDossier(
    personId: string
  ): Promise<import('../primarySourcesTypes').PrimarySourcePersonDossier | null>;
  addPrimarySourcePersonVariant(
    personId: string,
    name: string
  ): Promise<import('../primarySourcesTypes').PrimarySourcePersonDossier>;
  mergePrimarySourcePersons(input: {
    sourcePersonId: string;
    targetPersonId: string;
    rationale?: string | null;
  }): Promise<import('../primarySourcesTypes').PrimarySourcePersonDossier>;
  revertPrimarySourcePersonMerge(
    resolutionId: string
  ): Promise<import('../primarySourcesTypes').PrimarySourcePersonDossier | null>;
  getPrimarySourceTimelineWorkspace(
  ): Promise<import('../primarySourcesTypes').PrimarySourceTimelineWorkspace>;
  getPrimarySourceMapWorkspace(
  ): Promise<import('../primarySourcesTypes').PrimarySourceMapWorkspace>;
  resolvePrimarySourceToponym(
    input: import('../primarySourcesTypes').PrimarySourceToponymResolutionInput
  ): Promise<import('../primarySourcesTypes').PrimarySourceMapWorkspace>;
  revertPrimarySourceToponymResolution(
    resolutionId: string
  ): Promise<import('../primarySourcesTypes').PrimarySourceMapWorkspace>;
  getPrimarySourceRelationsWorkspace(
  ): Promise<import('../primarySourcesTypes').PrimarySourceRelationsWorkspace>;
  searchPrimarySourceCorpus(
    request: import('../primarySourcesTypes').PrimarySourceSearchRequest
  ): Promise<import('../primarySourcesTypes').PrimarySourceSearchResponse>;
  getPrimarySourceNoteWorkspace(
  ): Promise<import('../primarySourcesTypes').PrimarySourceNoteWorkspace>;
  createPrimarySourceNote(input: {
    title: string;
    content?: string;
    noteType?: import('../primarySourcesTypes').PrimarySourceNoteType;
    status?: import('../primarySourcesTypes').PrimarySourceNoteStatus;
    collection?: string | null;
    accessStatus?: import('../primarySourcesTypes').PrimarySourceAccessStatus;
    sensitivity?: import('../primarySourcesTypes').PrimarySourceSensitivity;
  }): Promise<import('../primarySourcesTypes').PrimarySourceResearchNote>;
  updatePrimarySourceNoteProfile(
    noteId: string,
    patch: import('../primarySourcesTypes').PrimarySourceNoteProfilePatch
  ): Promise<import('../primarySourcesTypes').PrimarySourceNoteProfile>;
  addPrimarySourceNoteLink(
    input: import('../primarySourcesTypes').PrimarySourceNoteLinkInput
  ): Promise<import('../primarySourcesTypes').PrimarySourceResearchNoteLink>;
  removePrimarySourceNoteLink(linkId: string): Promise<boolean>;
  getPrimarySourceBacklinks(
    targetKind: import('../primarySourcesTypes').PrimarySourceSearchTargetKind,
    targetId: string
  ): Promise<import('../primarySourcesTypes').PrimarySourceResearchNoteLink[]>;
  insertPrimarySourceExcerptCitation(
    input: import('../primarySourcesTypes').PrimarySourceNoteLinkInput
  ): Promise<import('../primarySourcesTypes').PrimarySourceCitationInsertion>;
  getPrimarySourceOperationalDashboard(
  ): Promise<import('../primarySourcesTypes').PrimarySourceOperationalDashboard>;
  getPrimarySourceGovernanceWorkspace(
  ): Promise<import('../primarySourcesTypes').PrimarySourceGovernanceWorkspace>;
  updatePrimarySourcePolicySettings(
    patch: import('../primarySourcesTypes').PrimarySourcePolicySettingsPatch
  ): Promise<import('../primarySourcesTypes').PrimarySourcePolicySettings>;
  updatePrimarySourceCitationSettings(
    patch: Partial<Omit<import('../primarySourcesTypes').PrimarySourceCitationSettings, 'updatedAt'>>
  ): Promise<import('../primarySourcesTypes').PrimarySourceCitationSettings>;
  getPrimarySourceLocalMetricSummary(
  ): Promise<import('../primarySourcesTypes').PrimarySourceLocalMetricSummary>;
  clearPrimarySourceLocalMetrics(): Promise<void>;
  previewPrimarySourceToolkitOperation(
    request: import('../primarySourcesTypes').PrimarySourceToolkitRequest
  ): Promise<import('../primarySourcesTypes').PrimarySourceToolkitContextPreview>;
  runPrimarySourceToolkitOperation(
    request: import('../primarySourcesTypes').PrimarySourceToolkitRequest
  ): Promise<import('../primarySourcesTypes').PrimarySourceToolkitResult>;
  buildPrimarySourceCitation(
    request: import('../primarySourcesTypes').PrimarySourceCitationBuildRequest
  ): Promise<import('../primarySourcesTypes').PrimarySourceBuiltCitation>;
  previewPrimarySourceExport(
    request: import('../primarySourcesTypes').PrimarySourceExportRequest
  ): Promise<import('../primarySourcesTypes').PrimarySourceExportPreview>;
  exportPrimarySourceResearchPackage(
    request: import('../primarySourcesTypes').PrimarySourceExportRequest
  ): Promise<import('../primarySourcesTypes').PrimarySourceExportResult>;
  validatePrimarySourceResearchPackage(
  ): Promise<import('../primarySourcesTypes').PrimarySourcePackageValidation | null>;
  restorePrimarySourceResearchPackage(
    name?: string | null
  ): Promise<import('../primarySourcesTypes').PrimarySourceRestoreReport | null>;
}
