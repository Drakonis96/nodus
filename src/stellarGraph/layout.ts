import type { StellarPosition } from "@shared/stellarGraph";
export const STELLAR_LAYOUT_VERSION = 2;
export function hash(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++)
    h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}
function placementAngle(id: string) {
  // Avalanche sequential idea IDs so neighboring labels do not share a direction.
  let h = (hash(id) * 4294967296) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296 * Math.PI * 2;
}
/** Recognize only the obsolete automatic row, not a manually positioned canvas. */
export function isLegacyLinearLayout(ids: string[], positions: Record<string, StellarPosition>) {
  if (ids.length < 8) return false;
  const ps = ids.map(id => positions[id]);
  return ps.every(p => p && p.y === 0 && p.x % 280 === 0)
    && Math.max(...ps.map(p => p.x)) - Math.min(...ps.map(p => p.x)) > ids.length * 140;
}
/** Place connected ideas together and pack disconnected roots over a 2D spiral.
 * Existing coordinates, including dragged and temporarily hidden nodes, stay immutable. */
export function placeNodes(
  ids: string[],
  edges: { source: string; target: string }[],
  existing: Record<string, StellarPosition>,
) {
  const positions = { ...existing }, occupied = new Set<string>();
  const cell = (p: StellarPosition) => `${Math.round(p.x / 280)},${Math.round(p.y / 170)}`;
  const snap = (x: number, y: number) => ({ x: Math.round(x / 280) * 280, y: Math.round(y / 170) * 170 });
  for (const p of Object.values(positions)) occupied.add(cell(p));
  const adjacency = new Map<string, Set<string>>();
  for (const e of edges) for (const [a, b] of [[e.source, e.target], [e.target, e.source]]) {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a)!.add(b);
  }
  const members = new Set(ids), visited = new Set<string>();
  const neighbors = new Map([...adjacency].map(([id, ns]) => [id, [...ns].sort()]));
  const roots = [...members].sort((a, b) =>
    Number(!!positions[b]) - Number(!!positions[a]) ||
    (neighbors.get(b)?.length || 0) - (neighbors.get(a)?.length || 0) ||
    (a < b ? -1 : a > b ? 1 : 0));
  let rootSlot = 0;
  for (const root of roots) {
    if (visited.has(root)) continue;
    const queue = [root]; visited.add(root);
    for (const id of queue) {
      const ns = neighbors.get(id) || [];
      if (!positions[id]) {
        const parent = ns.find(n => positions[n]);
        let candidate: StellarPosition;
        if (parent) {
          const origin = positions[parent], angle = placementAngle(id);
          let attempt = 0;
          do {
            const r = Math.sqrt(++attempt) * 300, theta = angle + (attempt - 1) * 2.399963;
            candidate = snap(origin.x + Math.cos(theta) * r, origin.y + Math.sin(theta) * r * 0.7);
          } while (occupied.has(cell(candidate)));
        } else {
          do {
            const slot = rootSlot++, r = Math.sqrt(slot) * 360, theta = slot * 2.399963;
            candidate = snap(Math.cos(theta) * r, Math.sin(theta) * r * 0.72);
          } while (occupied.has(cell(candidate)));
        }
        positions[id] = candidate;
        occupied.add(cell(candidate));
      }
      for (const n of ns) if (members.has(n) && !visited.has(n)) {
        visited.add(n); queue.push(n);
      }
    }
  }
  return positions;
}
