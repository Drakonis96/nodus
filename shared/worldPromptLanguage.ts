import type { AppLanguage } from './types';
import { normalizeUiLanguage } from './uiLanguage';

const RESPONSE_LANGUAGE_INSTRUCTION: Record<AppLanguage, string> = {
  es: 'Responde íntegramente en español.',
  en: 'Respond entirely in English.',
  fr: 'Réponds intégralement en français.',
  de: 'Antworte vollständig auf Deutsch.',
  pt: 'Responde integralmente em português europeu.',
  'pt-BR': 'Responda integralmente em português do Brasil.',
  it: 'Rispondi interamente in italiano.',
  tr: 'Yanıtın tamamını Türkçe ver.',
};

/**
 * Worldbuilding prompts carry author prose and invented proper names verbatim, but every
 * generated explanation or draft must follow the prompt language selected for the
 * vault. Keeping this instruction in the target language also works with small local
 * models that underweight a final English-only locale code.
 */
export function withWorldPromptLanguage(system: string, language: unknown): string {
  const locale = normalizeUiLanguage(language);
  return `${system}\n\n${RESPONSE_LANGUAGE_INSTRUCTION[locale]}`;
}
