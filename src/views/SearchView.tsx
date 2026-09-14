import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GlobalSearchResult, SavedSearch, SearchResultKind, VaultType } from '@shared/types';
import { Icon } from '../components/ui';
import type { PendingGraphNavigationTarget } from '../navigation';
import { t, tx } from '../i18n';
import { IdeaDetailModal } from '../components/IdeaDetailModal';
import { mergeHybridResults } from '@shared/hybridSearch';
import { SearchKindFilters } from '../components/search/SearchKindFilters';
import { WorkIdeasModal } from './WorkIdeasModal';

const KIND_META: Record<SearchResultKind, { label: string; icon: string }> = {
  note: { label: 'Notas', icon: 'notebook' },
  idea: { label: 'Ideas', icon: 'bulb' },
  work: { label: 'Obras', icon: 'book' },
  passage: { label: 'Pasajes', icon: 'quote' },
  gap: { label: 'Huecos', icon: 'gap' },
  theme: { label: 'Temas', icon: 'tag' },
  author: { label: 'Autores', icon: 'graduation' },
  person: { label: 'Personas', icon: 'users' },
  event: { label: 'Eventos', icon: 'clock' },
  archive: { label: 'Documentos', icon: 'archive' },
};

const ACADEMIC_TEXT_KINDS: SearchResultKind[] = ['note', 'idea', 'work', 'passage', 'gap', 'theme', 'author'];

/** Text-search kinds shown for the active vault type — records vaults surface persons,
 *  events and archive documents (and drop the argumentative kinds they don't have). */
function textKinds(vaultType: VaultType | undefined): SearchResultKind[] {
  if (vaultType === 'genealogy') return ['person', 'event', 'archive', 'work', 'passage', 'note'];
  if (vaultType === 'primary_sources') return ['person', 'event', 'archive', 'work', 'idea', 'author', 'note'];
  return ACADEMIC_TEXT_KINDS;
}

interface SimilarTarget {
  ideaId: string;
  ideaTitle: string;
}

export function SearchView({
  vaultType,
  onOpenGraph,
  onOpenNote,
  onOpenGaps,
  onOpenPerson,
  onOpenTimeline,
  onOpenArchive,
}: {
  vaultType?: VaultType;
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenNote: (noteId: string) => void;
  onOpenGaps: () => void;
  onOpenPerson: (personId: string) => void;
  onOpenTimeline: () => void;
  onOpenArchive: () => void;
}) {
  const [query, setQuery] = useState('');
  const [activeKinds, setActiveKinds] = useState<Set<SearchResultKind>>(() => new Set(textKinds(vaultType)));
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState('');
  const [similar, setSimilar] = useState<SimilarTarget | null>(null);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [ideaModalId, setIdeaModalId] = useState<string | null>(null);
  const [workModal, setWorkModal] = useState<{ nodus_id: string; title: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const reloadSaved = useCallback(() => {
    void window.nodus.listSavedSearches().then(setSavedSearches).catch(() => setSavedSearches([]));
  }, []);
  useEffect(() => {
    reloadSaved();
  }, [reloadSaved]);

  useEffect(() => { setActiveKinds(new Set(textKinds(vaultType))); setQuery(''); setSimilar(null); }, [vaultType]);

  // Debounced live search; ignores stale responses if inputs changed meanwhile.
  useEffect(() => {
    setError(''); setResults([]);
    // "Ideas parecidas a esta" runs immediately off an idea id, not the query box.
    if (similar) {
      setLoading(true);
      let active = true;
      void window.nodus.findSimilarToIdea(similar.ideaId).then((res) => {
        if (!active) return;
        setResults(res.results);
        setUnavailable(!res.available);
        setSearched(true);
        setLoading(false);
      }).catch((cause) => { if (active) { setError(String(cause)); setLoading(false); } });
      return () => {
        active = false;
      };
    }

    const q = query.trim();
    if (q.length < 2 || !activeKinds.size) {
      setResults([]);
      setSearched(false);
      setUnavailable(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    let active = true;
    const handle = window.setTimeout(() => {
      const literalRequest = window.nodus.globalSearch(q, 80, [...activeKinds]);
      void literalRequest.then((literal) => {
        if (active) { setResults(mergeHybridResults(q, literal, [], activeKinds)); setSearched(true); }
      }).catch(() => {});
      void Promise.allSettled([
        literalRequest,
        activeKinds.size ? window.nodus.semanticSearch(q, { kinds: [...activeKinds], limit: 80 }) : Promise.resolve({ available: true, results: [] }),
      ]).then(([literal, semantic]) => {
        if (!active) return;
        setResults(mergeHybridResults(q, literal.status === 'fulfilled' ? literal.value : [],
          semantic.status === 'fulfilled' ? semantic.value.results : [], activeKinds));
        if (literal.status === 'rejected') setError(String(literal.reason));
        setUnavailable(semantic.status === 'rejected' || !semantic.value.available);
        setSearched(true);
        setLoading(false);
      });
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [query, activeKinds, similar, vaultType]);

  const visible = useMemo(
    () => results.filter((r) => activeKinds.has(r.kind)),
    [results, activeKinds]
  );

  const categoryCount = new Set(visible.map((hit) => hit.kind)).size;

  const locate = (r: GlobalSearchResult) => {
    switch (r.kind) {
      case 'idea':
        onOpenGraph({ preset: 'overview', nodeId: r.id, label: `${t('Idea:')} ${r.title}` });
        break;
      case 'work':
        onOpenGraph({
          preset: 'reading',
          workId: r.id,
          workTitle: r.title,
          zoteroKey: r.zoteroKey ?? undefined,
          label: `${t('Ideas y conexiones:')} ${r.title}`,
        });
        break;
      case 'passage':
        if (r.nodusId)
          onOpenGraph({
            preset: 'reading',
            workId: r.nodusId,
            workTitle: r.title,
            zoteroKey: r.zoteroKey ?? undefined,
            label: `${t('Ideas y conexiones:')} ${r.title}`,
          });
        break;
      case 'theme':
        onOpenGraph({ theme: r.themeLabel ?? r.title, label: `${t('Tema:')} ${r.title}` });
        break;
      case 'author':
        onOpenGraph({ preset: 'authors', search: r.title, label: `${t('Autor:')} ${r.title}` });
        break;
      case 'gap':
        onOpenGaps();
        break;
      case 'note':
        onOpenNote(r.id);
        break;
      case 'person':
        onOpenPerson(r.id);
        break;
      case 'event':
        onOpenTimeline();
        break;
      case 'archive':
        onOpenArchive();
        break;
    }
  };

  // Clicking a result reuses the surface that owns it: ideas and works open the
  // same detail modals as the Ideas and Library sections; everything else jumps
  // straight to its home view (notes, gaps, themes, authors, passages).
  const openResult = (r: GlobalSearchResult) => {
    if (r.kind === 'idea') return setIdeaModalId(r.id);
    if (r.kind === 'work') return setWorkModal({ nodus_id: r.id, title: r.title });
    locate(r);
  };

  const findSimilar = (r: GlobalSearchResult) => {
    setActiveKinds(new Set(['idea']));
    setSimilar({ ideaId: r.id, ideaTitle: r.title });
  };

  const clearSimilar = () => {
    setSimilar(null);
    setActiveKinds(new Set(textKinds(vaultType)));
  };

  const saveCurrent = () => {
    const q = query.trim();
    if (q.length < 2 || similar) return;
    void window.nodus
      .saveSearch({ name: q, query: q, mode: 'hybrid', kinds: [...activeKinds] })
      .then(reloadSaved);
  };

  const applySaved = (s: SavedSearch) => {
    setSimilar(null);
    setActiveKinds(new Set((s.mode === 'hybrid' || s.kinds.length ? s.kinds : textKinds(vaultType)).filter((kind) => textKinds(vaultType).includes(kind))));
    setQuery(s.query);
  };

  const deleteSaved = (id: string) => {
    void window.nodus.deleteSavedSearch(id).then(reloadSaved);
  };

  const availableKinds = textKinds(vaultType);
  const canSave = query.trim().length >= 2 && !similar;

  return (
    <div className="h-full flex flex-col min-h-0 p-6">
      <div className="shrink-0 max-w-3xl w-full mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <Icon name="search" size={22} className="text-indigo-300" />
          <h1 className="text-xl font-semibold">{t('Búsqueda global')}</h1>

        </div>

        {similar ? (
          <div className="flex items-center gap-2 rounded-md border border-indigo-800/60 bg-indigo-950/30 px-3 py-2 text-sm">
            <Icon name="network" size={15} className="text-indigo-300" />
            <span className="text-neutral-300">
              {t('Ideas parecidas a:')} <span className="text-neutral-100">{similar.ideaTitle}</span>
            </span>
            <button className="ml-auto text-xs text-neutral-400 hover:text-neutral-200" onClick={clearSimilar}>
              <Icon name="x" size={14} /> {t('Salir')}
            </button>
          </div>
        ) : (
          <div className="relative">
            <Icon
              name="search"
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none"
            />
            <input
              ref={inputRef}
              className="input input-with-leading-icon w-full"
              placeholder={t('Escribe para buscar…')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {loading && (
              // The centring `-translate-y-1/2` must stay on this wrapper, never on the
              // spinning icon: `animate-spin`'s keyframe sets `transform: rotate(360deg)`,
              // which would replace the translate and make the icon slide up and down
              // instead of turning (360deg decomposes to the identity matrix).
              <span className="absolute right-3 top-1/2 flex -translate-y-1/2">
                <Icon name="sync" size={15} className="animate-spin text-neutral-500" />
              </span>
            )}
          </div>
        )}

        {/* Kind filters */}
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          <SearchKindFilters options={availableKinds.map((kind) => ({ kind, ...KIND_META[kind] }))}
            selected={activeKinds} onChange={setActiveKinds} disabled={Boolean(similar)} />
          {canSave && (
            <button
              className="ml-auto inline-flex items-center gap-1 rounded-full border border-neutral-700 px-2.5 py-1 text-xs text-neutral-400 hover:text-neutral-200"
              onClick={saveCurrent}
              title={t('Guardar esta búsqueda y sus filtros')}
            >
              <Icon name="star" size={12} /> {t('Guardar')}
            </button>
          )}
        </div>

        {/* Saved searches */}
        {savedSearches.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <span className="text-xs text-neutral-600">{t('Guardadas:')}</span>
            {savedSearches.map((s) => (
              <span
                key={s.id}
                className="group inline-flex items-center gap-1 rounded-full border border-neutral-800 bg-neutral-900/50 pl-2.5 pr-1 py-1 text-xs text-neutral-300"
              >
                <button className="flex items-center gap-1 hover:text-neutral-100" onClick={() => applySaved(s)}>
                  <Icon name={s.mode === 'semantic' ? 'network' : 'search'} size={11} />
                  <span className="max-w-[12rem] truncate">{s.name}</span>
                </button>
                <button
                  className="text-neutral-600 hover:text-red-400"
                  onClick={() => deleteSaved(s.id)}
                  title={t('Eliminar búsqueda guardada')}
                >
                  <Icon name="x" size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        {error && <p role="alert" className="mt-3 text-xs text-red-500">{error}</p>}
        {unavailable && (
          <p className="text-xs text-amber-400/90 mt-3">
            {t('La búsqueda por significado necesita embeddings. Configura el proveedor y la clave de embeddings en Ajustes e indexa la biblioteca.')}
          </p>
        )}
        {searched && (
          <p className="text-xs text-neutral-500 mt-2">
            {tx('{n} resultado(s) en {g} categoría(s).', { n: visible.length, g: categoryCount })}
          </p>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto mt-4">
        <div className="max-w-3xl w-full mx-auto space-y-5">
          {!similar && query.trim().length < 2 && (
            <p className="text-sm text-neutral-600 text-center py-10">
              {t('Escribe al menos dos caracteres para buscar en todo el espacio de trabajo.')}
            </p>
          )}
          {searched && visible.length === 0 && (
            <p className="text-sm text-neutral-500 text-center py-10">{t('Sin resultados.')}</p>
          )}
          <ul className="space-y-1">
          {visible.map((r) => {
            const meta = KIND_META[r.kind];
            return <li key={`${r.kind}:${r.id}`}>
                      <div className="group flex w-full items-start gap-3 rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2 transition-colors hover:border-neutral-700 hover:bg-neutral-900">
                        <button className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => openResult(r)}>
                          <Icon name={meta.icon} size={15} className="mt-0.5 shrink-0 text-neutral-500" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm text-neutral-100">{r.title}</span>
                              <span className="text-[10px] text-neutral-500">{t(meta.label)}</span>
                              {typeof (r.relevance ?? r.similarity) === 'number' && (
                                <span title={t('Relevancia')} className="shrink-0 rounded bg-indigo-900/50 px-1.5 py-0.5 text-[10px] tabular-nums text-indigo-300">
                                  {Math.round((r.relevance ?? r.similarity ?? 0) * 100)}%
                                </span>
                              )}
                              {r.subtitle && (
                                <span className="shrink-0 truncate text-xs text-neutral-500">{r.subtitle}</span>
                              )}
                            </div>
                            {r.snippet && <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">{r.snippet}</p>}
                          </div>
                        </button>
                        {r.kind === 'idea' && (
                          <button
                            className="mt-0.5 shrink-0 text-neutral-600 opacity-0 transition-opacity hover:text-indigo-300 group-hover:opacity-100"
                            onClick={() => findSimilar(r)}
                            title={t('Buscar ideas parecidas a esta')}
                          >
                            <Icon name="network" size={15} />
                          </button>
                        )}
                      </div>
            </li>;
          })}
          </ul>
        </div>
      </div>
      {ideaModalId && (
        <IdeaDetailModal
          initialIdeaId={ideaModalId}
          onClose={() => setIdeaModalId(null)}
          onOpenGraph={onOpenGraph}
        />
      )}
      {workModal && (
        <WorkIdeasModal
          work={workModal}
          onClose={() => setWorkModal(null)}
          onOpenGraph={onOpenGraph}
          onOpenWorkGraph={(w) => {
            setWorkModal(null);
            onOpenGraph({
              preset: 'reading',
              workId: w.nodus_id,
              workTitle: w.title,
              label: `${t('Ideas y conexiones:')} ${w.title}`,
            });
          }}
        />
      )}
    </div>
  );
}
