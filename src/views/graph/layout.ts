// ForceAtlas2 layout running in a Web Worker.
//
// graphology-layout-forceatlas2/worker spawns the physics simulation in a
// background thread and writes x/y back onto the shared graphology graph, which
// Sigma re-renders automatically. This is the core scalability win: growing the
// corpus no longer freezes the UI thread while the layout settles.
//
// We keep the supervisor bounded — it runs for a budget of time then auto-stops
// so it never burns the worker forever once the graph has visually settled. A
// manual `start()` (e.g. after a drag or a "re-layout") can re-run it.
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
      scalingRatio: options.scalingRatio ?? 14,
      gravity: options.gravity ?? 0.8,
      // High slowDown → the live simulation settles calm and only reacts to drags.
      slowDown: 9,
    };
    this.supervisor = new FA2Layout(this.graph, {
      settings,
      getEdgeWeight: 'weight',
    });
    return this.supervisor;
  }

  /**
   * Start the simulation. Runs continuously (live, Obsidian-style) so dragging a
   * node repels its neighbours; pass `durationMs` for a bounded settle instead.
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
