/**
 * Rate-limit a side effect to at most once per interval, without ever losing
 * the last one.
 *
 * Built for progress broadcasts driven by work rather than by time — one per
 * extracted PDF page, one per enqueued item — where the cost of each call is
 * proportional to the size of the payload. Coalescing makes the total cost
 * proportional to elapsed time instead of to the amount of work done.
 *
 * The trailing edge is mandatory: dropping it would leave a progress bar
 * frozen at whatever it happened to show when the burst began.
 */
export interface Coalescer {
  /** Request a run. Executes immediately if the interval has elapsed, otherwise schedules the trailing edge. */
  schedule(): void;
  /** Run now if anything is pending, ignoring the interval. */
  flush(): void;
  /** Drop any pending run. */
  cancel(): void;
  /** True while a trailing run is scheduled. */
  readonly pending: boolean;
}

export function coalesce(run: () => void, intervalMs: number): Coalescer {
  let timer: NodeJS.Timeout | null = null;
  let lastRunAt = 0;

  const execute = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    lastRunAt = Date.now();
    run();
  };

  return {
    schedule() {
      if (timer !== null) return; // trailing run already booked
      const elapsed = Date.now() - lastRunAt;
      if (elapsed >= intervalMs) {
        execute();
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        execute();
      }, intervalMs - elapsed);
      // Never hold the process open just to deliver a progress update.
      timer.unref?.();
    },
    flush() {
      if (timer !== null) execute();
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    get pending() {
      return timer !== null;
    },
  };
}
