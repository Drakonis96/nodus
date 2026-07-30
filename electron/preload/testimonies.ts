// testimonies half of the renderer bridge, paired with electron/ipc/testimonies.ts.
// Typed as TestimoniesApi so the compiler, not a test, guarantees the slice is complete.
import { ipcRenderer } from 'electron';

import type { TestimoniesApi } from '@shared/api/testimonies';

export const testimoniesApi: TestimoniesApi = {
  // ── Testimonios (historia oral) ────────────────────────────────────────────
  // Argumentos explícitos, nunca rutas ni SQL. El blob de un medio va aparte y por id.
  testimonyDashboard: () => ipcRenderer.invoke('testimony:dashboard:get'),
  listTestimonyInterviews: (options) => ipcRenderer.invoke('testimony:interviews:list', options ?? {}),
  getTestimonyInterview: (id) => ipcRenderer.invoke('testimony:interviews:get', id),
  createTestimonyInterview: (input) => ipcRenderer.invoke('testimony:interviews:create', input),
  updateTestimonyInterview: (id, patch) => ipcRenderer.invoke('testimony:interviews:update', id, patch),
  archiveTestimonyInterview: (id, archived) => ipcRenderer.invoke('testimony:interviews:archive', id, archived),
  trashTestimonyInterview: (id, trashed) => ipcRenderer.invoke('testimony:interviews:trash', id, trashed),
  testimonyDeletionImpact: (id) => ipcRenderer.invoke('testimony:interviews:impact', id),
  purgeTestimonyInterview: (id) => ipcRenderer.invoke('testimony:interviews:purge', id).then(() => undefined),
  testimonyInterviewFacets: () => ipcRenderer.invoke('testimony:interviews:facets'),

  listTestimonyParticipants: (search) => ipcRenderer.invoke('testimony:participants:list', search ?? ''),
  getTestimonyParticipant: (personId) => ipcRenderer.invoke('testimony:participants:get', personId),
  createTestimonyParticipant: (input) => ipcRenderer.invoke('testimony:participants:create', input),
  updateTestimonyParticipant: (personId, patch) => ipcRenderer.invoke('testimony:participants:update', personId, patch),
  deleteTestimonyParticipant: (personId) => ipcRenderer.invoke('testimony:participants:delete', personId).then(() => undefined),
  testimonyParticipantInterviews: (personId) => ipcRenderer.invoke('testimony:participants:interviews', personId),
  addTestimonyParticipant: (interviewId, personId, role, options) =>
    ipcRenderer.invoke('testimony:participants:add', interviewId, personId, role, options ?? {}).then(() => undefined),
  removeTestimonyParticipant: (interviewId, personId, role) =>
    ipcRenderer.invoke('testimony:participants:remove', interviewId, personId, role).then(() => undefined),
  listTestimonyInterviewParticipants: (interviewId) => ipcRenderer.invoke('testimony:participants:forInterview', interviewId),

  testimonyAgreementHistory: (interviewId) => ipcRenderer.invoke('testimony:agreements:history', interviewId),
  saveTestimonyAgreement: (input) => ipcRenderer.invoke('testimony:agreements:save', input),

  listTestimonySessions: (interviewId) => ipcRenderer.invoke('testimony:sessions:list', interviewId),
  createTestimonySession: (input) => ipcRenderer.invoke('testimony:sessions:create', input),
  updateTestimonySession: (id, patch) => ipcRenderer.invoke('testimony:sessions:update', id, patch),
  deleteTestimonySession: (id) => ipcRenderer.invoke('testimony:sessions:delete', id).then(() => undefined),

  importTestimonyMedia: (input) => ipcRenderer.invoke('testimony:media:import', input),
  importTestimonyMediaPaths: (sessionId, paths) => ipcRenderer.invoke('testimony:media:importPaths', sessionId, paths),
  pickTestimonyMediaFiles: () => ipcRenderer.invoke('testimony:media:pick'),
  getTestimonyMediaBlob: (mediaId) => ipcRenderer.invoke('testimony:media:blob', mediaId),
  verifyTestimonyMediaHash: (mediaId) => ipcRenderer.invoke('testimony:media:verify', mediaId),
  exportTestimonyMaster: (mediaId) => ipcRenderer.invoke('testimony:media:exportMaster', mediaId),
  dropTestimonyMediaBytes: (mediaId) => ipcRenderer.invoke('testimony:media:dropBytes', mediaId),
  deleteTestimonyMedia: (mediaId) => ipcRenderer.invoke('testimony:media:delete', mediaId).then(() => undefined),

  listTestimonyTranscripts: (mediaId) => ipcRenderer.invoke('testimony:transcripts:list', mediaId),
  listTestimonySegments: (transcriptId) => ipcRenderer.invoke('testimony:transcripts:segments', transcriptId),
  createTestimonyTranscript: (input) => ipcRenderer.invoke('testimony:transcripts:create', input),
  deriveTestimonyTranscript: (sourceId, kind, options) => ipcRenderer.invoke('testimony:transcripts:derive', sourceId, kind, options ?? {}),
  deleteTestimonyTranscript: (id) => ipcRenderer.invoke('testimony:transcripts:delete', id).then(() => undefined),
  updateTestimonySegment: (id, patch) => ipcRenderer.invoke('testimony:transcripts:updateSegment', id, patch),
  assignTestimonySpeaker: (transcriptId, speakerLabel, personId) =>
    ipcRenderer.invoke('testimony:transcripts:assignSpeaker', transcriptId, speakerLabel, personId),
  testimonySpeakerLabels: (transcriptId) => ipcRenderer.invoke('testimony:transcripts:speakers', transcriptId),
  buildTestimonyIndex: () => ipcRenderer.invoke('testimony:index:build'),
  testimonyIndexStatus: () => ipcRenderer.invoke('testimony:index:status'),
  clearTestimonyIndex: () => ipcRenderer.invoke('testimony:index:clear'),
  searchTestimoniesBySemantics: (query, limit) => ipcRenderer.invoke('testimony:search:semantic', query, limit ?? null),
  analyzeTestimonyInterview: (interviewId) => ipcRenderer.invoke('testimony:ai:analyze', interviewId),
  improveTestimonyTranscript: (transcriptId) => ipcRenderer.invoke('testimony:ai:improve', transcriptId),
  applyDetectedTestimonySpeakers: (transcriptId, entries) =>
    ipcRenderer.invoke('testimony:transcripts:applyDetectedSpeakers', transcriptId, entries),

  listTestimonyCodes: () => ipcRenderer.invoke('testimony:codes:list'),
  createTestimonyCode: (input) => ipcRenderer.invoke('testimony:codes:create', input),
  updateTestimonyCode: (id, patch) => ipcRenderer.invoke('testimony:codes:update', id, patch),
  deleteTestimonyCode: (id) => ipcRenderer.invoke('testimony:codes:delete', id).then(() => undefined),
  mergeTestimonyCodes: (sourceId, targetId) => ipcRenderer.invoke('testimony:codes:merge', sourceId, targetId),
  listTestimonyAnnotations: (interviewId) => ipcRenderer.invoke('testimony:annotations:list', interviewId),
  createTestimonyAnnotation: (input) => ipcRenderer.invoke('testimony:annotations:create', input),
  updateTestimonyAnnotation: (id, patch) => ipcRenderer.invoke('testimony:annotations:update', id, patch),
  deleteTestimonyAnnotation: (id) => ipcRenderer.invoke('testimony:annotations:delete', id).then(() => undefined),
  testimonyFragments: (filters) => ipcRenderer.invoke('testimony:annotations:fragments', filters),

  listTestimonyContrasts: () => ipcRenderer.invoke('testimony:contrasts:list'),
  getTestimonyContrast: (id) => ipcRenderer.invoke('testimony:contrasts:get', id),
  createTestimonyContrast: (input) => ipcRenderer.invoke('testimony:contrasts:create', input),
  updateTestimonyContrast: (id, patch) => ipcRenderer.invoke('testimony:contrasts:update', id, patch),
  deleteTestimonyContrast: (id) => ipcRenderer.invoke('testimony:contrasts:delete', id).then(() => undefined),
  pinTestimonyFragment: (contrastId, annotationId, pinned) => ipcRenderer.invoke('testimony:contrasts:pin', contrastId, annotationId, pinned),
  reorderTestimonyContrastItems: (contrastId, annotationIds) => ipcRenderer.invoke('testimony:contrasts:reorder', contrastId, annotationIds),
  runTestimonyContrast: (filters) => ipcRenderer.invoke('testimony:contrasts:run', filters),

  searchTestimonies: (query, kinds) => ipcRenderer.invoke('testimony:search:query', query, kinds ?? null),

  listNoteLinks: (noteId) => ipcRenderer.invoke('testimony:notes:links', noteId),
  linksForTarget: (targetKind, targetId) => ipcRenderer.invoke('testimony:notes:linksForTarget', targetKind, targetId),
  addNoteLink: (noteId, targetKind, targetId, label) =>
    ipcRenderer.invoke('testimony:notes:addLink', noteId, targetKind, targetId, label ?? null).then(() => undefined),
  removeNoteLink: (noteId, targetKind, targetId) =>
    ipcRenderer.invoke('testimony:notes:removeLink', noteId, targetKind, targetId).then(() => undefined),
  createNoteFromFragment: (annotationId) => ipcRenderer.invoke('testimony:notes:fromFragment', annotationId),

  exportTestimonyPackage: (request) => ipcRenderer.invoke('testimony:export:package', request),
  testimonyAccessDecision: (interviewId, channel) => ipcRenderer.invoke('testimony:export:accessDecision', interviewId, channel),
};
