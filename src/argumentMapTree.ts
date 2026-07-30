import type { ArgumentBlock } from '@shared/types';

/**
 * Ids of the blocks that have children, grouped by depth: level 0 is the root,
 * level 1 its expandable children, and so on. The argument map opens one level
 * per tick, so this is the script of that unfold — and it is contiguous by
 * construction, because a block only lands at depth d when every ancestor above
 * it has children too.
 */
export function expandableIdsByDepth(block: ArgumentBlock, depth = 0, acc: string[][] = []): string[][] {
  if (block.children.length === 0) return acc;
  if (!acc[depth]) acc[depth] = [];
  acc[depth].push(block.id);
  for (const child of block.children) expandableIdsByDepth(child, depth + 1, acc);
  return acc;
}
