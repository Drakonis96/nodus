import type { StellarPosition, StellarSession } from "@shared/stellarGraph";
type Camera = StellarSession["camera"];
/** Frame both endpoints inside the readable area above the playback controls. */
export function frameConnection(a: StellarPosition, b: StellarPosition, width: number, height: number, bottomInset = 250): Camera {
  const side = Math.min(155, width * .25), top = Math.min(130, height * .22), bottom = Math.min(bottomInset, Math.max(40, height-top-50));
  const usableWidth = Math.max(40, width - side * 2), usableHeight = Math.max(40, height - top - bottom);
  const zoom = Math.max(.0001, Math.min(1.15, usableWidth / Math.max(1, Math.abs(b.x-a.x)), usableHeight / Math.max(1, Math.abs(b.y-a.y))));
  return { x: (a.x+b.x)/2, y: (a.y+b.y)/2 + (bottom-top)/2/zoom, zoom };
}
export function interpolateCamera(a: Camera, b: Camera, progress: number): Camera {
  if (progress <= 0) return a;
  if (progress >= 1) return b;
  const t = Math.max(0, Math.min(1, progress)), eased = t*t*(3-2*t);
  return { x: a.x+(b.x-a.x)*eased, y: a.y+(b.y-a.y)*eased, zoom: Math.exp(Math.log(a.zoom)+(Math.log(b.zoom)-Math.log(a.zoom))*eased) };
}
export function arrowGeometry(points: StellarPosition[], clearance = 15) {
  if (points.length < 2) return null;
  const end = points[points.length-1], previous = points[points.length-2];
  const angle = Math.atan2(end.y-previous.y, end.x-previous.x);
  return { angle, tip: { x: end.x-Math.cos(angle)*clearance, y: end.y-Math.sin(angle)*clearance } };
}
