import { useEffect, useState } from 'react';
import type { VaultContentHit } from '@shared/hybridSearch';
import { Icon } from '../components/ui';
import { SearchKindFilters, type SearchKindOption } from '../components/search/SearchKindFilters';
import { t, tx } from '../i18n';

export function VaultContentSearchView({ options, onOpen, testId }: {
  options: readonly SearchKindOption<string>[]; onOpen: (hit: VaultContentHit) => void; testId: string;
}) {
  const [query, setQuery] = useState('');
  const [kinds, setKinds] = useState(() => new Set(options.map((option) => option.kind)));
  const [results, setResults] = useState<VaultContentHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(80);
  const [hasMore, setHasMore] = useState(false);
  useEffect(() => {
    let active = true;
    setResults([]); setHasMore(false); setError(''); setLoading(false);
    if (query.trim().length < 2 || !kinds.size) return;
    setLoading(true);
    const timer = window.setTimeout(() => {
      // Literal results appear while the semantic index is being prepared.
      let semanticDone = false;
      void window.nodus.searchVaultContent(query, [...kinds], false, limit).then((response) => {
        if (active && !semanticDone) setResults(response.results);
      }).catch((cause) => { if (active && !semanticDone) setError(String(cause)); });
      void window.nodus.searchVaultContent(query, [...kinds], true, limit).then((response) => {
        semanticDone = true;
        if (!active) return;
        setResults(response.results); setHasMore(Boolean(response.hasMore));
        setError(response.semanticAvailable ? '' : t('La búsqueda por significado necesita embeddings. Configura el proveedor y la clave de embeddings en Ajustes e indexa la biblioteca.'));
      }).catch((cause) => { if (active) setError(String(cause)); })
        .finally(() => { if (active) setLoading(false); });
    }, 220);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, kinds, limit]);
  return <div className="flex h-full min-h-0 flex-col p-6" data-testid={testId}>
    <div className="mx-auto w-full max-w-3xl shrink-0">
      <div className="mb-4 flex items-center gap-3"><Icon name="search" size={22} className="text-indigo-500 dark:text-indigo-300" /><h1 className="text-xl font-semibold">{t('Búsqueda global')}</h1></div>
      <div className="relative"><Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" /><input autoFocus aria-label={t('Buscar')} className="input input-with-leading-icon w-full pr-10" placeholder={t('Escribe para buscar…')} value={query} onChange={(event) => { setQuery(event.target.value); setLimit(80); }} />{loading && <span className="absolute right-3 top-1/2 -translate-y-1/2"><Icon name="sync" size={15} className="animate-spin text-neutral-500" /></span>}</div>
      <SearchKindFilters options={options} selected={kinds} onChange={(next) => { setKinds(next); setLimit(80); }} />
      {error && <p role="status" className="mt-3 text-xs text-amber-600 dark:text-amber-400">{error}</p>}
      {query.trim().length >= 2 && <p className="mt-3 text-xs text-neutral-500">{tx('{count} resultados', { count: results.length })}</p>}
    </div>
    <main className="mt-4 min-h-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-3xl space-y-1">
      {query.trim().length < 2 && <p className="py-10 text-center text-sm text-neutral-500">{t('Escribe al menos dos caracteres para buscar en todo el espacio de trabajo.')}</p>}
      {query.trim().length >= 2 && !loading && !results.length && <p className="py-10 text-center text-sm text-neutral-500">{t('Sin resultados.')}</p>}
      {results.map((hit) => {
        const meta = options.find((option) => option.kind === hit.kind);
        return <button key={`${hit.kind}:${hit.id}`} onClick={() => onOpen(hit)} className="flex w-full items-start gap-3 rounded-md border border-neutral-200 bg-white px-3 py-2 text-left hover:border-indigo-400 dark:border-neutral-800 dark:bg-neutral-900/40">
          <Icon name={meta?.icon ?? 'search'} size={15} className="mt-0.5 shrink-0 text-neutral-500" />
          <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-sm font-medium">{hit.title}</span><span className="text-[10px] text-neutral-500">{t(meta?.label ?? hit.kind)}</span></span>{hit.subtitle && <span className="block truncate text-xs text-neutral-500">{hit.subtitle}</span>}{hit.snippet && <span className="mt-0.5 line-clamp-2 block text-xs text-neutral-500">{hit.snippet}</span>}</span>
        </button>;
      })}
      {hasMore && <button className="btn btn-ghost mt-3 w-full justify-center" disabled={loading} onClick={() => setLimit((current) => current + 80)}>{t('Cargar más resultados')}</button>}
    </div></main>
  </div>;
}
