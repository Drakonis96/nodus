// ForceAtlas2 layout running in a Web Worker.
//
// graphology-layout-forceatlas2/worker spawns the physics simulation in a
// background thread and writes x/y back onto the shared graphology graph, which
// Sigma re-renders automatically. This is the core scalability win: growing the
// corpus no longer freezes the UI thread while the layout settles.
//
// We keep the supervisor bounded — it runs long enough for a visibly physical
// settle, then auto-stops so it never burns the worker forever once the graph
// has visually settled. A manual `start()` (e.g. after a re-layout) can re-run it.
import Graph from 'graphology';
import FA2Layout from 'graphology-layout-forceatlas2/worker';
import { inferSettings } from 'graphology-layout-forceatlas2';

export interface FA2Options {
  /** Auto-stop after this many ms of simulation. */
  durationMs?: number;
  /** Multiplies the inferred gravity (higher = tighter graph). */
  gravity?: number;
  /** Multiplies the inferred scalingRatio (higher = more spread). */
  scalingRatio?: number;
}

export class WorkerLayout {
  private graph: Graph;
  private supervisor: FA2Layout | null = null;
  private stopTimer: number | null = null;
  private onStop?: () => void;

  constructor(graph: Graph) {
    this.graph = graph;
  }

  /** Whether the worker simulation is currently running. */
  get running(): boolean {
    return this.supervisor?.isRunning() ?? false;
  }

  private ensureSupervisor(options: FA2Options): FA2Layout {
    if (this.supervisor) return this.supervisor;
    const inferred = inferSettings(this.graph);
    const settings = {
      ...inferred,
      // Barnes-Hut keeps repulsion ~O(n log n); essential past a few thousand nodes.
      barnesHutOptimize: this.graph.order > 500,
      barnesHutTheta: 0.7,
      // Respect node sizes so labels/circles don't overlap, and dissuade hubs so
      // dense centres open up instead of collapsing into a blob.
      adjustSizes: true,
      outboundAttractionDistribution: true,
      // Honour our per-edge weight (non-layout edges have weight 0 → no pull).
      edgeWeightInfluence: 1,
      // A touch more repulsion and a touch less gravity so dense hubs open up
      // instead of pulling their leaves into a blob. The hard guarantee against
      // stacked circles is resolveOverlaps(), run once the simulation settles.
      scalingRatio: options.scalingRatio ?? 20,
      gravity: options.gravity ?? 0.7,
      // More damping so the graph settles calmly and then stays put, instead of
      // visibly drifting/quivering for many seconds after it appears.
      slowDown: 18,
    };
    this.supervisor = new FA2Layout(this.graph, {
      settings,
      getEdgeWeight: 'weight',
    });
    return this.supervisor;
  }

  /**
   * Start the simulation. Pass `durationMs` for the bounded, visibly settling
   * behaviour used by the graph view.
   */
  start(options: FA2Options = {}, onStop?: () => void): void {
    if (this.graph.order === 0) {
      onStop?.();
      return;
    }
    this.onStop = onStop;
    const supervisor = this.ensureSupervisor(options);
    this.clearTimer();
    if (!supervisor.isRunning()) supervisor.start();
    if (options.durationMs != null) {
      this.stopTimer = window.setTimeout(() => {
        this.stopTimer = null;
        this.stop();
      }, options.durationMs);
    }
  }

  /** Pause the simulation and fire the stop callback once. */
  stop(): void {
    this.clearTimer();
    if (this.supervisor?.isRunning()) this.supervisor.stop();
    const cb = this.onStop;
    this.onStop = undefined;
    cb?.();
  }

  private clearTimer(): void {
    if (this.stopTimer != null) {
      window.clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
  }

  /** Tear down the worker entirely. Call on unmount or before rebuilding. */
  kill(): void {
    this.clearTimer();
    this.onStop = undefined;
    this.supervisor?.kill();
    this.supervisor = null;
  }
}

/**
 * Seed initial positions for any node lacking coordinates. ForceAtlas2 diverges
 * if every node starts at the origin, so we scatter newcomers on a deterministic
 * spiral while preserving the positions of nodes that already had one (so adding
 * nodes to an existing graph is incremental, not a full reshuffle).
 */
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
