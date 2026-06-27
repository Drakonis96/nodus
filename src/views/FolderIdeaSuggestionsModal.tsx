import { useCallback, useEffect, useRef, useState } from 'react';
import type { FolderIdeaSuggestion, FolderIdeaSuggestionsResult, NoteFolder } from '@shared/types';
import { Badge, Icon, NODE_LABELS } from '../components/ui';
import { buildIdeaNote } from '../notes';
import { t, tx } from '../i18n';

/**
 * Suggests ideas to integrate into a folder. Asks the backend to match the
 * folder's summary against the whole idea base (semantic similarity + one-hop
 * graph expansion + AI curation, excluding ideas already filed in the folder
 * subtree) and lets the user add any of them as an idea note in this folder.
 */
export function FolderIdeaSuggestionsModal({
  folder,
  onClose,
  onAdded,
}: {
  folder: NoteFolder;
  onClose: () => void;
  /** Called after an idea is added so the caller can refresh the tree. */
  onAdded: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<FolderIdeaSuggestionsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<string | null>(null);

  // Guard async state updates: the analysis/add calls can resolve after the user
  // closes the modal, which would otherwise setState on an unmounted component.
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);

  const analyze = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await window.nodus.suggestFolderIdeas(folder.id);
      if (mounted.current) setResult(res);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [folder.id]);

  useEffect(() => {
    void analyze();
  }, [analyze]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const addIdea = useCallback(
    async (s: FolderIdeaSuggestion) => {
      if (adding || added.has(s.global_id)) return;
      setAdding(s.global_id);
      setError(null);
      try {
        // Build the note the same way the graph's "save to notes" does, so an
        // added idea looks identical and keeps its clickable provenance.
        const detail = await window.nodus.getIdeaDetail(s.global_id);
        const content = detail ? buildIdeaNote(detail) : `# ${s.label}\n\n${s.statement}`;
        await window.nodus.createNote({
          title: s.label,
          content,
          kind: 'idea',
          folderId: folder.id,
          source: { origin: 'idea', ref: s.global_id },
        });
        if (!mounted.current) return;
        setAdded((prev) => new Set(prev).add(s.global_id));
        onAdded();
      } catch (e) {
        if (mounted.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mounted.current) setAdding(null);
      }
    },
    [adding, added, folder.id, onAdded]
  );

  const suggestions = result?.suggestions ?? [];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-neutral-800 px-4 py-3">
          <Icon name="bulb" className="text-indigo-300" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{t('Ideas para esta carpeta')}</div>
            <div className="truncate text-xs text-neutral-500" title={folder.name}>
              «{folder.name}»
            </div>
          </div>
          <div className="flex-1" />
          <button
            className="btn btn-ghost border border-neutral-700 text-xs gap-1 py-1"
            onClick={() => void analyze()}
            disabled={loading}
            title={t('Volver a analizar')}
          >
            <Icon name={loading ? 'sync' : 'wand'} size={13} className={loading ? 'animate-spin' : ''} />
            {t('Analizar')}
          </button>
          <button className="btn btn-ghost" onClick={onClose} title={t('Cerrar')}>
            <Icon name="x" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-neutral-500">
              <Icon name="sync" className="animate-spin" /> {t('Analizando ideas y conexiones…')}
            </div>
          ) : error ? (
            <div className="rounded-md border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-300">{error}</div>
          ) : (
            <>
              {result?.message && (
                <div className="mb-3 rounded-md border border-neutral-800 bg-neutral-900/50 p-3 text-xs text-neutral-400">
                  <Icon name="info" size={12} className="mr-1 text-neutral-500" />
                  {result.message}
                </div>
              )}
              {suggestions.length === 0 && !result?.message && (
                <div className="py-10 text-center text-sm text-neutral-500">
                  {t('No hay ideas para sugerir ahora mismo.')}
                </div>
              )}
              <ul className="space-y-2">
                {suggestions.map((s) => {
                  const isAdded = added.has(s.global_id);
                  return (
                    <li key={s.global_id} className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge color="indigo">{t(NODE_LABELS[s.type]) ?? s.type}</Badge>
                            {s.viaConnection && <Badge color="cyan">{t('vía conexión')}</Badge>}
                            {s.similarity != null && (
                              <span className="text-[10px] text-neutral-500">
                                {t('afinidad')} {s.similarity.toFixed(2)}
                              </span>
                            )}
                            <span className="text-[10px] text-neutral-500">
                              · {t('ajuste')} {s.score.toFixed(2)}
                            </span>
                          </div>
                          <div className="mt-1 text-sm font-medium text-neutral-200">{s.label}</div>
                          {s.statement && (
                            <p className="mt-0.5 text-xs leading-relaxed text-neutral-400">{s.statement}</p>
                          )}
                          {s.reason && (
                            <p className="mt-1.5 text-xs leading-relaxed text-indigo-200">
                              <Icon name="bulb" size={11} className="mr-1 text-indigo-300" />
                              {s.reason}
                            </p>
                          )}
                        </div>
                        <button
                          className="btn btn-ghost shrink-0 border border-neutral-700 text-xs gap-1 py-1"
                          onClick={() => void addIdea(s)}
                          disabled={isAdded || adding === s.global_id}
                          title={t('Añadir esta idea a la carpeta')}
                        >
                          <Icon
                            name={isAdded ? 'check' : adding === s.global_id ? 'sync' : 'plus'}
                            size={13}
                            className={adding === s.global_id ? 'animate-spin' : ''}
                          />
                          {isAdded ? t('Añadida') : t('Añadir')}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        {result && !loading && (
          <footer className="border-t border-neutral-800 px-4 py-2 text-[11px] text-neutral-500">
            {tx('{considered} candidatas analizadas · {excluded} ya en la carpeta', {
              considered: result.consideredCount,
              excluded: result.excludedCount,
            })}
          </footer>
        )}
      </div>
    </div>
  );
}
