import type { AppLanguage } from '@shared/types';
import { EN } from './i18n.en';

/**
 * Lightweight, dependency-free i18n. The source language is Spanish and the
 * Spanish string itself is the translation key, so:
 *   - In Spanish, `t()` returns the key unchanged (zero risk, byte-identical UI).
 *   - In English, `t()` looks the key up in {@link EN}; a missing entry falls back
 *     to the Spanish source, so the app never shows a blank or a raw key.
 *
 * The active language is a module-level value set once per App render
 * ({@link setActiveLang}) before any child renders, so plain `t()` calls — in
 * components, event handlers and helper functions alike — read the right language
 * without prop-drilling or a context/hook. Because no component is memoized, a
 * language change re-renders the whole tree and every `t()` re-evaluates.
 */
let activeLang: AppLanguage = 'es';

export function setActiveLang(lang: AppLanguage): void {
  activeLang = lang === 'en' ? 'en' : 'es';
}

export function getActiveLang(): AppLanguage {
  return activeLang;
}

/** Translate a Spanish source string to the active language. */
export function t(es: string): string {
  if (activeLang === 'es') return es;
  return EN[es] ?? es;
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

/** Pick between two already-built strings by language (for non-keyed, computed text). */
export function pick<T>(es: T, en: T): T {
  return activeLang === 'en' ? en : es;
}
