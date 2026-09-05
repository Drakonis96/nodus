import { useEffect, useRef, useState } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import type {
  PrimarySourceRelationEdge,
  PrimarySourceRelationNode,
} from '@shared/primarySourcesTypes';
import { seedMissingPositions, settleSync, resolveOverlaps } from './evidenceLayout';

const NODE_COLORS: Record<PrimarySourceRelationNode['status'], string> = {
  confirmed: '#6366f1',
  provisional: '#f59e0b',
  contact: '#94a3b8',
};

export function PrimarySourcesEvidenceGraph({
  nodes,
  edges,
  onSelectEdge,
}: {
  nodes: PrimarySourceRelationNode[];
  edges: PrimarySourceRelationEdge[];
  onSelectEdge: (edgeId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const [light, setLight] = useState(() => document.documentElement.classList.contains('light'));

  useEffect(() => {
    const observer = new MutationObserver(() =>
      setLight(document.documentElement.classList.contains('light'))
    );
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const graph = new Graph({ multi: true, type: 'mixed' });
    for (const node of nodes) {
      graph.addNode(node.nodeId, {
        label: node.displayName,
        size: node.status === 'confirmed' ? 8 : 6,
        color: NODE_COLORS[node.status],
        x: Math.random(),
        y: Math.random(),
      });
    }
    for (const edge of edges) {
      if (!graph.hasNode(edge.fromId) || !graph.hasNode(edge.toId)) continue;
      const attrs = {
        label: edge.historicalLabel,
        size: edge.hasContradiction ? 2.6 : edge.hypothesis ? 1.2 : 1.8,
        color: edge.hasContradiction
          ? '#e11d48'
          : edge.hypothesis
            ? '#f59e0b'
            : light ? '#71717a' : '#a1a1aa',
        type: edge.direction === 'directed' ? 'arrow' : 'line',
      };
      if (edge.direction === 'directed') {
        graph.addDirectedEdgeWithKey(edge.edgeId, edge.fromId, edge.toId, attrs);
      } else {
        graph.addUndirectedEdgeWithKey(edge.edgeId, edge.fromId, edge.toId, attrs);
      }
    }
    seedMissingPositions(graph);
    if (graph.order > 0) settleSync(graph, 260);
    resolveOverlaps(graph, { padding: 18 });
    sigmaRef.current?.kill();
    const sigma = new Sigma(graph, containerRef.current, {
      allowInvalidContainer: true,
      renderLabels: true,
      renderEdgeLabels: true,
      labelRenderedSizeThreshold: 0,
      labelSize: 12,
      labelColor: { color: light ? '#18181b' : '#f4f4f5' },
      edgeLabelSize: 10,
      edgeLabelColor: { color: light ? '#52525b' : '#d4d4d8' },
      defaultEdgeType: 'arrow',
      minCameraRatio: 0.08,
      maxCameraRatio: 4,
    });
    sigma.on('clickEdge', ({ edge }) => onSelectEdge(edge));
    sigmaRef.current = sigma;
    return () => {
      sigma.kill();
      sigmaRef.current = null;
    };
  }, [nodes, edges, light, onSelectEdge]);

  return (
    <div
      ref={containerRef}
      data-testid="primary-sources-evidence-graph"
      className="h-full min-h-[420px] w-full rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
    />
  );
}
