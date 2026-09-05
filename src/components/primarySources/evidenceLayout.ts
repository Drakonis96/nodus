// Layout helpers used only by person and primary-source networks.
import Graph from 'graphology';
import forceAtlas2, { inferSettings } from 'graphology-layout-forceatlas2';

export function settleSync(graph: Graph, iterations = 400): void {
  if (graph.order === 0) return;
  const inferred = inferSettings(graph);
  forceAtlas2.assign(graph, {
    iterations,
    getEdgeWeight: 'weight',
    settings: {
      ...inferred,
      barnesHutOptimize: graph.order > 500,
      barnesHutTheta: 0.7,
      adjustSizes: true,
      outboundAttractionDistribution: true,
      edgeWeightInfluence: 1,
      scalingRatio: 22,
      gravity: 0.9,
      slowDown: 8,
    },
  });
}


export function seedMissingPositions(graph: Graph, previous?: Map<string, { x: number; y: number }>): void {
  const golden = Math.PI * (3 - Math.sqrt(5));
  let i = 0;
  graph.forEachNode((id, attrs) => {
    const prior = previous?.get(id);
    if (prior) {
      graph.mergeNodeAttributes(id, { x: prior.x, y: prior.y });
      return;
    }
    if (typeof attrs.x === 'number' && typeof attrs.y === 'number') return;
    const radius = 12 * Math.sqrt(i + 1);
    const angle = (i + 1) * golden;
    graph.mergeNodeAttributes(id, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
    i++;
  });
}

/** Force every node onto a fresh deterministic spiral (used by "reset graph"). */
export function scatterPositions(graph: Graph): void {
  const golden = Math.PI * (3 - Math.sqrt(5));
  let i = 0;
  graph.forEachNode((id) => {
    const radius = 12 * Math.sqrt(i + 1);
    const angle = (i + 1) * golden;
    graph.mergeNodeAttributes(id, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
    i++;
  });
}

/**
 * Push apart any nodes whose circles overlap. ForceAtlas2's `adjustSizes`
 * anti-collision is approximate (and weakened by Barnes-Hut on large graphs), so
 * the settled layout can still leave circles stacked on top of one another — the
 * unreadable "blob" the user sees. This runs once after the simulation stops and
 * deterministically separates overlapping nodes with a few relaxation passes over
 * a spatial hash, so the result is O(n·iterations) rather than O(n²).
 *
 * `padding` is extra breathing room (in layout units) added on top of each pair's
 * combined radii, so labels have somewhere to sit. Positions are only nudged, so
 * the overall shape the force layout found is preserved.
 */
export function resolveOverlaps(
  graph: Graph,
  opts: { padding?: number; iterations?: number } = {}
): boolean {
  const padding = opts.padding ?? 10;
  const iterations = opts.iterations ?? 80;

  const ids: string[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  const rs: number[] = [];
  let maxR = 1;
  graph.forEachNode((id, attrs) => {
    if (typeof attrs.x !== 'number' || typeof attrs.y !== 'number') return;
    const r = Math.max(1, Number(attrs.size ?? 4));
    ids.push(id);
    xs.push(attrs.x as number);
    ys.push(attrs.y as number);
    rs.push(r);
    if (r > maxR) maxR = r;
  });

  const n = ids.length;
  if (n < 2) return false;

  const cell = maxR * 2 + padding;
  let anyMoved = false;

  for (let iter = 0; iter < iterations; iter++) {
    const grid = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const key = `${Math.floor(xs[i] / cell)},${Math.floor(ys[i] / cell)}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(i);
      else grid.set(key, [i]);
    }

    let moved = false;
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(xs[i] / cell);
      const cy = Math.floor(ys[i] / cell);
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const bucket = grid.get(`${gx},${gy}`);
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            let dx = xs[j] - xs[i];
            let dy = ys[j] - ys[i];
            let dist = Math.hypot(dx, dy);
            const minDist = rs[i] + rs[j] + padding;
            if (dist >= minDist) continue;
            if (dist < 1e-6) {
              // Coincident nodes: nudge along a deterministic direction derived
              // from the index so the resolution stays stable across runs.
              const a = (i * 2.399963) % (Math.PI * 2);
              dx = Math.cos(a);
              dy = Math.sin(a);
              dist = 1;
            }
            const shift = (minDist - dist) / 2;
            const ux = dx / dist;
            const uy = dy / dist;
            xs[i] -= ux * shift;
            ys[i] -= uy * shift;
            xs[j] += ux * shift;
            ys[j] += uy * shift;
            moved = true;
          }
        }
      }
    }
    if (moved) anyMoved = true;
    else break;
  }

  if (anyMoved) {
    for (let i = 0; i < n; i++) graph.mergeNodeAttributes(ids[i], { x: xs[i], y: ys[i] });
  }
  return anyMoved;
}
