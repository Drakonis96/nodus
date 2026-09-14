import type { GraphData } from "@shared/types";
import type { StellarGraphSource } from "./source";

/** Exhaust both independent page streams; disconnected ideas belong to the corpus too. */
export async function loadCorpusContext(
  source: StellarGraphSource,
  cancelled: () => boolean,
  onProgress: (loaded: number, total: number) => void,
): Promise<GraphData | null> {
  const nodes = new Map<string, GraphData["nodes"][number]>();
  const edges = new Map<string, GraphData["edges"][number]>();
  let cursor: number | null = 0;
  do {
    if (cancelled()) return null;
    const page = await source.page({ kind: "corpus", cursor, limit: 200 });
    if (cancelled()) return null;
    page.nodes.forEach(node => nodes.set(node.id, node));
    page.edges.forEach(edge => edges.set(edge.id, edge));
    onProgress(Math.min(cursor + 200, page.total), page.total);
    if (page.next !== null && page.next <= cursor) throw new Error("No se pudo cargar el contexto del corpus.");
    cursor = page.next;
  } while (cursor !== null);
  return { nodes: [...nodes.values()], edges: [...edges.values()].filter(edge =>
    edge.verdict !== "rejected" && nodes.has(edge.source) && nodes.has(edge.target)) };
}
