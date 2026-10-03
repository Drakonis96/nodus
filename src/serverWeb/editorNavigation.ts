/** Keep an editor mounted until its pending save has completed. */
const flushers = new Set<() => Promise<boolean>>();

export function registerServerEditorFlush(flush: () => Promise<boolean>): () => void {
  flushers.add(flush);
  return () => { flushers.delete(flush); };
}

export async function flushServerEditors(): Promise<boolean> {
  const results = await Promise.allSettled([...flushers].map(flush => flush()));
  return results.every(result => result.status === 'fulfilled' && result.value);
}
