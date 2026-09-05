import { CARD_HEIGHT, CARD_WIDTH, type MapPosition } from './layout';

export type Camera = { x: number; y: number; zoom: number };
export type Viewport = { width: number; height: number };

export function fitArgumentCamera(nodes: MapPosition[], size: Viewport): Camera {
  const minX = Math.min(...nodes.map(n => n.x)) - CARD_WIDTH / 2;
  const maxX = Math.max(...nodes.map(n => n.x)) + CARD_WIDTH / 2;
  const minY = Math.min(...nodes.map(n => n.y)) - CARD_HEIGHT / 2;
  const maxY = Math.max(...nodes.map(n => n.y)) + CARD_HEIGHT / 2;
  const zoom = Math.max(0.025, Math.min(1, (size.width - 96) / (maxX - minX), (size.height - 150) / (maxY - minY)));
  return { x: size.width / 2 - (minX + maxX) / 2 * zoom, y: size.height / 2 - (minY + maxY) / 2 * zoom - 10, zoom };
}

/** Frame the local neighborhood, with a readable seed even when a hub spans many screens. */
export function focusArgumentCamera(nodes: MapPosition[], id: string, size: Viewport, currentZoom: number): Camera {
  const selected = nodes.find(node => node.block.id === id);
  if (!selected) return fitArgumentCamera(nodes, size);
  const neighborhood = nodes.filter(node => node.block.id === id || node.block.id === selected.parentId || node.parentId === id);
  const framing = fitArgumentCamera(neighborhood, size);
  // Dense maps must not defeat focus by fitting hundreds of distant branches again.
  const zoom = Math.min(1.8, Math.max(currentZoom, Math.min(0.85, (size.width - 48) / CARD_WIDTH, (size.height - 150) / CARD_HEIGHT), Math.min(1.1, framing.zoom)));
  const marginX = Math.max(0, (size.width - CARD_WIDTH * zoom) / 2 - 32);
  const marginY = Math.max(0, (size.height - CARD_HEIGHT * zoom) / 2 - 80);
  const centerX = (size.width / 2 - framing.x) / framing.zoom;
  const centerY = (size.height / 2 - 10 - framing.y) / framing.zoom;
  const shiftX = Math.max(-marginX, Math.min(marginX, (selected.x - centerX) * zoom));
  const shiftY = Math.max(-marginY, Math.min(marginY, (selected.y - centerY) * zoom));
  return { x: size.width / 2 - selected.x * zoom + shiftX, y: size.height / 2 - 10 - selected.y * zoom + shiftY, zoom };
}

/** Preserve the previous world view when a source panel or full screen changes its viewport. */
export function restoreArgumentCamera(camera: Camera, from: Viewport, to: Viewport): Camera {
  const ratio = Math.min(to.width / from.width, to.height / from.height);
  return { zoom: camera.zoom * ratio, x: to.width / 2 + (camera.x - from.width / 2) * ratio, y: to.height / 2 + (camera.y - from.height / 2) * ratio };
}
