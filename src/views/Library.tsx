import { useCallback, useEffect, useState } from 'react';
import type { WorkView, WorkFilter, DeepStatus, LightStatus, AppSettings, ModelRef } from '@shared/types';
import { Badge } from '../components/ui';
import { ModelPicker } from '../components/ModelPicker';

function lightBadge(s: LightStatus) {
  if (s === 'done') return <Badge color="green">ligero ✓</Badge>;
  if (s === 'none') return <Badge color="neutral">—</Badge>;
  if (s === 'failed') return <Badge color="red">ligero ✕</Badge>;
  return <Badge color="neutral">ligero…</Badge>;
}

function deepBadge(s: DeepStatus) {
  switch (s) {
    case 'done':
      return <Badge color="indigo">profundo ✓</Badge>;
    case 'pending':
      return <Badge color="amber">profundo…</Badge>;
    case 'failed':
      return <Badge color="red">profundo ✕</Badge>;
    case 'skipped_no_text':
      return <Badge color="amber" title="Sin texto disponible">sin texto</Badge>;
    default:
      return <Badge color="neutral">—</Badge>;
  }
}

function triggerBadge(w: WorkView) {
  if (!w.deep_trigger) return null;
  if (w.deep_trigger === 'tag') return <span title="Por tag">🏷</span>;
  if (w.deep_trigger === 'manual') return <span title="Manual">✦</span>;
  return (
    <span title="Tag + manual">
      🏷✦
    </span>
  );
}

export function Library({ settings, onOpenCollections }: { settings: AppSettings; onOpenCollections: () => void }) {
  const [works, setWorks] = useState<WorkView[]>([]);
  const [filter, setFilter] = useState<WorkFilter>({ lightStatus: 'all', deepStatus: 'all' });
  const [loading, setLoading] = useState(true);
  const [scanModel, setScanModel] = useState<ModelRef | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setWorks(await window.nodus.listWorks(filter));
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const analyzeThemes = async (w: WorkView) => {
    await window.nodus.rescan(w.nodus_id, 'light', scanModel);
    await load();
  };

  const analyzeIdeas = async (w: WorkView) => {
    if (w.deep_status === 'done') {
      await window.nodus.rescan(w.nodus_id, 'deep', scanModel);
    } else {
      await window.nodus.setManualDeep(w.nodus_id, true, scanModel);
    }
    await load();
  };

  const analyzeSelectedThemes = async () => {
    for (const id of selected) {
      await window.nodus.rescan(id, 'light', scanModel);
    }
    setSelected(new Set());
    await load();
  };

  const analyzeSelectedIdeas = async () => {
    await window.nodus.setManualDeepBulk(Array.from(selected), true, scanModel);
    setSelected(new Set());
    await load();
  };

  const toggleSelected = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  };

  const allVisibleSelected = works.length > 0 && works.every((w) => selected.has(w.nodus_id));

  return (
    <div className="h-full flex flex-col p-6 min-h-0">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-xl font-semibold">Biblioteca</h1>
        <span className="text-sm text-neutral-500">{works.length} obras</span>
        <div className="flex-1" />
        <span className="text-xs text-neutral-500">Escanear con:</span>
        <ModelPicker settings={settings} value={scanModel} onChange={setScanModel} compact />
        {selected.size > 0 && (
          <>
            <span className="text-xs text-neutral-500">{selected.size} seleccionadas</span>
            <button className="btn btn-ghost border border-neutral-700" onClick={analyzeSelectedThemes}>
              Analizar temas
            </button>
            <button className="btn btn-primary" onClick={analyzeSelectedIdeas}>
              Analizar ideas
            </button>
          </>
        )}
        <button className="btn btn-ghost border border-neutral-700" onClick={onOpenCollections}>
          Modal de Colecciones
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <input
          className="input"
          placeholder="Buscar título o autor…"
          onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
        />
        <select
          className="input"
          value={filter.lightStatus}
          onChange={(e) => setFilter((f) => ({ ...f, lightStatus: e.target.value as any }))}
        >
          <option value="all">Ligero: todos</option>
          <option value="none">Ligero: ninguno</option>
          <option value="done">Ligero: hecho</option>
          <option value="pending">Ligero: pendiente</option>
          <option value="failed">Ligero: fallido</option>
        </select>
        <select
          className="input"
          value={filter.deepStatus}
          onChange={(e) => setFilter((f) => ({ ...f, deepStatus: e.target.value as any }))}
        >
          <option value="all">Profundo: todos</option>
          <option value="done">Profundo: hecho</option>
          <option value="pending">Profundo: pendiente</option>
          <option value="none">Profundo: ninguno</option>
          <option value="skipped_no_text">Profundo: sin texto</option>
        </select>
      </div>

      <div className="card flex-1 overflow-auto min-h-0">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-neutral-900 text-neutral-400 text-left">
            <tr>
              <th className="p-2 font-medium w-8">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={(e) => {
                    if (e.target.checked) setSelected(new Set(works.map((w) => w.nodus_id)));
                    else setSelected(new Set());
                  }}
                />
              </th>
              <th className="p-2 font-medium">Título</th>
              <th className="p-2 font-medium">Autores</th>
              <th className="p-2 font-medium">Año</th>
              <th className="p-2 font-medium">Tema(s)</th>
              <th className="p-2 font-medium">Ligero</th>
              <th className="p-2 font-medium">Profundo</th>
              <th className="p-2 font-medium" data-tour="library-actions">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td className="p-4 text-neutral-500" colSpan={8}>
                  Cargando…
                </td>
              </tr>
            )}
            {!loading &&
              works.map((w) => (
                <tr key={w.nodus_id} className="border-t border-neutral-800 hover:bg-neutral-900/50">
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={selected.has(w.nodus_id)}
                      onChange={(e) => toggleSelected(w.nodus_id, e.target.checked)}
                    />
                  </td>
                  <td className="p-2 max-w-md">
                    <div className="truncate" title={w.title}>
                      {w.title}
                    </div>
                    <div className="text-[10px] text-neutral-600 font-mono">{w.nodus_id.slice(0, 8)}</div>
                  </td>
                  <td className="p-2 text-neutral-400">
                    {w.authors[0] ?? '—'}
                    {w.authors.length > 1 ? ' et al.' : ''}
                  </td>
                  <td className="p-2 text-neutral-400">{w.year ?? '—'}</td>
                  <td className="p-2 text-neutral-400 max-w-[140px] truncate">{w.themes.join(', ')}</td>
                  <td className="p-2">{lightBadge(w.light_status)}</td>
                  <td className="p-2 whitespace-nowrap">
                    {deepBadge(w.deep_status)} {triggerBadge(w)}
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    <button
                      className="text-xs text-neutral-400 hover:text-white mr-2"
                      onClick={() => analyzeThemes(w)}
                    >
                      temas
                    </button>
                    <button
                      className="text-xs text-neutral-400 hover:text-white mr-2"
                      onClick={() => analyzeIdeas(w)}
                    >
                      {w.deep_status === 'done' ? 'reanalizar ideas' : 'analizar ideas'}
                    </button>
                    <button
                      className="text-xs text-indigo-400 hover:text-indigo-300"
                      onClick={() => window.nodus.openInZotero(w.zotero_key)}
                    >
                      Zotero
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
