/**
 * Family-tree layout — pure geometry, no rendering. Assigns each reachable person a
 * generation (0 = focus, negative = ancestors, positive = descendants) and an (x, y).
 *
 * Couples are handled with care for the messy real cases: spouses AND unmarried
 * co-parents (two people sharing a child) are grouped ADJACENT; within a couple the
 * man goes left and the woman right (same-sex couples order by birth year, then id);
 * a person married more than once appears ONCE with their spouses chained beside
 * them. Pedigree collapse keeps one node per person even when reachable by several
 * paths. Each node carries `coupleSide` so the renderer can face default portraits
 * inward. The view maps ids back to Person records; this module only needs edges +
 * light attributes, so it stays testable.
 */

export type CoupleSide = 'left' | 'right' | 'none';

export interface TreePersonAttr {
  id: string;
  sex?: string;
  birthYear?: number | null;
}

export interface TreeNode {
  personId: string;
  generation: number;
  x: number;
  y: number;
  coupleSide: CoupleSide;
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
  persons?: TreePersonAttr[];
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

// Ancestor/descendant depth is UNLIMITED by default — a family tree should show every
// generation it has, however deep. A caller may still pass a finite depth to focus.
const DEFAULTS = {
  ancestorDepth: Number.POSITIVE_INFINITY,
  descendantDepth: Number.POSITIVE_INFINITY,
  nodeWidth: 160,
  nodeHeight: 64,
  hGap: 28,
  vGap: 88,
};

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function computeTreeLayout(input: TreeLayoutInput): TreeLayoutResult {
  const opts = { ...DEFAULTS, ...input };
  if (!input.focusId) return { nodes: [], edges: [], width: 0, height: 0 };

  const sexOf = new Map<string, string>();
  const birthYearOf = new Map<string, number | null>();
  for (const p of input.persons ?? []) {
    sexOf.set(p.id, p.sex ?? 'unknown');
    birthYearOf.set(p.id, p.birthYear ?? null);
  }

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

  // ── Generations (BFS up + down; nearest-to-focus wins; spouses share a gen) ──
  const generation = new Map<string, number>();
  generation.set(input.focusId, 0);
  const queue = [input.focusId];
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
    for (const spouse of spousesOf.get(id) ?? []) {
      if (!generation.has(spouse) && Math.abs(g) <= Math.max(opts.ancestorDepth, opts.descendantDepth)) {
        generation.set(spouse, g);
        queue.push(spouse);
      }
    }
  }

  const present = new Set(generation.keys());

  // ── Couple links within a generation: spouses + unmarried co-parents ────────
  const coupleLinks = new Set<string>(); // "a|b"
  const partners = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b || !present.has(a) || !present.has(b) || generation.get(a) !== generation.get(b)) return;
    coupleLinks.add(pairKey(a, b));
    (partners.get(a) ?? partners.set(a, new Set()).get(a)!).add(b);
    (partners.get(b) ?? partners.set(b, new Set()).get(b)!).add(a);
  };
  for (const { a, b } of input.spouseEdges) link(a, b);
  // Co-parents: any two parents of the same child.
  for (const parents of parentsOf.values()) {
    for (let i = 0; i < parents.length; i++) {
      for (let j = i + 1; j < parents.length; j++) link(parents[i], parents[j]);
    }
  }

  const byGen = new Map<number, string[]>();
  for (const [id, g] of generation) (byGen.get(g) ?? byGen.set(g, []).get(g)!).push(id);
  const gens = [...byGen.keys()].sort((a, b) => a - b);

  // Order a couple (2 people): man left, woman right; same-sex by birth year then id.
  const orderPair = (x: string, y: string): [string, string] => {
    const sx = sexOf.get(x);
    const sy = sexOf.get(y);
    if (sx === 'male' && sy === 'female') return [x, y];
    if (sx === 'female' && sy === 'male') return [y, x];
    const bx = birthYearOf.get(x) ?? null;
    const by = birthYearOf.get(y) ?? null;
    if (bx != null && by != null && bx !== by) return bx < by ? [x, y] : [y, x];
    return x < y ? [x, y] : [y, x];
  };

  // Order a whole coupled component into a contiguous run (person + chained spouses).
  const orderComponent = (members: string[]): string[] => {
    if (members.length === 1) return members;
    if (members.length === 2) return orderPair(members[0], members[1]);
    // Chain/star: greedy walk from an endpoint, then man-left tidy for the first pair.
    const set = new Set(members);
    const start = members.find((m) => [...(partners.get(m) ?? [])].filter((p) => set.has(p)).length === 1) ?? members[0];
    const seq: string[] = [];
    const seen = new Set<string>();
    let cur: string | undefined = start;
    while (cur) {
      seq.push(cur);
      seen.add(cur);
      const next: string | undefined = [...(partners.get(cur) ?? [])].find((p) => set.has(p) && !seen.has(p));
      cur = next;
    }
    for (const m of members) if (!seen.has(m)) seq.push(m); // stragglers (branches)
    return seq;
  };

  const order = new Map<string, number>();

  const orderGeneration = (g: number, neighbourGen: number | null) => {
    const ids = byGen.get(g)!;
    // Components via union of coupleLinks restricted to this generation.
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r)!;
      return r;
    };
    for (const id of ids) parent.set(id, id);
    for (const id of ids) {
      for (const p of partners.get(id) ?? []) {
        if (generation.get(p) === g) parent.set(find(id), find(p));
      }
    }
    const comps = new Map<string, string[]>();
    for (const id of ids) (comps.get(find(id)) ?? comps.set(find(id), []).get(find(id))!).push(id);

    const nodeBary = (id: string): number => {
      if (neighbourGen === null) return Number.MAX_SAFE_INTEGER;
      const rel = g < 0 ? childrenOf.get(id) ?? [] : parentsOf.get(id) ?? [];
      const placed = rel.filter((n) => generation.get(n) === neighbourGen && order.has(n)).map((n) => order.get(n)!);
      return placed.length ? placed.reduce((s, v) => s + v, 0) / placed.length : Number.MAX_SAFE_INTEGER;
    };

    const ordered = [...comps.values()]
      .map((members) => {
        const seq = orderComponent(members);
        const barys = members.map(nodeBary).filter((b) => b < Number.MAX_SAFE_INTEGER);
        const bary = barys.length ? barys.reduce((s, v) => s + v, 0) / barys.length : Number.MAX_SAFE_INTEGER;
        return { seq, bary };
      })
      .sort((a, b) => a.bary - b.bary);

    let i = 0;
    for (const comp of ordered) for (const id of comp.seq) order.set(id, i++);
  };

  // Seed the focus generation, then order outward so couples sit under their kin.
  orderGeneration(0, null);
  for (const g of [...gens].sort((a, b) => Math.abs(a) - Math.abs(b))) {
    if (g === 0) continue;
    orderGeneration(g, g < 0 ? g + 1 : g - 1);
  }

  // ── Coordinates ─────────────────────────────────────────────────────────────
  const minGen = gens[0] ?? 0;
  const rowStep = opts.nodeHeight + opts.vGap;
  const colStep = opts.nodeWidth + opts.hGap;
  const nodesById = new Map<string, TreeNode>();
  const nodes: TreeNode[] = [];
  let maxCols = 0;
  for (const g of gens) {
    const ids = byGen.get(g)!.slice().sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    maxCols = Math.max(maxCols, ids.length);
    ids.forEach((id, col) => {
      const node: TreeNode = { personId: id, generation: g, x: col * colStep, y: (g - minGen) * rowStep, coupleSide: 'none' };
      nodes.push(node);
      nodesById.set(id, node);
    });
  }

  // coupleSide: relative to the nearest placed partner (drives inward-facing portraits).
  for (const node of nodes) {
    const ps = [...(partners.get(node.personId) ?? [])].map((p) => nodesById.get(p)).filter(Boolean) as TreeNode[];
    if (ps.length === 0) continue;
    const nearest = ps.reduce((a, b) => (Math.abs(b.x - node.x) < Math.abs(a.x - node.x) ? b : a));
    node.coupleSide = node.x < nearest.x ? 'left' : 'right';
  }

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
