import type { ArgumentBlock } from '@shared/types';

export const CARD_WIDTH = 256;
export const CARD_HEIGHT = 156;
const COLUMN = 374;
const ROW = 180;
export type MapPosition = { block: ArgumentBlock; x: number; y: number; side: number; parentId: string | null };

/** Alternate root branches; descendants keep that side as branches unfold. */
export function layoutArgumentMap(root: ArgumentBlock, expanded: Set<string>, relation = '') {
  const nodes: MapPosition[] = [{ block: root, x: 0, y: 0, side: 0, parentId: null }];
  const children = expanded.has(root.id) ? root.children.filter(child => !relation || child.relation === relation) : [];
  const weight = (block: ArgumentBlock): number => expanded.has(block.id) && block.children.length
    ? block.children.reduce((sum, child) => sum + weight(child), 0) : 1;
  const sides: ArgumentBlock[][] = [[], []];
  const weights = [0, 0];
  for (const [index, child] of children.entries()) {
    const side = index % 2;
    sides[side].push(child);
    weights[side] += weight(child);
  }
  const place = (block: ArgumentBlock, parentId: string, side: number, depth: number, top: number) => {
    const height = weight(block) * ROW;
    nodes.push({ block, parentId, side, x: side * depth * COLUMN, y: top + height / 2 });
    if (expanded.has(block.id)) {
      let cursor = top;
      for (const child of block.children) {
        place(child, block.id, side, depth + 1, cursor);
        cursor += weight(child) * ROW;
      }
    }
  };
  sides.forEach((branches, index) => {
    let top = -weights[index] * ROW / 2;
    for (const branch of branches) {
      place(branch, root.id, index === 0 ? -1 : 1, 1, top);
      top += weight(branch) * ROW;
    }
  });
  return nodes;
}
