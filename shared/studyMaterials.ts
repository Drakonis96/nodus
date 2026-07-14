export const STUDY_MATERIAL_EXTENSIONS = [
  'pdf', 'docx', 'md', 'markdown', 'pptx', 'txt', 'html', 'htm', 'epub',
  'png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'mp3', 'wav', 'm4a', 'ogg',
] as const;

export type StudyMaterialReadState = 'pending' | 'reading' | 'read' | 'reviewed';
export type StudyMaterialPreviewKind = 'pdf' | 'document' | 'presentation' | 'image' | 'audio' | 'unknown';

export interface StudyMaterialBibliography {
  authors: string[];
  year: number | null;
  publisher: string;
  journal: string;
  doi: string;
  isbn: string;
  url: string;
  citation: string;
  zoteroKey: string;
}

export interface StudyMaterialMetadata {
  author?: string;
  date?: string;
  pageCount?: number;
  slideCount?: number;
  durationSeconds?: number;
  extractionNote?: string;
  tags?: string[];
  comments?: string[];
  [key: string]: unknown;
}

export interface StudyMaterialSummary {
  id: string;
  shortId: string;
  title: string;
  description: string;
  fileName: string;
  mimeType: string;
  extension: string;
  contentHash: string;
  extractionStatus: 'pending' | 'ready' | 'partial' | 'unsupported' | 'error';
  metadata: StudyMaterialMetadata;
  bibliography: StudyMaterialBibliography;
  readState: StudyMaterialReadState;
  previewKind: StudyMaterialPreviewKind;
  pageCount: number | null;
  durationSeconds: number | null;
  sizeBytes: number;
  extractedChars: number;
  favorite: boolean;
  pinned: boolean;
  position: number;
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudyMaterialPlacement {
  id: string;
  shortId: string;
  materialId: string;
  courseId: string | null;
  subjectId: string | null;
  topicId: string | null;
  folderId: string | null;
  documentId: string | null;
  position: number;
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudyMaterialRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StudyMaterialAnnotation {
  id: string;
  shortId: string;
  materialId: string;
  pageNumber: number | null;
  rect: StudyMaterialRect | null;
  from: number | null;
  to: number | null;
  selectedText: string;
  note: string;
  color: string;
  position: number;
  archivedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudyMaterialFragmentLink {
  id: string;
  shortId: string;
  materialId: string;
  annotationId: string | null;
  documentId: string;
  docFrom: number | null;
  docTo: number | null;
  label: string;
  source: StudyMaterialSourceRef;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface StudyMaterialVersion {
  id: string;
  shortId: string;
  materialId: string;
  versionNo: number;
  fileName: string;
  mimeType: string;
  contentHash: string;
  extractedText: string;
  metadata: StudyMaterialMetadata;
  sizeBytes: number;
  createdAt: string;
}

export interface StudyMaterialDetail extends StudyMaterialSummary {
  extractedText: string;
  placements: StudyMaterialPlacement[];
  annotations: StudyMaterialAnnotation[];
  fragmentLinks: StudyMaterialFragmentLink[];
  versions: StudyMaterialVersion[];
}

export interface StudyMaterialSourceRef {
  materialId: string;
  materialTitle: string;
  pageNumber?: number | null;
  slideNumber?: number | null;
  fragment?: string;
  timestampSeconds?: number | null;
  annotationId?: string | null;
}

export interface StudyMaterialImportInput {
  courseId?: string | null;
  subjectId?: string | null;
  topicId?: string | null;
  folderId?: string | null;
  documentId?: string | null;
  readState?: StudyMaterialReadState;
  tags?: string[];
  ocr?: boolean;
}

export interface StudyMaterialImportResult {
  material: StudyMaterialSummary;
  duplicate: boolean;
}

export interface StudyMaterialUpdateInput {
  title?: string;
  description?: string;
  readState?: StudyMaterialReadState;
  favorite?: boolean;
  pinned?: boolean;
  position?: number;
  metadata?: StudyMaterialMetadata;
  bibliography?: Partial<StudyMaterialBibliography>;
}

export interface StudyMaterialAnnotationInput {
  pageNumber?: number | null;
  rect?: StudyMaterialRect | null;
  from?: number | null;
  to?: number | null;
  selectedText?: string;
  note?: string;
  color?: string;
}

export interface StudyMaterialContent {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
}

export interface StudyMaterialListOptions {
  search?: string;
  readState?: StudyMaterialReadState | 'all';
  previewKind?: StudyMaterialPreviewKind | 'all';
  courseId?: string;
  subjectId?: string;
  topicId?: string;
  documentId?: string;
  favorite?: boolean;
  includeArchived?: boolean;
  includeDeleted?: boolean;
}

export const EMPTY_STUDY_BIBLIOGRAPHY: StudyMaterialBibliography = {
  authors: [], year: null, publisher: '', journal: '', doi: '', isbn: '', url: '', citation: '', zoteroKey: '',
};

export function studyMaterialPreviewKind(extension: string, mimeType = ''): StudyMaterialPreviewKind {
  const ext = extension.replace(/^\./, '').toLocaleLowerCase();
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  if (['pptx'].includes(ext)) return 'presentation';
  if (['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff'].includes(ext) || mimeType.startsWith('image/')) return 'image';
  if (['mp3', 'wav', 'm4a', 'ogg'].includes(ext) || mimeType.startsWith('audio/')) return 'audio';
  if (['docx', 'md', 'markdown', 'txt', 'html', 'htm', 'epub'].includes(ext)) return 'document';
  return 'unknown';
}

export function studyMaterialLocationLabel(source: StudyMaterialSourceRef): string {
  const parts = [source.materialTitle];
  if (source.pageNumber) parts.push(`p. ${source.pageNumber}`);
  if (source.slideNumber) parts.push(`diap. ${source.slideNumber}`);
  if (source.timestampSeconds != null) {
    const minutes = Math.floor(source.timestampSeconds / 60);
    const seconds = Math.floor(source.timestampSeconds % 60);
    parts.push(`${minutes}:${String(seconds).padStart(2, '0')}`);
  }
  return parts.join(' · ');
}

export function parseStudyMaterialMarkers(text: string): Array<{ kind: 'page' | 'slide'; number: number; from: number }> {
  return [...text.matchAll(/\[\[(p|slide)\.\s*(\d+)\]\]/gi)].map((match) => ({
    kind: match[1].toLocaleLowerCase() === 'p' ? 'page' : 'slide',
    number: Number(match[2]),
    from: match.index ?? 0,
  }));
}
