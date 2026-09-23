import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { ResearchActivity, ResearchActivityLayer, ResearchActivityOperation } from '@shared/researchActivity';

interface ActivityContext {
  emit: (event: ResearchActivity) => void;
  signal?: AbortSignal;
  pending: Map<string, ResearchActivity>;
  closed?: boolean;
}
const context = new AsyncLocalStorage<ActivityContext>();
function publish(owner: ActivityContext, event: ResearchActivity): void {
  try { owner.emit(event); } catch { /* An observer must never fail a research request. */ }
}

/** Only Research Chat installs this context. Shared Deep Research helpers stay silent. */
export async function withResearchActivity<T>(emit: ((event: ResearchActivity) => void) | undefined, signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
  if (!emit) return run();
  const owner: ActivityContext = { emit, signal, pending: new Map() };
  return context.run(owner, async () => {
    try { return await run(); }
    finally {
      owner.closed = true;
      for (const event of owner.pending.values()) publish(owner, { ...event, status: signal?.aborted ? 'cancelled' : 'failed', finishedAt: Date.now() });
      owner.pending.clear();
    }
  });
}

export function researchActivityEnabled(): boolean { return !!context.getStore() && !context.getStore()?.closed; }

export function startResearchActivity(layer: ResearchActivityLayer, operation: ResearchActivityOperation, subject?: string) {
  const owner = context.getStore();
  if (!owner || owner.closed) return (_status: Exclude<ResearchActivity['status'], 'active'> = 'completed', _count?: number) => {};
  const event: ResearchActivity = { id: randomUUID(), layer, operation, status: 'active', startedAt: Date.now(), ...(subject ? { subject: subject.slice(0, 240) } : {}) };
  owner.pending.set(event.id, event);
  publish(owner, event);
  return (status: Exclude<ResearchActivity['status'], 'active'> = 'completed', count?: number) => {
    if (!owner.pending.delete(event.id)) return;
    publish(owner, { ...event, status: owner.signal?.aborted ? 'cancelled' : status, finishedAt: Date.now(), ...(count === undefined ? {} : { count }) });
  };
}

export async function researchActivityStep<T>(layer: ResearchActivityLayer, operation: ResearchActivityOperation, run: () => T | Promise<T>, subject?: string): Promise<T> {
  const finish = startResearchActivity(layer, operation, subject);
  try { const value = await run(); finish('completed', operation !== 'embed' && Array.isArray(value) ? value.length : undefined); return value; }
  catch (error) { finish('failed'); throw error; }
}
