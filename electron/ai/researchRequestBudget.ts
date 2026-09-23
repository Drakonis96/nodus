import { AsyncLocalStorage } from 'node:async_hooks';

/** A report's async calls share the same request envelope. No global setting can
 * leak a notebook's restriction into another vault or concurrent conversation. */
const active = new AsyncLocalStorage<{ window: number; onOverflow: () => void }>();
export const withResearchRequestBudget = <T>(window: number, onOverflow: () => void, run: () => T): T => active.run({ window, onOverflow }, run);
export const currentResearchRequestBudget = () => active.getStore();
export function researchPromptUpperBound(system: string, user: string, output: number): number {
  // Byte-level upper bound, including complete serialized history/tool text.
  // Reserve framing, injected JSON directives and provider message wrappers.
  return new TextEncoder().encode(system).length + new TextEncoder().encode(user).length + output + 1024;
}
