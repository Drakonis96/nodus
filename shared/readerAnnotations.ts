const IMMERSION_DOCUMENT_PREFIX = 'immersion:';

/** Stable document id used by the shared reader-annotation store for one immersion. */
export function immersionAnnotationDocumentId(sessionId: string): string {
  return `${IMMERSION_DOCUMENT_PREFIX}${sessionId}`;
}

/** Returns the owning immersion id, or null when this is another reader document. */
export function immersionSessionIdFromAnnotationDocument(documentId: string): string | null {
  if (!documentId.startsWith(IMMERSION_DOCUMENT_PREFIX)) return null;
  const sessionId = documentId.slice(IMMERSION_DOCUMENT_PREFIX.length);
  return sessionId || null;
}
