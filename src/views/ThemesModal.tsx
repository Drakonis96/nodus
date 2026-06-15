import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSettings, ManagedTheme, ModelRef } from '@shared/types';
import { Icon } from '../components/ui';
import { ModelPicker } from '../components/ModelPicker';
import { ConfirmModal } from '../components/ConfirmModal';

/**
 * "Temas principales" manager. Lets the user curate the main theme hubs of the graph:
 * add/rename/remove themes, pin them so auto-scans can't prune them, lock theme
 * generation so future scans only use this curated set, and reprocess the node↔theme
 * connections across the library (ideas are never touched here).
 */
export function ThemesModal({
  settings,
  onClose,
  onSettingsChange,
  onReprocessed,
}: {
  settings: AppSettings;
  onClose: () => void;
  onSettingsChange: () => void;
  onReprocessed?: () => void;
}) {
  const [themes, setThemes] = useState<ManagedTheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [pendingDelete, setPendingDelete] = useState<ManagedTheme | null>(null);
  const [model, setModel] = useState<ModelRef | null>(settings.extractionModel ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [includeRelations, setIncludeRelations] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const locked = settings.themesLocked;
  const editRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setThemes(await window.nodus.listManagedThemes());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (editingId) editRef.current?.focus();
  }, [editingId]);

  const addTheme = async () => {
    const label = newLabel.trim();
    if (!label || busy) return;
    setBusy(true);
    try {
      const next = await window.nodus.addManualTheme(label);
      setThemes(next);
      setNewLabel('');
      // Curating a main theme implies locking generation: that is the whole point of the
      // feature ("no se generan más en futuros procesamientos, salvo que los añada el usuario").
      if (!locked) {
        await window.nodus.updateSettings({ themesLocked: true });
        onSettingsChange();
      }
    } finally {
      setBusy(false);
    }
  };

  const togglePinned = async (theme: ManagedTheme) => {
    setBusy(true);
    try {
      setThemes(await window.nodus.setThemePinned(theme.theme_id, !theme.pinned));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (theme: ManagedTheme) => {
    setEditingId(theme.theme_id);
    setEditLabel(theme.label);
  };

  const commitEdit = async () => {
    if (!editingId) return;
    const label = editLabel.trim();
    const current = themes.find((t) => t.theme_id === editingId);
    if (!label || !current || label === current.label) {
      setEditingId(null);
      return;
    }
    setBusy(true);
    try {
      setThemes(await window.nodus.renameTheme(editingId, label));
    } finally {
      setBusy(false);
      setEditingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      setThemes(await window.nodus.deleteTheme(pendingDelete.theme_id));
    } finally {
      setBusy(false);
      setPendingDelete(null);
    }
  };

  const toggleLocked = async () => {
    setBusy(true);
    try {
      await window.nodus.updateSettings({ themesLocked: !locked });
      onSettingsChange();
    } finally {
      setBusy(false);
    }
  };

  const reprocess = async () => {
    setBusy(true);
    setReprocessing(true);
    setNotice(null);
    try {
      const result = await window.nodus.reprocessThemeConnections({ relations: includeRelations }, model);
      if (result.ideas === 0) {
        setNotice('No hay ideas extraídas que reprocesar. Analiza primero algunas obras (escaneo profundo).');
      } else {
        const parts = [`${result.themedIdeas}/${result.ideas} ideas agrupadas en temas`];
        if (result.newThemes > 0) parts.push(`${result.newThemes} tema(s) nuevo(s)`);
        if (includeRelations) parts.push(`${result.relationsAdded} relación(es) idea↔idea inferida(s)`);
        setNotice(`Listo: ${parts.join(' · ')}.`);
      }
      setThemes(await window.nodus.listManagedThemes());
      onReprocessed?.();
    } catch (e) {
      setNotice(`Error al reprocesar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      setReprocessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 p-4 flex items-center justify-center">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-2xl max-h-[88vh] bg-neutral-950 border border-neutral-800 rounded-lg shadow-2xl flex flex-col overflow-hidden"
      >
        <header className="px-4 py-3 border-b border-neutral-800 flex items-center gap-3">
          <div className="flex items-center gap-2 font-semibold">
            <Icon name="tag" className="text-orange-300" />
            Temas principales
          </div>
          <div className="flex-1" />
          <button className="btn btn-ghost" onClick={onClose} title="Cerrar">
            <Icon name="x" />
          </button>
        </header>

        <div className="p-4 overflow-y-auto space-y-4">
          <p className="text-xs text-neutral-400 leading-relaxed">
            Los temas principales son los grandes nodos que agrupan tus ideas en el grafo. Añade los tuyos para
            controlarlos manualmente; mientras estén bloqueados, los análisis solo usarán estos temas y no generarán otros
            nuevos. <span className="text-neutral-300">Reprocesar</span> coge las ideas ya extraídas (afirmaciones, hallazgos…)
            y las vuelve a agrupar bajo estos temas con el modelo seleccionado, sin volver a leer los documentos ni
            re-extraer ideas.
          </p>

          {/* Add a manual theme */}
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="Añadir tema principal…"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void addTheme();
                }
              }}
            />
            <button className="btn btn-primary gap-1.5" onClick={() => void addTheme()} disabled={busy || !newLabel.trim()}>
              <Icon name="plus" /> Añadir
            </button>
          </div>

          {/* Lock toggle */}
          <label className="flex items-start gap-3 card p-3 cursor-pointer">
            <input type="checkbox" className="h-4 w-4 mt-0.5 accent-indigo-500" checked={locked} onChange={() => void toggleLocked()} disabled={busy} />
            <span className="text-sm">
              <span className="flex items-center gap-1.5 font-medium">
                <Icon name={locked ? 'lock' : 'unlock'} size={14} className={locked ? 'text-emerald-300' : 'text-neutral-400'} />
                Bloquear generación automática de temas
              </span>
              <span className="block text-xs text-neutral-500 mt-1">
                Con esto activado, los análisis ligeros y profundos solo asignan las obras a los temas de esta lista. Desactívalo
                para volver a permitir que la IA proponga temas nuevos.
              </span>
            </span>
          </label>

          {/* Theme list */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs uppercase text-neutral-500 px-1">
              <span>{themes.length} tema(s)</span>
              <span>obras · ideas</span>
            </div>
            {loading ? (
              <div className="text-sm text-neutral-500 py-6 text-center">Cargando temas…</div>
            ) : themes.length === 0 ? (
              <div className="text-sm text-neutral-500 py-6 text-center">Todavía no hay temas. Añade el primero arriba.</div>
            ) : (
              themes.map((theme) => (
                <div key={theme.theme_id} className="card p-2.5 flex items-center gap-2">
                  <button
                    className={`p-1 rounded hover:bg-neutral-800 ${theme.pinned ? 'text-amber-400' : 'text-neutral-600'}`}
                    title={theme.pinned ? 'Tema fijado (protegido). Clic para soltar.' : 'Fijar como tema principal (protegido)'}
                    onClick={() => void togglePinned(theme)}
                    disabled={busy}
                  >
                    <Icon name="star" size={15} />
                  </button>
                  {editingId === theme.theme_id ? (
                    <input
                      ref={editRef}
                      className="input flex-1 py-1 text-sm"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      onBlur={() => void commitEdit()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void commitEdit();
                        } else if (e.key === 'Escape') {
                          setEditingId(null);
                        }
                      }}
                    />
                  ) : (
                    <button
                      className="flex-1 min-w-0 text-left text-sm truncate hover:text-indigo-300"
                      title="Renombrar tema"
                      onClick={() => startEdit(theme)}
                    >
                      {theme.label}
                    </button>
                  )}
                  <span className="text-xs text-neutral-500 tabular-nums shrink-0">
                    {theme.work_count} · {theme.idea_count}
                  </span>
                  <button
                    className="p-1 rounded text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800"
                    title="Renombrar"
                    onClick={() => startEdit(theme)}
                    disabled={busy}
                  >
                    <Icon name="edit" size={14} />
                  </button>
                  <button
                    className="p-1 rounded text-neutral-500 hover:text-red-400 hover:bg-neutral-800"
                    title="Eliminar tema y sus conexiones"
                    onClick={() => setPendingDelete(theme)}
                    disabled={busy}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              ))
            )}
          </div>

          {notice && <div className="text-xs text-emerald-300 bg-emerald-950/30 border border-emerald-900 rounded-md px-3 py-2">{notice}</div>}
        </div>

        <footer className="border-t border-neutral-800 p-3 space-y-2.5">
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase text-neutral-500">Qué reprocesar</span>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                className="mt-0.5 accent-indigo-500"
                checked={!includeRelations}
                onChange={() => setIncludeRelations(false)}
                disabled={busy}
              />
              <span>
                Solo temas <span className="text-emerald-400 text-xs">(recomendado)</span>
                <span className="block text-xs text-neutral-500">Reasigna las ideas a los temas principales. No toca las relaciones idea↔idea.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                className="mt-0.5 accent-indigo-500"
                checked={includeRelations}
                onChange={() => setIncludeRelations(true)}
                disabled={busy}
              />
              <span>
                Temas + relaciones entre ideas
                <span className="block text-xs text-neutral-500">
                  Además vuelve a trazar relaciones idea↔idea. Al no haber cita textual, se marcan como inferidas.
                </span>
              </span>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500">Modelo:</span>
            <ModelPicker settings={settings} value={model} onChange={setModel} compact />
            <div className="flex-1" />
            {reprocessing && <span className="text-xs text-neutral-500">Reprocesando con el modelo…</span>}
            <button
              className="btn btn-primary gap-1.5"
              title="Reagrupa las ideas ya extraídas bajo los temas (no re-extrae ideas ni lee documentos)"
              onClick={() => void reprocess()}
              disabled={busy}
            >
              <Icon name={busy ? 'sync' : 'refresh'} className={busy ? 'animate-spin' : ''} /> Reprocesar conexiones
            </button>
          </div>
        </footer>
      </div>

      {pendingDelete && (
        <ConfirmModal
          title="Eliminar tema"
          message={
            <>
              Se eliminará el tema <span className="text-neutral-200">«{pendingDelete.label}»</span> y todas sus conexiones con
              obras e ideas. Las ideas en sí no se borran. ¿Continuar?
            </>
          }
          confirmLabel="Eliminar"
          danger
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
