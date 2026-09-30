import type { DriftSort } from './driftState';

/** Stable, locale-aware ordering. Recommended preserves the original catalogue/list order. */
export function sortDriftItems<T>(items: readonly T[], mode: DriftSort, labels: {
  language: string;
  name: (item: T) => string;
  type: (item: T) => string;
  uses: (item: T) => number;
}): T[] {
  if (mode === 'recommended') return [...items];
  const collator = new Intl.Collator(labels.language, { sensitivity: 'base', numeric: true });
  return [...items].sort((a, b) => {
    if (mode === 'type') {
      const category = collator.compare(labels.type(a), labels.type(b));
      if (category) return category;
    }
    if (mode === 'usage') {
      const count = labels.uses(b) - labels.uses(a);
      if (count) return count;
    }
    return collator.compare(labels.name(a), labels.name(b));
  });
}
