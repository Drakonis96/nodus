import type { PrimarySourceTextDeepLink } from './primarySourcesTypes';

const PREFIX = 'nodus://primary-source/';

/** Build the stable internal URL for a source when no exact excerpt exists yet. */
export function primarySourceItemDeepLink(itemId: string): string {
  if (!itemId.trim()) throw new Error('A primary-source deep link requires an item.');
  return `${PREFIX}${encodeURIComponent(itemId)}`;
}

/** Build the stable internal URL copied with a primary-source quotation. */
export function primarySourceExcerptDeepLink(
  itemId: string,
  excerptId: string
): string {
  if (!itemId.trim() || !excerptId.trim()) {
    throw new Error('A primary-source deep link requires an item and an excerpt.');
  }
  return `${PREFIX}${encodeURIComponent(itemId)}/excerpt/${encodeURIComponent(excerptId)}`;
}

/** Parse only the exact primary-source excerpt route; unrelated nodus:// links are ignored. */
export function parsePrimarySourceExcerptDeepLink(
  value: string
): PrimarySourceTextDeepLink | null {
  const match = value.match(/^nodus:\/\/primary-source\/([^/?#]+)\/excerpt\/([^/?#]+)$/);
  if (!match) return null;
  try {
    const itemId = decodeURIComponent(match[1]);
    const excerptId = decodeURIComponent(match[2]);
    return itemId && excerptId ? { itemId, excerptId } : null;
  } catch {
    return null;
  }
}
