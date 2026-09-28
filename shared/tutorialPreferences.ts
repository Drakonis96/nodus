import type { AppLanguage, PromptLanguage } from './types';

export type TutorialLanguage = AppLanguage | 'tr' | 'it' | 'zh' | 'ja' | 'ru' | 'uk';

/** Exhaustive on purpose: a language added to the UI (as Korean was) must say here
 * which prompt translation it selects, instead of silently falling back to English. */
const PROMPT_LANGUAGE_BY_TUTORIAL: Record<TutorialLanguage, PromptLanguage> = {
  es: 'es',
  en: 'en',
  fr: 'fr',
  tr: 'tr',
  de: 'de',
  pt: 'pt',
  'pt-BR': 'pt-BR',
  it: 'it',
  'zh-CN': 'zh-Hans',
  'zh-TW': 'zh-Hant',
  // Legacy tutorial-only code kept so an already-saved preference still resolves.
  zh: 'zh-Hans',
  ja: 'ja',
  ko: 'ko',
  ru: 'ru',
  uk: 'uk',
};

/** The tutorial speaks more languages than the interface does. Pick the UI in the
 * tutorial's own language when Nodus has been translated into it, otherwise fall
 * back to English. Generated content follows the tutorial language when Nodus has a
 * matching prompt translation, otherwise English. */
const UI_LANGUAGES: readonly AppLanguage[] = ['es', 'en', 'fr', 'tr', 'de', 'pt', 'pt-BR', 'it', 'zh-CN', 'zh-TW', 'ja', 'ko'];
const UI_LANGUAGE_BY_TUTORIAL: Partial<Record<TutorialLanguage, AppLanguage>> = {
  // The legacy code only ever meant Simplified Chinese, which has its own UI table.
  zh: 'zh-CN',
};

export function preferencesForTutorialLanguage(language: TutorialLanguage): {
  uiLanguage: AppLanguage;
  promptLanguage: PromptLanguage;
} {
  return {
    uiLanguage: UI_LANGUAGES.find((candidate) => candidate === language) ?? UI_LANGUAGE_BY_TUTORIAL[language] ?? 'en',
    promptLanguage: PROMPT_LANGUAGE_BY_TUTORIAL[language] ?? 'en',
  };
}
