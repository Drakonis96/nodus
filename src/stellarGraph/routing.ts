import type { StellarPosition as Point } from "@shared/stellarGraph";
export interface Obstacle {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
function intersects(a: Point, b: Point, r: Obstacle) {
  let lo = 0,
    hi = 1;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - r.x],
    [dx, r.x + r.width - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.height - a.y],
  ]) {
    if (!p) {
      if (q < 0) return false;
    } else {
      const u = q / p;
      if (p < 0) lo = Math.max(lo, u);
      else hi = Math.min(hi, u);
      if (lo > hi) return false;
    }
  }
  return true;
}
/** Choose a stable curved route with the fewest label/node intersections. */
export function routeConnection(
  a: Point,
  b: Point,
  sign: number,
  obstacles: Obstacle[],
  steps = 20,
): Point[] {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    len = Math.hypot(dx, dy) || 1;
  let best: Point[] = [],
    score = Infinity;
  for (const bend of [
    sign * Math.min(60, len * 0.12),
    0,
    100,
    -100,
    220,
    -220,
    380,
    -380,
  ]) {
    const c = {
      x: (a.x + b.x) / 2 - (dy / len) * bend,
      y: (a.y + b.y) / 2 + (dx / len) * bend,
    };
    const points = Array.from({ length: steps + 1 }, (_, i) => {
      const u = i / steps;
      return {
        x: (1 - u) ** 2 * a.x + 2 * (1 - u) * u * c.x + u * u * b.x,
        y: (1 - u) ** 2 * a.y + 2 * (1 - u) * u * c.y + u * u * b.y,
      };
    });
    let hits = 0;
    for (const r of obstacles) {
      if (points.some((p, i) => i > 0 && intersects(points[i - 1], p, r)))
        hits++;
    }
    const cost = hits * 10000 + Math.abs(bend);
    if (cost < score) {
      score = cost;
      best = points;
    }
    if (!hits) break;
  }
  return best;
}
