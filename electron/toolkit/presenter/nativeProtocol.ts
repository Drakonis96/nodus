import type { PresenterAction, ToolName } from '@shared/presenterState';
const tools = new Set<ToolName>(['pointer', 'flashlight', 'draw', 'zoom']);
const finite = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
/** Accept only bounded commands. A native peer never supplies file paths or runtime snapshots. */
export function nativeAction(value: unknown): PresenterAction | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const a = value as Record<string, any>;
  switch (a.type) {
    case 'next': case 'prev': case 'timerToggle': case 'timerReset': case 'videoToggle': case 'clearDraw': return { type: a.type };
    case 'navigate': return finite(a.slide, 1, 100000) ? { type: 'navigate', slide: Math.round(a.slide) } : null;
    case 'blackScreen': return a.enabled === undefined || typeof a.enabled === 'boolean' ? { type: 'blackScreen', enabled: a.enabled } : null;
    case 'setTool': return a.tool === null || tools.has(a.tool) ? { type: 'setTool', tool: a.tool } : null;
    case 'setToolSize': return tools.has(a.tool) && finite(a.size, 1, 400) ? { type: 'setToolSize', tool: a.tool, size: a.size } : null;
    case 'setToolColor': return typeof a.color === 'string' && /^#[0-9a-f]{6}$/i.test(a.color) ? { type: 'setToolColor', color: a.color } : null;
    case 'setZoomFactor': return finite(a.factor, 1, 4) ? { type: 'setZoomFactor', factor: a.factor } : null;
    case 'videoSeek': return finite(a.time, 0, 86400) ? { type: 'videoSeek', time: a.time } : null;
    case 'slideZoom': return a.data && finite(a.data.scale, 1, 5) && finite(a.data.originX, 0, 100) && finite(a.data.originY, 0, 100)
      ? { type: 'slideZoom', data: { scale: a.data.scale, originX: a.data.originX, originY: a.data.originY } } : null;
    case 'toolData': {
      const d = a.data;
      if (!d || !tools.has(d.tool)) return null;
      if (d.action === 'clear') return { type: 'toolData', data: { tool: d.tool, action: 'clear' } };
      if (!finite(d.x, 0, 100) || !finite(d.y, 0, 100)) return null;
      if (d.action !== undefined && !['start', 'move', 'end'].includes(d.action)) return null;
      for (const [key, max] of [['r', 40], ['size', 400], ['lineWidth', 20]] as const) if (d[key] !== undefined && !finite(d[key], 1, max)) return null;
      if (d.color !== undefined && (typeof d.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(d.color))) return null;
      return { type: 'toolData', data: { tool: d.tool, x: d.x, y: d.y, r: d.r, size: d.size, action: d.action, color: d.color, lineWidth: d.lineWidth } };
    }
    default: return null;
  }
}

export class CommandWindow {
  private ids = new Set<string>();
  accept(id: unknown): boolean {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id) || this.ids.has(id)) return false;
    this.ids.add(id);
    if (this.ids.size > 4096) this.ids.delete(this.ids.values().next().value!);
    return true;
  }
}
