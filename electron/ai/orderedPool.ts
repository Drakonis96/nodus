function abortReason(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

/** Bounded worker pool that preserves input order and fails closed on first error. */
export async function mapOrderedPool<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number, signal: AbortSignal) => Promise<R>,
  parentSignal?: AbortSignal,
): Promise<R[]> {
  parentSignal?.throwIfAborted();
  if (!values.length) return [];
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(abortReason(parentSignal));
  parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  const results = new Array<R>(values.length);
  let cursor = 0;
  let firstError: unknown;

  const runWorker = async () => {
    while (!controller.signal.aborted) {
      const index = cursor++;
      if (index >= values.length) return;
      try {
        results[index] = await worker(values[index], index, controller.signal);
      } catch (error) {
        firstError ??= error;
        controller.abort(error);
        return;
      }
    }
  };

  try {
    await Promise.all(Array.from(
      { length: Math.min(values.length, Math.max(1, Math.trunc(concurrency) || 1)) },
      () => runWorker(),
    ));
    if (firstError !== undefined) throw firstError;
    controller.signal.throwIfAborted();
    return results;
  } finally {
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}
