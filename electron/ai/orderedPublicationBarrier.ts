/**
 * Assigns monotonically increasing tickets and lets mutations publish only when
 * every earlier ticket has reached a terminal state. A failed/cancelled job must
 * call `finish` too; otherwise a later successful job could wait forever.
 */
export class OrderedPublicationBarrier {
  #issued = 0;
  #next = 0;
  #terminal = new Set<number>();
  #closed = new Set<number>();
  #claimed = new Set<number>();
  #waiters = new Map<number, Set<() => void>>();

  issue(): number {
    return this.#issued++;
  }

  async wait(ticket: number, signal?: AbortSignal): Promise<void> {
    if (!Number.isInteger(ticket) || ticket < 0 || ticket >= this.#issued) {
      throw new Error(`Invalid publication ticket: ${ticket}`);
    }
    if (ticket < this.#next) return;
    if (ticket === this.#next) return;
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const waiters = this.#waiters.get(ticket) ?? new Set<() => void>();
      this.#waiters.set(ticket, waiters);
      const done = () => {
        signal?.removeEventListener('abort', abort);
        resolve();
      };
      const abort = () => {
        waiters.delete(done);
        if (!waiters.size) this.#waiters.delete(ticket);
        reject(signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
      };
      waiters.add(done);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  finish(ticket: number): void {
    if (!Number.isInteger(ticket) || ticket < 0 || ticket >= this.#issued || this.#closed.has(ticket)) return;
    this.#closed.add(ticket);
    this.#claimed.delete(ticket);
    if (ticket < this.#next) return;
    this.#terminal.add(ticket);
    while (this.#terminal.delete(this.#next)) {
      this.#next += 1;
      const ready = this.#waiters.get(this.#next);
      this.#waiters.delete(this.#next);
      for (const resolve of ready ?? []) resolve();
    }
  }

  async publish<T>(ticket: number, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.#closed.has(ticket)) throw new Error(`Publication ticket ${ticket} is already terminal.`);
    if (this.#claimed.has(ticket)) throw new Error(`Publication ticket ${ticket} already has a publisher.`);
    this.#claimed.add(ticket);
    try {
      await this.wait(ticket, signal);
      if (this.#closed.has(ticket)) throw new Error(`Publication ticket ${ticket} became terminal before publishing.`);
      return await task();
    } finally {
      this.finish(ticket);
    }
  }

  snapshot(): { issued: number; next: number; terminal: number[]; waiting: number[] } {
    return {
      issued: this.#issued,
      next: this.#next,
      terminal: [...this.#terminal].sort((a, b) => a - b),
      waiting: [...this.#waiters.keys()].sort((a, b) => a - b),
    };
  }
}
