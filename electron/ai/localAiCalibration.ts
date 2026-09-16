/** A foreground inference preempts synthetic benchmarks, never another inference. */
export class LocalCalibrationQueue {
  private jobs = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private tail: Promise<void> = Promise.resolve();
  private foreground = 0;
  activeKey: string | null = null;

  schedule(key: string, run: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const existing = this.jobs.get(key);
    if (existing) return existing.promise;
    // Calibration is opportunistic. A user request must never wait for a new one.
    if (this.foreground > 0) return Promise.resolve();
    const controller = new AbortController();
    const previous = this.tail;
    const promise = (async () => {
      await previous;
      if (controller.signal.aborted || this.foreground > 0) return;
      this.activeKey = key;
      try { await run(controller.signal); }
      catch (error) { if (!controller.signal.aborted) throw error; }
      finally { if (this.activeKey === key) this.activeKey = null; }
    })().finally(() => { if (this.jobs.get(key)?.controller === controller) this.jobs.delete(key); });
    this.jobs.set(key, { controller, promise });
    this.tail = promise.catch(() => undefined);
    return promise;
  }
  cancel(): void {
    for (const job of this.jobs.values()) job.controller.abort(new DOMException('Foreground work takes priority', 'AbortError'));
  }
  async runForeground<T>(run: () => Promise<T>): Promise<T> {
    this.foreground += 1;
    this.cancel();
    try {
      // Every benchmark propagates this cancellation to its fetches and startup
      // probe, and releases its own process before this promise resolves.
      await this.tail;
      return await run();
    } finally { this.foreground -= 1; }
  }
}
