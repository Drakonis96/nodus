// The testimonies slice of the window.nodus contract. NodusApi extends it, so the
// renderer surface stays flat and every call site is unchanged.
import type { AnnotationKind, InterviewFilters, InterviewSort, MediaRole, ParticipantRole as OralHistoryParticipantRole, TranscriptKind, TranscriptStatus } from '../testimonies';
import type { AccessChannel, AccessDecision } from '../testimonyAccess';// Declared in shared/types.ts itself; the resulting cycle is types-only and erased at build time.
import type {
  NoteLink,
  TestimonyAgreement,
  TestimonyAgreementInput,
  TestimonyAnnotation,
  TestimonyAnnotationInput,
  TestimonyCode,
  TestimonyCodeInput,
  TestimonyContrast,
  TestimonyContrastFilters,
  TestimonyContrastInput,
  TestimonyContrastResult,
  TestimonyDashboard,
  TestimonyDeletionImpact,
  TestimonyExportRequest,
  TestimonyExportResult,
  TestimonyFragment,
  TestimonyIndexReport,
  TestimonyIndexStatus,
  TestimonyInterview,
  TestimonyInterviewAnalysis,
  TestimonyInterviewInput,
  TestimonyInterviewParticipant,
  TestimonyInterviewRow,
  TestimonyMedia,
  TestimonyMediaImportResult,
  TestimonyParticipantInput,
  TestimonyParticipantProfile,
  TestimonyParticipantRow,
  TestimonySearchHit,
  TestimonySearchKind,
  TestimonySemanticHit,
  TestimonySession,
  TestimonySessionInput,
  TestimonyTranscript,
  TestimonyTranscriptImprovement,
  TestimonyTranscriptSegment,
} from '../types';

export interface TestimoniesApi {
  // ── Testimonios (historia oral) ────────────────────────────────────────────
  // Los canales van agrupados por entidad y NUNCA exponen rutas ni SQL: el renderer
  // pide entrevistas, no consultas. El blob de un medio se pide siempre aparte, por id,
  // para que ninguna lista arrastre horas de audio.
  testimonyDashboard(): Promise<TestimonyDashboard>;
  listTestimonyInterviews(options?: { filters?: InterviewFilters; sort?: InterviewSort; limit?: number }): Promise<TestimonyInterviewRow[]>;
  getTestimonyInterview(id: string): Promise<TestimonyInterviewRow | null>;
  createTestimonyInterview(input: TestimonyInterviewInput): Promise<TestimonyInterview>;
  updateTestimonyInterview(id: string, patch: Partial<TestimonyInterviewInput>): Promise<TestimonyInterview | null>;
  archiveTestimonyInterview(id: string, archived: boolean): Promise<TestimonyInterview | null>;
  trashTestimonyInterview(id: string, trashed: boolean): Promise<TestimonyInterview | null>;
  testimonyDeletionImpact(id: string): Promise<TestimonyDeletionImpact | null>;
  purgeTestimonyInterview(id: string): Promise<void>;
  testimonyInterviewFacets(): Promise<{ collections: string[]; languages: string[] }>;

  listTestimonyParticipants(search?: string): Promise<TestimonyParticipantRow[]>;
  getTestimonyParticipant(personId: string): Promise<TestimonyParticipantProfile | null>;
  createTestimonyParticipant(input: TestimonyParticipantInput): Promise<TestimonyParticipantProfile>;
  updateTestimonyParticipant(personId: string, patch: Partial<TestimonyParticipantInput>): Promise<TestimonyParticipantProfile | null>;
  deleteTestimonyParticipant(personId: string): Promise<void>;
  testimonyParticipantInterviews(personId: string): Promise<{ interviewId: string; title: string; shortId: string; role: OralHistoryParticipantRole; at: string | null; workflowStatus: string; accessLevel: string }[]>;
  addTestimonyParticipant(interviewId: string, personId: string, role: OralHistoryParticipantRole, options?: { isPrimary?: boolean; speakerLabel?: string | null }): Promise<void>;
  removeTestimonyParticipant(interviewId: string, personId: string, role: OralHistoryParticipantRole): Promise<void>;
  listTestimonyInterviewParticipants(interviewId: string): Promise<TestimonyInterviewParticipant[]>;

  testimonyAgreementHistory(interviewId: string): Promise<TestimonyAgreement[]>;
  saveTestimonyAgreement(input: TestimonyAgreementInput): Promise<TestimonyAgreement>;

  listTestimonySessions(interviewId: string): Promise<TestimonySession[]>;
  createTestimonySession(input: TestimonySessionInput): Promise<TestimonySession>;
  updateTestimonySession(id: string, patch: Partial<TestimonySessionInput>): Promise<TestimonySession | null>;
  deleteTestimonySession(id: string): Promise<void>;

  importTestimonyMedia(input: { sessionId: string; fileName: string; mimeType: string; bytes: ArrayBuffer; durationSeconds?: number | null; role?: MediaRole }): Promise<TestimonyMediaImportResult>;
  importTestimonyMediaPaths(sessionId: string, paths: string[]): Promise<TestimonyMediaImportResult[]>;
  pickTestimonyMediaFiles(): Promise<string[]>;
  getTestimonyMediaBlob(mediaId: string): Promise<{ bytes: ArrayBuffer; mimeType: string; fileName: string } | null>;
  verifyTestimonyMediaHash(mediaId: string): Promise<{ ok: boolean; expected: string | null; actual: string | null }>;
  exportTestimonyMaster(mediaId: string): Promise<string | null>;
  dropTestimonyMediaBytes(mediaId: string): Promise<TestimonyMedia | null>;
  deleteTestimonyMedia(mediaId: string): Promise<void>;

  listTestimonyTranscripts(mediaId: string): Promise<TestimonyTranscript[]>;
  listTestimonySegments(transcriptId: string): Promise<TestimonyTranscriptSegment[]>;
  createTestimonyTranscript(input: { mediaId: string; kind: TranscriptKind; language?: string | null; contentMarkdown?: string | null; status?: TranscriptStatus; sourceTranscriptId?: string | null; modelProvider?: string | null; modelName?: string | null; segments?: { tStart: number; tEnd: number; text: string; speakerLabel?: string | null; confidence?: number | null }[] }): Promise<TestimonyTranscript>;
  deriveTestimonyTranscript(sourceId: string, kind: TranscriptKind, options?: { language?: string | null }): Promise<{ transcript: TestimonyTranscript; remapped: number; needsReview: number }>;
  deleteTestimonyTranscript(id: string): Promise<void>;
  updateTestimonySegment(id: string, patch: { text?: string; speakerPersonId?: string | null; speakerLabel?: string | null; tStart?: number; tEnd?: number }): Promise<TestimonyTranscriptSegment | null>;
  assignTestimonySpeaker(transcriptId: string, speakerLabel: string | null, personId: string | null): Promise<number>;
  testimonySpeakerLabels(transcriptId: string): Promise<{ label: string | null; personId: string | null; segments: number }[]>;
  buildTestimonyIndex(): Promise<TestimonyIndexReport>;
  testimonyIndexStatus(): Promise<TestimonyIndexStatus>;
  clearTestimonyIndex(): Promise<number>;
  searchTestimoniesBySemantics(query: string, limit?: number): Promise<TestimonySemanticHit[]>;
  analyzeTestimonyInterview(interviewId: string): Promise<TestimonyInterviewAnalysis>;
  improveTestimonyTranscript(transcriptId: string): Promise<TestimonyTranscriptImprovement>;
  applyDetectedTestimonySpeakers(
    transcriptId: string,
    entries: { segmentId: string; label: string | null }[],
  ): Promise<{ changed: number; skipped: number }>;

  listTestimonyCodes(): Promise<TestimonyCode[]>;
  createTestimonyCode(input: TestimonyCodeInput): Promise<TestimonyCode>;
  updateTestimonyCode(id: string, patch: Partial<TestimonyCodeInput>): Promise<TestimonyCode | null>;
  deleteTestimonyCode(id: string): Promise<void>;
  mergeTestimonyCodes(sourceId: string, targetId: string): Promise<TestimonyCode | null>;
  listTestimonyAnnotations(interviewId: string): Promise<TestimonyAnnotation[]>;
  createTestimonyAnnotation(input: TestimonyAnnotationInput): Promise<TestimonyAnnotation>;
  updateTestimonyAnnotation(id: string, patch: { memo?: string | null; kind?: AnnotationKind; codeIds?: string[]; linkStatus?: 'valid' | 'needs_review' }): Promise<TestimonyAnnotation | null>;
  deleteTestimonyAnnotation(id: string): Promise<void>;
  testimonyFragments(filters: TestimonyContrastFilters): Promise<TestimonyFragment[]>;

  listTestimonyContrasts(): Promise<TestimonyContrast[]>;
  getTestimonyContrast(id: string): Promise<TestimonyContrast | null>;
  createTestimonyContrast(input: TestimonyContrastInput): Promise<TestimonyContrast>;
  updateTestimonyContrast(id: string, patch: Partial<TestimonyContrastInput>): Promise<TestimonyContrast | null>;
  deleteTestimonyContrast(id: string): Promise<void>;
  pinTestimonyFragment(contrastId: string, annotationId: string, pinned: boolean): Promise<TestimonyContrast | null>;
  reorderTestimonyContrastItems(contrastId: string, annotationIds: string[]): Promise<TestimonyContrast | null>;
  runTestimonyContrast(filters: TestimonyContrastFilters): Promise<TestimonyContrastResult>;

  searchTestimonies(query: string, kinds?: TestimonySearchKind[]): Promise<TestimonySearchHit[]>;

  listNoteLinks(noteId: string): Promise<NoteLink[]>;
  linksForTarget(targetKind: string, targetId: string): Promise<NoteLink[]>;
  addNoteLink(noteId: string, targetKind: string, targetId: string, label?: string | null): Promise<void>;
  removeNoteLink(noteId: string, targetKind: string, targetId: string): Promise<void>;
  createNoteFromFragment(annotationId: string): Promise<{ noteId: string; title: string }>;

  exportTestimonyPackage(request: TestimonyExportRequest): Promise<TestimonyExportResult | null>;
  testimonyAccessDecision(interviewId: string, channel: AccessChannel): Promise<AccessDecision>;
}
