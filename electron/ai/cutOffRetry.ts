/**
 * A reasoning model sometimes loops in its thinking until the output ceiling and never writes
 * the answer (DeepSeek Flash at high effort: 2 of 36 route drafts, each on a target that answered
 * normally in its other runs). `write` is tried once more with the same settings; any other
 * error, a second cut-off or a cancelled turn is thrown as before.
 */
export async function retryOnceWhenCutOff<T>(
  write: () => Promise<T>,
  options: { isCutOff: (error: unknown) => boolean; beforeRetry?: () => void; signal?: AbortSignal },
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (options.signal?.aborted || !options.isCutOff(error)) throw error;
    console.warn('[research] answer cut off at the output limit; retrying once');
    options.beforeRetry?.();
    return write();
  }
}
