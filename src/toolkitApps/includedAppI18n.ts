import type { AppLanguage } from '@shared/types';

export const INCLUDED_APP_LANGUAGES: AppLanguage[] = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it'];

export type IncludedAppCopy = Record<AppLanguage, Record<string, string>>;

/** Prefix a bundled mini-app with the small localization runtime shared by included apps. */
export function buildIncludedAppScript(copy: IncludedAppCopy, source: string): string {
  return `'use strict';const __copies=${JSON.stringify(copy)};const __locale=Object.prototype.hasOwnProperty.call(__copies,window.nodus.locale)?window.nodus.locale:'en';const __copy=__copies[__locale];document.documentElement.lang=__locale;function tx(key,vars={}){let value=__copy[key]??__copies.en[key]??key;for(const [name,replacement] of Object.entries(vars))value=value.split('{'+name+'}').join(String(replacement));return value}function applyCopy(){document.querySelectorAll('[data-copy]').forEach(element=>{element.textContent=tx(element.dataset.copy)});document.querySelectorAll('[data-copy-placeholder]').forEach(element=>{element.setAttribute('placeholder',tx(element.dataset.copyPlaceholder))});document.querySelectorAll('[data-copy-title]').forEach(element=>{element.setAttribute('title',tx(element.dataset.copyTitle))})}applyCopy();${source}`;
}
