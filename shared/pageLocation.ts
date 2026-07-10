/**
 * Parse a page number out of an evidence/passage location string.
 *
 * Locations come from the deep-scan extractor, which prefixes each PDF page
 * with a `[[p. N]]` marker where N is the PHYSICAL 1-based page index — the
 * same index Zotero's reader expects in `zotero://open-pdf/...?page=N`. Typical
 * shapes: "p. 12", "pp. 12-14", "página 12", "[[p. 12]]", "12". Anything
 * without a leading arabic page number (chapters, roman numerals, section
 * names) returns null and callers fall back to opening the item.
 */
export function parsePageNumber(location: string | null | undefined): number | null {
  if (!location) return null;
  const text = location.trim().toLowerCase();
  if (!text) return null;
  const match =
    /^(?:\[\[)?\s*(?:pp?\.\s*|p[aá]g(?:ina)?s?\.?\s*)?(\d{1,5})/.exec(text) ?? null;
  if (!match) return null;
  const page = Number(match[1]);
  return Number.isInteger(page) && page > 0 ? page : null;
}

/** Zotero deep link that opens a PDF attachment at a specific page. */
export function zoteroOpenPdfUrl(attachmentKey: string, page: number): string {
  return `zotero://open-pdf/library/items/${attachmentKey}?page=${page}`;
}

/** Zotero deep link that selects an item in the library pane. */
export function zoteroSelectUrl(itemKey: string): string {
  return `zotero://select/library/items/${itemKey}`;
}
