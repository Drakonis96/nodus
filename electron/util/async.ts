/**
 * Yield control back to the Electron main-process event loop so pending IPC
 * calls, timers and progress emits can be serviced before more CPU work runs.
 *
 * `better-sqlite3` and the JS `vec_cosine()` similarity function are fully
 * synchronous, and the main process is single-threaded and shared with every
 * IPC handler. A long CPU-bound loop (e.g. a per-idea similarity scan over the
 * whole corpus) therefore freezes the entire app — the renderer can't get IPC
 * responses, so section switches and scan progress appear hung — until the loop
 * finishes. Awaiting this periodically breaks such a loop into chunks and lets
 * the UI stay responsive; it does not change any results.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * How many iterations of a hot main-thread loop to run between event-loop
 * yields. Small enough that each synchronous chunk stays well under a frame,
 * large enough that the yield overhead is negligible.
 */
export const YIELD_EVERY = 16;
