import { PROMPT_LANGUAGES, type PromptLanguage } from './types';

/**
 * The languages Nodus can WRITE in, as one list every picker renders.
 *
 * Each composer used to spell this list out by hand, and they drifted: the Deep
 * Research picker offered seven of the eight supported languages, so an Italian
 * report was reachable over MCP (whose schema enumerates `PROMPT_LANGUAGES`) but
 * not from the app. Deriving the list from `PROMPT_LANGUAGES` and typing the labels
 * as an exhaustive `Record` means adding a language to the union fails the build
 * until it has a label, instead of quietly going missing from a dropdown.
 *
 * The labels are ENDONYMS: a language is named in itself, not translated into the
 * interface language, so they never go through `t()`.
 */
const LABELS: Record<PromptLanguage, string> = {
  es: 'Español',
  en: 'English',
  fr: 'Français',
  de: 'Deutsch',
  pt: 'Português (Portugal)',
  'pt-BR': 'Português (Brasil)',
  it: 'Italiano',
  tr: 'Türkçe',
};

/** Reading order for the pickers: Spanish first, then the rest as declared. */
const ORDER: readonly PromptLanguage[] = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];

export interface PromptLanguageOption {
  id: PromptLanguage;
  /** Endonym. Never pass this through t(). */
  label: string;
}

export const PROMPT_LANGUAGE_OPTIONS: readonly PromptLanguageOption[] = [
  // A language present in the union but missing from ORDER still gets offered,
  // so the two lists cannot silently disagree either.
  ...ORDER.filter((id) => (PROMPT_LANGUAGES as readonly string[]).includes(id)),
  ...PROMPT_LANGUAGES.filter((id) => !ORDER.includes(id)),
].map((id) => ({ id, label: LABELS[id] }));
