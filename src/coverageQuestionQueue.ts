import type { ResearchQuestionDetail } from '@shared/types';

export type CoverageQuestionJobStatus = 'queued' | 'running' | 'failed';

export interface CoverageQuestionJob {
  id: string;
  vaultId: string;
  question: string;
  notes?: string;
  status: CoverageQuestionJobStatus;
  rqId: string | null;
  error: string | null;
}

export type CoverageQuestionQueueEvent =
  | { type: 'changed' }
  | { type: 'ready'; vaultId: string; rqId: string };

interface CoverageQuestionQueueDeps {
  activeVaultId(): Promise<string | null>;
  create(input: { question: string; notes?: string }): Promise<ResearchQuestionDetail>;
  decompose(rqId: string): Promise<ResearchQuestionDetail>;
  remove(rqId: string): Promise<void>;
}

type QueueListener = (jobs: readonly CoverageQuestionJob[], event: CoverageQuestionQueueEvent) => void;

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A small renderer-side lane for question decomposition.
 *
 * Creating a coverage question used to await the provider call directly from the
 * form, so the form was locked until it finished and a second question could not
 * be submitted. This queue accepts all of them immediately and runs exactly one
 * decomposition at a time. The database row is only announced to the catalogue
 * after its sub-questions are ready.
 */
export class CoverageQuestionQueue {
  private jobs: CoverageQuestionJob[] = [];
  private listeners = new Set<QueueListener>();
  private draining = false;
  private sequence = 0;

  constructor(private readonly deps: CoverageQuestionQueueDeps) {}

  snapshot(): readonly CoverageQuestionJob[] {
    return this.jobs.map((job) => ({ ...job }));
  }

  subscribe(listener: QueueListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  enqueue(input: { vaultId: string; question: string; notes?: string }): CoverageQuestionJob {
    const job: CoverageQuestionJob = {
      id: `coverage-question-${Date.now()}-${++this.sequence}`,
      vaultId: input.vaultId,
      question: input.question.trim(),
      notes: input.notes?.trim() || undefined,
      status: 'queued',
      rqId: null,
      error: null,
    };
    this.jobs.push(job);
    this.emit({ type: 'changed' });
    void this.drain();
    return { ...job };
  }

  dismiss(id: string): void {
    const job = this.jobs.find((item) => item.id === id);
    if (!job || job.status !== 'failed') return;
    this.jobs = this.jobs.filter((item) => item.id !== id);
    this.emit({ type: 'changed' });
  }

  private emit(event: CoverageQuestionQueueEvent): void {
    const jobs = this.snapshot();
    for (const listener of this.listeners) listener(jobs, event);
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      let job = this.jobs.find((item) => item.status === 'queued');
      while (job) {
        job.status = 'running';
        this.emit({ type: 'changed' });

        try {
          const activeVaultId = await this.deps.activeVaultId();
          if (activeVaultId !== job.vaultId) {
            throw new Error('La bóveda activa cambió antes de procesar esta pregunta.');
          }

          const created = await this.deps.create({ question: job.question, notes: job.notes });
          job.rqId = created.rq.id;
          this.emit({ type: 'changed' });

          if ((await this.deps.activeVaultId()) !== job.vaultId) {
            throw new Error('La bóveda activa cambió antes de procesar esta pregunta.');
          }
          await this.deps.decompose(created.rq.id);
          this.jobs = this.jobs.filter((item) => item.id !== job!.id);
          this.emit({ type: 'ready', vaultId: job.vaultId, rqId: created.rq.id });
        } catch (error) {
          // A half-created draft is not a ready queue result. Remove it when it is
          // still safe to address the same vault, while preserving the original
          // provider error in the queue for the user to inspect.
          let removed = false;
          let activeVaultId: string | null = null;
          try {
            activeVaultId = await this.deps.activeVaultId();
          } catch {
            // Keep the draft hidden in the catalogue if the active vault cannot be checked.
          }
          if (job.rqId && activeVaultId === job.vaultId) {
            try {
              await this.deps.remove(job.rqId);
              removed = true;
            } catch {
              // The decomposition error is the actionable one; cleanup is best-effort.
            }
          }
          if (removed) job.rqId = null;
          job.status = 'failed';
          job.error = messageFromError(error);
          this.emit({ type: 'changed' });
        }

        job = this.jobs.find((item) => item.status === 'queued');
      }
    } finally {
      this.draining = false;
      // A submission can land between the last lookup and this finally block.
      if (this.jobs.some((item) => item.status === 'queued')) void this.drain();
    }
  }
}

export const coverageQuestionQueue = new CoverageQuestionQueue({
  activeVaultId: async () => (await window.nodus.getActiveVault())?.id ?? null,
  create: (input) => window.nodus.createResearchQuestion(input),
  decompose: (rqId) => window.nodus.decomposeResearchQuestion({ rqId, model: null }),
  remove: (rqId) => window.nodus.deleteResearchQuestion(rqId),
});
