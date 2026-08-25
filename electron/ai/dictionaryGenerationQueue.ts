import type {
  DictionaryGenerationRequest,
  DictionaryProgress,
} from "@shared/dictionary";

export type DictionaryGenerationProgressReporter = (
  progress: DictionaryProgress,
) => void;

export type DictionaryGenerationExecutor = (
  request: DictionaryGenerationRequest,
  report: DictionaryGenerationProgressReporter,
) => Promise<void>;

const isRunning = (progress: DictionaryProgress): boolean =>
  !["done", "failed"].includes(progress.phase);

/**
 * Owns the lifetime of background Dictionary work independently from any
 * renderer. Every entry gets its own scheduled execution, so starting a batch
 * does not serialize retrieval or synthesis behind the preceding entry.
 */
export class DictionaryGenerationQueue {
  readonly #jobs = new Map<string, DictionaryProgress>();
  readonly #tokens = new Map<string, symbol>();

  constructor(
    private readonly execute: DictionaryGenerationExecutor,
    private readonly publish: DictionaryGenerationProgressReporter,
  ) {}

  start(request: DictionaryGenerationRequest): DictionaryProgress {
    const running = this.#jobs.get(request.entryId);
    if (running && isRunning(running)) return running;

    const token = Symbol(request.entryId);
    const queued: DictionaryProgress = {
      entryId: request.entryId,
      phase: "queued",
      message: "En cola",
    };
    this.#tokens.set(request.entryId, token);
    this.#set(queued, token);

    setImmediate(() => {
      void this.#run(request, token);
    });
    return queued;
  }

  list(): DictionaryProgress[] {
    return [...this.#jobs.values()];
  }

  delete(entryIds: Iterable<string>): void {
    for (const entryId of entryIds) {
      this.#tokens.delete(entryId);
      this.#jobs.delete(entryId);
    }
  }

  async #run(
    request: DictionaryGenerationRequest,
    token: symbol,
  ): Promise<void> {
    const report = (progress: DictionaryProgress) => this.#set(progress, token);
    try {
      await this.execute(request, report);
      report({
        entryId: request.entryId,
        phase: "done",
        message: "Definición generada",
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(
        `[dictionary] background generation failed for ${request.entryId}`,
        error,
      );
      report({
        entryId: request.entryId,
        phase: "failed",
        message: "Error al generar",
        error: detail,
      });
    }
  }

  #set(progress: DictionaryProgress, token: symbol): void {
    if (this.#tokens.get(progress.entryId) !== token) return;
    this.#jobs.set(progress.entryId, progress);
    this.publish(progress);
  }
}
