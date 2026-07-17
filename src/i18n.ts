import type { AppLanguage } from '@shared/types';
import { EN } from './i18n.en';
import { FR } from './i18n.fr';
import { DE } from './i18n.de';
import { PT } from './i18n.pt';
import { PT_BR } from './i18n.pt-BR';
import { looksLikeSpanishUiText, normalizeUiLanguage } from '@shared/uiLanguage';

/**
 * Lightweight, dependency-free i18n. The source language is Spanish and the
 * Spanish string itself is the translation key, so:
 *   - In Spanish, `t()` returns the key unchanged (zero risk, byte-identical UI).
 *   - Otherwise `t()` looks the key up in that language's table.
 *
 * Lookups fall back <lang> → EN. A gap in a translated language shows English
 * rather than Spanish, because an untranslated string is far more likely to be
 * readable to that user in English. English is mandatory; an invalid locale also
 * normalizes to English.
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

const MISSING_ENGLISH_TRANSLATION = 'Translation unavailable.';

type TranslationTables = Partial<Record<Exclude<AppLanguage, 'es'>, Record<string, string>>>;

/** Resolve one key with English as the only fallback for non-Spanish locales. */
export function resolveTranslation(
  lang: unknown,
  es: string,
  tables: TranslationTables = TABLES
): string {
  const normalized = normalizeUiLanguage(lang);
  if (normalized === 'es') return es;
  return tables[normalized]?.[es] ?? tables.en?.[es] ?? MISSING_ENGLISH_TRANSLATION;
}

export function setActiveLang(lang: AppLanguage): void {
  activeLang = normalizeUiLanguage(lang);
}

export function getActiveLang(): AppLanguage {
  return activeLang;
}

/** Translate a Spanish source string to the active language (falls back to English). */
export function t(es: string): string {
  return resolveTranslation(activeLang, es);
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
 * mirroring {@link t}'s <lang> → EN chain.
 */
export function pick<T>(values: Partial<Record<AppLanguage, T>> & { es: T; en: T }): T {
  return values[activeLang] ?? values.en;
}

type RuntimePattern = {
  pattern: RegExp;
  render: (match: RegExpMatchArray) => string;
};

const RUNTIME_PATTERNS: RuntimePattern[] = [
  {
    pattern: /^(Esta bóveda ya está cargada\.|Bóveda cargada\.) Claves API copiadas: (\d+)\.$/,
    render: (m) => `${t(m[1])} ${tx('Claves API copiadas: {n}.', { n: m[2] })}`,
  },
  {
    pattern: /^Analizando fragmento (\d+)\/(\d+) con IA…(?: \((\d+)s\))?$/,
    render: (m) => m[3]
      ? tx('Analizando fragmento {current}/{total} con IA… ({seconds}s)', { current: m[1], total: m[2], seconds: m[3] })
      : tx('Analizando fragmento {current}/{total} con IA…', { current: m[1], total: m[2] }),
  },
  {
    pattern: /^Fusionando idea (\d+)\/(\d+)…$/,
    render: (m) => tx('Fusionando idea {current}/{total}…', { current: m[1], total: m[2] }),
  },
  {
    pattern: /^Extrayendo p\. (\d+)\/(\d+)$/,
    render: (m) => tx('Extrayendo p. {current}/{total}', { current: m[1], total: m[2] }),
  },
  {
    pattern: /^(\d+) candidatos encontrados \((\d+) cross-tema\)$/,
    render: (m) => tx('{candidates} candidatos encontrados ({cross} entre temas)', { candidates: m[1], cross: m[2] }),
  },
  {
    pattern: /^(\d+) nuevas relaciones$/,
    render: (m) => tx('{n} nuevas relaciones', { n: m[1] }),
  },
  {
    pattern: /^(\d+) nuevas · (\d+) validados · (\d+) escaneados$/,
    render: (m) => tx('{added} nuevas · {validated} validados · {scanned} escaneados', { added: m[1], validated: m[2], scanned: m[3] }),
  },
  {
    pattern: /^Reintentando \((\d+)\/(\d+)\)…$/,
    render: (m) => tx('Reintentando ({current}/{total})…', { current: m[1], total: m[2] }),
  },
];

/** Translate prose received at runtime from Electron while preserving user data. */
export function tr(value: string): string {
  if (!value || activeLang === 'es') return value;
  const direct = TABLES[activeLang]?.[value] ?? EN[value];
  if (direct) return direct;
  for (const candidate of RUNTIME_PATTERNS) {
    const match = value.match(candidate.pattern);
    if (match) return candidate.render(match);
  }
  return looksLikeSpanishUiText(value) ? t('No se pudo traducir este mensaje.') : value;
}

/** Translate a caught error without turning already-English provider errors into keys. */
export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return tr(message);
}
