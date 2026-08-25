type WaitingRequest = {
  signal?: AbortSignal;
  start: (release: () => void) => void;
  reject: (error: unknown) => void;
  abort?: () => void;
};

function aborted(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

/**
 * One process-wide gate for provider text requests.
 *
 * Nodus exposes a global "concurrent calls" setting, but historically only the
 * legacy scan queue honoured it. Dictionary, Deep Research and document profiles
 * could therefore each respect their own queue while still flooding the same
 * provider together. Keeping the gate below every feature, immediately above the
 * transports, makes the setting describe what the UI says it describes.
 */
export class AiRequestGate {
  #active = 0;
  #waiting: WaitingRequest[] = [];

  constructor(private readonly configuredLimit: () => number) {}

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.#acquire(signal);
    try {
      signal?.throwIfAborted();
      return await task();
    } finally {
      release();
    }
  }

  #limit(): number {
    const value = Number(this.configuredLimit());
    return Number.isFinite(value) ? Math.max(1, Math.min(8, Math.floor(value))) : 1;
  }

  #acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(aborted(signal));
    return new Promise<() => void>((resolve, reject) => {
      const waiting: WaitingRequest = {
        signal,
        reject,
        start: (release) => resolve(release),
      };
      if (signal) {
        waiting.abort = () => {
          const index = this.#waiting.indexOf(waiting);
          if (index === -1) return;
          this.#waiting.splice(index, 1);
          reject(aborted(signal));
        };
        signal.addEventListener('abort', waiting.abort, { once: true });
      }
      this.#waiting.push(waiting);
      this.#drain();
    });
  }

  #drain(): void {
    while (this.#active < this.#limit() && this.#waiting.length) {
      const waiting = this.#waiting.shift()!;
      if (waiting.abort) waiting.signal?.removeEventListener('abort', waiting.abort);
      if (waiting.signal?.aborted) {
        waiting.reject(aborted(waiting.signal));
        continue;
      }
      this.#active += 1;
      let released = false;
      waiting.start(() => {
        if (released) return;
        released = true;
        this.#active -= 1;
        this.#drain();
      });
    }
  }
}
