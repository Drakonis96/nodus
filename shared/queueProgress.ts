import type { QueueItem } from './types';

/**
 * The work the queue bar narrates: the one that started earliest and is still running.
 *
 * The bar used to take whichever running item came first in the list, and the queue
 * moves every newly dispatched item to the front of the running block — so the title,
 * the elapsed time, the fragment counter and the percentage all re-pointed at another
 * work every time a slot freed or a retry landed, and the numbers that belonged to the
 * work being watched appeared to jump backwards and forwards. Pinning the oldest
 * running item keeps the row stable: it changes only when that work really ends.
 */
export function displayedQueueItem(items: readonly QueueItem[]): QueueItem | undefined {
  let displayed: QueueItem | undefined;
  for (const item of items) {
    if (item.state !== 'running') continue;
    if (!displayed || startedEarlier(item, displayed)) displayed = item;
  }
  return displayed;
}

function startedEarlier(candidate: QueueItem, current: QueueItem): boolean {
  const candidateStart = candidate.started_at ?? candidate.enqueued_at;
  const currentStart = current.started_at ?? current.enqueued_at;
  if (candidateStart !== currentStart) return candidateStart < currentStart;
  return candidate.enqueued_at < current.enqueued_at;
}
