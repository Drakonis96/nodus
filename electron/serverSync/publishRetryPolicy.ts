/** Successful live publications may follow closely enough for an open reader to feel live. */
export const PUBLISH_MIN_INTERVAL_MS = 5_000;
/** Failures retain the slower backoff so an unavailable server never causes a rebuild loop. */
export const PUBLISH_RETRY_BASE_MS = 15_000;
export const PUBLISH_RETRY_MAX_MS = 15 * 60_000;

export interface PublishRetryRuntime {
  consecutiveFailures: number;
  retryNotBefore: number;
  lastUploadStartedAt: number;
}

export function notePublishFailure(runtime: PublishRetryRuntime, now = Date.now()): void {
  runtime.consecutiveFailures += 1;
  const delay = Math.min(
    PUBLISH_RETRY_MAX_MS,
    PUBLISH_RETRY_BASE_MS * (2 ** Math.max(0, runtime.consecutiveFailures - 1)),
  );
  runtime.retryNotBefore = now + delay;
}

export function clearPublishRetry(runtime: PublishRetryRuntime): void {
  runtime.consecutiveFailures = 0;
  runtime.retryNotBefore = 0;
}

export function publishRetryIsDue(runtime: PublishRetryRuntime, now = Date.now()): boolean {
  return runtime.consecutiveFailures > 0 && runtime.retryNotBefore > 0 && now >= runtime.retryNotBefore;
}

export function mayAttemptPublish(runtime: PublishRetryRuntime, now = Date.now()): boolean {
  return now - runtime.lastUploadStartedAt >= PUBLISH_MIN_INTERVAL_MS
    && (runtime.retryNotBefore === 0 || now >= runtime.retryNotBefore);
}
