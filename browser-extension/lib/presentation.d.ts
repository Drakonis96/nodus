import type { LibraryItemMetadata } from '../../shared/libraryTypes';

export const ITEM_TYPES: ReadonlyArray<readonly [string, string]>;
export function byline(metadata: LibraryItemMetadata): string;
/** `locale` is an interface language: 'en', 'es', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-CN'. */
export function typeLabel(type: string, locale?: string): string;
export function typeGlyph(type: string): string;
