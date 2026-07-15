import type { TreeNode } from './treeLayout';

export interface TreeFamily {
  id: string;
  parentIds: string[];
  childIds: string[];
  parentGeneration: number;
  childGeneration: number;
  laneIndex: number;
  laneCount: number;
}

function familyKey(parentIds: string[], childGeneration: number): string {
  return `${parentIds.slice().sort().join('|')}->${childGeneration}`;
}

/**
 * Groups parent edges into real family units. Children with the same visible
 * parents share one descent trunk and one sibling bar. Families crossing the
 * same two generations receive separate lanes, so unrelated branches can never
 * collapse into the same horizontal line.
 */
export function buildTreeFamilies(
  parentEdges: { parent: string; child: string }[],
  nodes: TreeNode[]
): TreeFamily[] {
  const nodeById = new Map(nodes.map((node) => [node.personId, node]));
  const parentsByChild = new Map<string, string[]>();
  for (const edge of parentEdges) {
    const parent = nodeById.get(edge.parent);
    const child = nodeById.get(edge.child);
    if (!parent || !child || parent.generation === child.generation) continue;
    (parentsByChild.get(edge.child) ?? parentsByChild.set(edge.child, []).get(edge.child)!).push(edge.parent);
  }

  const grouped = new Map<string, Omit<TreeFamily, 'laneIndex' | 'laneCount'>>();
  for (const [childId, rawParents] of parentsByChild) {
    const child = nodeById.get(childId)!;
    const parentIds = [...new Set(rawParents)].sort((a, b) => (nodeById.get(a)?.x ?? 0) - (nodeById.get(b)?.x ?? 0));
    const parentGeneration = nodeById.get(parentIds[0])?.generation;
    if (parentIds.length === 0 || parentGeneration == null) continue;
    const key = familyKey(parentIds, child.generation);
    const current = grouped.get(key);
    if (current) current.childIds.push(childId);
    else grouped.set(key, {
      id: key,
      parentIds,
      childIds: [childId],
      parentGeneration,
      childGeneration: child.generation,
    });
  }

  const families = [...grouped.values()];
  const transitions = new Map<string, typeof families>();
  for (const family of families) {
    const transition = `${family.parentGeneration}->${family.childGeneration}`;
    (transitions.get(transition) ?? transitions.set(transition, []).get(transition)!).push(family);
  }

  const result: TreeFamily[] = [];
  for (const transitionFamilies of transitions.values()) {
    transitionFamilies.sort((a, b) => {
      const center = (family: typeof a) => family.parentIds.reduce((sum, id) => sum + (nodeById.get(id)?.x ?? 0), 0) / family.parentIds.length;
      return center(a) - center(b);
    });
    transitionFamilies.forEach((family, laneIndex) => result.push({
      ...family,
      childIds: family.childIds.sort((a, b) => (nodeById.get(a)?.x ?? 0) - (nodeById.get(b)?.x ?? 0)),
      laneIndex,
      laneCount: transitionFamilies.length,
    }));
  }
  return result;
}
