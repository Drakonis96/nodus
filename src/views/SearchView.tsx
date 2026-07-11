import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GlobalSearchResult, SavedSearch, SearchMode, SearchResultKind } from '@shared/types';
import { Icon } from '../components/ui';
import type { PendingGraphNavigationTarget } from '../navigation';
import { t, tx } from '../i18n';
import { IdeaDetailModal } from '../components/IdeaDetailModal';
import { WorkIdeasModal } from './WorkIdeasModal';

// One search box that spans the whole workspace. Two strategies: text (LIKE,
// matches characters) and semantic (embeddings, matches meaning). Each result
// links to the surface that owns it (graph node, reading view, gaps, note, …).
const KIND_META: Record<SearchResultKind, { label: string; icon: string }> = {
  note: { label: 'Notas', icon: 'notebook' },
  idea: { label: 'Ideas', icon: 'bulb' },
  work: { label: 'Obras', icon: 'book' },
  passage: { label: 'Pasajes', icon: 'quote' },
  gap: { label: 'Huecos', icon: 'gap' },
  theme: { label: 'Temas', icon: 'theme' },
  author: { label: 'Autores', icon: 'graduation' },
};

const TEXT_KINDS: SearchResultKind[] = ['note', 'idea', 'work', 'gap', 'theme', 'author'];
const SEMANTIC_KINDS: SearchResultKind[] = ['idea', 'passage', 'work'];

function kindsForMode(mode: SearchMode): SearchResultKind[] {
  return mode === 'semantic' ? SEMANTIC_KINDS : TEXT_KINDS;
}

interface SimilarTarget {
  ideaId: string;
  ideaTitle: string;
}

export function SearchView({
  onOpenGraph,
  onOpenNote,
  onOpenGaps,
}: {
  onOpenGraph: (target: PendingGraphNavigationTarget) => void;
  onOpenNote: (noteId: string) => void;
  onOpenGaps: () => void;
}) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('text');
  const [activeKinds, setActiveKinds] = useState<Set<SearchResultKind>>(() => new Set(TEXT_KINDS));
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [similar, setSimilar] = useState<SimilarTarget | null>(null);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [ideaModalId, setIdeaModalId] = useState<string | null>(null);
  const [workModal, setWorkModal] = useState<{ nodus_id: string; title: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const reloadSaved = useCallback(() => {
    void window.nodus.listSavedSearches().then(setSavedSearches);
  }, []);
  useEffect(() => {
    reloadSaved();
  }, [reloadSaved]);

  const switchMode = (next: SearchMode) => {
    if (next === mode) return;
    setMode(next);
    setActiveKinds(new Set(kindsForMode(next)));
    setSimilar(null);
    setUnavailable(false);
  };

  const toggleKind = (kind: SearchResultKind) => {
    setActiveKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      // Never leave the filter empty — that would hide everything.
      if (next.size === 0) return new Set(kindsForMode(mode));
      return next;
    });
  };

  // Debounced live search; ignores stale responses if inputs changed meanwhile.
  useEffect(() => {
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
      });
      return () => {
        active = false;
      };
    }

    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearched(false);
      setUnavailable(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    let active = true;
    const handle = window.setTimeout(() => {
      if (mode === 'semantic') {
        void window.nodus
          .semanticSearch(q, { kinds: [...activeKinds] })
          .then((res) => {
            if (!active) return;
            setResults(res.results);
            setUnavailable(!res.available);
            setSearched(true);
            setLoading(false);
          });
      } else {
        void window.nodus.globalSearch(q).then((res) => {
          if (!active) return;
          setResults(res);
          setUnavailable(false);
          setSearched(true);
          setLoading(false);
        });
      }
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [query, mode, activeKinds, similar]);

  const visible = useMemo(
    () => results.filter((r) => activeKinds.has(r.kind)),
    [results, activeKinds]
  );

  const grouped = useMemo(() => {
    const order = kindsForMode(mode);
    const map = new Map<SearchResultKind, GlobalSearchResult[]>();
    for (const r of visible) {
      const list = map.get(r.kind) ?? [];
      list.push(r);
      map.set(r.kind, list);
    }
    return order.filter((k) => map.has(k)).map((k) => ({ kind: k, items: map.get(k)! }));
  }, [visible, mode]);

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
    setMode('semantic');
    setActiveKinds(new Set(['idea']));
    setSimilar({ ideaId: r.id, ideaTitle: r.title });
  };

  const clearSimilar = () => {
    setSimilar(null);
    setActiveKinds(new Set(kindsForMode(mode)));
  };

  const saveCurrent = () => {
    const q = query.trim();
    if (q.length < 2 || similar) return;
    void window.nodus
      .saveSearch({ name: q, query: q, mode, kinds: [...activeKinds] })
      .then(reloadSaved);
  };

  const applySaved = (s: SavedSearch) => {
    setSimilar(null);
    setMode(s.mode);
    setActiveKinds(new Set(s.kinds.length ? s.kinds : kindsForMode(s.mode)));
    setQuery(s.query);
  };

  const deleteSaved = (id: string) => {
    void window.nodus.deleteSavedSearch(id).then(reloadSaved);
  };

  const availableKinds = kindsForMode(mode);
  const canSave = query.trim().length >= 2 && !similar;

  return (
    <div className="h-full flex flex-col min-h-0 p-6">
      <div className="shrink-0 max-w-3xl w-full mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <Icon name="search" size={22} className="text-indigo-300" />
          <h1 className="text-xl font-semibold">{t('Búsqueda global')}</h1>
          <div className="ml-auto inline-flex rounded-md border border-neutral-700 overflow-hidden text-xs">
            <button
              className={`px-3 py-1.5 ${mode === 'text' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}`}
              onClick={() => switchMode('text')}
            >
              {t('Texto')}
            </button>
            <button
              className={`px-3 py-1.5 ${mode === 'semantic' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}`}
              onClick={() => switchMode('semantic')}
            >
              {t('Significado')}
            </button>
          </div>
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
              placeholder={
                mode === 'semantic'
                  ? t('Describe una idea o pregunta; busca por significado en ideas, pasajes y obras…')
                  : t('Busca en notas, ideas, obras, huecos, temas y autores…')
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {loading && (
              <Icon name="sync" size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-neutral-500" />
            )}
          </div>
        )}

        {/* Kind filters */}
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          {availableKinds.map((k) => {
            const meta = KIND_META[k];
            const on = activeKinds.has(k);
            return (
              <button
                key={k}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${
                  on
                    ? 'border-indigo-600 bg-indigo-900/40 text-indigo-200'
                    : 'border-neutral-700 text-neutral-500 hover:text-neutral-300'
                }`}
                onClick={() => toggleKind(k)}
                disabled={Boolean(similar)}
              >
                <Icon name={meta.icon} size={12} /> {t(meta.label)}
              </button>
            );
          })}
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

        {unavailable && (
          <p className="text-xs text-amber-400/90 mt-3">
            {t('La búsqueda por significado necesita embeddings. Configura el proveedor y la clave de embeddings en Ajustes e indexa la biblioteca.')}
          </p>
        )}
        {searched && !unavailable && (
          <p className="text-xs text-neutral-500 mt-2">
            {tx('{n} resultado(s) en {g} categoría(s).', { n: visible.length, g: grouped.length })}
          </p>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto mt-4">
        <div className="max-w-3xl w-full mx-auto space-y-5">
          {!similar && query.trim().length < 2 && (
            <p className="text-sm text-neutral-600 text-center py-10">
              {mode === 'semantic'
                ? t('Describe una idea para encontrar pasajes, ideas y obras con significado parecido.')
                : t('Escribe al menos dos caracteres para buscar en todo el espacio de trabajo.')}
            </p>
          )}
          {searched && !unavailable && visible.length === 0 && (
            <p className="text-sm text-neutral-500 text-center py-10">{t('Sin resultados.')}</p>
          )}
          {grouped.map(({ kind, items }) => {
            const meta = KIND_META[kind];
            return (
              <section key={kind}>
                <div className="flex items-center gap-2 mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  <Icon name={meta.icon} size={14} />
                  {t(meta.label)}
                  <span className="text-neutral-600">({items.length})</span>
                </div>
                <ul className="space-y-1">
                  {items.map((r) => (
                    <li key={`${r.kind}:${r.id}`}>
                      <div className="group flex w-full items-start gap-3 rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2 transition-colors hover:border-neutral-700 hover:bg-neutral-900">
                        <button className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => openResult(r)}>
                          <Icon name={meta.icon} size={15} className="mt-0.5 shrink-0 text-neutral-500" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm text-neutral-100">{r.title}</span>
                              {typeof r.similarity === 'number' && (
                                <span className="shrink-0 rounded bg-indigo-900/50 px-1.5 py-0.5 text-[10px] tabular-nums text-indigo-300">
                                  {Math.round(r.similarity * 100)}%
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
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
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
