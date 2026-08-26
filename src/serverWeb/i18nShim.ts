import type { AppLanguage } from '@shared/types';

// Server currently publishes the canonical Spanish Desktop labels. Keeping this
// tiny adapter at the build boundary avoids shipping every Desktop locale (several
// megabytes) to phones merely so shared presentational components can call t().
let active: AppLanguage = 'es';

export function setActiveLang(language: AppLanguage): void { active = language; }
export function getActiveLang(): AppLanguage { return active; }
export function t(source: string): string { return source; }
export function tx(source: string, variables: Record<string, string | number>): string {
  return Object.entries(variables).reduce((value, [key, replacement]) => value.replaceAll(`{${key}}`, String(replacement)), source);
}
export function tr(value: string): string { return value; }
export function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export function pick<T>(values: Partial<Record<AppLanguage, T>> & { es: T; en: T }): T { return values[active] ?? values.es; }
export function resolveTranslation(source: string): string { return source; }
export function notificationLine(_text: unknown, fallback: string | undefined): string { return fallback || ''; }
