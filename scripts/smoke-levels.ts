// Headless smoke for the semantic-zoom level builders (constellation + backbone).
// Run via:
//   npx esbuild scripts/smoke-levels.ts --bundle --platform=node --format=esm --outfile=/tmp/smoke-levels.mjs && node /tmp/smoke-levels.mjs
import { buildThemeConstellation, buildThemeBackbone } from '../src/views/graph/model';

const THEMES = 14;
const IDEAS = 9000;
const IDEA_TYPES = ['claim', 'finding', 'construct', 'method', 'framework'] as const;
const SEMANTIC = ['supports', 'refutes', 'contradicts', 'extends', 'refines', 'applies_to', 'shares_method'] as const;
const rand = (n: number) => Math.floor(Math.random() * n);

const themeLabels = Array.from({ length: THEMES }, (_, t) => `Tema ${t}`);
const nodes: any[] = [];
for (let t = 0; t < THEMES; t++) {
  nodes.push({ id: `theme:${t}`, label: themeLabels[t], type: 'theme', workCount: rand(40), workIds: [], read: false, themes: [themeLabels[t]], years: [], authors: [], maxConfidence: 0.9 });
}
for (let i = 0; i < IDEAS; i++) {
  // 1–2 themes per idea, primary first.
  const primary = rand(THEMES);
  const themes = Math.random() < 0.4 ? [themeLabels[primary], themeLabels[(primary + 1) % THEMES]] : [themeLabels[primary]];
  nodes.push({ id: `idea:${i}`, label: `Idea ${i} sobre algo bastante concreto`, type: IDEA_TYPES[rand(IDEA_TYPES.length)], workCount: rand(8), workIds: [], read: Math.random() < 0.5, themes, years: [], authors: [], maxConfidence: Math.random() });
}

const edges: any[] = [];
let e = 0;
for (let i = 0; i < IDEAS; i++) edges.push({ id: `c${e++}`, source: `theme:${rand(THEMES)}`, target: `idea:${i}`, type: 'contains', basis: 'inferred', confidence: 0.6 });
for (let k = 0; k < 18000; k++) {
  const a = rand(IDEAS); let b = rand(IDEAS); if (a === b) b = (b + 1) % IDEAS;
  edges.push({ id: `s${e++}`, source: `idea:${a}`, target: `idea:${b}`, type: SEMANTIC[rand(SEMANTIC.length)], basis: Math.random() < 0.5 ? 'explicit' : 'inferred', confidence: Math.random() });
}
const data = { nodes, edges } as any;

// ── Level 1: constellation ──
const t0 = performance.now();
const constellation = buildThemeConstellation(data);
const t1 = performance.now();
console.log('— constellation —');
console.log(`nodes: ${constellation.nodes.length} (expect ${THEMES}) · edges: ${constellation.edges.length} · ${(t1 - t0).toFixed(1)} ms`);
if (constellation.nodes.length !== THEMES) throw new Error('constellation node count != themes');
if (!constellation.nodes.every((n) => n.type === 'theme' && !!n.color && n.size > 0)) throw new Error('constellation node missing color/size/type');
if (constellation.edges.length < 1) throw new Error('constellation has no inter-theme edges');
if (!constellation.edges.every((ed) => ed.confidence >= 0 && ed.confidence <= 1 && ed.layoutEdge)) throw new Error('constellation edge malformed');
const biggest = [...constellation.nodes].sort((a, b) => b.workCount - a.workCount)[0];
console.log(`biggest theme: ${biggest.label} (${biggest.workCount} ideas, size ${biggest.size.toFixed(1)}, ${biggest.color})`);

// ── Level 2: backbone for the busiest theme ──
const t2 = performance.now();
const backbone = buildThemeBackbone(data, biggest.label, 90);
const t3 = performance.now();
console.log('— backbone —');
console.log(`nodes: ${backbone.nodes.length} (cap 90) · edges: ${backbone.edges.length} · ${(t3 - t2).toFixed(1)} ms`);
if (backbone.nodes.length === 0) throw new Error('backbone empty');
if (backbone.nodes.length > 90) throw new Error('backbone exceeded cap');
if (backbone.nodes.some((n) => n.type === 'theme')) throw new Error('backbone contains a theme node');
// connectivity: every kept node should touch at least one kept edge
const touched = new Set<string>();
for (const ed of backbone.edges) { touched.add(ed.source); touched.add(ed.target); }
const isolated = backbone.nodes.filter((n) => !touched.has(n.id)).length;
console.log(`isolated nodes in backbone: ${isolated} (expect 0 for a connected core)`);
if (isolated > 0) throw new Error('backbone left isolated nodes — component filter failed');
// edges must only reference kept nodes
const kept = new Set(backbone.nodes.map((n) => n.id));
if (backbone.edges.some((ed) => !kept.has(ed.source) || !kept.has(ed.target))) throw new Error('backbone edge references a dropped node');

// empty / unknown theme must not throw
const empty = buildThemeBackbone(data, 'Tema inexistente', 90);
console.log(`unknown theme backbone: ${empty.nodes.length} nodes (expect 0)`);
if (empty.nodes.length !== 0) throw new Error('unknown theme should yield empty backbone');

console.log('OK ✓');
