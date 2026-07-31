/**
 * How many items of a long list a page budget covers.
 *
 * Split out from `useIncrementalList` so the rule can be asserted without a
 * renderer. The rule has two edges that matter, and both were real bugs:
 *
 *  - An item can weigh more than one card. Debates are grouped into clusters,
 *    and paging by clusters alone let a single connected component paint every
 *    contradiction it contained — the exact freeze the paging was added to fix.
 *  - The first item always renders, even when it alone blows the budget, so a
 *    heavy first item shows something instead of an empty list with a
 *    "show more" button under it.
 */
export function incrementalSliceLength<T>(
  items: readonly T[],
  budget: number,
  weight?: (item: T) => number
): number {
  if (items.length === 0) return 0;
  if (!weight) return Math.min(Math.max(1, budget), items.length);
  let used = 0;
  let index = 0;
  while (index < items.length && (index === 0 || used < budget)) {
    used += Math.max(1, weight(items[index]));
    index += 1;
  }
  return index;
}
