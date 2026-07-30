// primarySources half of the renderer bridge, paired with electron/ipc/primarySources.ts.
// Typed as PrimarySourcesApi so the compiler, not a test, guarantees the slice is complete.
import { ipcRenderer } from 'electron';

import type { PrimarySourcesApi } from '@shared/api/primarySources';

export const primarySourcesApi: PrimarySourcesApi = {
  getPrimarySourcesWorkspace: (search, offset, limit) =>
    ipcRenderer.invoke('primarySources:workspace', search, offset, limit),
  getPrimarySourceDossier: (itemId) => ipcRenderer.invoke('primarySources:dossier', itemId),
  choosePrimarySourceFiles: () => ipcRenderer.invoke('primarySources:chooseFiles'),
  ingestPrimarySources: (input) => ipcRenderer.invoke('primarySources:ingest', input),
  createPrimarySourceUnit: (input) => ipcRenderer.invoke('primarySources:createUnit', input),
  createPrimarySourceRepository: (input) => ipcRenderer.invoke('primarySources:createRepository', input),
  createPrimarySourceCaptureSession: (input) => ipcRenderer.invoke('primarySources:createSession', input),
  createPrimarySourceCollection: (name, parentId) => ipcRenderer.invoke('primarySources:createCollection', name, parentId),
  createPrimarySourceDescriptionTemplate: (input) => ipcRenderer.invoke('primarySources:createTemplate', input),
  updatePrimarySourceArchiveRecord: (itemId, input) => ipcRenderer.invoke('primarySources:updateRecord', itemId, input),
  previewPrimarySourceBulkEdit: (itemIds) => ipcRenderer.invoke('primarySources:bulkPreview', itemIds),
  applyPrimarySourceBulkEdit: (input) => ipcRenderer.invoke('primarySources:bulkApply', input),
  addPrimarySourceFiles: (input) => ipcRenderer.invoke('primarySources:files:add', input),
  updatePrimarySourceFileMetadata: (fileId, patch) =>
    ipcRenderer.invoke('primarySources:files:updateMetadata', fileId, patch),
  reorderPrimarySourceFileGroups: (itemId, rootFileIds) =>
    ipcRenderer.invoke('primarySources:files:reorder', itemId, rootFileIds),
  verifyPrimarySourceFiles: (itemId) => ipcRenderer.invoke('primarySources:files:verifyAll', itemId),
  regeneratePrimarySourceThumbnail: (parentFileId) =>
    ipcRenderer.invoke('primarySources:files:thumbnail', parentFileId),
  savePrimarySourceFile: (fileId) => ipcRenderer.invoke('primarySources:files:save', fileId),
  openPrimarySourceFileExternal: (fileId) =>
    ipcRenderer.invoke('primarySources:files:openExternal', fileId),
  createPrimarySourceTextVersion: (input) =>
    ipcRenderer.invoke('primarySources:text:create', input),
  setPrimarySourceTextReviewStatus: (textVersionId, status) =>
    ipcRenderer.invoke('primarySources:text:review', textVersionId, status),
  createPrimarySourceExcerpt: (input) =>
    ipcRenderer.invoke('primarySources:excerpt:create', input),
  setPrimarySourceExcerptReviewStatus: (excerptId, status) =>
    ipcRenderer.invoke('primarySources:excerpt:review', excerptId, status),
  savePrimarySourceAnalysis: (itemId, patch) =>
    ipcRenderer.invoke('primarySources:analysis:save', itemId, patch),
  extractPrimarySourceProposals: (input) =>
    ipcRenderer.invoke('primarySources:proposals:extract', input),
  acceptPrimarySourceProposal: (proposalId, input) =>
    ipcRenderer.invoke('primarySources:proposals:accept', proposalId, input),
  decidePrimarySourceProposal: (proposalId, status, input) =>
    ipcRenderer.invoke('primarySources:proposals:decide', proposalId, status, input),
  revertPrimarySourceEntityResolution: (itemId, resolutionId) =>
    ipcRenderer.invoke('primarySources:resolutions:revert', itemId, resolutionId),
  listPrimarySourcePersons: (search, filter) =>
    ipcRenderer.invoke('primarySources:persons:list', search, filter),
  getPrimarySourcePersonDossier: (personId) =>
    ipcRenderer.invoke('primarySources:persons:dossier', personId),
  addPrimarySourcePersonVariant: (personId, name) =>
    ipcRenderer.invoke('primarySources:persons:addVariant', personId, name),
  mergePrimarySourcePersons: (input) =>
    ipcRenderer.invoke('primarySources:persons:merge', input),
  revertPrimarySourcePersonMerge: (resolutionId) =>
    ipcRenderer.invoke('primarySources:persons:revertMerge', resolutionId),
  getPrimarySourceTimelineWorkspace: () =>
    ipcRenderer.invoke('primarySources:timeline:workspace'),
  getPrimarySourceMapWorkspace: () =>
    ipcRenderer.invoke('primarySources:map:workspace'),
  resolvePrimarySourceToponym: (input) =>
    ipcRenderer.invoke('primarySources:map:resolveToponym', input),
  revertPrimarySourceToponymResolution: (resolutionId) =>
    ipcRenderer.invoke('primarySources:map:revertToponym', resolutionId),
  getPrimarySourceRelationsWorkspace: () =>
    ipcRenderer.invoke('primarySources:relations:workspace'),
  searchPrimarySourceCorpus: (request) =>
    ipcRenderer.invoke('primarySources:search', request),
  getPrimarySourceNoteWorkspace: () =>
    ipcRenderer.invoke('primarySources:notes:workspace'),
  createPrimarySourceNote: (input) =>
    ipcRenderer.invoke('primarySources:notes:create', input),
  updatePrimarySourceNoteProfile: (noteId, patch) =>
    ipcRenderer.invoke('primarySources:notes:updateProfile', noteId, patch),
  addPrimarySourceNoteLink: (input) =>
    ipcRenderer.invoke('primarySources:notes:addLink', input),
  removePrimarySourceNoteLink: (linkId) =>
    ipcRenderer.invoke('primarySources:notes:removeLink', linkId),
  getPrimarySourceBacklinks: (targetKind, targetId) =>
    ipcRenderer.invoke('primarySources:notes:backlinks', targetKind, targetId),
  insertPrimarySourceExcerptCitation: (input) =>
    ipcRenderer.invoke('primarySources:notes:insertCitation', input),
  getPrimarySourceOperationalDashboard: () =>
    ipcRenderer.invoke('primarySources:dashboard'),
  getPrimarySourceGovernanceWorkspace: () =>
    ipcRenderer.invoke('primarySources:governance:workspace'),
  updatePrimarySourcePolicySettings: (patch) =>
    ipcRenderer.invoke('primarySources:governance:updatePolicy', patch),
  updatePrimarySourceCitationSettings: (patch) =>
    ipcRenderer.invoke('primarySources:governance:updateCitations', patch),
  getPrimarySourceLocalMetricSummary: () =>
    ipcRenderer.invoke('primarySources:metrics:summary'),
  clearPrimarySourceLocalMetrics: () =>
    ipcRenderer.invoke('primarySources:metrics:clear').then(() => undefined),
  previewPrimarySourceToolkitOperation: (request) =>
    ipcRenderer.invoke('primarySources:toolkit:preview', request),
  runPrimarySourceToolkitOperation: (request) =>
    ipcRenderer.invoke('primarySources:toolkit:run', request),
  buildPrimarySourceCitation: (request) =>
    ipcRenderer.invoke('primarySources:citations:build', request),
  previewPrimarySourceExport: (request) =>
    ipcRenderer.invoke('primarySources:export:preview', request),
  exportPrimarySourceResearchPackage: (request) =>
    ipcRenderer.invoke('primarySources:export:package', request),
  validatePrimarySourceResearchPackage: () =>
    ipcRenderer.invoke('primarySources:export:validate'),
  restorePrimarySourceResearchPackage: (name) =>
    ipcRenderer.invoke('primarySources:export:restore', name),
};
