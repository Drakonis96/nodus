// Dónde escribe el editor.
//
// El editor de Estudio es una pieza grande y afinada —barra contextual al seleccionar,
// mejora con IA en streaming, sinónimos, historial, comentarios anclados, dictado— y el
// Workspace de la bóveda académica pedía exactamente ese editor, no uno parecido. La
// única diferencia real entre los dos casos es la FILA que se guarda: un `study_docs` o
// una `notes`.
//
// Así que eso es lo único que se inyecta. El puerto tiene siete métodos y ninguno sabe
// nada de la interfaz; el componente no sabe nada de la tabla. Los sitios que ya usaban
// el editor no cambian una línea: si no se pasa puerto, se usa el de Estudio.

import type {
  StudyAnnotation,
  StudyAnnotationInput,
  StudyDocEditorData,
  StudyDocUpdateInput,
} from '@shared/studyEditor';

/** Lo mínimo que el editor necesita saber de aquello que está editando. */
export interface EditorDocument {
  id: string;
  title: string;
  contentMarkdown: string;
  favorite: boolean;
  /** Solo Estudio clasifica sus documentos por tipo; el prompt de mejora lo aprovecha. */
  kind?: string;
  color?: string | null;
}

export interface EditorDocumentPort<TDocument extends EditorDocument = EditorDocument> {
  loadEditorData(documentId: string): Promise<StudyDocEditorData>;
  save(documentId: string, input: StudyDocUpdateInput): Promise<TDocument>;
  restoreVersion(documentId: string, versionId: string): Promise<TDocument>;
  createAnnotation(documentId: string, input: StudyAnnotationInput): Promise<StudyAnnotation>;
  updateAnnotation(id: string, patch: Partial<StudyAnnotationInput> & { resolved?: boolean }): Promise<StudyAnnotation | null>;
  /**
   * Cómo se identifica el documento ante el registro de mejoras de IA. Son dos claves
   * distintas con dos cascadas distintas, y solo el puerto sabe cuál le toca.
   */
  improveTarget(documentId: string): { documentId?: string | null; noteId?: string | null };
  /** Los documentos a los que se puede enlazar al soltar uno dentro del texto. */
  listLinkTargets(): Promise<Array<{ id: string; title: string }>>;
  /** El enlace Markdown que abre otro documento del mismo espacio. */
  linkHref(documentId: string): string;
}

/** El puerto de Estudio y Docencia: documentos de estudio. Es el de por defecto. */
export const studyDocumentPort: EditorDocumentPort<import('@shared/studyOrg').StudyDocument> = {
  loadEditorData: (documentId) => window.nodus.getStudyDocEditorData(documentId),
  save: (documentId, input) => window.nodus.updateStudyDoc(documentId, input),
  restoreVersion: (documentId, versionId) => window.nodus.restoreStudyDocVersion(documentId, versionId),
  createAnnotation: (documentId, input) => window.nodus.createStudyAnnotation(documentId, input),
  updateAnnotation: (id, patch) => window.nodus.updateStudyAnnotation(id, patch),
  improveTarget: (documentId) => ({ documentId }),
  listLinkTargets: async () => (await window.nodus.getStudyWorkspace()).documents.map((document) => ({ id: document.id, title: document.title })),
  linkHref: (documentId) => `nodus://study/doc/${documentId}`,
};

/**
 * El puerto del Workspace: notas e ideas. `contentMarkdown` es el `content` de la nota —
 * el editor pide un nombre y la nota guarda otro, y traducirlo aquí evita renombrar una
 * columna que lee media aplicación.
 */
export const workspaceNotePort: EditorDocumentPort<EditorDocument & { noteId: string }> = {
  loadEditorData: (noteId) => window.nodus.getWorkspaceNoteEditorData(noteId),
  save: async (noteId, input) => noteAsEditorDocument(await window.nodus.updateWorkspaceNote(noteId, input)),
  restoreVersion: async (noteId, versionId) => noteAsEditorDocument(await window.nodus.restoreWorkspaceNoteVersion(noteId, versionId)),
  createAnnotation: (noteId, input) => window.nodus.createWorkspaceAnnotation(noteId, input),
  updateAnnotation: (id, patch) => window.nodus.updateWorkspaceAnnotation(id, patch),
  improveTarget: (noteId) => ({ noteId }),
  listLinkTargets: async () => (await window.nodus.getNotesTree()).notes.map((note) => ({ id: note.id, title: note.title })),
  linkHref: (noteId) => `nodus://note/${noteId}`,
};

/** Una nota vista como documento de editor. */
export function noteAsEditorDocument(note: { id: string; title: string; content: string }): EditorDocument & { noteId: string } {
  return { id: note.id, noteId: note.id, title: note.title, contentMarkdown: note.content, favorite: false };
}
