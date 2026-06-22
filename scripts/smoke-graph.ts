// Headless smoke for the scalability-critical data path of the new graph engine.
// Builds the render model, focus index and LOD clustering for a synthetic large
// corpus and reports timings. Run via:
//   npx esbuild scripts/smoke-graph.ts --bundle --platform=node --format=esm --outfile=/tmp/smoke-graph.mjs && node /tmp/smoke-graph.mjs
import Graph from 'graphology';
import { buildGraphModel, type GraphFilters } from '../src/views/graph/model';
import { buildGraphIndex, collectLocalGraph } from '../src/views/graph/focus';
import { computeClusters } from '../src/views/graph/lod';

const THEMES = 60;
const IDEAS = 10_000;
const IDEA_TYPES = ['claim', 'finding', 'construct', 'method', 'framework'] as const;
const SEMANTIC = ['supports', 'refutes', 'contradicts', 'extends', 'refines', 'applies_to', 'shares_method'] as const;

function rand(n: number): number {
  return Math.floor(Math.random() * n);
}

const nodes: any[] = [];
for (let t = 0; t < THEMES; t++) {
  nodes.push({ id: `theme:${t}`, label: `Tema ${t}`, type: 'theme', workCount: rand(40), workIds: [], read: false, themes: [`Tema ${t}`], years: [2000 + rand(25)], authors: [], maxConfidence: 0.9 });
}
for (let i = 0; i < IDEAS; i++) {
  const theme = `Tema ${rand(THEMES)}`;
  nodes.push({ id: `idea:${i}`, label: `Idea ${i} sobre algo`, type: IDEA_TYPES[rand(IDEA_TYPES.length)], workCount: rand(8), workIds: [`w${rand(3000)}`], read: Math.random() < 0.5, themes: [theme], years: [2000 + rand(25)], authors: [`Autor ${rand(800)}`], maxConfidence: Math.random() });
}

const edges: any[] = [];
let e = 0;
// contains: each idea attached to its theme.
for (let i = 0; i < IDEAS; i++) {
  const themeId = `theme:${rand(THEMES)}`;
  edges.push({ id: `e${e++}`, source: themeId, target: `idea:${i}`, type: 'contains', basis: 'inferred', confidence: 0.5 + Math.random() * 0.5 });
}
// semantic links between ideas.
for (let k = 0; k < 20_000; k++) {
  const a = rand(IDEAS);
  let b = rand(IDEAS);
  if (a === b) b = (b + 1) % IDEAS;
  edges.push({ id: `e${e++}`, source: `idea:${a}`, target: `idea:${b}`, type: SEMANTIC[rand(SEMANTIC.length)], basis: Math.random() < 0.5 ? 'explicit' : 'inferred', confidence: Math.random() });
}

const data = { nodes, edges } as any;
const filters: GraphFilters = {
  search: '', nodeTypes: ['theme', ...IDEA_TYPES], edgeTypes: [...SEMANTIC, 'contains'], theme: '', workIds: [], authors: [],
  yearMin: null, yearMax: null, readState: 'all', minConfidence: 0, basis: 'all',
};

const t0 = performance.now();
const model = buildGraphModel(data, filters, 'ideas', 'overview');
const t1 = performance.now();

const graph = new Graph({ multi: true, type: 'directed' });
for (const n of model.nodes) graph.addNode(n.id, { label: n.label, type: n.type, size: n.size, degree: n.degree, workCount: n.workCount, x: Math.random() * 1000, y: Math.random() * 1000 });
for (const ed of model.edges) {
  if (graph.hasNode(ed.source) && graph.hasNode(ed.target)) graph.addEdgeWithKey(ed.id, ed.source, ed.target, { weight: ed.layoutEdge ? ed.confidence : 0 });
}
const t2 = performance.now();

const index = buildGraphIndex(model.nodes, model.edges);
const t3 = performance.now();
const sample = model.nodes.find((n) => n.type !== 'theme')!;
const local = collectLocalGraph(sample.id, index, 2);
const t4 = performance.now();

const clusters = computeClusters(graph);
const t5 = performance.now();

console.log('— Smoke: new graph engine data path (10k ideas) —');
console.log(`model nodes/edges:        ${model.nodes.length} / ${model.edges.length}`);
console.log(`buildGraphModel:          ${(t1 - t0).toFixed(1)} ms`);
console.log(`graphology build:         ${(t2 - t1).toFixed(1)} ms`);
console.log(`buildGraphIndex:          ${(t3 - t2).toFixed(1)} ms`);
console.log(`collectLocalGraph(depth2): ${(t4 - t3).toFixed(2)} ms  (focus nodes: ${local.primaryNodes.size + local.secondaryNodes.size})`);
console.log(`computeClusters (Louvain): ${(t5 - t4).toFixed(1)} ms  → ${clusters.clusters.length} clusters, ${clusters.edges.length} agg edges`);
console.log(`TOTAL data path:          ${(t5 - t0).toFixed(1)} ms`);

if (clusters.clusters.length < 2) throw new Error('LOD produced <2 clusters — aggregation failed');
if (model.nodes.length < THEMES + IDEAS - 5) throw new Error('model dropped too many nodes');
console.log('OK ✓');
