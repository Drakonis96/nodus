/**
 * Family-tree layout — pure geometry, no rendering. Given the kinship edges and a
 * focus person, it assigns each reachable person a generation (0 = focus, negative =
 * ancestors, positive = descendants) and an (x, y). Pedigree collapse is handled:
 * a person reachable by several paths gets ONE node (the generation nearest the
 * focus wins), so the "tree" is really a DAG. Within a generation, nodes are ordered
 * by the barycentre of their already-placed neighbours for a tidy, low-crossing look.
 *
 * The view maps person ids back to Person records for the node cards; this module
 * only needs the edges, so it stays trivially testable.
 */

export interface TreeNode {
  personId: string;
  generation: number;
  x: number;
  y: number;
}

export interface TreeEdge {
  from: string;
  to: string;
  kind: 'parent' | 'spouse';
}

export interface TreeLayoutInput {
  focusId: string;
  parentEdges: { parent: string; child: string }[];
  spouseEdges: { a: string; b: string }[];
  ancestorDepth?: number;
  descendantDepth?: number;
  nodeWidth?: number;
  nodeHeight?: number;
  hGap?: number;
  vGap?: number;
}

export interface TreeLayoutResult {
  nodes: TreeNode[];
  edges: TreeEdge[];
  width: number;
  height: number;
}

const DEFAULTS = { ancestorDepth: 3, descendantDepth: 3, nodeWidth: 160, nodeHeight: 64, hGap: 28, vGap: 72 };

export function computeTreeLayout(input: TreeLayoutInput): TreeLayoutResult {
  const opts = { ...DEFAULTS, ...input };
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  for (const { parent, child } of input.parentEdges) {
    (childrenOf.get(parent) ?? childrenOf.set(parent, []).get(parent)!).push(child);
    (parentsOf.get(child) ?? parentsOf.set(child, []).get(child)!).push(parent);
  }
  const spousesOf = new Map<string, string[]>();
  for (const { a, b } of input.spouseEdges) {
    (spousesOf.get(a) ?? spousesOf.set(a, []).get(a)!).push(b);
    (spousesOf.get(b) ?? spousesOf.set(b, []).get(b)!).push(a);
  }

  // ── Generation assignment (BFS up + down; nearest-to-focus wins) ────────────
  const generation = new Map<string, number>();
  if (!input.focusId) return { nodes: [], edges: [], width: 0, height: 0 };
  generation.set(input.focusId, 0);
  const queue: string[] = [input.focusId];
  while (queue.length) {
    const id = queue.shift()!;
    const g = generation.get(id)!;
    if (g > -opts.ancestorDepth) {
      for (const parent of parentsOf.get(id) ?? []) {
        if (!generation.has(parent)) {
          generation.set(parent, g - 1);
          queue.push(parent);
        }
      }
    }
    if (g < opts.descendantDepth) {
      for (const childId of childrenOf.get(id) ?? []) {
        if (!generation.has(childId)) {
          generation.set(childId, g + 1);
          queue.push(childId);
        }
      }
    }
    // Pull in spouses at the same generation so couples sit together.
    for (const spouse of spousesOf.get(id) ?? []) {
      if (!generation.has(spouse) && Math.abs(g) <= Math.max(opts.ancestorDepth, opts.descendantDepth)) {
        generation.set(spouse, g);
        queue.push(spouse);
      }
    }
  }

  // ── Order within each generation by neighbour barycentre ────────────────────
  const byGen = new Map<number, string[]>();
  for (const [id, g] of generation) (byGen.get(g) ?? byGen.set(g, []).get(g)!).push(id);
  const gens = [...byGen.keys()].sort((a, b) => a - b);

  const order = new Map<string, number>();
  // Seed generation 0 in insertion order.
  const seed = byGen.get(0) ?? [];
  seed.forEach((id, i) => order.set(id, i));
  // Walk outward from 0 in both directions, ordering by placed neighbours.
  const outward = [...gens].sort((a, b) => Math.abs(a) - Math.abs(b));
  for (const g of outward) {
    if (g === 0) continue;
    const ids = byGen.get(g)!;
    const neighbourGen = g < 0 ? g + 1 : g - 1; // toward the focus
    const bary = (id: string): number => {
      const rel = g < 0 ? childrenOf.get(id) ?? [] : parentsOf.get(id) ?? [];
      const placed = rel.filter((n) => generation.get(n) === neighbourGen && order.has(n)).map((n) => order.get(n)!);
      const spouses = (spousesOf.get(id) ?? []).filter((s) => order.has(s)).map((s) => order.get(s)!);
      const all = [...placed, ...spouses];
      return all.length ? all.reduce((s, v) => s + v, 0) / all.length : Number.MAX_SAFE_INTEGER;
    };
    ids
      .map((id) => ({ id, key: bary(id) }))
      .sort((a, b) => a.key - b.key)
      .forEach((entry, i) => order.set(entry.id, i));
  }

  // ── Coordinates ─────────────────────────────────────────────────────────────
  const minGen = gens[0] ?? 0;
  const rowStep = opts.nodeHeight + opts.vGap;
  const colStep = opts.nodeWidth + opts.hGap;
  const nodes: TreeNode[] = [];
  let maxCols = 0;
  for (const g of gens) {
    const ids = byGen.get(g)!.slice().sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    maxCols = Math.max(maxCols, ids.length);
    ids.forEach((id, i) => {
      nodes.push({ personId: id, generation: g, x: i * colStep, y: (g - minGen) * rowStep });
    });
  }

  const present = new Set(generation.keys());
  const edges: TreeEdge[] = [];
  for (const { parent, child } of input.parentEdges) {
    if (present.has(parent) && present.has(child)) edges.push({ from: parent, to: child, kind: 'parent' });
  }
  for (const { a, b } of input.spouseEdges) {
    if (present.has(a) && present.has(b)) edges.push({ from: a, to: b, kind: 'spouse' });
  }

  return {
    nodes,
    edges,
    width: Math.max(0, maxCols * colStep - opts.hGap),
    height: Math.max(0, gens.length * rowStep - opts.vGap),
  };
}
