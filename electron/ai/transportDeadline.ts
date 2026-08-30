/**
 * Run one dispatched transport operation under a deadline that covers the complete
 * response body, not only the arrival of HTTP headers.
 *
 * Some SDKs clear their timeout as soon as `fetch()` resolves with headers and then
 * parse the body outside that timer. A provider that stalls between headers and the
 * final byte can therefore occupy a scheduler slot indefinitely. This wrapper owns a
 * linked AbortSignal until the returned promise has fully settled.
 */
export async function withTransportDeadline<T>(
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;

  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('AI transport deadline exceeded.', 'TimeoutError'));
  }, Math.max(1, timeoutMs));
  timer.unref?.();

  try {
    return await task(controller.signal);
  } catch (error) {
    if (timedOut) {
      const timeout = new Error(`AI transport timed out after ${Math.max(1, timeoutMs)} ms.`);
      timeout.name = 'TimeoutError';
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  }
}
