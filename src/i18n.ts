import type { AppLanguage } from '@shared/types';
import { EN } from './i18n.en';
import { FR } from './i18n.fr';
import { DE } from './i18n.de';
import { PT } from './i18n.pt';
import { PT_BR } from './i18n.pt-BR';
import { IT } from './i18n.it';
import { TR } from './i18n.tr';
import { looksLikeSpanishUiText, normalizeUiLanguage } from '@shared/uiLanguage';
import { NODI_NOTIFICATION_TEXT, type NodiNotificationText } from '@shared/nodiNotifications';

/**
 * Lightweight, dependency-free i18n. The source language is Spanish and the
 * Spanish string itself is the translation key, so:
 *   - In Spanish, `t()` returns the key unchanged (zero risk, byte-identical UI).
 *   - Otherwise `t()` looks the key up in that language's table.
 *
 * Lookups fall back <lang> → EN. Dynamic values that are not translation keys are
 * preserved as written when neither table contains them; an invalid locale still
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
  it: IT,
  tr: TR,
};

let activeLang: AppLanguage = 'es';

type TranslationTables = Partial<Record<Exclude<AppLanguage, 'es'>, Record<string, string>>>;

/** Resolve one key with English first and the original dynamic value last. */
export function resolveTranslation(
  lang: unknown,
  es: string,
  tables: TranslationTables = TABLES
): string {
  const normalized = normalizeUiLanguage(lang);
  if (normalized === 'es') return es;
  // `t()` is also used at a few dynamic render boundaries (provider labels,
  // imported metadata and runtime catalogues). Those values are not translation
  // keys and must remain readable when they are absent from the static tables.
  // Literal UI copy is still exhaustively checked by test-i18n-coverage.mjs.
  return tables[normalized]?.[es] ?? tables.en?.[es] ?? es;
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
  {
    pattern: /^Traduciendo (\d+) de (\d+) fragmentos…$/,
    render: (m) => tx('Traduciendo {done} de {total} fragmentos…', { done: m[1], total: m[2] }),
  },
  {
    pattern: /^(.+): analizando…$/,
    render: (m) => tx('{name}: analizando…', { name: m[1] }),
  },
  {
    pattern: /^(.+): reconstruyendo…$/,
    render: (m) => tx('{name}: reconstruyendo…', { name: m[1] }),
  },
  {
    pattern: /^(.+): traduciendo…$/,
    render: (m) => tx('{name}: traduciendo…', { name: m[1] }),
  },
  {
    pattern: /^(.+): guardando…$/,
    render: (m) => tx('{name}: guardando…', { name: m[1] }),
  },
  {
    pattern: /^Revisa las páginas (.+): el texto necesitó un ajuste tipográfico intenso\.$/,
    render: (m) => tx('Revisa las páginas {pages}: el texto necesitó un ajuste tipográfico intenso.', { pages: m[1] }),
  },
  {
    pattern: /^(.+?): (.+)$/,
    render: (m) => tx('{name}: {warning}', { name: m[1], warning: tr(m[2]) }),
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

/**
 * Every catalogue sentence as a matcher, so a notification stored as Spanish prose by
 * an older build can be read back as the key it would be written with today. A plain
 * table lookup cannot do this: the stored sentence carries its values inline
 * ("102 tareas completadas y 183 con errores."), which is exactly why those lines used
 * to end up as "this message could not be translated".
 */
const LEGACY_NOTIFICATION_PATTERNS = Object.values(NODI_NOTIFICATION_TEXT).map((source) => ({
  source,
  names: [...source.matchAll(/\{(\w+)\}/g)].map((match) => match[1]),
  pattern: new RegExp(`^${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{\w+\\\}/g, '(.+?)')}$`),
}));

/** Re-key a stored Spanish sentence, or null when it is not one of ours. */
function recoverLegacyNotification(prose: string): string | null {
  for (const entry of LEGACY_NOTIFICATION_PATTERNS) {
    const match = prose.match(entry.pattern);
    if (!match) continue;
    const values: Record<string, string> = {};
    entry.names.forEach((name, index) => { values[name] = match[index + 1]; });
    return tx(entry.source, values);
  }
  return null;
}

/**
 * Render one line of a Nodi notification. The main process stores a catalogue key and
 * its values rather than a finished sentence — Nodi's centre is global while the UI
 * language is per-vault, so prose written there is stuck in the language of whichever
 * vault raised it.
 *
 * `fallback` covers the two cases with no key: notifications stored before the
 * catalogue existed, and provider errors, which are runtime prose.
 */
export function notificationLine(text: NodiNotificationText | undefined, fallback: string | undefined): string {
  const source = text ? NODI_NOTIFICATION_TEXT[text.id] : undefined;
  if (!source) {
    if (!fallback) return '';
    return recoverLegacyNotification(fallback) ?? tr(fallback);
  }
  const values: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(text?.params ?? {})) {
    // A timestamp is formatted here, not by the emitter, for the same reason the
    // sentence is: only the renderer knows the locale this reader is looking at.
    values[name] = typeof value === 'object'
      ? new Date(value.datetime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      : value;
  }
  return tx(source, values);
}
