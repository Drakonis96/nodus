import { useEffect, useMemo, useState } from 'react';
import type {
  PrimarySourceSearchFilters,
  PrimarySourceSearchLayer,
  PrimarySourceSearchResponse,
  PrimarySourceSearchResult,
} from '@shared/primarySourcesTypes';
import { Icon } from '../components/ui';
import { t, tx } from '../i18n';
import type { View } from '../navigation';

const EMPTY: PrimarySourceSearchResponse = {
  queryText: '',
  parsedTerms: [],
  results: [],
  total: 0,
  elapsedMs: 0,
  indexStrategy: 'sqlite_like',
  ftsRecommended: false,
  facets: {
    layers: [],
    repositories: [],
    levels: [],
    formats: [],
    persons: [],
    places: [],
    reviewStatuses: [],
    accessStatuses: [],
  },
};

const LAYER_LABELS: Record<PrimarySourceSearchLayer, string> = {
  metadata: 'Metadatos',
  ocr: 'OCR',
  transcription: 'Transcripción',
  excerpt: 'Fragmento',
  person: 'Persona',
  event: 'Evento',
  place: 'Lugar',
  relation: 'Relación',
  note: 'Interpretación',
  tag: 'Etiqueta',
  collection: 'Colección de trabajo',
};

export interface PrimarySourceOpenTarget {
  itemId: string;
  excerptId?: string | null;
  textVersionId?: string | null;
  startOffset?: number | null;
  endOffset?: number | null;
}

export type PrimarySourcesSearchLoader = {
  searchPrimarySourceCorpus: (request: import('@shared/primarySourcesTypes').PrimarySourceSearchRequest) => Promise<PrimarySourceSearchResponse>;
};

export function PrimarySourcesSearchView({
  onOpenSource,
  onOpenNote,
  onNavigate,
  loader,
}: {
  onOpenSource: (target: PrimarySourceOpenTarget) => void;
  onOpenNote: (noteId: string) => void;
  onNavigate: (view: View) => void;
  loader?: PrimarySourcesSearchLoader;
}) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<PrimarySourceSearchFilters>({});
  const [response, setResponse] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [allowPrivate, setAllowPrivate] = useState(false);
  const [allowRestricted, setAllowRestricted] = useState(false);
  const [allowUnknownRights, setAllowUnknownRights] = useState(false);
  const [grouped, setGrouped] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!query.trim() && !Object.values(filters).some(Boolean)) {
        setResponse(EMPTY);
        setLoading(false);
        return;
      }
      setLoading(true);
      void (loader?.searchPrimarySourceCorpus ?? window.nodus.searchPrimarySourceCorpus)({
        query,
        filters,
        allowPrivateContent: allowPrivate,
        allowRestrictedContent: allowRestricted,
        allowUnknownRightsContent: allowUnknownRights,
      }).then(setResponse).finally(() => setLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [allowPrivate, allowRestricted, allowUnknownRights, filters, query, loader]);

  const groups = useMemo(() => {
    const result = new Map<PrimarySourceSearchLayer, PrimarySourceSearchResult[]>();
    for (const row of response.results) result.set(row.layer, [...(result.get(row.layer) ?? []), row]);
    return [...result.entries()];
  }, [response.results]);

  const setFilter = <K extends keyof PrimarySourceSearchFilters>(
    key: K,
    value: PrimarySourceSearchFilters[K]
  ) => setFilters((current) => ({ ...current, [key]: value || undefined }));

  const clearFilters = () => {
    setFilters({});
    setAllowPrivate(false);
    setAllowRestricted(false);
    setAllowUnknownRights(false);
  };

  const facetLabel = (options: Array<{ id: string; label: string }>, id: string) =>
    options.find((option) => option.id === id)?.label ?? id;

  const activeFilters: Array<{ key: string; label: string; clear: () => void }> = [];
  const layer = filters.layers?.[0];
  if (layer) activeFilters.push({ key: 'layer', label: `${t('Tipo de resultado')}: ${t(LAYER_LABELS[layer])}`, clear: () => setFilter('layers', undefined) });
  if (filters.repositoryId) activeFilters.push({ key: 'repository', label: `${t('Repositorio')}: ${facetLabel(response.facets.repositories, filters.repositoryId)}`, clear: () => setFilter('repositoryId', undefined) });
  if (filters.level) activeFilters.push({ key: 'level', label: `${t('Nivel descriptivo')}: ${facetLabel(response.facets.levels, filters.level)}`, clear: () => setFilter('level', undefined) });
  if (filters.format) activeFilters.push({ key: 'format', label: `${t('Formato')}: ${facetLabel(response.facets.formats, filters.format)}`, clear: () => setFilter('format', undefined) });
  if (filters.personId) activeFilters.push({ key: 'person', label: `${t('Persona')}: ${facetLabel(response.facets.persons, filters.personId)}`, clear: () => setFilter('personId', undefined) });
  if (filters.placeId) activeFilters.push({ key: 'place', label: `${t('Lugar')}: ${facetLabel(response.facets.places, filters.placeId)}`, clear: () => setFilter('placeId', undefined) });
  if (filters.reviewStatus) activeFilters.push({ key: 'review', label: `${t('Estado de revisión')}: ${facetLabel(response.facets.reviewStatuses, filters.reviewStatus)}`, clear: () => setFilter('reviewStatus', undefined) });
  if (filters.accessStatus) activeFilters.push({ key: 'access', label: `${t('Restricción')}: ${facetLabel(response.facets.accessStatuses, filters.accessStatus)}`, clear: () => setFilter('accessStatus', undefined) });
  if (filters.dateFrom) activeFilters.push({ key: 'dateFrom', label: `${t('Desde')}: ${filters.dateFrom}`, clear: () => setFilter('dateFrom', undefined) });
  if (filters.dateTo) activeFilters.push({ key: 'dateTo', label: `${t('Hasta')}: ${filters.dateTo}`, clear: () => setFilter('dateTo', undefined) });
  if (allowPrivate) activeFilters.push({ key: 'private', label: t('Privado'), clear: () => setAllowPrivate(false) });
  if (allowRestricted) activeFilters.push({ key: 'restricted', label: t('Restringido'), clear: () => setAllowRestricted(false) });
  if (allowUnknownRights) activeFilters.push({ key: 'unknownRights', label: t('Derechos por revisar'), clear: () => setAllowUnknownRights(false) });

  const hasSearchCriteria = Boolean(query.trim() || Object.values(filters).some(Boolean));

  const open = (result: PrimarySourceSearchResult) => {
    if (result.noteId) {
      onOpenNote(result.noteId);
      return;
    }
    if (result.itemId) {
      onOpenSource({
        itemId: result.itemId,
        excerptId: result.excerptId,
        textVersionId: result.textVersionId,
        startOffset: result.startOffset,
        endOffset: result.endOffset,
      });
      return;
    }
    if (result.layer === 'person') onNavigate('persons');
    else if (result.layer === 'event') onNavigate('timeline');
    else if (result.layer === 'place') onNavigate('map');
    else if (result.layer === 'relation') onNavigate('relations');
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100" data-testid="primary-sources-search">
      <header className="shrink-0 border-b border-neutral-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
        <div className="mx-auto max-w-5xl">
          <div className="mb-4 flex items-center gap-3">
            <Icon name="search" size={22} className="text-indigo-500 dark:text-indigo-300" />
            <h1 className="text-xl font-semibold">{t('Buscar')}</h1>
            <button
              type="button"
              className={`btn btn-ghost ml-auto h-8 gap-1.5 px-2.5 text-xs ${filtersOpen ? 'text-indigo-600 dark:text-indigo-300' : ''}`}
              aria-expanded={filtersOpen}
              data-testid="primary-sources-search-filter-toggle"
              onClick={() => setFiltersOpen((value) => !value)}
            >
              <Icon name="settings" size={13} />
              {t('Filtros')}
              {activeFilters.length > 0 && (
                <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[9px] font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">
                  {activeFilters.length}
                </span>
              )}
            </button>
          </div>
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={17} />
            <input
              autoFocus
              className="input input-with-leading-icon h-10 w-full pr-10 text-sm"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('Busca metadatos, OCR, transcripciones, fragmentos, entidades y notas…')}
              data-testid="primary-sources-search-input"
            />
            {loading && <Icon name="sync" className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-indigo-500" size={17} />}
          </div>

          {filtersOpen && (
            <section className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/50" data-testid="primary-sources-search-filters">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <FacetSelect label={t('Tipo de resultado')} value={filters.layers?.[0] ?? ''} options={response.facets.layers} onChange={(value) => setFilter('layers', value ? [value as PrimarySourceSearchLayer] : undefined)} />
                <FacetSelect label={t('Repositorio')} value={filters.repositoryId ?? ''} options={response.facets.repositories} onChange={(value) => setFilter('repositoryId', value)} />
                <FacetSelect label={t('Nivel descriptivo')} value={filters.level ?? ''} options={response.facets.levels} onChange={(value) => setFilter('level', value)} />
                <FacetSelect label={t('Formato')} value={filters.format ?? ''} options={response.facets.formats} onChange={(value) => setFilter('format', value)} />
                <FacetSelect label={t('Persona')} value={filters.personId ?? ''} options={response.facets.persons} onChange={(value) => setFilter('personId', value)} />
                <FacetSelect label={t('Lugar')} value={filters.placeId ?? ''} options={response.facets.places} onChange={(value) => setFilter('placeId', value)} />
                <FacetSelect label={t('Estado de revisión')} value={filters.reviewStatus ?? ''} options={response.facets.reviewStatuses} onChange={(value) => setFilter('reviewStatus', value)} />
                <FacetSelect label={t('Restricción')} value={filters.accessStatus ?? ''} options={response.facets.accessStatuses} onChange={(value) => setFilter('accessStatus', value as PrimarySourceSearchFilters['accessStatus'])} />
                <div>
                  <p className="mb-1 text-[10px] font-medium text-neutral-500">{t('Intervalo de fechas')}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input aria-label={t('Desde')} className="input h-8 px-2 text-[11px]" type="number" placeholder={t('Desde')} value={filters.dateFrom ?? ''} onChange={(event) => setFilter('dateFrom', event.target.value)} />
                    <input aria-label={t('Hasta')} className="input h-8 px-2 text-[11px]" type="number" placeholder={t('Hasta')} value={filters.dateTo ?? ''} onChange={(event) => setFilter('dateTo', event.target.value)} />
                  </div>
                </div>
                <div className="grid gap-2 sm:col-span-2 lg:col-span-3 lg:grid-cols-3">
                  <PrivacyToggle checked={allowPrivate} label={t('Incluir contenido privado en esta búsqueda local')} onChange={setAllowPrivate} />
                  <PrivacyToggle checked={allowRestricted} label={t('Incluir contenido restringido permitido por la política del vault')} onChange={setAllowRestricted} />
                  <PrivacyToggle checked={allowUnknownRights} label={t('Confirmo buscar contenido cuyos derechos están por revisar')} onChange={setAllowUnknownRights} />
                </div>
              </div>
            </section>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-neutral-500">
            <span className="mr-auto">{t('Sintaxis: comillas para frases; persona:, lugar:, repositorio:, fecha:, tipo:, estado: o referencia:.')}</span>
            {response.results.length > 0 && tx('{n} resultados · {ms} ms · SQLite local', {
              n: response.total,
              ms: Math.round(response.elapsedMs),
            })}
            <button className="text-indigo-600 hover:underline dark:text-indigo-300" onClick={() => setGrouped((value) => !value)}>
              {grouped ? t('Lista única') : t('Agrupar por capa')}
            </button>
          </div>

          {activeFilters.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5" data-testid="primary-sources-search-active-filters">
              {activeFilters.map((filter) => (
                <span key={filter.key} className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 py-1 pl-2.5 pr-1 text-[10px] text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200">
                  {filter.label}
                  <button type="button" className="grid h-5 w-5 place-items-center rounded-full hover:bg-indigo-100 dark:hover:bg-indigo-900" aria-label={`${t('Limpiar')} ${filter.label}`} onClick={filter.clear}>
                    <Icon name="x" size={10} />
                  </button>
                </span>
              ))}
              <button type="button" className="ml-1 text-[10px] text-indigo-600 hover:underline dark:text-indigo-300" onClick={clearFilters}>{t('Limpiar filtros')}</button>
            </div>
          )}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-5 p-5">
          {!hasSearchCriteria && response.results.length === 0 && (
            <section className="rounded-2xl border border-dashed border-neutral-300 bg-white p-10 text-center dark:border-neutral-700 dark:bg-neutral-900">
              <Icon name="search" className="mx-auto text-indigo-500" size={28} />
              <h1 className="mt-4 text-lg font-semibold">{t('Busca en todo el corpus')}</h1>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-neutral-500">{t('Cada resultado indica si procede de una fuente, de texto automático o de una interpretación y abre el pasaje exacto cuando existe.')}</p>
              <code className="mt-4 inline-block rounded-lg bg-neutral-100 px-3 py-2 text-xs dark:bg-neutral-800">"cólera" persona:"María López"</code>
            </section>
          )}
          {hasSearchCriteria && !loading && response.results.length === 0 && (
            <p className="rounded-xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">{t('No hay coincidencias con estos filtros.')}</p>
          )}
          {response.ftsRecommended && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              {t('La medición supera el objetivo de latencia. Conviene reconstruir un índice FTS derivado de los datos canónicos.')}
            </p>
          )}
          {(grouped ? groups : [['metadata' as PrimarySourceSearchLayer, response.results] as const]).map(([layer, results]) => (
            <section key={layer}>
              {grouped && (
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">{t(LAYER_LABELS[layer])}</h2>
                  <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[9px] dark:bg-neutral-800">{results.length}</span>
                </div>
              )}
              <div className="space-y-2">
                {results.map((result) => <SearchResultCard key={result.resultId} result={result} onOpen={() => open(result)} />)}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}

function FacetSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ id: string; label: string; count: number }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-medium text-neutral-500">{label}</span>
      <select aria-label={label} className="input h-8 w-full px-2 text-[11px]" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t('Todos')}</option>
        {options.map((option) => <option key={option.id} value={option.id}>{t(option.label)} ({option.count})</option>)}
      </select>
    </label>
  );
}

function PrivacyToggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`flex min-h-12 cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-[10px] leading-4 transition ${checked ? 'border-indigo-300 bg-indigo-50 text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-100' : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:border-neutral-700'}`}>
      <input className="mt-0.5 accent-indigo-600" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function SearchResultCard({ result, onOpen }: { result: PrimarySourceSearchResult; onOpen: () => void }) {
  const before = result.matchText.slice(0, result.matchStart);
  const marked = result.matchText.slice(result.matchStart, result.matchStart + result.matchLength);
  const after = result.matchText.slice(result.matchStart + result.matchLength);
  return (
    <article className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition hover:border-indigo-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-indigo-700" data-testid="primary-sources-search-result">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 rounded-md px-2 py-1 text-[9px] font-semibold uppercase tracking-wide ${result.interpretation ? 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-200' : result.unreviewedText ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200' : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200'}`}>
          {t(result.interpretation ? 'Interpretación' : result.unreviewedText ? 'Texto no revisado' : LAYER_LABELS[result.layer])}
        </span>
        <div className="min-w-0 flex-1">
          <button className="block max-w-full truncate text-left text-sm font-semibold hover:text-indigo-600 dark:hover:text-indigo-300" onClick={onOpen}>{result.title}</button>
          <p className="mt-1 text-[10px] text-neutral-500">
            {[result.repositoryName, result.hierarchy.join(' › '), result.referenceCode, result.dateDisplay, result.locator].filter(Boolean).join(' · ')}
          </p>
          <p className="mt-2 text-xs leading-5 text-neutral-700 dark:text-neutral-300">
            {before}<mark className="rounded bg-amber-200 px-0.5 text-inherit dark:bg-amber-700/70">{marked}</mark>{after}
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-[9px] text-neutral-500">
            {result.documentType && <span>{t(result.documentType)}</span>}
            {result.format && <span>· {result.format}</span>}
            {result.accessStatus && <span>· {t(result.accessStatus)}</span>}
            {result.restrictedContentHidden && <span className="text-amber-600">· {t('Contenido oculto por política')}</span>}
          </div>
        </div>
        <button className="btn btn-ghost h-8 shrink-0 gap-1 px-2 text-[10px]" onClick={onOpen}>
          <Icon name="target" size={12} /> {t('Abrir contexto')}
        </button>
      </div>
    </article>
  );
}
