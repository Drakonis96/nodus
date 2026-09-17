import type { LibraryItemMetadata } from '../../shared/libraryTypes';

export const ITEM_TYPES: ReadonlyArray<readonly [string, string]>;
export function byline(metadata: LibraryItemMetadata): string;
/** `locale` is one of the shipped languages: 'en', 'es', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-CN', 'ja', 'ko', 'ru', 'zh-TW'. */
export function typeLabel(type: string, locale?: string): string;
export function typeGlyph(type: string): string;
