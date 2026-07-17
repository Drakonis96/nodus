import type { AppLanguage, PromptLanguage } from './types';

export type TutorialLanguage = AppLanguage | 'tr' | 'it' | 'zh' | 'ja' | 'ru' | 'uk';

const PROMPT_LANGUAGE_BY_TUTORIAL: Partial<Record<TutorialLanguage, PromptLanguage>> = {
  es: 'es',
  en: 'en',
  fr: 'fr',
  tr: 'tr',
  de: 'de',
  pt: 'pt',
  'pt-BR': 'pt-BR',
};

/** The tutorial speaks more languages than the interface does. Pick the UI in the
 * tutorial's own language when Nodus has been translated into it, otherwise fall
 * back to English. Generated content follows the tutorial language when Nodus has a
 * matching prompt translation, otherwise English. */
const UI_LANGUAGES: readonly AppLanguage[] = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR'];

export function preferencesForTutorialLanguage(language: TutorialLanguage): {
  uiLanguage: AppLanguage;
  promptLanguage: PromptLanguage;
} {
  return {
    uiLanguage: UI_LANGUAGES.find((candidate) => candidate === language) ?? 'en',
    promptLanguage: PROMPT_LANGUAGE_BY_TUTORIAL[language] ?? 'en',
  };
}
