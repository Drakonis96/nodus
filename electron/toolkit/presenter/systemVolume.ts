// Serialize system audio operations and collapse slider bursts to the latest value.
// A separate osascript per input used to finish out of order and restore old volumes.
export class SystemVolume {
  private requested: number | null = null;
  private revision = 0;
  private writing: Promise<void> | null = null;

  constructor(
    private readonly read: () => Promise<number>,
    private readonly write: (volume: number) => Promise<void>,
  ) {}

  set(volume: number): Promise<void> {
    this.requested = Math.max(0, Math.min(100, Math.round(volume) || 0));
    this.revision += 1;
    if (!this.writing) {
      // Inputs delivered in the same turn need only one system call.
      this.writing = Promise.resolve().then(async () => {
        try {
          let lastError: unknown = null;
          while (this.requested !== null) {
            const next = this.requested;
            this.requested = null;
            try {
              await this.write(next);
              lastError = null;
            } catch (error) {
              lastError = error;
            }
          }
          if (lastError) throw lastError;
        } finally {
          this.writing = null;
        }
      });
    }
    return this.writing;
  }

  async get(): Promise<number> {
    // A poll must never return the intermediate volume while a newer input is queued.
    for (;;) {
      await this.writing;
      const revision = this.revision;
      const volume = await this.read();
      if (revision === this.revision && !this.writing) return volume;
    }
  }
}
