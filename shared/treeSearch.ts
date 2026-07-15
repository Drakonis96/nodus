export function normalizeTreeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim();
}

/** Accent-insensitive matching across a person's visible tree fields. */
export function matchesTreeSearch(query: string, fields: Array<string | null | undefined>): boolean {
  const normalizedQuery = normalizeTreeSearch(query);
  if (!normalizedQuery) return true;
  return fields.some((field) => normalizeTreeSearch(field ?? '').includes(normalizedQuery));
}
