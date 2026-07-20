// PDF Presenter — the annotation toolbar shared by the audience and presenter
// windows: the four tools, a colour row (draw), a size slider (range per tool),
// the magnifier factor (zoom), and clear. Controlled by the parent window, which
// owns the tool state and relays changes to the other window.
import { Icon } from '../components/ui';
import { t } from '../i18n';
import type { ToolName } from '@shared/presenterState';

export const PRESENTER_TOOLS: { name: ToolName; icon: string; label: string; shortcut: string }[] = [
  { name: 'flashlight', icon: 'bulb', label: 'Linterna', shortcut: '⌘L' },
  { name: 'draw', icon: 'edit', label: 'Dibujo', shortcut: '⌘D' },
  { name: 'pointer', icon: 'target', label: 'Puntero', shortcut: '⌘P' },
  { name: 'zoom', icon: 'search', label: 'Lupa', shortcut: '⌘M' },
];

const COLORS = ['#6366f1', '#ef4444', '#22c55e', '#ffffff'];
const ZOOM_FACTORS = [1.5, 2, 2.5, 3];
const SIZE_RANGE: Record<ToolName, { min: number; max: number }> = {
  flashlight: { min: 5, max: 40 },
  draw: { min: 1, max: 20 },
  pointer: { min: 5, max: 50 },
  zoom: { min: 100, max: 400 },
};

export function PresenterToolbar({
  activeTool,
  color,
  size,
  zoomFactor,
  onSetTool,
  onSetColor,
  onSetSize,
  onSetZoomFactor,
  onClear,
}: {
  activeTool: ToolName | null;
  color: string;
  size: number;
  zoomFactor: number;
  onSetTool: (tool: ToolName | null) => void;
  onSetColor: (color: string) => void;
  onSetSize: (size: number) => void;
  onSetZoomFactor: (factor: number) => void;
  onClear: () => void;
}) {
  const range = activeTool ? SIZE_RANGE[activeTool] : SIZE_RANGE.pointer;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-neutral-900/90 px-2.5 py-1.5 text-neutral-200 shadow-lg backdrop-blur">
      {PRESENTER_TOOLS.map((tool) => (
        <button
          key={tool.name}
          type="button"
          title={`${t(tool.label)} (${tool.shortcut})`}
          onClick={() => onSetTool(activeTool === tool.name ? null : tool.name)}
          className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
            activeTool === tool.name ? 'bg-amber-500/25 text-amber-300' : 'hover:bg-white/10'
          }`}
        >
          <Icon name={tool.icon} size={17} />
        </button>
      ))}

      {activeTool === 'draw' && (
        <div className="flex items-center gap-1 border-l border-white/10 pl-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onSetColor(c)}
              aria-label={c}
              style={{ background: c }}
              className={`h-5 w-5 rounded-full border ${color === c ? 'border-white ring-2 ring-white/60' : 'border-white/30'}`}
            />
          ))}
        </div>
      )}

      {activeTool && (
        <div className="flex items-center gap-1.5 border-l border-white/10 pl-2">
          <span className="text-xs text-neutral-400">{activeTool === 'zoom' ? t('Diámetro') : t('Tamaño')}</span>
          <input
            type="range"
            min={range.min}
            max={range.max}
            value={Math.min(Math.max(size, range.min), range.max)}
            onChange={(e) => onSetSize(parseInt(e.target.value, 10))}
            className="h-1 w-24 accent-amber-400"
          />
        </div>
      )}

      {activeTool === 'zoom' && (
        <div className="flex items-center gap-1 border-l border-white/10 pl-2">
          {ZOOM_FACTORS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onSetZoomFactor(f)}
              className={`rounded px-1.5 py-0.5 text-xs ${zoomFactor === f ? 'bg-amber-500/25 text-amber-300' : 'hover:bg-white/10'}`}
            >
              {f}×
            </button>
          ))}
        </div>
      )}

      {activeTool === 'draw' && (
        <button
          type="button"
          title={t('Limpiar dibujo')}
          onClick={onClear}
          className="flex h-8 w-8 items-center justify-center rounded-md border-l border-white/10 hover:bg-white/10"
        >
          <Icon name="trash" size={15} />
        </button>
      )}
    </div>
  );
}
