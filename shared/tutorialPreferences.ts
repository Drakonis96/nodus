import type { AppLanguage, PromptLanguage } from './types';

export type TutorialLanguage = AppLanguage | 'fr' | 'tr' | 'de' | 'it' | 'pt' | 'pt-BR' | 'zh' | 'ja' | 'ru' | 'uk';

const PROMPT_LANGUAGE_BY_TUTORIAL: Partial<Record<TutorialLanguage, PromptLanguage>> = {
  es: 'es',
  en: 'en',
  fr: 'fr',
  tr: 'tr',
};

/** Until the full interface is translated, Spanish keeps the Spanish UI and every
 * other tutorial language uses the English UI. Generated content follows the
 * tutorial language when Nodus has a matching prompt translation, otherwise English. */
export function preferencesForTutorialLanguage(language: TutorialLanguage): {
  uiLanguage: AppLanguage;
  promptLanguage: PromptLanguage;
} {
  return {
    uiLanguage: language === 'es' ? 'es' : 'en',
    promptLanguage: PROMPT_LANGUAGE_BY_TUTORIAL[language] ?? 'en',
  };
}
