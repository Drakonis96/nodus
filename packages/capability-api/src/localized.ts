/** Plugin-supplied copy. `en` is the fallback every consumer can rely on. */
export interface LocalizedText { en: string; [locale: string]: string }

const LOCALE = /^[a-z]{2}(?:-[A-Z]{2})?$/;

export function validateLocalizedText(value: unknown, max = 500): LocalizedText {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid localized text.');
  const record = value as Record<string, unknown>;
  const entries = Object.entries(record);
  if (typeof record.en !== 'string' || !record.en.trim() || entries.length > 24) throw new Error('Localized text needs an "en" entry.');
  for (const [locale, text] of entries) {
    if (!LOCALE.test(locale) || typeof text !== 'string' || !text.trim() || text.length > max) throw new Error(`Invalid localized text for ${locale}.`);
  }
  return structuredClone(record) as LocalizedText;
}

export const localize = (text: LocalizedText, locale: string): string =>
  text[locale] ?? text[locale.split('-')[0]] ?? text.en;
