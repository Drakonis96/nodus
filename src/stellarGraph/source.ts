import type { GraphData, IdeaDetail, EdgeDetail } from "@shared/types";
import type {
  StellarPage,
  StellarPageRequest,
  StellarSession,
} from "@shared/stellarGraph";
import type { KnowledgeViewSource } from "../views/knowledgeViewSource";
export interface StellarGraphSource {
  key: string;
  readOnly?: boolean;
  page(request: StellarPageRequest): Promise<StellarPage>;
  idea?(id: string): Promise<IdeaDetail | null>;
  edge?(id: string): Promise<EdgeDetail | null>;
  restore?(): Promise<StellarSession | null>;
  save?(state: StellarSession): Promise<void>;
}
export function cleanGraph(data: GraphData): GraphData {
  const nodes = data.nodes.filter(
    (n) => n.type !== "theme" && n.type !== "author",
  );
  const ids = new Set(nodes.map((n) => n.id));
  return {
    nodes,
    edges: data.edges.filter(
      (e) => e.verdict !== "rejected" && ids.has(e.source) && ids.has(e.target),
    ),
  };
}
export function memorySource(
  key: string,
  get: () => Promise<GraphData>,
): StellarGraphSource {
  let cached: Promise<GraphData> | undefined;
  return {
    key,
    async page(req) {
      const graph = await (cached ??= get().then(cleanGraph));
      let ns = graph.nodes,
        es = graph.edges;
      if (req.kind === "search") {
        const q = (req.search || "").toLocaleLowerCase();
        ns = ns.filter((n) =>
          `${n.label} ${n.statement || ""} ${n.themes.join(" ")}`
            .toLocaleLowerCase()
            .includes(q),
        );
        es = [];
      }
      if (req.kind === "neighbors") {
        es = es
          .filter((e) => e.source === req.id || e.target === req.id)
          .sort(compareEdges);
        ns = [];
      }
      if (req.kind === "work") {
        ns = ns.filter((n) => n.workIds?.includes(req.id!));
        const ids = new Set(ns.map((n) => n.id));
        es = es.filter((e) => ids.has(e.source) && ids.has(e.target));
      }
      if (req.kind === "elements") {
        ns = ns.filter((n) => req.nodeIds?.includes(n.id));
        es = es.filter((e) => req.edgeIds?.includes(e.id));
      }
      const offset = req.cursor || 0,
        limit = Math.min(req.limit || 200, 200),
        total = Math.max(ns.length, es.length);
      ns = ns.slice(offset, offset + limit);
      es = es.slice(offset, offset + limit);
      const ids = new Set([
        ...ns.map((n) => n.id),
        ...es.flatMap((e) => [e.source, e.target]),
      ]);
      return {
        nodes: graph.nodes.filter((n) => ids.has(n.id)),
        edges: es,
        total,
        next: offset + limit < total ? offset + limit : null,
      };
    },
  };
}
export function compareEdges(
  a: GraphData["edges"][number],
  b: GraphData["edges"][number],
) {
  const rank = (e: typeof a) =>
    e.verdict === "confirmed" ? 0 : e.basis === "explicit" ? 1 : 2;
  return (
    rank(a) - rank(b) || b.confidence - a.confidence || a.id.localeCompare(b.id)
  );
}
export function desktopSource(
  source: KnowledgeViewSource,
  context: string,
): StellarGraphSource {
  let vaultId = "";
  const adapter =
    source.key === "academic"
      ? {
          key: context,
          page: (r: StellarPageRequest) => window.nodus.stellarPage(r),
        }
      : memorySource(context, () => source.getGraph("ideas"));
  return {
    ...adapter,
    idea: source.getIdeaDetail,
    edge: source.getEdgeDetail,
    async restore() {
      const saved = await window.nodus.getStellarSession(context);
      vaultId = saved.vaultId;
      return saved.session;
    },
    async save(state) {
      if (vaultId)
        await window.nodus.saveStellarSession(vaultId, context, state);
    },
  };
}
