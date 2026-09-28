import { AsyncLocalStorage } from 'node:async_hooks';
import { PROMPT_LANGUAGES, type PromptLanguage } from '@shared/types';

/**
 * Output language for every model call made by one background job. The generation
 * form lets the user pick a language per report; without this scope the vault-wide
 * `promptLanguage` setting was appended last (highest priority) to every call and
 * silently won over the report's own choice.
 */
const override = new AsyncLocalStorage<PromptLanguage>();

export function withJobOutputLanguage<T>(language: unknown, run: () => T): T {
  return (PROMPT_LANGUAGES as readonly unknown[]).includes(language) ? override.run(language as PromptLanguage, run) : run();
}

export function jobOutputLanguage(): PromptLanguage | undefined {
  return override.getStore();
}
