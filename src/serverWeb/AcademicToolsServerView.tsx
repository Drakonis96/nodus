import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "../components/ui";
import { MarkdownReader } from "./readers";
import { api } from "./api";
import type { JsonRecord, PageResponse } from "./types";
import { errorText, t } from "./i18nShim";

type Tool =
  "argument" | "hypothesis" | "reading" | "immersion" | "writing" | "projects";
type VisibleTool = Exclude<Tool, "writing" | "projects">;
type ReadingEntry = JsonRecord & {
  nodus_id?: string;
  title?: string;
  authors?: string[];
  year?: number | null;
  reason?: string;
  themes?: string[];
  read?: boolean;
  priority?: number;
  bridgeScore?: number;
  gapScore?: number;
  analysis?: JsonRecord;
  relatedGaps?: string[];
};
const STRATEGIES = [
  [
    "research_relevance",
    "Más relevante",
    "Equilibra objetivos, temas principales, huecos y prioridad académica.",
  ],
  [
    "gaps",
    "Cubrir huecos",
    "Prioriza documentos vinculados con huecos, contradicciones y preguntas abiertas.",
  ],
  [
    "foundational",
    "Textos de base",
    "Sube obras antiguas, citadas internamente o usadas como dependencia conceptual.",
  ],
  [
    "recent",
    "Más recientes",
    "Ordena por actualidad sin ignorar relevancia temática.",
  ],
  [
    "connected_authors",
    "Autores conectados",
    "Da peso a autores relacionados por el grafo de ideas.",
  ],
  [
    "bridges",
    "Conectar temas",
    "Busca textos que conectan varias líneas temáticas o zonas del grafo.",
  ],
];
const LABELS: Record<Tool, string> = {
  argument: "Mapa de argumentos",
  hypothesis: "Hipótesis",
  reading: "Ruta de lectura",
  immersion: "Inmersión",
  writing: "Escritura",
  projects: "Proyectos",
};
const ICONS: Record<Tool, string> = {
  argument: "layers",
  hypothesis: "flask",
  reading: "route",
  immersion: "eye",
  writing: "edit",
  projects: "folder",
};
function text(value: unknown, fallback = "—"): string {
  return value == null || value === "" ? t(fallback) : String(value);
}
function rows(
  page: PageResponse | JsonRecord | undefined,
  key: string,
): JsonRecord[] {
  const found = page?.[key];
  return Array.isArray(found)
    ? (found as JsonRecord[])
    : Array.isArray(page?.items)
      ? page.items
      : [];
}
function title(row: JsonRecord): string {
  return text(
    row.title ?? row.label ?? row.name ?? row.topic ?? row.id,
    "Sin título",
  );
}

function Shell({ tool, children }: { tool: Tool; children: ReactNode }) {
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
      data-testid={`academic-tool-${tool}`}
    >
      <header className="shrink-0 border-b border-neutral-200 px-5 pt-4 dark:border-neutral-800">
        <div className="mb-3 flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
            <Icon name={ICONS[tool]} size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold">{t(LABELS[tool])}</h1>
            <p className="text-[11px] text-neutral-500">
              {t("Contenido publicado, con la misma jerarquía de Desktop.")}
            </p>
          </div>
          <span className="ml-auto rounded-full border border-teal-200 bg-teal-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-teal-700 dark:border-teal-800/70 dark:bg-teal-950/35 dark:text-teal-300">
            {t("Solo lectura")}
          </span>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}
function Empty({ children }: { children: string }) {
  return (
    <div className="grid h-56 place-items-center p-8 text-center text-sm text-neutral-500">
      {t(children)}
    </div>
  );
}
function Table({
  columns,
  data,
  onOpen,
}: {
  columns: string[];
  data: JsonRecord[];
  onOpen?: (row: JsonRecord) => void;
}) {
  return (
    <div className="min-w-[820px]">
      <div className="grid grid-cols-[minmax(300px,1.7fr)_minmax(180px,1fr)_10rem_9rem_2rem] border-b border-neutral-200 px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
        {columns.map((col) => (
          <span key={col}>{t(col)}</span>
        ))}
        <span />
      </div>
      {data.map((row, i) => (
        <button
          key={text(row.id ?? row.nodus_id, String(i))}
          onClick={() => onOpen?.(row)}
          className="grid min-h-[72px] w-full grid-cols-[minmax(300px,1.7fr)_minmax(180px,1fr)_10rem_9rem_2rem] items-center border-b border-neutral-100 px-4 py-3 text-left text-xs hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/60"
        >
          <strong className="truncate pr-4 font-medium">{title(row)}</strong>
          <span className="truncate pr-4 text-neutral-500">
            {text(
              row.description ?? row.statement ?? row.reason ?? row.brief,
              "—",
            )}
          </span>
          <span className="text-neutral-500">
            {text(row.status ?? row.type ?? row.phase, "—")}
          </span>
          <span className="text-neutral-500">
            {text(row.year ?? row.updated_at ?? row.updatedAt, "—")}
          </span>
          <Icon name="chevronRight" size={14} className="text-neutral-400" />
        </button>
      ))}
    </div>
  );
}

function ArgumentView({
  spaceId,
  csrfToken: _csrfToken,
}: {
  spaceId: string;
  csrfToken?: string;
}) {
  const [routes, setRoutes] = useState<JsonRecord[]>([]);
  const [active, setActive] = useState<JsonRecord | null>(null);
  const [graph, setGraph] = useState<JsonRecord | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch(`/api/v1/spaces/${encodeURIComponent(spaceId)}/ideas/routes`, {
      credentials: "same-origin",
    })
      .then((r) => r.json())
      .then((v) => setRoutes(Array.isArray(v.routes) ? v.routes : []))
      .catch((e) => setError(errorText(e)));
  }, [spaceId]);
  useEffect(() => {
    if (!active?.ideaId) {
      setGraph(null);
      return;
    }
    fetch(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/ideas/${encodeURIComponent(String(active.ideaId))}/graph?depth=2&limit=200`,
      { credentials: "same-origin" },
    )
      .then((r) => r.json())
      .then(setGraph)
      .catch(() => setGraph(null));
  }, [active, spaceId]);
  const items = useMemo(() => routes.slice(0, 200), [routes]);
  return (
    <Shell tool="argument">
      <div className="flex h-full min-h-0 flex-col">
        {active ? (
          <section className="p-5">
            <button
              className="btn btn-ghost mb-4 text-xs"
              onClick={() => setActive(null)}
            >
              <Icon name="chevronLeft" size={13} />
              {t("Mapa de argumentos")}
            </button>
            <header className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 dark:border-indigo-800/60 dark:bg-indigo-950/25">
              <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-indigo-600 dark:text-indigo-300">
                {t("Ruta sugerida")}
              </p>
              <h2 className="mt-1 text-xl font-semibold">{title(active)}</h2>
              <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                {text(active.statement, "Sin enunciado publicado")}
              </p>
            </header>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <article className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                <h3 className="mb-3 text-sm font-semibold">
                  {t("Estructura argumental")}
                </h3>
                <dl className="server-detail-list">
                  <div>
                    <dt>{t("Conexiones")}</dt>
                    <dd>{text(active.degree, "0")}</dd>
                  </div>
                  <div>
                    <dt>{t("Debates")}</dt>
                    <dd>{text(active.debateCount, "0")}</dd>
                  </div>
                  <div>
                    <dt>{t("Confianza media")}</dt>
                    <dd>{Number(active.avgConfidence || 0).toFixed(2)}</dd>
                  </div>
                </dl>
              </article>
              <article className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                <h3 className="mb-3 text-sm font-semibold">
                  {t("Vecinos de la ruta")}
                </h3>
                {Array.isArray(active.neighborLabels) ? (
                  <ul className="space-y-2 text-sm">
                    {active.neighborLabels.map((entry) => (
                      <li
                        key={String(entry)}
                        className="rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-900"
                      >
                        {String(entry)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>Sin vecinos publicados.</Empty>
                )}
              </article>
            </div>
            {graph && (
              <article className="mt-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
                <h3 className="mb-3 text-sm font-semibold">
                  {t("Grafo de la ruta")}
                </h3>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {(Array.isArray(graph.ideas) ? graph.ideas : []).map(
                    (node: JsonRecord) => (
                      <div
                        key={text(node.global_id)}
                        className="rounded-lg border border-neutral-100 p-3 text-xs dark:border-neutral-900"
                      >
                        <strong>{text(node.label)}</strong>
                        <p className="mt-1 text-neutral-500">
                          {text(node.statement, "—")}
                        </p>
                      </div>
                    ),
                  )}
                </div>
              </article>
            )}
          </section>
        ) : (
          <>
            <div className="border-b border-neutral-200 p-3 text-xs text-neutral-500 dark:border-neutral-800">
              {t(
                "Rutas ordenadas por conexiones, debates y confianza del grafo publicado.",
              )}
            </div>
            {error ? (
              <Empty>{error}</Empty>
            ) : items.length ? (
              <Table
                columns={[
                  "Idea semilla",
                  "Enunciado",
                  "Conexiones",
                  "Confianza",
                ]}
                data={items}
                onOpen={setActive}
              />
            ) : (
              <Empty>No hay rutas de argumentos publicadas.</Empty>
            )}
            <div className="p-5"></div>
          </>
        )}
      </div>
    </Shell>
  );
}

function HypothesisView({
  spaceId,
  csrfToken: _csrfToken,
}: {
  spaceId: string;
  csrfToken?: string;
}) {
  const [items, setItems] = useState<JsonRecord[]>([]);
  const [active, setActive] = useState<JsonRecord | null>(null);
  const [detail, setDetail] = useState<JsonRecord | null>(null);
  useEffect(() => {
    api
      .collection(spaceId, "gaps", { limit: "200" })
      .then((p) => setItems(rows(p, "gaps")))
      .catch(() => setItems([]));
  }, [spaceId]);
  useEffect(() => {
    if (!active?.id) {
      setDetail(null);
      return;
    }
    api
      .detail(spaceId, "gaps", String(active.id))
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [active, spaceId]);
  const current = (detail?.gap as JsonRecord | undefined) || active;
  const work =
    (detail?.work as JsonRecord | undefined) ||
    (active?.work as JsonRecord | undefined);
  const idea =
    (detail?.idea as JsonRecord | undefined) ||
    (active?.idea as JsonRecord | undefined);
  return (
    <Shell tool="hypothesis">
      {active ? (
        <section className="p-5">
          <button
            className="btn btn-ghost mb-4 text-xs"
            onClick={() => setActive(null)}
          >
            <Icon name="chevronLeft" size={13} />
            {t("Hipótesis")}
          </button>
          <article className="max-w-4xl rounded-2xl border border-indigo-200 bg-indigo-50 p-5 dark:border-indigo-800/60 dark:bg-indigo-950/25">
            <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-indigo-600 dark:text-indigo-300">
              {t("Hueco de investigación")}
            </p>
            <h2 className="mt-1 text-xl font-semibold">
              {title(current || {})}
            </h2>
            <p className="mt-3 text-sm leading-6 text-neutral-600 dark:text-neutral-400">
              {text(
                current?.description ?? current?.text,
                "Sin descripción publicada",
              )}
            </p>
            <dl className="server-detail-list mt-5">
              <div>
                <dt>{t("Obra de origen")}</dt>
                <dd>{text(work?.title ?? current?.nodus_id)}</dd>
              </div>
              <div>
                <dt>{t("Idea relacionada")}</dt>
                <dd>{text(idea?.label ?? current?.related_idea)}</dd>
              </div>
              <div>
                <dt>{t("Evidencia")}</dt>
                <dd>
                  {text(
                    (detail?.evidence as JsonRecord | undefined)?.quote ??
                      (detail?.evidence as JsonRecord | undefined)?.text,
                    "Sin evidencia publicada",
                  )}
                </dd>
              </div>
            </dl>
          </article>
        </section>
      ) : (
        <>
          <Table
            columns={["Hueco", "Descripción", "Estado", "Origen"]}
            data={items}
            onOpen={setActive}
          />
          <div className="p-5"></div>
        </>
      )}
    </Shell>
  );
}

function ReadingEntryCard({
  entry,
  index,
  onToggleRead = () => undefined,
  onAssistant = () => undefined,
}: {
  entry: ReadingEntry;
  index: number;
  onToggleRead?: (id: string, read: boolean) => void;
  onAssistant?: (entry: ReadingEntry) => void;
}) {
  const analysis = (
    entry.analysis && typeof entry.analysis === "object" ? entry.analysis : {}
  ) as JsonRecord;
  const ideas = Number(analysis.ideaCount) || 0;
  const themes = Number(analysis.themeCount) || 0;
  const gaps = Number(analysis.gapCount) || 0;
  const contradictions = Number(analysis.contradictionCount) || 0;
  const authors = Array.isArray(entry.authors) ? entry.authors : [];
  const themesList = Array.isArray(entry.themes) ? entry.themes : [];
  const graphIdea = Array.isArray(entry.relatedIdeas)
    ? entry.relatedIdeas[0]
    : undefined;
  const id = text(entry.nodus_id || entry.id, "");
  return (
    <article
      className={`rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/40 ${entry.read ? "opacity-75" : ""}`}
      data-testid="reading-entry-card"
    >
      <div className="flex items-start gap-3">
        <span className="w-8 shrink-0 text-right font-mono text-lg text-neutral-500">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 text-sm font-medium">
              {text(entry.title, "Obra sin título")}
            </h3>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] ${entry.read ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200" : "bg-amber-100 text-amber-700 dark:bg-amber-900/35 dark:text-amber-200"}`}
            >
              {entry.read ? t("Leída") : t("Por leer")}
            </span>
            {text(analysis.deepStatus, "") === "done" ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-900/35 dark:text-emerald-200">
                {t("Ideas analizadas")}
              </span>
            ) : (
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-900">
                {t("Ideas pendientes")}
              </span>
            )}
            {text(analysis.lightStatus, "") === "done" ? (
              <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] text-cyan-700 dark:bg-cyan-900/35 dark:text-cyan-200">
                {t("Temas analizados")}
              </span>
            ) : null}
            <span className="rounded-full border border-neutral-200 px-2 py-0.5 text-[10px] text-neutral-500 dark:border-neutral-700">
              {t("Prioridad")} {Number(entry.priority ?? 0).toFixed(2)}
            </span>
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            {authors[0] ? text(authors[0]) : "—"}
            {authors.length > 1 ? " et al." : ""} · {text(entry.year, "s.f.")}
            {themesList.length
              ? ` · ${themesList.slice(0, 4).map(String).join(", ")}`
              : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {ideas > 0 && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                {ideas} {t("ideas")}
              </span>
            )}
            {themes > 0 && (
              <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300">
                {themes} {t("temas")}
              </span>
            )}
            {contradictions > 0 && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] text-red-700 dark:bg-red-950/50 dark:text-red-300">
                {contradictions} {t("contrad.")}
              </span>
            )}
            {gaps > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                {gaps} {t("huecos")}
              </span>
            )}
            {Number(entry.bridgeScore) >= 0.45 && (
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                {t("Puente")}
              </span>
            )}
          </div>
          <p className="mt-2 line-clamp-2 text-xs text-neutral-500">
            {text(
              entry.reason,
              entry.read ? "Marcada como leída." : "Pendiente de lectura.",
            )}
          </p>
          {Array.isArray(entry.relatedGaps) && entry.relatedGaps.length > 0 && (
            <p className="mt-1 line-clamp-1 text-[11px] text-neutral-500">
              {t("Huecos relacionados")}:{" "}
              {entry.relatedGaps.map(String).join(" · ")}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {id && (
              <button
                className="btn btn-ghost border border-neutral-300 text-xs dark:border-neutral-700"
                onClick={() => onToggleRead(id, !entry.read)}
              >
                <Icon name="check" size={13} />
                {entry.read ? t("Marcar pendiente") : t("Marcar leída")}
              </button>
            )}
            {graphIdea && (
              <a
                className="btn btn-ghost border border-neutral-300 text-xs dark:border-neutral-700"
                href={`/view/graph?seed=${encodeURIComponent(String(graphIdea))}`}
              >
                <Icon name="layers" size={13} />
                {t("Grafo")}
              </a>
            )}
            {id && (
              <a
                className="btn btn-ghost border border-neutral-300 text-xs dark:border-neutral-700"
                href={`/library/${encodeURIComponent(id)}`}
              >
                <Icon name="book" size={13} />
                {t("Abrir lectura")}
              </a>
            )}
            <button
              className="btn btn-ghost border border-neutral-300 text-xs dark:border-neutral-700"
              onClick={() => onAssistant(entry)}
            >
              <Icon name="chat" size={13} />
              {t("Asistente")}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function ReadingView({
  spaceId,
  csrfToken,
}: {
  spaceId: string;
  csrfToken?: string;
}) {
  const [strategy, setStrategy] = useState("research_relevance");
  const [brief, setBrief] = useState("");
  const [limit, setLimit] = useState(72);
  const [includeRead, setIncludeRead] = useState(true);
  const [data, setData] = useState<JsonRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [readOverlay, setReadOverlay] = useState<Record<string, boolean>>({});
  const [annotationVersion, setAnnotationVersion] = useState(0);
  const load = () => {
    setLoading(true);
    setError("");
    api
      .readingPath(spaceId, {
        strategy,
        researchBrief: brief,
        limit,
        includeRead,
      })
      .then(setData)
      .catch((cause) =>
        setError(errorText(cause)),
      )
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    void load();
    api
      .annotations(spaceId, "reading-path", "")
      .then((response) => {
        const next: Record<string, boolean> = {};
        response.annotations
          .filter(
            (entry) =>
              entry.kind === "note" &&
              (entry.content === "read" || entry.content === "unread") &&
              !entry.deletedAt,
          )
          .forEach((entry) => {
            next[String(entry.documentId)] = entry.content === "read";
          });
        setAnnotationVersion(response.version);
        setReadOverlay(next);
      })
      .catch(() => undefined);
  }, [spaceId]);
  const entries = ((data?.phases as JsonRecord[]) || [])
    .flatMap((phase) =>
      Array.isArray(phase.entries) ? (phase.entries as ReadingEntry[]) : [],
    )
    .map((entry) => ({
      ...entry,
      read:
        readOverlay[text(entry.nodus_id || entry.id, "")] ??
        Boolean(entry.read),
    }));
  const toggleRead = async (id: string, read: boolean) => {
    const now = new Date().toISOString();
    try {
      const response = await api.addAnnotation(
        spaceId,
        {
          id: `reading-${id}`,
          resource: "reading-path",
          documentId: id,
          kind: "note",
          title: read ? t("Leída") : t("Pendiente"),
          content: read ? "read" : "unread",
          quote: "",
          baseVersion: annotationVersion,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
        csrfToken,
      );
      setAnnotationVersion(response.version);
      setReadOverlay((current) => ({ ...current, [id]: read }));
    } catch (cause) {
      setError(errorText(cause));
    }
  };
  const openAssistant = (entry: ReadingEntry) => {
    window.location.assign(
      `/view/assistant?reading=${encodeURIComponent(text(entry.nodus_id || entry.id, ""))}`,
    );
  };
  const strategyHelp = STRATEGIES.find(([id]) => id === strategy)?.[2] || "";
  return (
    <Shell tool="reading">
      <div className="p-5">
        <div className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="input"
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
                data-testid="reading-strategy"
              >
                {STRATEGIES.map(([id, label]) => (
                  <option key={id} value={id}>
                    {t(label)}
                  </option>
                ))}
              </select>
              <select
                className="input"
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                data-testid="reading-limit"
              >
                {[36, 72, 108, 144].map((n) => (
                  <option key={n} value={n}>
                    {n} {t("lecturas")}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm text-neutral-500">
                <input
                  type="checkbox"
                  checked={includeRead}
                  onChange={(e) => setIncludeRead(e.target.checked)}
                  data-testid="reading-include-read"
                />
                {t("Incluir leídas")}
              </label>
              <button
                className="btn"
                onClick={load}
                disabled={loading}
                data-testid="reading-analyze"
              >
                <Icon name="wand" />
                {loading ? t("Analizando…") : t("Analizar ruta")}
              </button>
            </div>
            <textarea
              className="input mt-3 min-h-24 w-full resize-y"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder={t(
                "Describe tu investigación, preguntas u objetivos actuales…",
              )}
              data-testid="reading-brief"
            />
            <p className="mt-2 text-xs text-neutral-500">{t(strategyHelp)}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-neutral-200 p-3 text-xs dark:border-neutral-800">
            <Metric label="Corpus" value={data?.totalWorks ?? "—"} />
            <Metric label="Mostradas" value={data?.shownWorks ?? "—"} />
            <Metric label="Leídas" value={data?.readCount ?? "—"} />
            <Metric label="Por leer" value={data?.unreadCount ?? "—"} />
            <Metric label="Analizadas" value={data?.analyzedCount ?? "—"} />
            <Metric
              label="Pendientes"
              value={data?.pendingAnalysisCount ?? "—"}
            />
          </div>
        </div>
        {loading && (
          <p className="mb-3 text-xs text-neutral-500">
            {t("Recalculando ruta…")}
          </p>
        )}
        {error ? (
          <Empty>{error}</Empty>
        ) : data ? (
          <>
            <p className="mb-4 text-sm text-neutral-500">
              {t("Ruta optimizada por")} {text(data.strategy, strategy)}:{" "}
              {text(data.shownWorks, "0")} {t("lecturas priorizadas de")}{" "}
              {text(data.totalWorks, "0")} {t("obras")}.
            </p>
            <div className="space-y-7">
              {((data.phases as JsonRecord[]) || []).map((phase) => {
                const phaseEntries = Array.isArray(phase.entries)
                  ? (phase.entries as ReadingEntry[])
                  : [];
                return (
                  <section key={text(phase.id)}>
                    <div className="mb-2 flex flex-wrap items-end gap-2">
                      <div>
                        <h2 className="text-base font-semibold">
                          {text(phase.title)}
                        </h2>
                        <p className="text-xs text-neutral-500">
                          {text(phase.objective)}
                        </p>
                      </div>
                      <span className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] text-neutral-500 dark:bg-neutral-900">
                        {phaseEntries.length}/{text(phase.totalCandidates, "0")}
                      </span>
                      {Number(phase.omitted) > 0 && (
                        <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                          {text(phase.omitted)} {t("fuera del bloque")}
                        </span>
                      )}
                    </div>
                    <div className="grid gap-3 xl:grid-cols-2">
                      {phaseEntries.map((entry, index) => (
                        <ReadingEntryCard
                          key={text(entry.nodus_id || entry.id, String(index))}
                          entry={{
                            ...entry,
                            read:
                              readOverlay[
                                text(entry.nodus_id || entry.id, "")
                              ] ?? Boolean(entry.read),
                          }}
                          index={index + 1}
                          onToggleRead={toggleRead}
                          onAssistant={openAssistant}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
            {entries.length === 0 && (
              <Empty>No hay obras que cumplan los filtros actuales.</Empty>
            )}
          </>
        ) : (
          <Empty>Sin plan calculado.</Empty>
        )}
      </div>
    </Shell>
  );
}
function Metric({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">
        {t(label)}
      </div>
      <strong className="mt-1 block text-lg tabular-nums">{text(value)}</strong>
    </div>
  );
}

function ImmersionPlan({ value }: { value: unknown }) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return <MarkdownReader value={text(value, "No hay plan publicado.")} />;
  const plan = value as JsonRecord;
  const terms = Array.isArray(plan.keyTerms)
    ? (plan.keyTerms as JsonRecord[])
    : [];
  const stations = Array.isArray(plan.stations)
    ? (plan.stations as JsonRecord[])
    : [];
  const takeaways = Array.isArray(plan.takeaways) ? plan.takeaways : [];
  return (
    <div className="space-y-6" data-testid="immersion-plan">
      {Boolean(plan.overview) && (
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("Panorama")}
          </h4>
          <MarkdownReader value={text(plan.overview, "")} />
        </section>
      )}
      {terms.length > 0 && (
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("Conceptos clave")}
          </h4>
          <dl className="grid gap-2 sm:grid-cols-2">
            {terms.map((term, index) => (
              <div
                key={text(term.term, String(index))}
                className="rounded-lg bg-neutral-50 p-3 dark:bg-neutral-900/60"
              >
                <dt className="text-xs font-semibold">{text(term.term)}</dt>
                <dd className="mt-1 text-xs leading-5 text-neutral-500">
                  {text(term.definition)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {stations.length > 0 && (
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("Estaciones")}
          </h4>
          <div className="space-y-3">
            {stations.map((station, index) => (
              <article
                key={text(station.id, String(index))}
                className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500">
                      {t("Estación")} {index + 1}
                    </p>
                    <h5 className="mt-1 text-sm font-semibold">
                      {text(station.title)}
                    </h5>
                  </div>
                  {station.minutes != null && (
                    <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-1 text-[10px] text-neutral-500 dark:bg-neutral-900">
                      {text(station.minutes)} {t("min")}
                    </span>
                  )}
                </div>
                {Boolean(station.question) && (
                  <p className="mt-2 text-xs font-medium text-neutral-600 dark:text-neutral-300">
                    {text(station.question)}
                  </p>
                )}
                {Boolean(station.synthesis) && (
                  <div className="mt-3 border-t border-neutral-200 pt-3 dark:border-neutral-800">
                    <MarkdownReader value={text(station.synthesis, "")} />
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      {takeaways.length > 0 && (
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            {t("Conclusiones")}
          </h4>
          <ul className="space-y-2">
            {takeaways.map((item, index) => (
              <li
                key={index}
                className="flex gap-2 text-xs leading-5 text-neutral-600 dark:text-neutral-400"
              >
                <Icon
                  name="check"
                  size={13}
                  className="mt-1 shrink-0 text-teal-500"
                />
                {text(item)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ListDetail({
  tool,
  list,
  active,
  setActive,
  children,
  aside,
}: {
  tool: "immersion" | "writing" | "projects";
  list: JsonRecord[];
  active: JsonRecord | null;
  setActive: (row: JsonRecord | null) => void;
  children?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <Shell tool={tool}>
      <div className="flex h-full min-h-0">
        {active ? (
          <section className="min-w-0 flex-1 overflow-auto p-5">
            <button
              className="btn btn-ghost mb-4 text-xs"
              onClick={() => setActive(null)}
            >
              <Icon name="chevronLeft" size={13} />
              {t(LABELS[tool])}
            </button>
            <article className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 dark:border-indigo-800/60 dark:bg-indigo-950/25">
              <h2 className="text-xl font-semibold">{title(active)}</h2>
              <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-400">
                {text(
                  active.description ??
                    active.brief ??
                    active.topic ??
                    active.objective,
                  "Contenido publicado",
                )}
              </p>
            </article>
            {children}
          </section>
        ) : (
          <section className="min-w-0 flex-1 overflow-auto">
            <div className="border-b border-neutral-200 p-3 text-xs text-neutral-500 dark:border-neutral-800">
              {list.length} {t("registros publicados")}
            </div>
            <Table
              columns={["Título", "Descripción", "Estado", "Actualizado"]}
              data={list}
              onOpen={setActive}
            />
            {aside}
          </section>
        )}
      </div>
    </Shell>
  );
}
function ImmersionView({
  spaceId,
  csrfToken: _csrfToken,
}: {
  spaceId: string;
  csrfToken?: string;
}) {
  const [list, setList] = useState<JsonRecord[]>([]);
  const [active, setActive] = useState<JsonRecord | null>(null);
  const [detail, setDetail] = useState<JsonRecord | null>(null);
  useEffect(() => {
    api
      .immersion(spaceId)
      .then((p) => setList(rows(p, "sessions")))
      .catch(() => setList([]));
  }, [spaceId]);
  useEffect(() => {
    setDetail(null);
    if (active?.id)
      api
        .immersion(spaceId, String(active.id))
        .then(setDetail)
        .catch(() => setDetail(null));
  }, [active, spaceId]);
  const plan =
    (detail?.session as JsonRecord | undefined)?.plan ?? detail?.plan;
  return (
    <ListDetail
      tool="immersion"
      list={list}
      active={active}
      setActive={setActive}
    >
      <div className="mt-5 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <h3 className="mb-3 text-sm font-semibold">{t("Plan de inmersión")}</h3>
        <ImmersionPlan value={plan} />
      </div>
    </ListDetail>
  );
}
type PrivateArtifactEditorProps = {
  spaceId: string;
  csrfToken?: string;
  surface: "writing" | "project";
  artifacts: import("./types").UserArtifact[];
  onChange: () => void;
};

function PrivateArtifactEditor({
  spaceId,
  csrfToken,
  surface,
  artifacts,
  onChange,
}: PrivateArtifactEditorProps) {
  const [active, setActive] = useState<import("./types").UserArtifact | null>(
    null,
  );
  const [creating, setCreating] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const label = surface === "writing" ? "borrador" : "proyecto";
  const open = (artifact: import("./types").UserArtifact) => {
    setActive(artifact);
    setCreating(false);
    setTitleValue(artifact.title);
    setContent(artifact.content);
    setPreview(false);
    setError("");
  };
  const reset = () => {
    setActive(null);
    setCreating(true);
    setTitleValue("");
    setContent("");
    setPreview(false);
    setError("");
  };
  const save = async () => {
    if (!titleValue.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      if (active)
        await api.updateArtifact(
          active.id,
          { title: titleValue.trim(), content },
          csrfToken,
        );
      else
        await api.createArtifact(
          {
            vaultId: spaceId,
            kind: "workspace-note",
            title: titleValue.trim(),
            content,
            metadata: { surface, private: true },
          },
          csrfToken,
        );
      setActive(null);
      setCreating(false);
      setTitleValue("");
      setContent("");
      onChange();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (
      !active ||
      busy ||
      !window.confirm(`${t("¿Eliminar este")} ${t(label)} ${t("privado?")}`)
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api.deleteArtifact(active.id, csrfToken);
      setActive(null);
      setCreating(false);
      setTitleValue("");
      setContent("");
      onChange();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="mt-5 rounded-xl border border-teal-200 bg-teal-50/60 p-4 dark:border-teal-900/70 dark:bg-teal-950/20"
      data-testid={`private-${surface}-workspace`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">
            {t(
              surface === "writing"
                ? "Borradores privados"
                : "Proyectos privados",
            )}
          </h3>
          <p className="mt-1 text-xs text-neutral-500">
            {t("Solo tú puedes verlos; no modifican el vault publicado.")}
          </p>
        </div>
        <button
          className="btn btn-primary h-8 text-xs"
          onClick={reset}
          data-testid={`private-${surface}-new`}
        >
          {t("Nuevo")} {t(label)}
        </button>
      </div>
      {(active || creating) && (
        <div className="mt-3 grid gap-2">
          <input
            className="input text-xs"
            value={titleValue}
            onChange={(event) => setTitleValue(event.target.value)}
            placeholder={t(
              surface === "writing"
                ? "Título del borrador"
                : "Título del proyecto",
            )}
            aria-label={`${t("Título del")} ${t(label)}`}
          />
          <div className="flex items-center gap-1 border-b border-teal-200 pb-1 text-xs dark:border-teal-900">
            <button
              type="button"
              className={`rounded px-2 py-1 ${!preview ? "bg-teal-600 text-white" : "text-neutral-500"}`}
              onClick={() => setPreview(false)}
              data-testid={`private-${surface}-edit-tab`}
            >
              {t("Editar Markdown")}
            </button>
            <button
              type="button"
              className={`rounded px-2 py-1 ${preview ? "bg-teal-600 text-white" : "text-neutral-500"}`}
              onClick={() => setPreview(true)}
              data-testid={`private-${surface}-preview-tab`}
            >
              {t("Vista previa")}
            </button>
          </div>
          {preview ? (
            <div
              className="min-h-32 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950"
              data-testid={`private-${surface}-preview`}
            >
              <MarkdownReader
                value={content || t("_Sin contenido todavía._")}
              />
            </div>
          ) : (
            <textarea
              className="input min-h-32 resize-y text-xs"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder={t(
                surface === "writing"
                  ? "Escribe tu borrador en Markdown…"
                  : "Describe el proyecto, objetivos y capítulos…",
              )}
              aria-label={`${t("Contenido del")} ${t(label)}`}
              data-testid={`private-${surface}-editor`}
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn btn-primary h-8 text-xs"
              disabled={busy || !titleValue.trim()}
              onClick={() => void save()}
            >
              {busy
                ? t("Guardando…")
                : active
                  ? t("Guardar cambios")
                  : `${t("Crear")} ${t(label)}`}
            </button>
            {active && (
              <button
                className="btn btn-ghost h-8 text-xs text-red-600"
                disabled={busy}
                onClick={() => void remove()}
              >
                {t("Eliminar")}
              </button>
            )}
            {error && (
              <span className="text-xs text-red-600 dark:text-red-300">
                {error}
              </span>
            )}
          </div>
        </div>
      )}
      {artifacts.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {artifacts.map((artifact) => (
            <button
              key={artifact.id}
              className="rounded-lg border border-teal-200 bg-white p-3 text-left text-xs hover:border-teal-500 dark:border-teal-900 dark:bg-neutral-950/40"
              onClick={() => open(artifact)}
            >
              <span className="text-[10px] uppercase tracking-wide text-teal-700 dark:text-teal-300">
                {t("Privado")}
              </span>
              <strong className="mt-1 block truncate">{artifact.title}</strong>
              <span className="mt-1 block line-clamp-2 text-neutral-500">
                {artifact.content || t("Sin contenido")}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function _WritingView({
  spaceId,
  csrfToken,
}: {
  spaceId: string;
  csrfToken?: string;
}) {
  const [list, setList] = useState<JsonRecord[]>([]);
  const [active, setActive] = useState<JsonRecord | null>(null);
  const [detail, setDetail] = useState<JsonRecord | null>(null);
  const [privateItems, setPrivateItems] = useState<
    import("./types").UserArtifact[]
  >([]);
  const load = () =>
    Promise.all([
      api.writing(spaceId, { limit: "200" }),
      api.artifacts(spaceId, "workspace-note"),
    ])
      .then(([page, privatePage]) => {
        setList(rows(page, "drafts"));
        setPrivateItems(
          privatePage.artifacts.filter(
            (entry) => entry.metadata?.surface === "writing",
          ),
        );
      })
      .catch(() => {
        setList([]);
        setPrivateItems([]);
      });
  useEffect(() => {
    void load();
  }, [spaceId]);
  useEffect(() => {
    if (!active?.id) {
      setDetail(null);
      return;
    }
    api
      .writingDraft(spaceId, String(active.id))
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [active, spaceId]);
  const draft = (detail?.draft as JsonRecord | undefined) || {};
  const markdown = text(
    draft.draftMarkdown ??
      draft.markdown ??
      draft.content ??
      active?.draft ??
      active?.content,
    "Este borrador no tiene contenido publicado.",
  );
  return (
    <ListDetail
      tool="writing"
      list={list}
      active={active}
      setActive={setActive}
      aside={
        <PrivateArtifactEditor
          surface="writing"
          spaceId={spaceId}
          csrfToken={csrfToken}
          artifacts={privateItems}
          onChange={() => void load()}
        />
      }
    >
      <div
        className="mt-5 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
        data-testid="writing-published-document"
      >
        <MarkdownReader value={markdown} />
      </div>
      <PrivateArtifactEditor
        surface="writing"
        spaceId={spaceId}
        csrfToken={csrfToken}
        artifacts={privateItems}
        onChange={() => void load()}
      />
    </ListDetail>
  );
}

function _ProjectsView({
  spaceId,
  csrfToken,
}: {
  spaceId: string;
  csrfToken?: string;
}) {
  const [list, setList] = useState<JsonRecord[]>([]);
  const [active, setActive] = useState<JsonRecord | null>(null);
  const [detail, setDetail] = useState<JsonRecord | null>(null);
  const [privateItems, setPrivateItems] = useState<
    import("./types").UserArtifact[]
  >([]);
  const load = () =>
    Promise.all([
      api.projects(spaceId, { limit: "200" }),
      api.artifacts(spaceId, "workspace-note"),
    ])
      .then(([page, privatePage]) => {
        setList(rows(page, "projects"));
        setPrivateItems(
          privatePage.artifacts.filter(
            (entry) => entry.metadata?.surface === "project",
          ),
        );
      })
      .catch(() => {
        setList([]);
        setPrivateItems([]);
      });
  useEffect(() => {
    void load();
  }, [spaceId]);
  useEffect(() => {
    if (active?.id)
      api
        .project(spaceId, String(active.id))
        .then(setDetail)
        .catch(() => setDetail(null));
  }, [active, spaceId]);
  const sections = Array.isArray(detail?.sections)
    ? (detail.sections as JsonRecord[])
    : [];
  const chapters = Array.isArray(detail?.chapters)
    ? (detail.chapters as JsonRecord[])
    : [];
  const links = Array.isArray(detail?.links)
    ? (detail.links as JsonRecord[])
    : [];
  return (
    <ListDetail
      tool="projects"
      list={list}
      active={active}
      setActive={setActive}
      aside={
        <PrivateArtifactEditor
          surface="project"
          spaceId={spaceId}
          csrfToken={csrfToken}
          artifacts={privateItems}
          onChange={() => void load()}
        />
      }
    >
      <div className="mt-5 space-y-4" data-testid="projects-published-detail">
        <div className="grid gap-4 lg:grid-cols-2">
          {sections.map((section, index) => (
            <article
              key={text(section.id, String(index))}
              className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
            >
              <h3 className="font-semibold">{title(section)}</h3>
              <p className="mt-1 text-xs text-neutral-500">
                {text(section.status)} · {text(section.role)}
              </p>
            </article>
          ))}
        </div>
        {chapters.length > 0 && (
          <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <h3 className="mb-2 text-sm font-semibold">{t("Capítulos publicados")}</h3>
            <div className="space-y-2">
              {chapters.map((chapter, index) => (
                <div
                  key={text(chapter.id, String(index))}
                  className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2 text-xs dark:bg-neutral-900"
                >
                  <span className="font-medium">{title(chapter)}</span>
                  <span className="text-neutral-500">
                    {text(chapter.status, "Publicado")}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
        {links.length > 0 && (
          <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <h3 className="mb-2 text-sm font-semibold">{t("Enlaces del proyecto")}</h3>
            <div className="space-y-1 text-xs text-neutral-500">
              {links.map((link, index) => (
                <div key={text(link.id, String(index))}>
                  {text(
                    link.label ?? link.title ?? link.target_id,
                    "Referencia publicada",
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
      <PrivateArtifactEditor
        surface="project"
        spaceId={spaceId}
        csrfToken={csrfToken}
        artifacts={privateItems}
        onChange={() => void load()}
      />
    </ListDetail>
  );
}

export function AcademicToolsServerView({
  spaceId,
  csrfToken,
  tool,
}: {
  spaceId: string;
  csrfToken?: string;
  tool: VisibleTool;
}) {
  if (tool === "argument")
    return <ArgumentView spaceId={spaceId} csrfToken={csrfToken} />;
  if (tool === "hypothesis")
    return <HypothesisView spaceId={spaceId} csrfToken={csrfToken} />;
  if (tool === "reading")
    return <ReadingView spaceId={spaceId} csrfToken={csrfToken} />;
  return <ImmersionView spaceId={spaceId} csrfToken={csrfToken} />;
}
