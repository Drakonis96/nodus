const listeners = new Set<() => void>();

/** Lightweight authored-source notifications; repositories never import the
 * preparation engine or start optional work before profile initialization. */
export function onResearchCorpusChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function notifyAuthoredResearchSourceChanged(): void {
  for (const listener of listeners) {
    try { listener(); } catch { /* Optional preparation cannot break an authored write. */ }
  }
}
