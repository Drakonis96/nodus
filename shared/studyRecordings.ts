export const STUDY_RECORDING_EXTENSIONS = ['mp3', 'wav', 'm4a', 'ogg', 'webm'] as const;

export type StudyRecordingStatus = 'pending' | 'transcribing' | 'ready' | 'cancelled' | 'error';
export type StudyTranscriptKind = 'literal' | 'corrected' | 'notes';

export interface StudyRecordingScope {
  courseId?: string | null;
  subjectId?: string | null;
  topicId?: string | null;
  documentId?: string | null;
  materialId?: string | null;
  sessionLabel?: string | null;
}

export interface StudyRecordingSummary {
  id: string;
  shortId: string;
  title: string;
  fileName: string;
  mimeType: string;
  contentHash: string;
  durationSeconds: number;
  sizeBytes: number;
  language: string;
  courseId: string | null;
  subjectId: string | null;
  topicId: string | null;
  documentId: string | null;
  materialId: string | null;
  sessionLabel: string;
  processingStatus: StudyRecordingStatus;
  processingProgress: number;
  favorite: boolean;
  position: number;
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudyAudioMarker {
  id: string;
  shortId: string;
  recordingId: string;
  tSeconds: number;
  label: string;
  note: string;
  color: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface StudyTranscriptSegment {
  id: string;
  shortId: string;
  transcriptId: string;
  tStart: number;
  tEnd: number;
  text: string;
  speaker: string;
  confidence: number | null;
  chapter: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface StudyTranscript {
  id: string;
  shortId: string;
  recordingId: string;
  kind: StudyTranscriptKind;
  contentMarkdown: string;
  language: string;
  modelProvider: string;
  modelName: string;
  status: StudyRecordingStatus;
  progress: number;
  errorMessage: string;
  versionNo: number;
  sourceTranscriptId: string | null;
  segments: StudyTranscriptSegment[];
  createdAt: string;
  updatedAt: string;
}

export interface StudyRecordingDetail extends StudyRecordingSummary {
  markers: StudyAudioMarker[];
  transcripts: StudyTranscript[];
}

export interface StudyRecordingContent {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
}

export interface StudyRecordingCreateInput extends StudyRecordingScope {
  title?: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  durationSeconds?: number;
  language?: string;
}

export interface StudyRecordingImportResult {
  recording: StudyRecordingSummary;
  duplicate: boolean;
}

export interface StudyRecordingUpdateInput extends StudyRecordingScope {
  title?: string;
  durationSeconds?: number;
  language?: string;
  processingStatus?: StudyRecordingStatus;
  processingProgress?: number;
  favorite?: boolean;
  position?: number;
}

export interface StudyRecordingListOptions {
  search?: string;
  courseId?: string;
  subjectId?: string;
  topicId?: string;
  documentId?: string;
  status?: StudyRecordingStatus | 'all';
  includeArchived?: boolean;
  includeDeleted?: boolean;
}

export interface StudyAudioMarkerInput {
  tSeconds: number;
  label: string;
  note?: string;
  color?: string;
}

export interface StudyTranscriptSegmentInput {
  tStart: number;
  tEnd: number;
  text: string;
  speaker?: string;
  confidence?: number | null;
  chapter?: string;
}

export interface StudyTranscriptInput {
  kind: StudyTranscriptKind;
  contentMarkdown: string;
  language?: string;
  modelProvider?: string;
  modelName?: string;
  status?: StudyRecordingStatus;
  progress?: number;
  errorMessage?: string;
  sourceTranscriptId?: string | null;
  segments?: StudyTranscriptSegmentInput[];
}

export interface StudyWhisperChunk {
  text: string;
  timestamp?: [number | null, number | null] | null;
}

export function formatStudyTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function normalizeStudyTranscriptSegments(
  chunks: StudyWhisperChunk[] | undefined,
  text: string,
  durationSeconds: number,
): StudyTranscriptSegmentInput[] {
  const valid = (chunks ?? []).map((chunk) => ({
    text: chunk.text.replace(/\s+/g, ' ').trim(),
    tStart: Math.max(0, Number(chunk.timestamp?.[0] ?? 0)),
    tEnd: Math.max(0, Number(chunk.timestamp?.[1] ?? chunk.timestamp?.[0] ?? 0)),
  })).filter((chunk) => chunk.text);
  if (valid.length) {
    return valid.map((chunk, index) => ({
      ...chunk,
      tEnd: Math.max(chunk.tStart, chunk.tEnd || valid[index + 1]?.tStart || durationSeconds || chunk.tStart),
      chapter: detectStudyChapter(chunk.text),
    }));
  }
  const sentences = text.split(/(?<=[.!?])\s+|\n+/u).map((part) => part.trim()).filter(Boolean);
  if (!sentences.length) return [];
  const totalWeight = sentences.reduce((sum, sentence) => sum + Math.max(1, sentence.length), 0);
  let cursor = 0;
  return sentences.map((sentence, index) => {
    const start = durationSeconds > 0 ? cursor / totalWeight * durationSeconds : index * 8;
    cursor += Math.max(1, sentence.length);
    const end = durationSeconds > 0 ? cursor / totalWeight * durationSeconds : start + 8;
    return { tStart: start, tEnd: end, text: sentence, chapter: detectStudyChapter(sentence) };
  });
}

export function detectStudyChapter(text: string): string {
  const match = text.trim().match(/^(?:cap[ií]tulo|tema|parte|section|chapter)\s+([\p{L}\dIVXLC.-]+)(?:\s*[:.-]\s*(.*))?$/iu);
  if (!match) return '';
  return [match[1], match[2]].filter(Boolean).join(' · ');
}

export function correctedStudyTranscript(literal: string): string {
  return literal
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([.!?])\s*(\p{Ll})/gu, (_match, punctuation: string, letter: string) => `${punctuation} ${letter.toLocaleUpperCase()}`)
    .replace(/(^|\n)(\p{Ll})/gu, (_match, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase()}`)
    .trim();
}

export function structuredStudyNotes(title: string, transcript: string): string {
  const paragraphs = transcript.split(/\n{2,}|(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ])/u).map((part) => part.trim()).filter(Boolean);
  const concepts = [...new Set((transcript.match(/\b[\p{L}][\p{L}-]{7,}\b/gu) ?? []).map((word) => word.toLocaleLowerCase()))].slice(0, 8);
  return [
    `# ${title}`,
    '',
    '## Resumen de la clase',
    '',
    paragraphs.slice(0, 3).join(' '),
    '',
    '## Ideas principales',
    '',
    ...paragraphs.slice(0, 8).map((paragraph) => `- ${paragraph}`),
    '',
    '## Conceptos',
    '',
    ...(concepts.length ? concepts.map((concept) => `- **${concept}**`) : ['- Pendiente de completar']),
    '',
    '## Preguntas de repaso sugeridas',
    '',
    ...(concepts.length ? concepts.slice(0, 5).map((concept) => `- ¿Cómo explicarías **${concept}** con tus propias palabras?`) : ['- ¿Cuál es la idea principal de esta clase?']),
  ].join('\n');
}
