import type { GraphData } from "@shared/types";
import type { StellarPosition, StellarTheme } from "@shared/stellarGraph";
import { compareEdges, themeName } from "./source";

/** Room each theme node needs from its neighbours: label cards are 220 wide. */
const THEME_SPACING = 265;
/** Widest a single ring may get and still leave its labels on screen at full size. */
const THEME_MAX_RADIUS = 680;
/** Tightest ring that still keeps two facing labels apart, and the gap between rings. */
const THEME_MIN_RADIUS = 300;
const THEME_RING_STEP = 330;
/** A screen is wider than it is tall, so the ring is an ellipse rather than a circle. */
export const THEME_SQUASH = 0.48;

/** How many nodes fit on a ring of this radius without crowding their labels. */
const ringCapacity = (radius: number) =>
  Math.max(1, Math.floor((2 * Math.PI * radius * Math.sqrt(THEME_SQUASH)) / THEME_SPACING));

/**
 * Themes as a ring of identical nodes: busiest at the top, going clockwise, on concentric
 * circles when one will not hold them all.
 *
 * Drawn at full size and centred rather than fitted, because a theme node zoomed out to a
 * speck stops reading as the graph node it is; the ring is therefore sized to what a
 * screen can hold, and only overflows inwards.
 */
export function themeConstellation(themes: StellarTheme[]): Record<string, StellarPosition> {
  const ordered = sortThemes(themes);
  if (ordered.length === 1) return { [ordered[0].id]: { x: 0, y: 0 } };

  // A few themes make one circle, sized to hold them and no larger.
  const single = ringCapacity(THEME_MAX_RADIUS);
  let sizes: number[];
  if (ordered.length <= single) {
    sizes = [
      Math.min(
        THEME_MAX_RADIUS,
        Math.max(THEME_MIN_RADIUS, (ordered.length * THEME_SPACING) / (2 * Math.PI * Math.sqrt(THEME_SQUASH))),
      ),
    ];
  } else {
    // More than one circle: rings step outwards by a fixed distance, so the gap between
    // them never closes below what a label needs, whatever the corpus holds.
    sizes = [THEME_MIN_RADIUS];
    while (sizes.reduce((total, radius) => total + ringCapacity(radius), 0) < ordered.length)
      sizes.push(THEME_MIN_RADIUS + sizes.length * THEME_RING_STEP);
    sizes.reverse();
  }
  const capacities = sizes.map(ringCapacity);
  const total = capacities.reduce((sum, capacity) => sum + capacity, 0);
  // Share the themes between rings by how much each can hold, outermost first.
  const share = capacities.map((capacity) => Math.min(capacity, Math.round((ordered.length * capacity) / total)));
  let left = ordered.length - share.reduce((sum, n) => sum + n, 0);
  for (let i = 0; left !== 0; i = (i + 1) % share.length) {
    const room = capacities[i] - share[i];
    if (left > 0 && room > 0) { share[i]++; left--; }
    else if (left < 0 && share[i] > 0) { share[i]--; left++; }
  }

  const positions: Record<string, StellarPosition> = {};
  let placed = 0;
  sizes.forEach((radius, ring) => {
    const count = share[ring];
    for (let i = 0; i < count; i++) {
      // Start at the top and turn clockwise; odd rings are offset so they do not line up.
      const angle = -Math.PI / 2 + (i / count) * Math.PI * 2 + (ring % 2 ? Math.PI / count : 0);
      positions[ordered[placed + i].id] = {
        x: Math.round(Math.cos(angle) * radius),
        y: Math.round(Math.sin(angle) * radius * THEME_SQUASH),
      };
    }
    placed += count;
  });
  return positions;
}

/** Largest theme first, so the cloud reads from the centre of gravity outwards. */
export function sortThemes(themes: StellarTheme[]): StellarTheme[] {
  return [...themes].sort(
    (a, b) =>
      b.ideaCount - a.ideaCount ||
      Number(b.curated) - Number(a.curated) ||
      themeName(a).localeCompare(themeName(b)),
  );
}

/**
 * Cap how many relations each idea shows without dropping a single idea from the theme.
 * Relations compete for each node's budget strongest first (confirmed, then extracted,
 * then by confidence) and an edge is drawn only when BOTH of its ends can still afford
 * it, so no idea exceeds the limit and a hub cannot spend the budget of the quiet ideas
 * around it. Relations passed in `protect` are drawn regardless. `limit` 0 means no cap.
 */
export function capRelations(
  data: GraphData,
  limit: number,
  /** Relations that must stay visible whatever the budget — the revealed path. */
  protect: Iterable<string> = [],
): GraphData {
  if (!limit || limit <= 0) return data;
  const spent = new Map<string, number>();
  const affordable = (id: string) => (spent.get(id) ?? 0) < limit;
  const kept = new Set<string>();
  const pinned = new Set(protect);
  const ranked = [...data.edges].sort(
    (a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)) || compareEdges(a, b),
  );
  for (const edge of ranked) {
    if (pinned.has(edge.id)) {
      kept.add(edge.id);
      for (const end of new Set([edge.source, edge.target]))
        spent.set(end, (spent.get(end) ?? 0) + 1);
      continue;
    }
    if (!affordable(edge.source) || !affordable(edge.target)) continue;
    kept.add(edge.id);
    for (const end of new Set([edge.source, edge.target]))
      spent.set(end, (spent.get(end) ?? 0) + 1);
  }
  // Preserve the caller's edge order: only the drawing budget is decided here.
  return { nodes: data.nodes, edges: data.edges.filter((edge) => kept.has(edge.id)) };
}

/**
 * The ideas within `depth` relations of a focal idea, plus the relations among them.
 *
 * A whole theme drawn at once is thousands of ideas and a screenful of crossing lines:
 * every relation is on screen and none can be followed. A neighbourhood is what the
 * canvas was always good at — one idea, what it touches, and one more step out — so the
 * theme becomes something you walk rather than something you stare at. `depth` 0 returns
 * everything, for when the shape of the whole theme is the point.
 */
export function neighbourhood(data: GraphData, focal: string | null, depth: number): GraphData {
  if (!depth || depth <= 0) return data;
  const present = new Set(data.nodes.map(node => node.id));
  if (!focal || !present.has(focal)) return data;
  const adjacency = new Map<string, string[]>();
  for (const edge of data.edges)
    for (const [a, b] of [[edge.source, edge.target], [edge.target, edge.source]]) {
      const list = adjacency.get(a);
      if (list) list.push(b);
      else adjacency.set(a, [b]);
    }
  const kept = new Set([focal]);
  let frontier = [focal];
  for (let step = 0; step < depth && frontier.length; step++) {
    const next: string[] = [];
    for (const id of frontier)
      for (const other of adjacency.get(id) || [])
        if (!kept.has(other)) {
          kept.add(other);
          next.push(other);
        }
    frontier = next;
  }
  return {
    nodes: data.nodes.filter(node => kept.has(node.id)),
    edges: data.edges.filter(edge => kept.has(edge.source) && kept.has(edge.target)),
  };
}
