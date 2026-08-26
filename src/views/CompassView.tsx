import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CompassLane,
  CompassResult as CompassResultDetail,
} from "@shared/compass";
import { Icon } from "../components/ui";
import { CompassFilters } from "../components/compass/CompassFilters";
import { CompassHistoryPanel } from "../components/compass/CompassHistoryPanel";
import { CompassImportDialog } from "../components/compass/CompassImportDialog";
import { CompassProviderStatus } from "../components/compass/CompassProviderStatus";
import { CompassResultList } from "../components/compass/CompassResultList";
import { CompassSearchBar } from "../components/compass/CompassSearchBar";
import { useCompassModal } from "../components/compass/useCompassModal";
import { compassT } from "../i18n.compass";
import {
  EMPTY_COMPASS_FILTERS,
  EMPTY_COMPASS_SNAPSHOT,
  getCompassApi,
  type CompassFilters as Filters,
  type CompassImportEvent,
  type CompassResult,
  type CompassSearchResponse,
  type CompassSession,
  type CompassSnapshot,
} from "../components/compass/types";

const uniqueResults = (items: CompassResult[]) => {
  const seen = new Set<string>();
  return items.filter(
    (item) =>
      item && !seen.has(item.canonicalKey) && seen.add(item.canonicalKey),
  );
};
const TYPE_LABELS: Record<CompassResult["type"], string> = {
  article: "Artículo",
  book: "Libro",
  chapter: "Capítulo",
  thesis: "Tesis",
  report: "Informe",
  dataset: "Conjunto de datos",
  preprint: "Prepublicación",
  photograph: "Fotografía",
  newspaper: "Prensa",
  map: "Mapa",
  manuscript: "Manuscrito",
  audio: "Audio",
  video: "Vídeo",
  "archive-item": "Objeto de archivo",
  other: "Otro",
};
function reasonLabel(reason: CompassResult["reasons"][number]): string {
  const labels: Record<typeof reason.code, string> = {
    "matched-concept": "Coincide con los conceptos de la consulta",
    "phrase-match": "Coincide con una frase exacta",
    "author-match": "Coincide con el autor solicitado",
    "language-match": "Coincide con el idioma solicitado",
    "type-match": "Coincide con el tipo de publicación",
    "date-match": "Coincide con el intervalo de fechas",
    "open-access": "Tiene acceso abierto verificado",
    "provider-route": "Procede de una fuente adecuada para la consulta",
    "citation-related": "Está relacionado por citas",
    "semantic-similarity": "Tiene similitud semántica local",
  };
  return `${compassT(labels[reason.code])}${reason.value ? ` · ${reason.value}` : ""}`;
}

export function CompassView({
  snapshot,
  onSnapshotChange,
}: {
  snapshot?: CompassSnapshot;
  onSnapshotChange?: (patch: Partial<CompassSnapshot>) => void;
}) {
  const api = getCompassApi();
  const initial = snapshot ?? EMPTY_COMPASS_SNAPSHOT;
  const [query, setQuery] = useState(initial.draft);
  const [lane, setLane] = useState<CompassLane>(initial.lane);
  const [filters, setFilters] = useState<Filters>({
    ...initial.filters,
    lane: initial.lane,
  });
  const [sort, setSort] = useState<NonNullable<Filters["sort"]>>(initial.sort);
  const [searchId, setSearchId] = useState<string | null>(initial.searchId);
  const [results, setResults] = useState<CompassResult[]>([]);
  const [session, setSession] = useState<CompassSession | null>(null);
  const [providers, setProviders] = useState<CompassSession["providers"]>([]);
  const [status, setStatus] = useState<CompassSession["state"]>("complete");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [savedResults, setSavedResults] = useState<CompassResult[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<CompassSession[]>([]);
  const [selectedItem, setSelectedItem] = useState<
    CompassResultDetail | CompassResult | null
  >(null);
  const [importProgress, setImportProgress] =
    useState<CompassImportEvent | null>(null);
  const [aiInterpret, setAiInterpret] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [lastPage, setLastPage] = useState({ offset: 0, length: 0 });
  const [scrollAnchors, setScrollAnchors] = useState(initial.scrollAnchors);
  const [laneTotals, setLaneTotals] = useState<Record<CompassLane, number>>({
    scholarly: 0,
    primary: 0,
  });
  const [online, setOnline] = useState(() => navigator.onLine);
  const generation = useRef(0);
  const queryRevision = useRef(0);
  const viewRevision = useRef(0);
  const requestId = useRef("");
  const activeSearchId = useRef<string | null>(initial.searchId);
  const hydratedSearchId = useRef<string | null>(null);
  const selectionVersion = useRef(0);
  const detailsModal = useCompassModal(Boolean(selectedItem), () =>
    setSelectedItem(null),
  );
  const patchSnapshot = useCallback(
    (patch: Partial<CompassSnapshot>) => onSnapshotChange?.(patch),
    [onSnapshotChange],
  );
  const anchorId = scrollAnchors[lane]?.key ?? null;

  const applyResponse = useCallback(
    (response: CompassSearchResponse, append = false) => {
      const incoming = uniqueResults(response.results ?? []);
      const offset = response.resultsOffset ?? 0;
      setSession(response.session);
      setSearchId(response.session.searchId);
      activeSearchId.current = response.session.searchId;
      hydratedSearchId.current = response.session.searchId;
      requestId.current = response.session.requestId;
      generation.current = response.session.generation;
      queryRevision.current = response.session.queryRevision;
      viewRevision.current = response.session.viewRevision;
      setLane(response.session.lane);
      setFilters(response.session.filters);
      setSort(response.session.filters.sort ?? "relevance");
      setStatus(response.session.state);
      setProviders(response.session.providers);
      setLaneTotals((current) => ({
        ...current,
        [response.session.lane]: response.session.resultCount,
      }));
      setLastPage({ offset, length: incoming.length });
      setHasMore(response.hasMore);
      setResults((current) =>
        append
          ? uniqueResults([
              ...current.slice(0, offset),
              ...incoming,
              ...current.slice(offset + incoming.length),
            ])
          : incoming,
      );
      patchSnapshot({
        searchId: response.session.searchId,
        draft: response.session.query,
        lane: response.session.lane,
        filters: response.session.filters,
        sort: response.session.filters.sort ?? "relevance",
      });
    },
    [patchSnapshot],
  );

  const startSearch = useCallback(
    async (
      nextQuery = query,
      nextLane = lane,
      similarTo?: { searchId: string; canonicalKey: string },
    ) => {
      const normalized = nextQuery.trim();
      if (!normalized) return;
      generation.current += 1;
      queryRevision.current += 1;
      viewRevision.current = 0;
      const currentGeneration = generation.current;
      const currentQueryRevision = queryRevision.current;
      const id = crypto.randomUUID();
      requestId.current = id;
      if (activeSearchId.current)
        void api
          .cancelCompassSearch(activeSearchId.current)
          .catch(() => undefined);
      activeSearchId.current = null;
      selectionVersion.current += 1;
      setSelected(new Set());
      setDismissed(new Set());
      setLaneTotals({ scholarly: 0, primary: 0 });
      setResults([]);
      setProviders([]);
      setHasMore(false);
      setStatus("interpreting");
      setSelectedItem(null);
      try {
        const response = await api.startCompassSearch({
          requestId: id,
          generation: currentGeneration,
          queryRevision: currentQueryRevision,
          query: normalized,
          lane: nextLane,
          filters: { ...filters, lane: nextLane, sort },
          interpretWithLlm: aiInterpret,
          similarTo,
        });
        if (
          requestId.current !== id ||
          generation.current !== currentGeneration ||
          queryRevision.current !== currentQueryRevision
        )
          return;
        setQuery(normalized);
        applyResponse(response);
      } catch (error) {
        if (requestId.current === id) {
          console.warn("[compass] search failed", error);
          setStatus("error");
        }
      }
    },
    [aiInterpret, api, applyResponse, filters, lane, query, sort],
  );

  const changeView = useCallback(
    async (
      nextLane: CompassLane,
      nextFilters: Filters,
      nextSort: NonNullable<Filters["sort"]>,
    ) => {
      if (!searchId || !session) return;
      viewRevision.current += 1;
      const revision = viewRevision.current;
      try {
        const response = await api.updateCompassView({
          searchId,
          requestId: requestId.current,
          generation: generation.current,
          viewRevision: revision,
          lane: nextLane,
          filters: { ...nextFilters, lane: nextLane, sort: nextSort },
          offset: 0,
        });
        if (
          viewRevision.current !== revision ||
          queryRevision.current !== response.session.queryRevision
        )
          return;
        applyResponse(response);
      } catch (error) {
        console.warn("[compass] view update failed", error);
      }
    },
    [api, applyResponse, searchId, session],
  );
  useEffect(() => {
    if (!searchId || !session) return;
    const desired = JSON.stringify({ ...filters, lane, sort });
    const current = JSON.stringify({
      ...session.filters,
      lane: session.lane,
      sort: session.filters.sort ?? "relevance",
    });
    if (desired === current) return;
    const timer = window.setTimeout(() => {
      void changeView(lane, filters, sort);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [changeView, filters, lane, searchId, session, sort]);

  const loadMore = useCallback(async () => {
    if (
      !searchId ||
      !session ||
      !hasMore ||
      ["interpreting", "queued", "searching"].includes(status)
    )
      return;
    const offset = results.length;
    setStatus("searching");
    try {
      const response = await api.loadMoreCompass(
        searchId,
        requestId.current,
        generation.current,
        offset,
      );
      if (
        response.session.queryRevision !== queryRevision.current ||
        response.session.viewRevision !== viewRevision.current
      )
        return;
      applyResponse(response, true);
    } catch (error) {
      console.warn("[compass] load more failed", error);
      setStatus("error");
    }
  }, [api, applyResponse, hasMore, results.length, searchId, session, status]);

  useEffect(() => {
    if (!initial.searchId || hydratedSearchId.current === initial.searchId)
      return;
    hydratedSearchId.current = initial.searchId;
    let active = true;
    void api
      .getCompassSearch(initial.searchId)
      .then((response) => {
        if (active && response) {
          setQuery(response.session.query);
          applyResponse(response);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, applyResponse, initial.searchId]);
  useEffect(() => {
    let active = true;
    void Promise.all([
      api.listCompassHistory(30),
      api.listCompassSavedCandidates(100),
    ])
      .then(([entries, savedEntries]) => {
        if (!active) return;
        setHistory(entries);
        setSavedResults(savedEntries);
        setSaved(new Set(savedEntries.map((entry) => entry.canonicalKey)));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, status]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(
    () =>
      api.onCompassSearchProgress((event) => {
        if (
          event.requestId !== requestId.current ||
          event.generation !== generation.current ||
          event.queryRevision !== queryRevision.current ||
          event.viewRevision < viewRevision.current
        )
          return;
        if (activeSearchId.current && event.searchId !== activeSearchId.current)
          return;
        if (!activeSearchId.current) {
          activeSearchId.current = event.searchId;
          setSearchId(event.searchId);
        }
        setStatus(event.state);
        setProviders(event.providers);
        setLaneTotals((current) => ({
          ...current,
          [lane]: event.providers
            .filter((provider) => provider.lane === lane)
            .reduce((sum, provider) => sum + provider.count, 0),
        }));
        setResults((current) =>
          uniqueResults([
            ...current.slice(0, event.resultsOffset),
            ...event.summaries,
            ...current.slice(event.resultsOffset + event.summaries.length),
          ]),
        );
        setHasMore(event.providers.some((provider) => provider.hasMore));
        if (event.done)
          void api
            .getCompassSearch(event.searchId)
            .then((response) => {
              if (
                response &&
                response.session.queryRevision === queryRevision.current &&
                response.session.viewRevision === viewRevision.current
              )
                // A late initial-page completion must not discard pages that the
                // user already loaded while providers were finishing.
                applyResponse(response, true);
            })
            .catch(() => undefined);
      }),
    [api, applyResponse, lane],
  );
  useEffect(() => api.onCompassImportProgress(setImportProgress), [api]);
  useEffect(() => {
    if (!searchId) return;
    let active = true;
    const version = ++selectionVersion.current;
    void api
      .getCompassSelection(searchId)
      .then((keys) => {
        if (active && selectionVersion.current === version)
          setSelected(new Set(keys));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, searchId]);

  const updateFilters = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch, lane };
    setFilters(next);
    patchSnapshot({ filters: next });
  };
  const toggleSelected = (item: CompassResult) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(item.canonicalKey)) next.delete(item.canonicalKey);
      else if (next.size < 10_000) next.add(item.canonicalKey);
      if (searchId)
        void api
          .setCompassSelection(searchId, [...next], ++selectionVersion.current)
          .catch(() => undefined);
      return next;
    });
  const selectPage = async () => {
    if (!searchId || !lastPage.length) return;
    const keys = await api.selectCompassRange({
      searchId,
      from: lastPage.offset,
      to: lastPage.offset + lastPage.length - 1,
      selected: true,
      revision: ++selectionVersion.current,
    });
    setSelected((current) => new Set([...current, ...keys]));
  };
  const clearSelection = () => {
    setSelected(new Set());
    if (searchId)
      void api
        .setCompassSelection(searchId, [], ++selectionVersion.current)
        .catch(() => undefined);
  };
  const saveCandidate = async (item: CompassResult) => {
    if (!searchId) return;
    await api.saveCompassCandidate(searchId, item.canonicalKey);
    setSaved((current) => new Set(current).add(item.canonicalKey));
    setSavedResults((current) => uniqueResults([item, ...current]));
  };
  const dismissCandidate = async (item: CompassResult) => {
    if (!searchId) return;
    const hidden = dismissed.has(item.canonicalKey);
    await (hidden ? api.restoreCompassCandidate : api.dismissCompassCandidate)(
      searchId,
      item.canonicalKey,
    );
    setDismissed((current) => {
      const next = new Set(current);
      if (hidden) next.delete(item.canonicalKey);
      else next.add(item.canonicalKey);
      return next;
    });
  };
  const openDetail = async (item: CompassResult) => {
    setSelectedItem(item);
    if (!searchId) return;
    try {
      const detail = await api.getCompassResultDetail(
        searchId,
        item.canonicalKey,
      );
      if (detail) setSelectedItem(detail);
    } catch {
      /* summary remains useful */
    }
  };
  const findSimilar = (item: CompassResult) => {
    setQuery(item.title);
    void startSearch(
      item.title,
      "scholarly",
      searchId ? { searchId, canonicalKey: item.canonicalKey } : undefined,
    );
  };
  const importSelection = async () => {
    if (!searchId || !selected.size) return;
    const job = await api.startCompassImport({
      searchId,
      selectionRevision: selectionVersion.current,
      selection: "stored",
    });
    const progress = await api.getCompassImport(job.jobId);
    if (progress) setImportProgress(progress);
  };
  const selectHistory = async (entry: CompassSession) => {
    const response = await api.getCompassSearch(entry.searchId);
    if (response) {
      setDismissed(new Set());
      setLaneTotals({ scholarly: 0, primary: 0 });
      setQuery(entry.query);
      applyResponse(response);
    }
  };
  const selectLane = (next: CompassLane) => {
    if (next === lane) return;
    setLane(next);
    setFilters((current) => ({ ...current, lane: next }));
    patchSnapshot({ lane: next });
  };

  // Keep a just-dismissed row mounted so its accessible Restore action remains
  // available. Main omits it on the next served page.
  const visibleResults = useMemo(() => results, [results]);
  const visibleSelected = visibleResults.filter((item) =>
    selected.has(item.canonicalKey),
  ).length;
  const hiddenSelected = Math.max(0, selected.size - visibleSelected);
  const detailsAuthors = selectedItem?.authors
    .map((author) => author.name)
    .join(", ");
  const retryableSearch = providers.some(
    (provider) =>
      provider.lane === lane &&
      ["error", "offline", "rate-limited", "budget-exhausted", "temporarily-disabled", "canceled"].includes(provider.state),
  );
  const statusText =
    !online || status === "offline"
      ? "Sin conexión"
      : ((
          {
            interpreting: "Interpretando consulta…",
            queued: "En cola",
            searching: "Buscando…",
            partial: "Resultados parciales",
            complete: "Búsqueda completa",
            empty: "Sin resultados",
            "rate-limited": "Límite temporal",
            "budget-exhausted": "Presupuesto agotado",
            "partial-error": "Error parcial",
            canceled: "Búsqueda cancelada",
            error: "Error en la búsqueda",
          } as Record<string, string>
        )[status] ?? "");
  const selectedHasDownload = selectedItem
    ? "hasDownloadableFile" in selectedItem
      ? selectedItem.hasDownloadableFile
      : selectedItem.downloadLinks.some((link) => link.open)
    : false;

  return (
    <div
      data-testid="compass-view"
      data-loaded-results={results.length}
      data-last-response-offset={lastPage.offset}
      className="relative flex h-full flex-col overflow-hidden bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
    >
      <header className="shrink-0 border-b border-neutral-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-950 max-md:px-4">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
              <Icon name="compassSearch" size={22} />
            </span>
            <div>
              <h1 className="text-xl font-semibold">
                {compassT("Nodus Compass")}
              </h1>
              <p className="text-sm text-neutral-500">
                {compassT(
                  "Descubre literatura académica y fuentes primarias abiertas.",
                )}
              </p>
            </div>
          </div>
          <div className="mt-4">
            <CompassSearchBar
              value={query}
              busy={["interpreting", "queued", "searching"].includes(status)}
              onSearch={(value) => {
                setQuery(value);
                patchSnapshot({ draft: value });
                void startSearch(value);
              }}
              onCancel={() => {
                void api.cancelCompassSearch(
                  searchId ?? undefined,
                  requestId.current,
                );
                setStatus("canceled");
              }}
              ai={aiInterpret}
              onAiChange={setAiInterpret}
            />
          </div>
          <p className="mt-2 text-[11px] text-neutral-500">
            {compassT(
              "La consulta se envía directamente a los proveedores mostrados; Nodus no usa proxy.",
            )}{" "}
            {compassT("El LLM permanece apagado por defecto.")}
          </p>
          <CompassFilters
            filters={filters}
            open={filtersOpen}
            onToggle={() => setFiltersOpen((value) => !value)}
            onClear={() => {
              setFilters({ ...EMPTY_COMPASS_FILTERS, lane, sort });
            }}
            onChange={updateFilters}
          />
        </div>
      </header>
      <main className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 gap-4 p-5 max-md:flex-col max-md:p-4">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <div
            role="tablist"
            aria-label={compassT("Tipo de fuente")}
            className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800"
          >
            {(["scholarly", "primary"] as const).map((entry) => (
              <button
                key={entry}
                id={`compass-tab-${entry}`}
                role="tab"
                aria-selected={lane === entry}
                aria-controls={`compass-panel-${entry}`}
                tabIndex={lane === entry ? 0 : -1}
                className={`px-3 py-2 text-sm ${lane === entry ? "border-b-2 border-indigo-600 font-medium text-indigo-700 dark:text-indigo-300" : "text-neutral-500"}`}
                onClick={() => selectLane(entry)}
                onKeyDown={(event) => {
                  const target =
                    event.key === "ArrowLeft" || event.key === "Home"
                      ? "scholarly"
                      : event.key === "ArrowRight" || event.key === "End"
                        ? "primary"
                        : null;
                  if (!target) return;
                  event.preventDefault();
                  selectLane(target);
                  document.getElementById(`compass-tab-${target}`)?.focus();
                }}
              >
                {compassT(
                  entry === "scholarly"
                    ? "Literatura académica"
                    : "Fuentes primarias",
                )}{" "}
                <span className="ml-1 text-xs">{laneTotals[entry]}</span>
              </button>
            ))}
          </div>
          <div
            id={`compass-panel-${lane}`}
            role="tabpanel"
            aria-labelledby={`compass-tab-${lane}`}
            className="flex min-h-0 flex-1 flex-col gap-3"
          >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-3 text-xs text-neutral-500">
              <span role="status">{compassT(statusText)}</span>
              {selected.size > 0 && (
                <span>
                  {compassT("{n} seleccionados, {hidden} ocultos por filtros", {
                    n: selected.size,
                    hidden: hiddenSelected,
                  })}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <select
                aria-label={compassT("Ordenar")}
                className="input h-8 text-xs"
                value={sort}
                onChange={(event) => {
                  const next = event.target.value as NonNullable<
                    Filters["sort"]
                  >;
                  setSort(next);
                  patchSnapshot({ sort: next });
                }}
              >
                <option value="relevance">{compassT("Relevancia")}</option>
                <option value="date">{compassT("Fecha")}</option>
                <option value="citations">{compassT("Citas")}</option>
              </select>
              <CompassProviderStatus
                providers={providers}
                onRetry={
                  searchId
                    ? (provider) => {
                        void api
                          .retryCompassProvider(searchId, provider)
                          .then((response) => applyResponse(response));
                      }
                    : undefined
                }
              />
              {retryableSearch && searchId && (
                <button
                  className="btn btn-ghost h-8 text-xs"
                  onClick={() =>
                    void api
                      .retryCompassSearch(searchId)
                      .then((response) => applyResponse(response))
                  }
                >
                  {compassT("Reintentar búsqueda")}
                </button>
              )}
            </div>
          </div>
          {visibleResults.length > 0 && (
            <div className="flex gap-2 text-xs">
              <button
                className="btn btn-ghost h-8 text-xs"
                onClick={() => void selectPage()}
              >
                {compassT("Seleccionar página")}
              </button>
              {selected.size > 0 && (
                <button className="text-neutral-500" onClick={clearSelection}>
                  {compassT("Limpiar selección")}
                </button>
              )}
            </div>
          )}
          <CompassResultList
            results={visibleResults}
            selected={selected}
            saved={saved}
            dismissed={dismissed}
            onToggle={toggleSelected}
            onOpen={(item) => void openDetail(item)}
            onSave={(item) => void saveCandidate(item)}
            onDismiss={(item) => void dismissCandidate(item)}
            onSimilar={findSimilar}
            anchorId={anchorId}
            onAnchorChange={(key) =>
              setScrollAnchors((current) => {
                const next = {
                  ...current,
                  [lane]: key ? { key, offset: 0 } : undefined,
                };
                patchSnapshot({ scrollAnchors: next });
                return next;
              })
            }
          />
          {hasMore && (
            <button
              data-testid="compass-load-more"
              className="btn btn-ghost h-9 self-center text-xs"
              disabled={["interpreting", "queued", "searching"].includes(
                status,
              )}
              onClick={() => void loadMore()}
            >
              <Icon name="download" size={14} /> {compassT("Cargar más")}
            </button>
          )}
          </div>
        </section>
        <aside className="w-56 shrink-0 max-md:w-full">
          <CompassHistoryPanel
            entries={history}
            saved={savedResults}
            onSelect={(entry) => void selectHistory(entry)}
            onSavedSelect={setSelectedItem}
            onDelete={(id) =>
              void api
                .deleteCompassHistory(id)
                .then(() =>
                  setHistory((items) =>
                    items.filter((item) => item.searchId !== id),
                  ),
                )
            }
            onClear={() =>
              void api.clearCompassHistory().then(() => setHistory([]))
            }
          />
          {selected.size > 0 && (
            <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-900 dark:bg-indigo-500/10">
              <p className="text-xs font-medium text-indigo-800 dark:text-indigo-200">
                {compassT("{n} seleccionados", { n: selected.size })}
              </p>
              <button
                className="btn btn-primary mt-2 h-8 w-full text-xs"
                onClick={() => void importSelection()}
              >
                {compassT("Importar selección")}
              </button>
            </div>
          )}
        </aside>
      </main>
      {selectedItem && (
        <div
          ref={detailsModal.dialogRef}
          tabIndex={-1}
          onKeyDown={detailsModal.onKeyDown}
          role="dialog"
          aria-modal="true"
          aria-labelledby="compass-details-title"
          className="fixed inset-0 z-40 grid place-items-center bg-black/25 p-4"
          onClick={() => setSelectedItem(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-5 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex justify-between gap-3">
              <div>
                <p className="text-xs uppercase text-indigo-600">
                  {compassT(TYPE_LABELS[selectedItem.type])}
                </p>
                <h2
                  id="compass-details-title"
                  className="text-lg font-semibold"
                >
                  {selectedItem.title}
                </h2>
              </div>
              <button
                className="icon-btn"
                aria-label={compassT("Cerrar")}
                onClick={() => setSelectedItem(null)}
              >
                <Icon name="x" size={16} />
              </button>
            </div>
            <p className="mt-2 text-sm text-neutral-500">
              {detailsAuthors}
              {selectedItem.issuedYear ? ` · ${selectedItem.issuedYear}` : ""}
            </p>
            {"abstract" in selectedItem && selectedItem.abstract && (
              <p className="mt-4 whitespace-pre-wrap text-sm leading-6">
                {selectedItem.abstract}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              {selectedItem.openAccess && (
                <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">
                  {compassT("Acceso abierto")}
                </span>
              )}
              {selectedHasDownload && (
                <span>{compassT("Archivo abierto verificado")}</span>
              )}
              {selectedItem.identifiers.map((identifier) => (
                <span
                  key={`${identifier.scheme}:${identifier.value}`}
                  className="rounded bg-neutral-100 px-2 py-1 dark:bg-neutral-800"
                >
                  {identifier.scheme}: {identifier.value}
                </span>
              ))}
            </div>
            <ul className="mt-4 space-y-1 text-sm">
              {selectedItem.reasons.map((reason, index) => (
                <li key={`${reason.code}:${index}`}>• {reasonLabel(reason)}</li>
              ))}
            </ul>
            <div className="mt-5 flex gap-2">
              {selectedItem.landingUrl && (
                <button
                  className="btn btn-ghost h-8 text-xs"
                  onClick={() => {
                    try {
                      const url = new URL(selectedItem.landingUrl!);
                      if (["http:", "https:"].includes(url.protocol))
                        void window.nodus.openExternal(url.toString());
                    } catch {
                      /* Provider URL was invalidated before navigation. */
                    }
                  }}
                >
                  {compassT("Abrir fuente")}
                </button>
              )}
            </div>
            <div className="mt-5 text-xs text-neutral-500">
              {selectedItem.provenance.map((source) => (
                <p key={`${source.provider}:${source.providerId}`}>
                  {source.provider}
                  {source.attribution ? ` · ${source.attribution}` : ""}
                  {source.metadataLicense ? ` · ${source.metadataLicense}` : ""}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}
      <CompassImportDialog
        progress={importProgress}
        onCancel={() => {
          if (importProgress)
            void api.cancelCompassImport(importProgress.job.jobId);
        }}
        onRetry={() => {
          if (importProgress)
            void api.retryCompassImport(importProgress.job.jobId);
        }}
        onClose={() => setImportProgress(null)}
      />
    </div>
  );
}
