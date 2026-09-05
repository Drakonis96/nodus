import { StellarWorkspace } from '../../stellarGraph/StellarWorkspace';
import { webStellarSource } from '../../stellarGraph/webSource';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Icon } from "../../components/ui";
import { advancedRest, type AuthorsQuery, type IdeasQuery } from "./api";
import {
  type AdvancedAuthor,
  type AdvancedAuthorDossier,
  type AdvancedIdea,
  type AdvancedIdeaDetail,
  type AdvancedPage,
} from "./types";
import { AcademicDetailExplorer } from "../academic/AcademicDetailExplorer";
import { errorText, getActiveLang, t, tx } from "../i18nShim";

type Surface = "ideas" | "authors" | "graph";


const IDEA_TYPES = [
  "",
  "claim",
  "finding",
  "construct",
  "method",
  "framework",
] as const;
const IDEA_SORTS = [
  "label",
  "type",
  "works",
  "connections",
  "confidence",
] as const;
const AUTHOR_SORTS = [
  "surname",
  "name",
  "works",
  "ideas",
  "connections",
] as const;

function stringValue(value: unknown, fallback = "—"): string {
  if (value === null || value === undefined || value === "") return t(fallback);
  return typeof value === "string" ? value : String(value);
}

function authorHeading(dossier: AdvancedAuthorDossier): string {
  return stringValue(
    dossier.fullName || dossier.author.name,
    "Autor sin nombre",
  );
}

function formatNumber(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString(getActiveLang()) : "0";
}

function ErrorMessage({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  return (
    <div
      className="rounded-xl border border-red-800/70 bg-red-950/30 p-4 text-sm text-red-300"
      role="alert"
    >
      <strong>{t("No se ha podido cargar el contenido publicado.")}</strong>
      <p className="mt-1 text-xs opacity-80">
        {errorText(error)}
      </p>
      {onRetry && (
        <button className="btn btn-ghost mt-3 text-xs" onClick={onRetry}>
          {t("Reintentar")}
        </button>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div
      className="grid min-h-40 place-items-center text-sm text-neutral-500"
      role="status"
    >
      {t("Cargando…")}
    </div>
  );
}

function ReadOnlyBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-teal-800/70 bg-teal-950/35 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-teal-300">
      <Icon name="lock" size={11} /> {t("Solo lectura")}
    </span>
  );
}

function Section({
  title,
  icon,
  children,
  testId,
}: {
  title: string;
  icon?: string;
  children: ReactNode;
  testId?: string;
}) {
  const translatedTitle = title.replace(
    /\((\d+)\)$/,
    (_match, count: string) => `(${count})`,
  );
  const titleKey = title.replace(/\(\d+\)$/, "({n})");
  return (
    <section
      data-testid={testId}
      className="rounded-xl border border-neutral-800 bg-neutral-950/45 p-4"
    >
      <div className="mb-3 flex items-center gap-2">
        <Icon name={icon ?? "layers"} size={15} className="text-indigo-300" />
        <h3 className="text-sm font-semibold text-neutral-100">
          {titleKey !== title
            ? tx(titleKey, { n: title.match(/\((\d+)\)$/)?.[1] ?? "" })
            : t(translatedTitle)}
        </h3>
      </div>
      {children}
    </section>
  );
}

function _PageControls({
  page,
  onPage,
}: {
  page: AdvancedPage<unknown>;
  onPage: (offset: number) => void;
}) {
  const current = page.limit ? Math.floor(page.offset / page.limit) + 1 : 1;
  const totalPages = page.limit
    ? Math.max(1, Math.ceil(page.total / page.limit))
    : 1;
  return (
    <div
      className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500"
      data-testid="advanced-pagination"
    >
      <span>
        {page.total
          ? `${page.offset + 1}–${Math.min(page.total, page.offset + page.items.length)} de ${page.total}`
          : t("Sin resultados")}
      </span>
      <div className="flex items-center gap-2">
        <button
          className="btn btn-ghost text-xs"
          disabled={page.offset <= 0}
          onClick={() => onPage(Math.max(0, page.offset - page.limit))}
          aria-label={t("Página anterior")}
        >
          ‹
        </button>
        <span>
          {t("Página")} {current} / {totalPages}
        </span>
        <button
          className="btn btn-ghost text-xs"
          disabled={!page.hasMore}
          onClick={() => onPage(page.offset + page.limit)}
          aria-label={t("Página siguiente")}
        >
          ›
        </button>
      </div>
    </div>
  );
}

function _IdeaCard({
  idea,
  onOpen,
}: {
  idea: AdvancedIdea;
  onOpen: () => void;
}) {
  return (
    <button
      className="server-record-card flex items-start gap-3"
      onClick={onOpen}
      data-testid="advanced-idea-card"
    >
      <span className="server-record-icon">
        <Icon name="bulb" />
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-sm text-neutral-200">
          {idea.label}
        </strong>
        <span className="mt-1 block text-[11px] uppercase tracking-wide text-indigo-300">
          {idea.type}
        </span>
        <small className="mt-1 line-clamp-2 block text-xs leading-5 text-neutral-500">
          {idea.statement || t("Sin enunciado publicado")}
        </small>
        <span className="mt-2 block text-[11px] text-neutral-600">
          {formatNumber(idea.workCount)} {t("obras")} ·{" "}
          {formatNumber(idea.connectionCount)} {t("conexiones")}
        </span>
      </span>
      <Icon name="chevronRight" size={14} className="mt-2 text-neutral-700" />
    </button>
  );
}

function _IdeaDetail({
  detail,
  onBack,
}: {
  detail: AdvancedIdeaDetail;
  onBack: () => void;
}) {
  const idea = detail.idea;
  return (
    <div className="space-y-4" data-testid="advanced-idea-detail">
      <button
        className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-200"
        onClick={onBack}
      >
        <Icon name="chevronLeft" size={13} />
        {t("Volver a Ideas")}
      </button>
      <header className="rounded-2xl border border-indigo-800/60 bg-indigo-950/25 p-5">
        <div className="flex flex-wrap items-start gap-3">
          <span className="server-record-icon">
            <Icon name="bulb" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[.18em] text-indigo-300">
              {stringValue(idea.type, "claim")}
            </div>
            <h2 className="mt-1 text-xl font-semibold text-neutral-100">
              {stringValue(idea.label, "Idea sin título")}
            </h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-400">
              {stringValue(idea.statement, "Sin enunciado publicado")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {detail.themes.map((theme) => (
                <span
                  key={theme}
                  className="rounded-full border border-amber-800/60 px-2 py-1 text-[11px] text-amber-300"
                >
                  {theme}
                </span>
              ))}
            </div>
          </div>
          <ReadOnlyBadge />
        </div>
      </header>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Section
          title={`Obras y ocurrencias (${detail.occurrences.length})`}
          icon="book"
        >
          <div className="space-y-2">
            {detail.occurrences.length ? (
              detail.occurrences.map((entry, index) => (
                <article
                  key={`${stringValue(entry.nodus_id, String(index))}-${index}`}
                  className="rounded-lg border border-neutral-800 p-3"
                >
                  <strong className="text-sm text-neutral-200">
                    {stringValue(
                      entry.workTitle ?? entry.nodus_id,
                      "Obra publicada",
                    )}
                  </strong>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-neutral-500">
                    {stringValue(
                      entry.development ?? entry.context,
                      "Sin desarrollo publicado",
                    )}
                  </p>
                  <span className="mt-1 block text-[11px] text-neutral-600">
                    {stringValue(entry.role, "secondary")} · {t("confianza")}{" "}
                    {stringValue(entry.confidence, "—")}
                  </span>
                </article>
              ))
            ) : (
              <p className="text-xs text-neutral-600">
                {t("No hay ocurrencias publicadas.")}
              </p>
            )}
          </div>
        </Section>
        <Section title={`Evidencia (${detail.evidence.length})`} icon="quote">
          <div className="space-y-2">
            {detail.evidence.length ? (
              detail.evidence.map((entry, index) => (
                <blockquote
                  key={`${index}-${stringValue(entry.id)}`}
                  className="rounded-r-lg border-l-2 border-indigo-500 bg-neutral-900/55 px-3 py-2 text-sm italic leading-6 text-neutral-300"
                >
                  “
                  {stringValue(
                    entry.quote ?? entry.text,
                    "Evidencia sin texto",
                  )}
                  ”
                  <span className="mt-1 block text-[11px] not-italic text-neutral-600">
                    {stringValue(entry.location ?? entry.source_ref, "")}
                  </span>
                </blockquote>
              ))
            ) : (
              <p className="text-xs text-neutral-600">
                {t("No hay evidencia anclada publicada.")}
              </p>
            )}
          </div>
        </Section>
        <Section title={`Relaciones (${detail.relations.length})`} icon="share">
          <div className="space-y-2">
            {detail.relations.length ? (
              detail.relations.map((entry, index) => (
                <div
                  key={`${stringValue(entry.id, String(index))}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-800 px-3 py-2 text-xs"
                >
                  <span className="text-neutral-300">
                    {stringValue(entry.type, "relación")}
                  </span>
                  <span className="text-neutral-500">
                    {stringValue(entry.from_id)} → {stringValue(entry.to_id)}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-xs text-neutral-600">
                {t("No hay relaciones visibles.")}
              </p>
            )}
          </div>
        </Section>
        <Section title="Metadatos publicados" icon="info">
          <dl className="server-detail-list">
            {Object.entries(idea)
              .filter(
                ([, value]) =>
                  value !== null &&
                  value !== undefined &&
                  typeof value !== "object",
              )
              .slice(0, 20)
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{key.replace(/_/g, " ")}</dt>
                  <dd>{stringValue(value)}</dd>
                </div>
              ))}
          </dl>
        </Section>
      </div>
    </div>
  );
}

export function IdeasServerView({
  spaceId,
  csrfToken: _csrfToken,
}: {
  spaceId: string;
  csrfToken?: string;
}) {
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<IdeasQuery>({
    offset: 0,
    limit: 80,
    sort: "label",
  });
  const [page, setPage] = useState<AdvancedPage<AdvancedIdea>>({
    items: [],
    total: 0,
    offset: 0,
    limit: 80,
    hasMore: false,
  });
  const [detail, setDetail] = useState<AdvancedIdeaDetail | null>(null);
  const [openTabs, setOpenTabs] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const listRequest = useRef(0);
  const detailRequest = useRef(0);

  const load = useCallback(async () => {
    const request = ++listRequest.current;
    setLoading(true);
    setError(undefined);
    try {
      const next = await advancedRest.ideas(spaceId, filters);
      if (request === listRequest.current) setPage(next);
    } catch (cause) {
      if (request === listRequest.current) setError(cause);
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  }, [filters, spaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  const open = useCallback(
    async (idea: Pick<AdvancedIdea, "id" | "label">) => {
      const request = ++detailRequest.current;
      setOpenTabs((tabs) =>
        tabs.some((tab) => tab.id === idea.id)
          ? tabs
          : [...tabs, { id: idea.id, label: idea.label }],
      );
      setActiveId(idea.id);
      setError(undefined);
      try {
        const next = await advancedRest.idea(spaceId, idea.id);
        if (request === detailRequest.current) setDetail(next);
      } catch (cause) {
        if (request === detailRequest.current) setError(cause);
      }
    },
    [spaceId],
  );
  const showCatalog = () => {
    detailRequest.current += 1;
    setActiveId(null);
    setDetail(null);
  };
  const closeTab = (id: string) => {
    setOpenTabs((tabs) => tabs.filter((tab) => tab.id !== id));
    if (activeId === id) showCatalog();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFilters((current) => ({
      ...current,
      offset: 0,
      q: query.trim() || undefined,
    }));
  };

  const activeSort = filters.sort ?? "label";
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
      data-testid="advanced-ideas-view"
    >
      <header className="shrink-0 border-b border-neutral-200 px-5 pt-4 dark:border-neutral-800">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            <Icon name="bulb" size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold">{t("Ideas")}</h1>
            <p className="text-[11px] text-neutral-500">
              {formatNumber(page.total)} {t("ideas extraídas")}
            </p>
          </div>
          <div className="flex-1" />
          <ReadOnlyBadge />
        </div>
        <div
          data-testid="advanced-ideas-tabs"
          className="flex min-w-0 items-end gap-1 overflow-x-auto"
        >
          <button
            className={`flex h-9 shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-3 text-xs ${!activeId ? "border-neutral-300 bg-white text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100" : "border-transparent text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900/60"}`}
            onClick={showCatalog}
          >
            <Icon name="list" size={13} /> {t("Ideas")}
          </button>
          {openTabs.map((tab) => (
            <div
              key={tab.id}
              className={`flex h-9 min-w-0 shrink-0 items-center rounded-t-lg border border-b-0 ${activeId === tab.id ? "border-neutral-300 bg-white text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100" : "border-transparent text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900/60"}`}
            >
              <button
                className="flex h-full max-w-80 min-w-0 items-center gap-2 px-3 text-xs"
                onClick={() => void open(tab)}
              >
                <Icon name="bulb" size={13} />
                <span className="truncate">{tab.label}</span>
              </button>
              <button
                className="mr-1 grid h-6 w-6 place-items-center rounded hover:bg-neutral-200 dark:hover:bg-neutral-800"
                aria-label={`${t("Cerrar")} ${tab.label}`}
                onClick={() => closeTab(tab.id)}
              >
                <Icon name="x" size={11} />
              </button>
            </div>
          ))}
        </div>
      </header>
      <main className="min-h-0 flex-1">
        {activeId ? (
          <div className="h-full overflow-auto p-4">
            <AcademicDetailExplorer
              key={activeId}
              spaceId={spaceId}
              origin={t("Ideas")}
              initialTarget={{
                kind: "idea",
                id: activeId,
                label:
                  openTabs.find((tab) => tab.id === activeId)?.label ??
                  String(detail?.idea.label ?? activeId),
              }}
              onOrigin={showCatalog}
            />
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <form
              className="shrink-0 border-b border-neutral-200 p-3 dark:border-neutral-800"
              onSubmit={submit}
            >
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[240px] flex-1">
                  <Icon
                    name="search"
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
                  />
                  <input
                    data-testid="advanced-ideas-search"
                    className="input input-with-leading-icon w-full"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("Buscar ideas…")}
                  />
                </div>
                <button
                  type="button"
                  className={`btn border border-neutral-300 dark:border-neutral-700 ${filtersOpen || filters.type ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300" : "btn-ghost"}`}
                  onClick={() => setFiltersOpen((value) => !value)}
                >
                  <Icon name="filter" /> {t("Filtros")}
                </button>
              </div>
              {filtersOpen && (
                <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl bg-neutral-50 p-2 dark:bg-neutral-900/55">
                  <label className="flex items-center gap-2 text-xs text-neutral-500">
                    {t("Tipo")}
                    <select
                      className="input h-8 text-xs"
                      value={filters.type ?? ""}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          offset: 0,
                          type: event.target.value || undefined,
                        }))
                      }
                    >
                      {IDEA_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type || t("Todos los tipos")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-neutral-500">
                    {t("Ordenar")}
                    <select
                      className="input h-8 text-xs"
                      value={activeSort}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          offset: 0,
                          sort: event.target.value as IdeasQuery["sort"],
                        }))
                      }
                    >
                      {IDEA_SORTS.map((sort) => (
                        <option key={sort} value={sort}>
                          {sort === "label" ? t("Nombre") : t(sort)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </form>
            <div
              className="min-h-0 flex-1 overflow-auto"
              data-testid="ideas-table-scroll"
            >
              <div className="min-w-[1080px]" data-testid="ideas-catalog-table">
                <div
                  className="grid h-11 items-center border-b border-neutral-200 px-4 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800 dark:text-neutral-600"
                  style={{
                    gridTemplateColumns:
                      "minmax(360px,2.4fr) 8rem 6.5rem 7.5rem 7rem minmax(220px,1.35fr) 2rem",
                  }}
                >
                  <span>{t("Idea")}</span>
                  <span>{t("Tipo")}</span>
                  <span>{t("Nº de obras")}</span>
                  <span>{t("Nº de conexiones")}</span>
                  <span>{t("Confianza")}</span>
                  <span>{t("Temas")}</span>
                  <span />
                </div>
                {error ? (
                  <ErrorMessage error={error} onRetry={() => void load()} />
                ) : loading ? (
                  <Loading />
                ) : page.items.length === 0 ? (
                  <div className="grid h-48 place-items-center text-sm text-neutral-500">
                    {t("No hay ideas publicadas con estos filtros.")}
                  </div>
                ) : (
                  page.items.map((idea) => (
                    <button
                      key={idea.id}
                      data-testid="advanced-idea-card"
                      className="grid min-h-[88px] w-full items-center border-b border-neutral-100 px-4 py-3 text-left text-xs transition-colors hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/55"
                      style={{
                        gridTemplateColumns:
                          "minmax(360px,2.4fr) 8rem 6.5rem 7.5rem 7rem minmax(220px,1.35fr) 2rem",
                      }}
                      onClick={() => void open(idea)}
                    >
                      <div className="flex min-w-0 items-center gap-2 pr-5">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-indigo-500" />
                        <div className="min-w-0">
                          <span className="block truncate font-medium text-neutral-900 dark:text-neutral-200">
                            {idea.label}
                          </span>
                          <span className="mt-1 block line-clamp-2 text-[11px] leading-relaxed text-neutral-500">
                            {idea.statement}
                          </span>
                        </div>
                      </div>
                      <span className="text-neutral-600 dark:text-neutral-400">
                        {idea.type}
                      </span>
                      <span className="tabular-nums text-neutral-600 dark:text-neutral-400">
                        {idea.workCount}
                      </span>
                      <span className="tabular-nums text-neutral-600 dark:text-neutral-400">
                        {idea.connectionCount}
                      </span>
                      <span className="tabular-nums text-neutral-600 dark:text-neutral-400">
                        {idea.maxConfidence.toFixed(2)}
                      </span>
                      <span className="flex min-w-0 flex-wrap gap-1 pr-3">
                        {idea.themes.slice(0, 3).map((theme) => (
                          <span
                            key={theme}
                            className="max-w-36 truncate rounded-full bg-neutral-100 px-2 py-1 text-[10px] text-neutral-600 dark:bg-neutral-900 dark:text-neutral-500"
                          >
                            {theme}
                          </span>
                        ))}
                      </span>
                      <Icon
                        name="chevronRight"
                        size={14}
                        className="text-neutral-400 dark:text-neutral-600"
                      />
                    </button>
                  ))
                )}
              </div>
            </div>
            <footer className="flex h-10 shrink-0 items-center border-t border-neutral-200 px-3 text-xs text-neutral-500 dark:border-neutral-800">
              <span>
                {page.total
                  ? `${page.offset + 1}–${Math.min(page.total, page.offset + page.items.length)} / ${page.total}`
                  : "0"}
              </span>
              <div className="flex-1" />
              <button
                className="btn btn-ghost h-7"
                disabled={page.offset <= 0}
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    offset: Math.max(0, page.offset - page.limit),
                  }))
                }
              >
                <Icon name="chevronLeft" size={13} />
              </button>
              <button
                className="btn btn-ghost h-7"
                disabled={!page.hasMore}
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    offset: page.offset + page.limit,
                  }))
                }
              >
                <Icon name="chevronRight" size={13} />
              </button>
            </footer>
          </div>
        )}
      </main>
    </div>
  );
}

function _AuthorCard({
  author,
  onOpen,
}: {
  author: AdvancedAuthor;
  onOpen: () => void;
}) {
  return (
    <button
      className="server-record-card flex items-start gap-3"
      onClick={onOpen}
      data-testid="advanced-author-card"
    >
      <span className="server-record-icon">
        <Icon name="graduation" />
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-sm text-neutral-200">
          {author.fullName || author.name}
        </strong>
        <small className="mt-1 block truncate text-xs text-neutral-500">
          {author.affiliation || t("Afiliación no publicada")}
        </small>
        <span className="mt-2 block text-[11px] text-neutral-600">
          {formatNumber(author.workCount)} {t("obras")} ·{" "}
          {formatNumber(author.ideaCount)} {t("ideas")} ·{" "}
          {formatNumber(author.relationCount)} {t("conexiones")}
        </span>
        <span className="mt-2 flex flex-wrap gap-1">
          {author.topThemes.slice(0, 3).map((theme) => (
            <span
              key={theme}
              className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-amber-300"
            >
              {theme}
            </span>
          ))}
        </span>
      </span>
      <Icon name="chevronRight" size={14} className="mt-2 text-neutral-700" />
    </button>
  );
}

function Synthesis({
  synthesis,
}: {
  synthesis: AdvancedAuthorDossier["synthesis"];
}) {
  if (!synthesis)
    return (
      <p className="text-xs text-neutral-600">
        {t("No hay síntesis publicada para este autor.")}
      </p>
    );
  return (
    <div data-testid="advanced-author-synthesis" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-teal-800/60 px-2 py-1 text-[10px] uppercase tracking-wide text-teal-300">
          {t("Síntesis publicada")}
        </span>
        {synthesis.stale && (
          <span className="rounded-full border border-amber-800/60 px-2 py-1 text-[10px] text-amber-300">
            {t("Puede estar desactualizada")}
          </span>
        )}
      </div>
      <p className="text-sm leading-6 text-neutral-300">
        {synthesis.thesis || t("Sin tesis publicada.")}
      </p>
      {synthesis.remember.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-neutral-400">
          {synthesis.remember.map((entry, index) => (
            <li key={`${index}-${entry}`}>{entry}</li>
          ))}
        </ul>
      )}
      {synthesis.positioning && (
        <p className="border-t border-neutral-800 pt-3 text-xs leading-5 text-neutral-500">
          {synthesis.positioning}
        </p>
      )}
      <p className="text-[10px] text-neutral-600">
        {t("Generada:")} {stringValue(synthesis.generatedAt)}
      </p>
    </div>
  );
}

function _AuthorDossier({
  dossier,
  onBack,
  privateSynthesis: _privateSynthesis,
}: {
  dossier: AdvancedAuthorDossier;
  onBack: () => void;
  privateSynthesis?: ReactNode;
}) {
  return (
    <div className="space-y-4" data-testid="advanced-author-dossier">
      <button
        className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-200"
        onClick={onBack}
      >
        <Icon name="chevronLeft" size={13} />
        {t("Volver a Autores")}
      </button>
      <header className="rounded-2xl border border-indigo-800/60 bg-indigo-950/25 p-5">
        <div className="flex flex-wrap items-start gap-3">
          <span className="server-record-icon">
            <Icon name="graduation" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold text-neutral-100">
              {authorHeading(dossier)}
            </h2>
            <p className="mt-1 text-xs text-neutral-500">
              {stringValue(
                dossier.author.affiliation,
                "Afiliación no publicada",
              )}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {dossier.themes.map((theme) => (
                <span
                  key={theme}
                  className="rounded-full border border-amber-800/60 px-2 py-1 text-[11px] text-amber-300"
                >
                  {theme}
                </span>
              ))}
            </div>
          </div>
          <ReadOnlyBadge />
        </div>
      </header>
      <Section title="Síntesis publicada" icon="sparkles">
        <Synthesis synthesis={dossier.synthesis} />
      </Section>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Section title={`Obras (${dossier.works.length})`} icon="book">
          {dossier.works.length ? (
            <div className="space-y-2">
              {dossier.works.map((work) => (
                <article
                  key={work.nodus_id}
                  className="rounded-lg border border-neutral-800 p-3"
                >
                  <strong className="text-sm text-neutral-200">
                    {work.title}
                  </strong>
                  <p className="mt-1 text-xs text-neutral-500">
                    {stringValue(work.year, "Año desconocido")} ·{" "}
                    {work.itemType || t("obra")} ·{" "}
                    {work.read ? t("Leída") : t("No marcada como leída")}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-xs text-neutral-600">
              {t("No hay obras de autoría publicadas.")}
            </p>
          )}
        </Section>
        <Section title={`Ideas (${dossier.ideas.length})`} icon="bulb">
          {dossier.ideas.length ? (
            <div className="space-y-2">
              {dossier.ideas.map((idea) => (
                <article
                  key={`${idea.global_id}-${idea.workId}`}
                  className="rounded-lg border border-neutral-800 p-3"
                >
                  <strong className="text-sm text-neutral-200">
                    {idea.label}
                  </strong>
                  <p className="mt-1 line-clamp-3 text-xs leading-5 text-neutral-500">
                    {idea.statement || idea.development}
                  </p>
                  <span className="mt-1 block text-[11px] text-neutral-600">
                    {idea.workTitle} · {idea.role} · {t("confianza")}{" "}
                    {idea.confidence.toFixed(2)}
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-xs text-neutral-600">
              {t("No hay ideas publicadas.")}
            </p>
          )}
        </Section>
        <Section
          title={`Relaciones autorales (${dossier.relations.length})`}
          icon="share"
        >
          {dossier.relations.length ? (
            <div className="space-y-2">
              {dossier.relations.map((relation) => (
                <div
                  key={`${relation.author_id}-${relation.type}`}
                  className="flex flex-wrap justify-between gap-2 rounded-lg border border-neutral-800 px-3 py-2 text-xs"
                >
                  <span className="text-neutral-300">{relation.name}</span>
                  <span className="text-neutral-500">
                    {relation.type} · {t("peso")} {relation.weight}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-neutral-600">
              {t("No hay relaciones visibles.")}
            </p>
          )}
        </Section>
      </div>
      {dossier.editedWorks.length > 0 && (
        <Section
          title={`Obras editadas (${dossier.editedWorks.length})`}
          icon="book"
        >
          <div className="space-y-1 text-xs text-neutral-500">
            {dossier.editedWorks.map((work) => (
              <div key={work.nodus_id}>
                {work.title}{" "}
                <span className="text-neutral-700">· {t("edición")}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

export function AuthorsServerView({
  spaceId,
  csrfToken: _csrfToken,
  renderPrivateSynthesis: _renderPrivateSynthesis,
}: {
  spaceId: string;
  csrfToken?: string;
  renderPrivateSynthesis?: (dossier: AdvancedAuthorDossier) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<AuthorsQuery>({
    offset: 0,
    limit: 80,
    sort: "surname",
    synthesis: "all",
  });
  const [page, setPage] = useState<AdvancedPage<AdvancedAuthor>>({
    items: [],
    total: 0,
    offset: 0,
    limit: 80,
    hasMore: false,
  });
  const [dossier, setDossier] = useState<AdvancedAuthorDossier | null>(null);
  const [openTabs, setOpenTabs] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const load = useCallback(async () => {
    const request = ++listRequest.current;
    setLoading(true);
    setError(undefined);
    try {
      const next = await advancedRest.authors(spaceId, filters);
      if (request === listRequest.current) setPage(next);
    } catch (cause) {
      if (request === listRequest.current) setError(cause);
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  }, [filters, spaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  const open = useCallback(
    async (author: Pick<AdvancedAuthor, "author_id" | "name" | "fullName">) => {
      const request = ++detailRequest.current;
      setOpenTabs((tabs) =>
        tabs.some((tab) => tab.id === author.author_id)
          ? tabs
          : [
              ...tabs,
              { id: author.author_id, label: author.fullName || author.name },
            ],
      );
      setActiveId(author.author_id);
      setError(undefined);
      try {
        const next = await advancedRest.authorDossier(
          spaceId,
          author.author_id,
        );
        if (request === detailRequest.current) setDossier(next);
      } catch (cause) {
        if (request === detailRequest.current) setError(cause);
      }
    },
    [spaceId],
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFilters((current) => ({
      ...current,
      offset: 0,
      q: query.trim() || undefined,
    }));
  };
  const showCatalog = () => {
    detailRequest.current += 1;
    setActiveId(null);
    setDossier(null);
  };
  const closeTab = (id: string) => {
    setOpenTabs((tabs) => tabs.filter((tab) => tab.id !== id));
    if (activeId === id) showCatalog();
  };
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
      data-testid="advanced-authors-view"
    >
      <header className="shrink-0 border-b border-neutral-200 px-5 pt-4 dark:border-neutral-800">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            <Icon name="graduation" size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold">{t("Autores")}</h1>
            <p className="text-[11px] text-neutral-500">
              {t("Autores, documentos y red autoral.")}
            </p>
          </div>
          <div className="flex-1" />
          <ReadOnlyBadge />
        </div>
        <div
          data-testid="advanced-authors-tabs"
          className="flex min-w-0 items-end gap-1 overflow-x-auto"
        >
          <button
            className={`flex h-9 shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-3 text-xs ${!activeId ? "border-neutral-300 bg-white text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100" : "border-transparent text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900/60"}`}
            onClick={showCatalog}
          >
            <Icon name="list" size={13} /> {t("Autores")}
          </button>
          {openTabs.map((tab) => (
            <div
              key={tab.id}
              className={`flex h-9 shrink-0 items-center rounded-t-lg border border-b-0 ${activeId === tab.id ? "border-neutral-300 bg-white text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100" : "border-transparent text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900/60"}`}
            >
              <button
                className="flex h-full max-w-64 items-center gap-2 px-3 text-xs"
                onClick={() =>
                  void open({
                    author_id: tab.id,
                    name: tab.label,
                    fullName: tab.label,
                  })
                }
              >
                <Icon name="user" size={13} />
                <span className="truncate">{tab.label}</span>
              </button>
              <button
                className="mr-1 grid h-6 w-6 place-items-center rounded hover:bg-neutral-200 dark:hover:bg-neutral-800"
                aria-label={`${t("Cerrar")} ${tab.label}`}
                onClick={() => closeTab(tab.id)}
              >
                <Icon name="x" size={11} />
              </button>
            </div>
          ))}
        </div>
      </header>
      {activeId ? (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <AcademicDetailExplorer
            key={activeId}
            spaceId={spaceId}
            origin={t("Autores")}
            initialTarget={{
              kind: "author",
              id: activeId,
              label:
                openTabs.find((tab) => tab.id === activeId)?.label ??
                dossier?.fullName ??
                activeId,
            }}
            onOrigin={showCatalog}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <form
            className="shrink-0 border-b border-neutral-200 p-3 dark:border-neutral-800"
            onSubmit={submit}
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[240px] flex-1">
                <Icon
                  name="search"
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
                />
                <input
                  data-testid="advanced-authors-search"
                  className="input input-with-leading-icon w-full"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("Buscar autor…")}
                />
              </div>
              <button
                type="button"
                className={`btn border border-neutral-300 dark:border-neutral-700 ${filtersOpen || filters.synthesis !== "all" ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300" : "btn-ghost"}`}
                onClick={() => setFiltersOpen((value) => !value)}
              >
                <Icon name="filter" /> {t("Filtros")}
              </button>
            </div>
            {filtersOpen && (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-neutral-50 p-2 dark:bg-neutral-900/55">
                <label className="flex items-center gap-2 text-xs text-neutral-500">
                  {t("Síntesis")}
                  <select
                    className="input h-8 text-xs"
                    value={filters.synthesis ?? "all"}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        offset: 0,
                        synthesis: event.target
                          .value as AuthorsQuery["synthesis"],
                      }))
                    }
                  >
                    <option value="all">{t("Todas")}</option>
                    <option value="with">{t("Con síntesis")}</option>
                    <option value="without">{t("Sin síntesis")}</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs text-neutral-500">
                  {t("Ordenar")}
                  <select
                    className="input h-8 text-xs"
                    value={filters.sort ?? "surname"}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        offset: 0,
                        sort: event.target.value as AuthorsQuery["sort"],
                      }))
                    }
                  >
                    {AUTHOR_SORTS.map((sort) => (
                      <option key={sort} value={sort}>
                        {t(sort)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </form>
          <div
            className="min-h-0 flex-1 overflow-auto"
            data-testid="authors-table-scroll"
          >
            <div className="min-w-[1050px]">
              <div
                className="grid h-10 items-center border-b border-neutral-200 px-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800 dark:text-neutral-600"
                style={{
                  gridTemplateColumns:
                    "2.25rem minmax(130px,1fr) minmax(150px,1.15fr) 5.5rem 5.5rem 7rem minmax(220px,1.6fr) 6rem 2.5rem",
                }}
              >
                <span />
                <span>{t("Nombre")}</span>
                <span>{t("Apellidos")}</span>
                <span>{t("Nº de obras")}</span>
                <span>{t("Nº de ideas")}</span>
                <span>{t("Nº de conexiones")}</span>
                <span>{t("Etiquetas")}</span>
                <span>{t("Síntesis")}</span>
                <span />
              </div>
              {error ? (
                <ErrorMessage error={error} onRetry={() => void load()} />
              ) : loading ? (
                <Loading />
              ) : page.items.length === 0 ? (
                <div className="grid h-48 place-items-center text-sm text-neutral-500">
                  {t("No hay autores todavía.")}
                </div>
              ) : (
                page.items.map((author) => (
                  <div
                    key={author.author_id}
                    data-testid="advanced-author-card"
                    className="grid min-h-[64px] items-center border-b border-neutral-100 px-3 text-xs hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/55"
                    style={{
                      gridTemplateColumns:
                        "2.25rem minmax(130px,1fr) minmax(150px,1.15fr) 5.5rem 5.5rem 7rem minmax(220px,1.6fr) 6rem 2.5rem",
                    }}
                  >
                    <input
                      type="checkbox"
                      disabled
                      aria-label={t(
                        "Selección no disponible en modo solo lectura",
                      )}
                    />
                    <button
                      className="min-w-0 pr-3 text-left font-medium text-neutral-900 hover:text-indigo-600 dark:text-neutral-200 dark:hover:text-indigo-300"
                      onClick={() => void open(author)}
                    >
                      <span className="block truncate">
                        {author.firstName || author.fullName || author.name}
                      </span>
                      {author.affiliation && (
                        <span className="mt-1 block truncate text-[10px] font-normal text-neutral-500">
                          {author.affiliation}
                        </span>
                      )}
                    </button>
                    <button
                      className="min-w-0 truncate pr-3 text-left text-neutral-500 hover:text-indigo-600 dark:hover:text-indigo-300"
                      onClick={() => void open(author)}
                    >
                      {author.lastName || author.name}
                    </button>
                    <span className="tabular-nums text-neutral-500">
                      {author.workCount}
                    </span>
                    <span className="tabular-nums text-neutral-500">
                      {author.ideaCount}
                    </span>
                    <span className="tabular-nums text-neutral-500">
                      {author.relationCount}
                    </span>
                    <div className="flex min-w-0 flex-wrap gap-1 pr-3">
                      {(author.topTags.length
                        ? author.topTags
                        : author.topThemes
                      )
                        .slice(0, 4)
                        .map((tag) => (
                          <span
                            key={tag}
                            className="max-w-32 truncate rounded-full bg-neutral-100 px-2 py-1 text-[10px] text-neutral-500 dark:bg-neutral-900"
                          >
                            {tag}
                          </span>
                        ))}
                    </div>
                    <span
                      className={`flex items-center gap-1 text-[10px] ${author.hasSynthesis ? "text-indigo-600 dark:text-indigo-300" : "text-neutral-500"}`}
                    >
                      {author.hasSynthesis ? (
                        <>
                          <Icon name="wand" size={11} /> {t("Síntesis")}
                        </>
                      ) : (
                        "—"
                      )}
                    </span>
                    <Icon
                      name="chevronRight"
                      size={14}
                      className="text-neutral-400"
                    />
                  </div>
                ))
              )}
            </div>
          </div>
          <footer className="flex h-10 shrink-0 items-center border-t border-neutral-200 px-3 text-xs text-neutral-500 dark:border-neutral-800">
            <span>
              {page.total
                ? `${page.offset + 1}–${Math.min(page.total, page.offset + page.items.length)} / ${page.total}`
                : "0"}
            </span>
            <div className="flex-1" />
            <button
              className="btn btn-ghost h-7"
              disabled={page.offset <= 0}
              onClick={() =>
                setFilters((current) => ({
                  ...current,
                  offset: Math.max(0, page.offset - page.limit),
                }))
              }
            >
              <Icon name="chevronLeft" size={13} />
            </button>
            <button
              className="btn btn-ghost h-7"
              disabled={!page.hasMore}
              onClick={() =>
                setFilters((current) => ({
                  ...current,
                  offset: page.offset + page.limit,
                }))
              }
            >
              <Icon name="chevronRight" size={13} />
            </button>
          </footer>
        </div>
      )}
    </div>
  );
}

export function GraphServerView({spaceId, initialSeedId, onOpenIdea}: {spaceId:string;csrfToken?:string;initialSeedId?:string;onOpenIdea?:(id:string)=>void}) {
  const source=useMemo(()=>webStellarSource(spaceId),[spaceId]);
  return <div className="h-full" data-testid="advanced-graph-view"><StellarWorkspace source={source} initialSeed={initialSeedId} onOpenIdea={onOpenIdea}/></div>;
}

export function AdvancedServerWorkspace({
  spaceId,
  csrfToken,
  initialSurface = "ideas",
  initialGraphSeedId,
  onOpenIdea,
}: {
  spaceId: string;
  csrfToken?: string;
  initialSurface?: Surface;
  initialGraphSeedId?: string;
  onOpenIdea?: (id: string) => void;
}) {
  const [surface, setSurface] = useState<Surface>(initialSurface);
  return (
    <div
      className="server-desktop-surface flex h-full min-h-0 flex-col bg-neutral-950 text-neutral-100"
      data-testid="advanced-server-workspace"
    >
      <nav
        className="flex shrink-0 gap-1 border-b border-neutral-800 p-2"
        aria-label={t("Superficies académicas")}
      >
        <button
          className={`btn text-xs ${surface === "ideas" ? "" : "btn-ghost"}`}
          onClick={() => setSurface("ideas")}
        >
          <Icon name="bulb" size={13} /> {t("Ideas")}
        </button>
        <button
          className={`btn text-xs ${surface === "authors" ? "" : "btn-ghost"}`}
          onClick={() => setSurface("authors")}
        >
          <Icon name="graduation" size={13} /> {t("Autores")}
        </button>
        <button
          className={`btn text-xs ${surface === "graph" ? "" : "btn-ghost"}`}
          onClick={() => setSurface("graph")}
        >
          <Icon name="network" size={13} /> {t("Grafo")}
        </button>
      </nav>
      <div className="min-h-0 flex-1">
        {surface === "ideas" ? (
          <IdeasServerView spaceId={spaceId} csrfToken={csrfToken} />
        ) : surface === "authors" ? (
          <AuthorsServerView spaceId={spaceId} csrfToken={csrfToken} />
        ) : (
          <GraphServerView
            spaceId={spaceId}
            csrfToken={csrfToken}
            initialSeedId={initialGraphSeedId}
            onOpenIdea={onOpenIdea}
          />
        )}
      </div>
    </div>
  );
}
