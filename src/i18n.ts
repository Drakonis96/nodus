import type { AppLanguage } from '@shared/types';
import { EN } from './i18n.en';
import { FR } from './i18n.fr';

/**
 * Lightweight, dependency-free i18n. The source language is Spanish and the
 * Spanish string itself is the translation key, so:
 *   - In Spanish, `t()` returns the key unchanged (zero risk, byte-identical UI).
 *   - Otherwise `t()` looks the key up in that language's table.
 *
 * Lookups fall back FR → EN → ES: a gap in a translated language shows English
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
const TABLES: Record<Exclude<AppLanguage, 'es'>, Record<string, string>> = { en: EN, fr: FR };

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
 * Pick between already-built strings by language (for non-keyed, computed text).
 * `fr` is optional and falls back to `en`, matching {@link t}'s FR → EN → ES chain.
 */
export function pick<T>(es: T, en: T, fr?: T): T {
  if (activeLang === 'es') return es;
  if (activeLang === 'fr') return fr ?? en;
  return en;
}
