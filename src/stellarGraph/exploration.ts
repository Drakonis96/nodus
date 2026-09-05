import type { GraphData, GraphNode, GraphEdge } from "@shared/types";
import type { StellarSession } from "@shared/stellarGraph";
import type { StellarGraphSource } from "./source";
/** Pure reveal history plus paginated breadth-first traversal. Rendering never owns topology. */
export class Exploration {
  private cancelled = false;
  private revision = 0;
  removedNodes = new Set<string>();
  private interrupted = false;
  interrupt() {
    this.interrupted = true;
    this.revision++;
  }
  cancel() {
    this.cancelled = true;
    this.revision++;
  }
  nodes = new Map<string, GraphNode>();
  edges = new Map<string, GraphEdge>();
  baselineNodes = new Set<string>();
  baselineEdges = new Set<string>();
  seeds: string[] = [];
  history: string[] = [];
  cursor = 0;
  activeSeed: string | null = null;
  private historySet = new Set<string>();
  private queue: string[] = [];
  private visited = new Set<string>();
  private seen = new Set<string>();
  private pending: GraphEdge[] = [];
  private pageCursor: number | null = 0;
  private head = 0;
  constructor(readonly source: StellarGraphSource) {}
  ingest(data: GraphData) {
    for (const n of data.nodes) if (!this.removedNodes.has(n.id)) this.nodes.set(n.id, n);
    for (const e of data.edges)
      if (this.nodes.has(e.source) && this.nodes.has(e.target))
        this.edges.set(e.id, e);
  }
  async baseline(workId: string) {
    let cursor: number | null = 0;
    do {
      const page = await this.source.page({ kind: "work", id: workId, cursor });
      if (this.cancelled) return;
      this.ingest(page);
      for (const n of page.nodes) this.baselineNodes.add(n.id);
      for (const e of page.edges) this.baselineEdges.add(e.id);
      cursor = page.next;
    } while (cursor !== null);
  }
  start(id: string) {
    if (!this.nodes.has(id)) return;
    this.revision++;
    this.history = this.history.slice(0, this.cursor);
    this.historySet = new Set(this.history);
    if (!this.seeds.includes(id)) this.seeds.push(id);
    this.activeSeed = id;
    this.queue = [id];
    this.visited = new Set([id]);
    this.seen = new Set();
    this.pending = [];
    this.pageCursor = 0;
    this.head = 0;
  }
  /** Load only the selected idea's direct links, paginating until its exact budget is met. */
  async add(id: string, limit: number): Promise<number | undefined> {
    if (this.cancelled) return;
    const revision = ++this.revision;
    this.interrupted = false;
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, GraphEdge>();
    if (!this.nodes.has(id)) {
      const seed = await this.source.page({ kind: "elements", nodeIds: [id] });
      if (this.cancelled || revision !== this.revision) return;
      seed.nodes.forEach(node => nodes.set(node.id, node));
      if (!nodes.has(id)) return;
    }
    let cursor: number | null = 0;
    do {
      const page = await this.source.page({ kind: "neighbors", id, cursor, limit: limit ? Math.min(200, limit - edges.size) : 200 });
      if (this.cancelled || revision !== this.revision) return;
      for (const node of page.nodes) nodes.set(node.id, node);
      for (const edge of page.edges) {
        if (edge.source !== id && edge.target !== id) continue;
        const other = edge.source === id ? edge.target : edge.source;
        if (this.removedNodes.has(other)) continue;
        edges.set(edge.id, edge);
        if (limit && edges.size >= limit) break;
      }
      if (limit && edges.size >= limit) break;
      if (page.next === cursor) throw new Error("No se pudieron cargar todas las conexiones. Vuelve a intentarlo.");
      cursor = page.next;
      // Yield between pages so Clear, tab changes and cancellation stay responsive.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    } while (cursor !== null && !this.cancelled && revision === this.revision);
    if (this.cancelled || revision !== this.revision) return;
    this.removedNodes.delete(id);
    this.ingest({ nodes: [...nodes.values()], edges: [...edges.values()] });
    this.start(id);
    for (const edge of edges.values()) {
      if (!this.edges.has(edge.id) || this.historySet.has(edge.id)) continue;
      this.history.push(edge.id);
      this.historySet.add(edge.id);
    }
    this.cursor = this.history.length;
    return edges.size;
  }

  clear() {
    this.interrupt();
    this.nodes.clear(); this.edges.clear();
    this.baselineNodes.clear(); this.baselineEdges.clear(); this.removedNodes.clear();
    this.seeds = []; this.history = []; this.historySet.clear(); this.cursor = 0;
    this.activeSeed = null; this.queue = []; this.pending = [];
    this.visited.clear(); this.seen.clear(); this.pageCursor = 0; this.head = 0;
  }

  /** Keep the other visible ideas, including those left isolated, and suppress dangling edges. */
  remove(id: string) {
    this.interrupt();
    const visible = this.visible();
    this.removedNodes.add(id);
    this.baselineNodes = new Set(visible.nodes.filter(n => n.id !== id).map(n => n.id));
    const kept = (edgeId: string) => {
      const edge = this.edges.get(edgeId);
      return !!edge && edge.source !== id && edge.target !== id;
    };
    this.cursor = this.history.slice(0, this.cursor).filter(kept).length;
    this.history = this.history.filter(kept);
    this.historySet = new Set(this.history);
    this.baselineEdges = new Set([...this.baselineEdges].filter(kept));
    this.seeds = this.seeds.filter(seed => seed !== id);
    this.nodes.delete(id);
    for (const [key, edge] of this.edges) if (edge.source === id || edge.target === id) this.edges.delete(key);
    this.activeSeed = this.activeSeed === id ? this.seeds[0] ?? null : this.activeSeed;
    this.queue = this.activeSeed ? [this.activeSeed] : [];
    this.visited = new Set(this.queue); this.seen.clear(); this.pending = []; this.pageCursor = 0; this.head = 0;
  }

  previous() {
    if (this.cursor > 0) this.cursor--;
  }
  visible(): GraphData {
    const edgeIds = new Set([
      ...this.baselineEdges,
      ...this.history.slice(0, this.cursor),
    ]);
    const ids = new Set([...this.baselineNodes, ...this.seeds]);
    const edges = [...edgeIds].flatMap((id) => {
      const e = this.edges.get(id);
      if (!e) return [];
      ids.add(e.source);
      ids.add(e.target);
      return [e];
    });
    return {
      nodes: [...ids].flatMap((id) =>
        this.nodes.get(id) ? [this.nodes.get(id)!] : [],
      ),
      edges,
    };
  }
  async next(): Promise<GraphEdge | null | undefined> {
    if (this.cancelled) return null;
    this.interrupted = false;
    const revision = this.revision;
    if (this.cursor < this.history.length)
      return this.edges.get(this.history[this.cursor++]) ?? null;

    while (
      !this.cancelled &&
      !this.interrupted &&
      this.head < this.queue.length
    ) {
      if (!this.pending.length) {
        if (this.pageCursor === null) {
          this.head++;
          this.pageCursor = 0;
          continue;
        }
        const page = await this.source.page({
          kind: "neighbors",
          id: this.queue[this.head],
          cursor: this.pageCursor,
        });
        if (this.cancelled) return null;
        if (revision !== this.revision) return undefined;
        this.ingest(page);
        this.pending = page.edges;
        this.pageCursor = page.next;
        if (this.interrupted) return undefined;
        // Let input and cancellation run even when traversing a large already-visible baseline.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (this.cancelled) return null;
        if (this.interrupted || revision !== this.revision) return undefined;
      }
      while (this.pending.length) {
        const edge = this.pending.shift()!;
        if (this.removedNodes.has(edge.source) || this.removedNodes.has(edge.target)) continue;
        if (this.seen.has(edge.id)) continue;
        this.seen.add(edge.id);
        for (const id of [edge.source, edge.target])
          if (!this.visited.has(id)) {
            this.visited.add(id);
            this.queue.push(id);
          }
        if (!this.baselineEdges.has(edge.id) && !this.historySet.has(edge.id)) {
          this.history.push(edge.id);
          this.historySet.add(edge.id);
          this.cursor++;
          return edge;
        }
      }
    }
    return null;
  }
  async restore(session: StellarSession) {
    this.removedNodes = new Set(session.removedNodes || []);
    const edges = [...new Set(session.history)],
      nodes = [...new Set([...session.seeds, ...(session.pinnedNodes || [])])];
    for (
      let i = 0;
      i < Math.max(edges.length, nodes.length) && !this.cancelled;
      i += 200
    )
      this.ingest(
        await this.source.page({
          kind: "elements",
          nodeIds: nodes.slice(i, i + 200),
          edgeIds: edges.slice(i, i + 200),
        }),
      );
    this.baselineNodes = new Set((session.pinnedNodes || []).filter(id => this.nodes.has(id)));
    this.seeds = session.seeds.filter((id) => this.nodes.has(id));
    const history = session.history.filter((id) => this.edges.has(id));
    if (session.activeSeed && this.nodes.has(session.activeSeed))
      this.start(session.activeSeed);
    this.history = history;
    this.historySet = new Set(history);
    this.cursor = session.history
      .slice(0, session.cursor)
      .filter((id) => this.edges.has(id)).length;
  }
}
