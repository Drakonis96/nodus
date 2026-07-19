import type { AppLanguage } from './types';

export type UiTranslations = Partial<Record<AppLanguage, string>> & { en: string };

const UI_LANGUAGES = new Set<AppLanguage>(['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it']);

/** Runtime locale validation. Unknown or future locales must never fall back to Spanish. */
export function normalizeUiLanguage(language: unknown): AppLanguage {
  return typeof language === 'string' && UI_LANGUAGES.has(language as AppLanguage)
    ? (language as AppLanguage)
    : 'en';
}

/** Pick UI copy with a single, explicit fallback: English. */
export function uiText(language: unknown, translations: UiTranslations): string {
  const normalized = normalizeUiLanguage(language);
  return translations[normalized] ?? translations.en;
}

/**
 * Conservative detector for Spanish application messages. It intentionally ignores
 * short user data and technical identifiers; it is only used at UI/error boundaries.
 */
export function looksLikeSpanishUiText(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (/[¿¡ñáéíóú]/i.test(text)) return true;
  if (/\b(?:bóveda|obra|archivo|carpeta|mientras|después|seleccionad[oa]|encontrad[oa]|configurad[oa]|lectura|cola|pued[ea]s?|debe[sn]?|falta)\b/i.test(text)) return true;
  const functionWords = text.match(/\b(?:el|la|los|las|una?|se|del|para|con|sin)\b/gi) ?? [];
  return functionWords.length >= 2;
}

/**
 * Last-resort protection for legacy Electron errors that still contain prose rather
 * than a stable error code. Specific messages should be translated by the caller;
 * unknown Spanish prose becomes a localized generic error instead of leaking Spanish.
 */
export function localizeRuntimeError(message: string, language: unknown): string {
  if (!looksLikeSpanishUiText(message)) return message;
  return uiText(language, {
    es: message,
    en: 'The operation could not be completed.',
    fr: 'L’opération n’a pas pu être effectuée.',
    de: 'Der Vorgang konnte nicht abgeschlossen werden.',
    pt: 'Não foi possível concluir a operação.',
    'pt-BR': 'Não foi possível concluir a operação.',
    it: 'Non è stato possibile completare l’operazione.',
  });
}

const RENDERER_TRANSLATED_MESSAGES = new Set([
  'Bóveda no encontrada.',
  'No se encontró la bóveda de origen de las claves API.',
  'Esta bóveda ya está cargada.',
  'Bóveda cargada.',
  'No se puede cambiar de bóveda con la cola de análisis activa. Pausa o termina los trabajos pendientes antes de cargar otra bóveda.',
  'No se puede cambiar de bóveda mientras se están indexando embeddings de ideas.',
  'No se puede cambiar de bóveda mientras se están indexando pasajes.',
  'No se puede cambiar de bóveda mientras se descubren relaciones semánticas.',
]);

function isRendererTranslatedMessage(message: string): boolean {
  if (RENDERER_TRANSLATED_MESSAGES.has(message)) return true;
  return /^(?:Esta bóveda ya está cargada\.|Bóveda cargada\.) Claves API copiadas: \d+\.$/.test(message);
}

/**
 * Localize legacy `message`/`error` fields returned as ordinary IPC payloads.
 * Domain content and user-authored title/body fields are deliberately untouched.
 */
export function localizeIpcPayload<T>(value: T, language: unknown): T {
  // Every one of the ~732 IPC handlers passes its result through here, so this
  // runs over entire result sets — a databases view can be 7,000 rows of nested
  // cells. The previous implementation rebuilt every object and array
  // unconditionally (`Object.entries` → `map` → `Object.fromEntries`), which
  // allocated a fresh copy of the whole payload on every call even though the
  // overwhelming majority contain no `message`/`error` field at all.
  //
  // The structure still has to be walked to find those fields, but nothing is
  // allocated unless something actually changed: unchanged subtrees are
  // returned by identity and shared with the original. `for...in` is used over
  // `Object.entries` for the same reason — no intermediate arrays.
  if (Array.isArray(value)) {
    let localizedItems: unknown[] | null = null;
    for (let index = 0; index < value.length; index += 1) {
      const entry = value[index];
      const next = localizeIpcPayload(entry, language);
      if (next !== entry && localizedItems === null) localizedItems = value.slice(0, index);
      if (localizedItems !== null) localizedItems.push(next);
    }
    return (localizedItems ?? value) as T;
  }
  if (!value || typeof value !== 'object') return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  const record = value as Record<string, unknown>;
  let localized: Record<string, unknown> | null = null;
  for (const key in record) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const entry = record[key];
    const next =
      (key === 'message' || key === 'error') &&
      typeof entry === 'string' &&
      !isRendererTranslatedMessage(entry)
        ? localizeRuntimeError(entry, language)
        : localizeIpcPayload(entry, language);
    if (next === entry) {
      if (localized !== null) localized[key] = next;
      continue;
    }
    if (localized === null) {
      // First change in this object: copy what we have skipped so far.
      localized = {};
      for (const seen in record) {
        if (!Object.prototype.hasOwnProperty.call(record, seen)) continue;
        if (seen === key) break;
        localized[seen] = record[seen];
      }
    }
    localized[key] = next;
  }
  return (localized ?? value) as T;
}
