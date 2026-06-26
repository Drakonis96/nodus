import { useEffect, useMemo, useRef, useState } from 'react';
import type { GlobalSearchResult, SearchResultKind } from '@shared/types';
import { Icon } from '../components/ui';
import type { PendingGraphNavigationTarget } from '../navigation';
import { t, tx } from '../i18n';

// One search box that spans the whole workspace; each result links to the surface
// that owns it (graph node, reading view, gaps, the note editor, …).
const KIND_META: Record<SearchResultKind, { label: string; icon: string }> = {
  note: { label: 'Notas', icon: 'notebook' },
  idea: { label: 'Ideas', icon: 'bulb' },
  work: { label: 'Obras', icon: 'book' },
  gap: { label: 'Huecos', icon: 'gap' },
  theme: { label: 'Temas', icon: 'theme' },
  author: { label: 'Autores', icon: 'graduation' },
};

const KIND_ORDER: SearchResultKind[] = ['note', 'idea', 'work', 'gap', 'theme', 'author'];

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
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced live search; ignores stale responses if the query changed meanwhile.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    let active = true;
    const handle = window.setTimeout(() => {
      void window.nodus.globalSearch(q).then((res) => {
        if (!active) return;
        setResults(res);
        setSearched(true);
        setLoading(false);
      });
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [query]);

  const grouped = useMemo(() => {
    const map = new Map<SearchResultKind, GlobalSearchResult[]>();
    for (const r of results) {
      const list = map.get(r.kind) ?? [];
      list.push(r);
      map.set(r.kind, list);
    }
    return KIND_ORDER.filter((k) => map.has(k)).map((k) => ({ kind: k, items: map.get(k)! }));
  }, [results]);

  const open = (r: GlobalSearchResult) => {
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

  return (
    <div className="h-full flex flex-col min-h-0 p-6">
      <div className="shrink-0 max-w-3xl w-full mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <Icon name="search" size={22} className="text-indigo-300" />
          <h1 className="text-xl font-semibold">{t('Búsqueda global')}</h1>
        </div>
        <div className="relative">
          <Icon
            name="search"
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none"
          />
          <input
            ref={inputRef}
            className="input input-with-leading-icon w-full"
            placeholder={t('Busca en notas, ideas, obras, huecos, temas y autores…')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {loading && (
            <Icon name="sync" size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-neutral-500" />
          )}
        </div>
        {searched && (
          <p className="text-xs text-neutral-500 mt-2">
            {tx('{n} resultado(s) en {g} categoría(s).', { n: results.length, g: grouped.length })}
          </p>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto mt-4">
        <div className="max-w-3xl w-full mx-auto space-y-5">
          {query.trim().length < 2 && (
            <p className="text-sm text-neutral-600 text-center py-10">
              {t('Escribe al menos dos caracteres para buscar en todo el espacio de trabajo.')}
            </p>
          )}
          {searched && results.length === 0 && (
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
                      <button
                        className="group flex w-full items-start gap-3 rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-left transition-colors hover:border-neutral-700 hover:bg-neutral-900"
                        onClick={() => open(r)}
                      >
                        <Icon name={meta.icon} size={15} className="mt-0.5 shrink-0 text-neutral-500" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm text-neutral-100">{r.title}</span>
                            {r.subtitle && (
                              <span className="shrink-0 truncate text-xs text-neutral-500">{r.subtitle}</span>
                            )}
                          </div>
                          {r.snippet && <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">{r.snippet}</p>}
                        </div>
                        <Icon
                          name="chevronRight"
                          size={14}
                          className="mt-1 shrink-0 text-neutral-700 group-hover:text-neutral-400"
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
