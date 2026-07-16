import type { AppLanguage } from '@shared/types';
import { EN } from './i18n.en';
import { FR } from './i18n.fr';
import { DE } from './i18n.de';
import { PT } from './i18n.pt';
import { PT_BR } from './i18n.pt-BR';

/**
 * Lightweight, dependency-free i18n. The source language is Spanish and the
 * Spanish string itself is the translation key, so:
 *   - In Spanish, `t()` returns the key unchanged (zero risk, byte-identical UI).
 *   - Otherwise `t()` looks the key up in that language's table.
 *
 * Lookups fall back <lang> → EN → ES: a gap in a translated language shows English
 * rather than Spanish, because an untranslated string is far more likely to be
 * readable to that user in English. Spanish remains the last resort since the key
 * *is* the Spanish text, so the app can never show a blank or a raw key.
 * `scripts/test-i18n-coverage.mjs` asserts every table is complete, so the
 * fallbacks are a safety net, not the plan.
 *
 * The active language is a module-level value set once per App render
 * ({@link setActiveLang}) before any child renders, so plain `t()` calls — in
 * components, event handlers and helper functions alike — read the right language
 * without prop-drilling or a context/hook. Because no component is memoized, a
 * language change re-renders the whole tree and every `t()` re-evaluates.
 */
const TABLES: Record<Exclude<AppLanguage, 'es'>, Record<string, string>> = {
  en: EN,
  fr: FR,
  de: DE,
  pt: PT,
  'pt-BR': PT_BR,
};

let activeLang: AppLanguage = 'es';

export function setActiveLang(lang: AppLanguage): void {
  activeLang = lang in TABLES ? lang : 'es';
}

export function getActiveLang(): AppLanguage {
  return activeLang;
}

/** Translate a Spanish source string to the active language (falls back to English). */
export function t(es: string): string {
  if (activeLang === 'es') return es;
  return TABLES[activeLang][es] ?? EN[es] ?? es;
}

/**
 * Translate and interpolate `{name}` placeholders. Keep dynamic values out of the
 * translation key: `tx('{n} obras', { n })` instead of embedding the number.
 */
export function tx(es: string, vars: Record<string, string | number>): string {
  let out = t(es);
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}

/**
 * Pick an already-built value by language, for text that is not keyed by a Spanish
 * source string — in practice the labels that live inside `shared/` data tables
 * (document types, heritage facets) rather than in the tables above.
 *
 * Spanish and English are required; the rest are optional and fall back to English,
 * mirroring {@link t}'s <lang> → EN → ES chain.
 */
export function pick<T>(values: Partial<Record<AppLanguage, T>> & { es: T; en: T }): T {
  return values[activeLang] ?? values.en;
}
