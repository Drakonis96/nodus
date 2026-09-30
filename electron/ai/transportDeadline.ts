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

/**
 * The streaming form: the deadline is idle time — no chunk for `idleMs` — not the length of
 * the whole answer, with `totalMs` as an outer ceiling. A thinking model can stream reasoning
 * steadily for several minutes before its first answer token (deepseek-flash at high effort
 * on a multistep synthesis route: 117K reasoning characters in the 180 s the whole-response
 * deadline allowed); that is progress, not a stall. The task calls `touch()` on every chunk.
 */
export async function withIdleTransportDeadline<T>(
  idleMs: number,
  totalMs: number,
  callerSignal: AbortSignal | undefined,
  task: (signal: AbortSignal, touch: () => void) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut: 'idle' | 'total' | null = null;

  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });

  const expire = (kind: 'idle' | 'total') => {
    timedOut = kind;
    controller.abort(new DOMException('AI transport deadline exceeded.', 'TimeoutError'));
  };
  let idle = setTimeout(() => expire('idle'), Math.max(1, idleMs));
  idle.unref?.();
  const total = setTimeout(() => expire('total'), Math.max(1, totalMs));
  total.unref?.();
  const touch = () => {
    if (timedOut) return;
    clearTimeout(idle);
    idle = setTimeout(() => expire('idle'), Math.max(1, idleMs));
    idle.unref?.();
  };

  try {
    const result = await task(controller.signal, touch);
    // Some SDK streams end their iteration quietly when aborted: an expired deadline must not
    // pass for a finished (and then "empty") response.
    if (timedOut) throw new DOMException('AI transport deadline exceeded.', 'TimeoutError');
    return result;
  } catch (error) {
    if (timedOut) {
      const timeout = new Error(timedOut === 'idle'
        ? `AI transport timed out: no data for ${Math.max(1, idleMs)} ms.`
        : `AI transport timed out after ${Math.max(1, totalMs)} ms.`);
      timeout.name = 'TimeoutError';
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(idle);
    clearTimeout(total);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  }
}
