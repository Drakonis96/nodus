/**
 * Works the passage-embedding run still has ahead of it (or is embedding now). The passage run and
 * the Documentary Index both publish a work's passages, and the later producer fences the earlier
 * one (passagePublications.ts). The index prepares its passages first and publishes them only
 * after its section analysis, which can take a long time, so a passage run reaching the same work
 * in between voided the whole index with documentary_publication_superseded. The index therefore
 * waits for a work the passage run has queued before it prepares that work's passages.
 * Dependency-free so the index can import it without the passage pipeline's own imports.
 */
const pending = new Set<string>();

export function setPassageWorksPending(nodusIds: Iterable<string>): void {
  pending.clear();
  for (const id of nodusIds) pending.add(id);
}

export function addPassageWorkPending(nodusId: string): void {
  pending.add(nodusId);
}

export function passageWorkDone(nodusId: string): void {
  pending.delete(nodusId);
}

export function passageWorkPending(nodusId: string): boolean {
  return pending.has(nodusId);
}

/** Resolves once the passage run has finished (or dropped) this work. */
export async function waitForPassageWork(nodusId: string, signal?: AbortSignal, pollMs = 500): Promise<void> {
  while (pending.has(nodusId)) {
    signal?.throwIfAborted();
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  signal?.throwIfAborted();
}
