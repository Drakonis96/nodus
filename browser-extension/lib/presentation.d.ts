import type { LibraryItemMetadata } from '../../shared/libraryTypes';

export const ITEM_TYPES: ReadonlyArray<readonly [string, string]>;
export function byline(metadata: LibraryItemMetadata): string;
export function typeLabel(type: string, spanishUi?: boolean): string;
export function typeGlyph(type: string): string;
