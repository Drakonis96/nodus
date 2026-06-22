// Renderer-agnostic local-graph traversal.
//
// Ports GraphView's `collectLocalGraph` to operate on a lightweight adjacency
// index (built once from the model) instead of Cytoscape collections, returning
// plain id sets. The Sigma renderer turns those sets into focus / secondary /
// context styling tiers. Keeping this pure makes the "tap a node, highlight its
// neighbourhood" path O(local) and free of any renderer object churn.
import type { EdgeModel, NodeModel } from './model';

export interface GraphIndex {
  nodeType: Map<string, string>;
  /** id → adjacency entries (one per connected edge, both directions). */
  adjacency: Map<string, { edgeId: string; other: string; type: string }[]>;
  edge: Map<string, { source: string; target: string; type: string }>;
}

export function buildGraphIndex(nodes: NodeModel[], edges: EdgeModel[]): GraphIndex {
  const nodeType = new Map<string, string>();
  const adjacency = new Map<string, { edgeId: string; other: string; type: string }[]>();
  const edge = new Map<string, { source: string; target: string; type: string }>();
  for (const n of nodes) {
    nodeType.set(n.id, n.type);
    adjacency.set(n.id, []);
  }
  for (const e of edges) {
    edge.set(e.id, { source: e.source, target: e.target, type: e.type });
    adjacency.get(e.source)?.push({ edgeId: e.id, other: e.target, type: e.type });
    adjacency.get(e.target)?.push({ edgeId: e.id, other: e.source, type: e.type });
  }
  return { nodeType, adjacency, edge };
}

export interface LocalGraph {
  center: string;
  primaryNodes: Set<string>;
  primaryEdges: Set<string>;
  secondaryNodes: Set<string>;
  secondaryEdges: Set<string>;
  contextNodes: Set<string>;
  contextEdges: Set<string>;
}

const emptyLocal = (center: string): LocalGraph => ({
  center,
  primaryNodes: new Set([center]),
  primaryEdges: new Set(),
  secondaryNodes: new Set(),
  secondaryEdges: new Set(),
  contextNodes: new Set(),
  contextEdges: new Set(),
});

/**
 * Build the focus neighbourhood for a node.
 * - theme node: primary = theme + its member ideas (contains edges); secondary
 *   = semantic links between members.
 * - idea node: BFS over non-contains edges up to maxDepth, skipping theme hops;
 *   depth 0 → primary, deeper → secondary; context = theme hubs that contain any
 *   focused idea.
 */
export function collectLocalGraph(startId: string, index: GraphIndex, maxDepth: number | null): LocalGraph {
  if (!index.adjacency.has(startId)) return emptyLocal(startId);
  const startType = index.nodeType.get(startId);

  if (startType === 'theme') {
    const result = emptyLocal(startId);
    const memberNodeIds = new Set<string>();
    for (const a of index.adjacency.get(startId) ?? []) {
      if (a.type !== 'contains') continue;
      result.primaryEdges.add(a.edgeId);
      memberNodeIds.add(a.other);
      result.primaryNodes.add(a.other);
    }
    // Semantic links between members.
    for (const [edgeId, e] of index.edge) {
      if (e.type === 'contains') continue;
      if (memberNodeIds.has(e.source) && memberNodeIds.has(e.target)) {
        result.secondaryEdges.add(edgeId);
      }
    }
    return result;
  }

  const result = emptyLocal(startId);
  const visited = new Set<string>([startId]);
  let frontier: string[] = [startId];
  let depth = 0;

  while (frontier.length > 0 && (maxDepth == null || depth < maxDepth)) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      for (const a of index.adjacency.get(nodeId) ?? []) {
        if (a.type === 'contains') continue;
        if (index.nodeType.get(a.other) === 'theme') continue;
        if (depth === 0) {
          result.primaryNodes.add(a.other);
          result.primaryEdges.add(a.edgeId);
        } else {
          result.secondaryNodes.add(a.other);
          result.secondaryEdges.add(a.edgeId);
        }
        if (!visited.has(a.other)) {
          visited.add(a.other);
          next.push(a.other);
        }
      }
    }
    frontier = next;
    depth += 1;
  }

  // Context: theme hubs linked to focused ideas via "contains".
  const ideaNodeIds = new Set<string>([...result.primaryNodes, ...result.secondaryNodes]);
  for (const id of ideaNodeIds) {
    if (index.nodeType.get(id) === 'theme') continue;
    for (const a of index.adjacency.get(id) ?? []) {
      if (a.type !== 'contains') continue;
      if (result.primaryEdges.has(a.edgeId) || result.secondaryEdges.has(a.edgeId)) continue;
      if (index.nodeType.get(a.other) === 'theme') {
        result.contextEdges.add(a.edgeId);
        result.contextNodes.add(a.other);
      }
    }
  }
  // Drop overlaps so a node/edge only lives in its strongest tier.
  for (const id of result.primaryNodes) result.contextNodes.delete(id);
  for (const id of result.secondaryNodes) result.contextNodes.delete(id);
  for (const id of result.primaryEdges) result.contextEdges.delete(id);
  for (const id of result.secondaryEdges) result.contextEdges.delete(id);

  return result;
}
