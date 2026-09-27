const listeners = new Set<() => void>();
/** UI observers cannot change preparation success or lease ownership. */
export function notifyDocumentaryPreparation(): void {
  for (const listener of listeners) { try { listener(); } catch { /* A closed renderer can request another snapshot. */ } }
}
export function onDocumentaryPreparationChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
