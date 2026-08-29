import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Icon, Spinner } from "../components/ui";
import { MarkdownReader } from "./readers";
import { api, ApiError } from "./api";
import type { AIJob, AIPreferences, JsonRecord, UserArtifact } from "./types";
import { SERVER_DEFAULT_MODELS, serverModelsFor } from "./modelCatalog";
import { PROVIDER_LABELS } from "@shared/providers";
import { getActiveLang, t, tx } from "./i18nShim";

type DbColumn = { id: string; name: string; type?: string };
type DbRow = { id: string; cells: Record<string, unknown> };
type DbView = { id: string; name: string; layout?: string };
type Database = {
  id: string;
  name: string;
  columns: DbColumn[];
  rows: DbRow[];
  views: DbView[];
  total: number;
  redactedColumns: string[];
};
type DatabaseContext = {
  databases: Array<{
    id: string;
    name: string;
    columns: DbColumn[];
    rows: Array<{ cells: Record<string, unknown> }>;
    views: DbView[];
  }>;
  revision?: string | number;
  truncated: boolean;
  redactedColumns: string[];
};

const MAX_DATABASES = 8;
const MAX_ROWS = 2_000;
const MAX_COLUMNS = 32;
const MAX_VALUE = 600;
const EXECUTABLE_PROVIDERS = new Set([
  "openai",
  "openrouter",
  "anthropic",
  "gemini",
  "mistral",
  "cohere",
]);
const DEFAULT_MODELS: Record<string, string> = Object.fromEntries(
  [...EXECUTABLE_PROVIDERS].map((provider) => [
    provider,
    SERVER_DEFAULT_MODELS[provider] || "",
  ]),
);
const SENSITIVE =
  /(?:email|phone|address|national[\s_-]?id|passport|ssn|secret|token|password|credential|api[\s_-]?key|authorization|cookie|private[\s_-]?key|file[\s_-]?path|local[\s_-]?path|owner|user[\s_-]?(?:id|name)?|created[\s_-]?by|updated[\s_-]?by|participant|speaker)/i;
const PII_VALUE =
  /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\+?\d[\d .()/-]{7,}\d)/gi;

function asObject(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}
function asText(value: unknown, fallback = ""): string {
  return value == null
    ? fallback
    : typeof value === "string"
      ? value
      : JSON.stringify(value);
}
function safeCell(value: unknown): string {
  return asText(value).replace(PII_VALUE, "[REDACTED]").slice(0, MAX_VALUE);
}
function extractAIText(result: unknown): string {
  const root = asObject(result);
  if (typeof root.text === "string") return root.text;
  if (typeof root.answer === "string") return root.answer;
  const output = Array.isArray(root.output) ? root.output : [];
  const outputText = output
    .flatMap((entry) =>
      Array.isArray(asObject(entry).content)
        ? (asObject(entry).content as unknown[])
        : [],
    )
    .map((entry) => asText(asObject(entry).text))
    .filter(Boolean)
    .join("\n");
  if (outputText) return outputText;
  const contentText = (Array.isArray(root.content) ? root.content : [])
    .map((entry) => asText(asObject(entry).text))
    .filter(Boolean)
    .join("\n");
  if (contentText) return contentText;
  const choices = Array.isArray(root.choices) ? root.choices : [];
  return (
    choices
      .map((entry) => asText(asObject(asObject(entry).message).content))
      .filter(Boolean)
      .join("\n") || t("El proveedor no devolvió texto compatible.")
  );
}
function normalizeArtifact(item: UserArtifact): UserArtifact {
  return {
    ...item,
    title: asText(item.title, t("Informe de datos")),
    content: asText(item.content),
    metadata: asObject(item.metadata),
  };
}

function publicDatabase(raw: JsonRecord, payload: JsonRecord): Database {
  const database = asObject(payload.database ?? raw);
  const allColumns = (Array.isArray(payload.columns) ? payload.columns : [])
    .map((entry) => {
      const item = asObject(entry);
      return {
        id: asText(item.id),
        name: asText(item.name ?? item.title, t("Columna")),
        type: asText(item.type),
      };
    })
    .filter((column) => column.id);
  const redactedColumns = allColumns
    .filter((column) => SENSITIVE.test(column.name))
    .map((column) => column.name);
  const columns = allColumns
    .filter((column) => !SENSITIVE.test(column.name))
    .slice(0, MAX_COLUMNS);
  const allowedColumns = new Set(columns.map((column) => column.id));
  const rows = (Array.isArray(payload.rows) ? payload.rows : [])
    .map((entry) => {
      const row = asObject(entry);
      const cells = asObject(row.cells);
      return {
        id: asText(row.id),
        cells: Object.fromEntries(
          Object.entries(cells)
            .filter(([key]) => allowedColumns.has(key))
            .map(([key, value]) => [key, safeCell(value)]),
        ),
      };
    })
    .filter((row) => row.id);
  const views = (Array.isArray(payload.views) ? payload.views : [])
    .map((entry) => {
      const view = asObject(entry);
      return {
        id: asText(view.id),
        name: asText(view.name, t("Vista")),
        layout: asText(view.layout),
      };
    })
    .filter((view) => view.id);
  return {
    id: asText(database.id ?? raw.id),
    name: asText(database.name ?? database.title, t("Base de datos")),
    columns,
    rows,
    views,
    total: Number(payload.total) || rows.length,
    redactedColumns,
  };
}

/** Bounded, redacted context; row ids and sensitive columns never enter a prompt. */
function buildContext(
  databases: Database[],
  selectedIds: string[],
  selectedViewIds: string[],
  query: string,
  revision?: string | number,
): DatabaseContext {
  let remaining = MAX_ROWS;
  const redactedColumns: string[] = [];
  const output = databases
    .filter((database) => selectedIds.includes(database.id))
    .slice(0, MAX_DATABASES)
    .map((database) => {
      const allowedViews = database.views.filter(
        (view) => !selectedViewIds.length || selectedViewIds.includes(view.id),
      );
      const needle = query.trim().toLocaleLowerCase();
      const rows = database.rows
        .filter(
          (row) =>
            !needle ||
            Object.values(row.cells).some((value) =>
              asText(value).toLocaleLowerCase().includes(needle),
            ),
        )
        .slice(0, remaining);
      remaining -= rows.length;
      return {
        id: database.id,
        name: database.name,
        columns: database.columns,
        views: allowedViews,
        rows: rows.map((row) => ({
          cells: Object.fromEntries(
            Object.entries(row.cells).map(([key, value]) => [
              database.columns.find((column) => column.id === key)?.name || key,
              value,
            ]),
          ),
        })),
      };
    });
  for (const database of databases)
    redactedColumns.push(...database.redactedColumns);
  return {
    databases: output,
    revision,
    truncated: remaining <= 0 || databases.length > MAX_DATABASES,
    redactedColumns: [...new Set(redactedColumns)].slice(0, 100),
  };
}

async function loadDatabaseContext(
  spaceId: string,
): Promise<{ databases: Database[]; revision?: string | number }> {
  const page = await api.collection(spaceId, "databases", {
    limit: String(MAX_DATABASES),
  });
  const listed = (
    Array.isArray(page.databases)
      ? page.databases
      : Array.isArray(page.items)
        ? page.items
        : []
  )
    .map(asObject)
    .filter((entry) => asText(entry.id));
  const loaded = await Promise.all(
    listed.slice(0, MAX_DATABASES).map(async (database) => {
      try {
        return publicDatabase(
          database,
          await api.databaseAnalysis(spaceId, asText(database.id)),
        );
      } catch {
        const [columns, rows, cells, computed, views] = await Promise.all([
          api.nativeContentList(spaceId, "db_columns", {
            limit: String(MAX_COLUMNS),
            database_id: asText(database.id),
          }),
          api.nativeContentList(spaceId, "db_rows", {
            limit: String(MAX_ROWS),
            database_id: asText(database.id),
          }),
          api.nativeContentList(spaceId, "db_cells", {
            limit: String(MAX_ROWS * 4),
            database_id: asText(database.id),
          }),
          api.nativeContentList(spaceId, "db_computed_cells", {
            limit: String(MAX_ROWS * 4),
            database_id: asText(database.id),
          }),
          api.nativeContentList(spaceId, "db_views", {
            limit: "100",
            database_id: asText(database.id),
          }),
        ]);
        const columnRows = columns.rows || columns.items || [];
        const normalizedColumns = columnRows.map(asObject).map((entry) => ({
          id: asText(entry.id),
          name: asText(entry.name, t("Columna")),
          type: asText(entry.type),
        }));
        const byRow = new Map<string, Record<string, unknown>>();
        for (const entry of [
          ...(cells.rows || cells.items || []),
          ...(computed.rows || computed.items || []),
        ].map(asObject)) {
          const rowId = asText(entry.row_id ?? entry.rowId);
          const columnId = asText(entry.column_id ?? entry.columnId);
          if (!rowId || !columnId) continue;
          const value =
            entry.value_text ??
            entry.value_json ??
            entry.value_number ??
            entry.value_date ??
            entry.value_integer ??
            null;
          byRow.set(rowId, { ...(byRow.get(rowId) || {}), [columnId]: value });
        }
        const normalizedRows = (rows.rows || rows.items || [])
          .map(asObject)
          .map((entry) => ({
            id: asText(entry.id),
            cells: byRow.get(asText(entry.id)) || {},
          }))
          .filter((entry) => entry.id);
        return publicDatabase(database, {
          database,
          columns: normalizedColumns,
          rows: normalizedRows,
          views: views.rows || views.items || [],
          total: Number(rows.total) || normalizedRows.length,
        });
      }
    }),
  );
  return { databases: loaded, revision: page.revision };
}

function statusLabel(status: AIJob["status"]): string {
  return t(
    status === "queued"
      ? "En cola"
      : status === "running"
        ? "Procesando"
        : status === "completed"
          ? "Completado"
          : status === "cancelled"
            ? "Cancelado"
            : "Fallido",
  );
}
function errorText(error: unknown): string {
  return error instanceof ApiError && error.code === "credential_required"
    ? t("Configura una credencial del proveedor en Ajustes.")
    : error instanceof Error
      ? error.message
      : String(error);
}

export function DatabaseDeepResearchServerView({
  spaceId,
  csrfToken,
}: {
  spaceId: string;
  csrfToken?: string;
}) {
  const [databases, setDatabases] = useState<Database[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedViewIds, setSelectedViewIds] = useState<string[]>([]);
  const [objective, setObjective] = useState("");
  const [query, setQuery] = useState("");
  const [reports, setReports] = useState<UserArtifact[]>([]);
  const [jobs, setJobs] = useState<AIJob[]>([]);
  const [activeReport, setActiveReport] = useState<UserArtifact | null>(null);
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState(DEFAULT_MODELS.openai);
  const [preferences, setPreferences] = useState<AIPreferences>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState<string | number>();
  const pollRef = useRef<number | undefined>();
  const jobTitles = useRef(new Map<string, string>());
  const materializedJobs = useRef(new Set<string>());
  const refresh = useCallback(async () => {
    const [context, artifacts, jobsResponse] = await Promise.all([
      loadDatabaseContext(spaceId),
      api.artifacts(spaceId, "deep-research"),
      api.aiJobs(),
    ]);
    setDatabases(context.databases);
    setRevision(context.revision);
    setReports(
      artifacts.artifacts
        .map(normalizeArtifact)
        .filter(
          (artifact) => artifact.metadata.surface === "database-deep-research",
        ),
    );
    setJobs(
      jobsResponse.jobs.filter(
        (job) =>
          job.vaultId === spaceId &&
          job.capability === "database-deep-research",
      ),
    );
    setSelectedIds((current) =>
      current.length
        ? current.filter((id) =>
            context.databases.some((database) => database.id === id),
          )
        : context.databases.map((database) => database.id),
    );
  }, [spaceId]);
  useEffect(() => {
    let alive = true;
    Promise.all([
      refresh(),
      api
        .aiPreferences()
        .then(({ preferences: next }) => {
          if (!alive) return;
          setPreferences(next);
          const requested = next.defaultProvider || "openai";
          const chosen = EXECUTABLE_PROVIDERS.has(requested)
            ? requested
            : "openai";
          setProvider(chosen);
          setModel(next.chatModels?.[chosen] || DEFAULT_MODELS[chosen]);
        })
        .catch(() => undefined),
    ])
      .catch((cause) => alive && setError(errorText(cause)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [refresh]);
  useEffect(() => {
    if (
      !jobs.some((job) => job.status === "queued" || job.status === "running")
    )
      return undefined;
    pollRef.current = window.setInterval(() => {
      void refresh().catch((cause) => setError(errorText(cause)));
    }, 1500);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [jobs, refresh]);
  const selected = useMemo(
    () => databases.filter((database) => selectedIds.includes(database.id)),
    [databases, selectedIds],
  );
  const views = useMemo(
    () => selected.flatMap((database) => database.views),
    [selected],
  );
  const context = useMemo(
    () =>
      buildContext(databases, selectedIds, selectedViewIds, query, revision),
    [databases, query, revision, selectedIds, selectedViewIds],
  );
  const activeJobs = jobs.filter(
    (job) => job.status === "queued" || job.status === "running",
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !objective.trim() || !selectedIds.length) return;
    setBusy(true);
    setError("");
    try {
      if (!EXECUTABLE_PROVIDERS.has(provider) || !model.trim())
        throw new Error(t("Selecciona un proveedor y modelo válidos."));
      if (!context.databases.some((database) => database.rows.length))
        throw new Error(t("La selección no contiene filas utilizables."));
      const title = objective.trim().slice(0, 240);
      const provenance = {
        vaultId: spaceId,
        revision,
        databaseIds: selectedIds.slice(0, MAX_DATABASES),
        viewIds: selectedViewIds,
        rowCount: context.databases.reduce(
          (sum, database) => sum + database.rows.length,
          0,
        ),
        redactedColumns: context.redactedColumns,
      };
      const created = await api.runAI(
        spaceId,
        "database-deep-research",
        {
          provider,
          model: model.trim(),
          maxTokens: 8000,
          messages: [
            {
              role: "system",
              content:
                "Eres un analista de datos cuidadoso. Redacta un informe en Markdown sobre el contexto proporcionado. Usa únicamente esos datos, indica límites y no inventes fuentes. No repitas identificadores de filas ni datos sensibles. Cita la procedencia como [base: columna] usando los nombres incluidos; si no hay evidencia suficiente, dilo.",
            },
            {
              role: "user",
              content: `Objetivo: ${title}\n\nProcedencia (solo lectura): ${JSON.stringify(provenance)}\n\nContexto autorizado y redactado:\n${JSON.stringify(context).slice(0, 1_500_000)}`,
            },
          ],
        },
        csrfToken,
      );
      jobTitles.current.set(created.job.id, title);
      setJobs((current) => [
        created.job,
        ...current.filter((job) => job.id !== created.job.id),
      ]);
      setObjective("");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async (job: AIJob) => {
    try {
      await api.cancelAIJob(job.id, csrfToken);
      await refresh();
    } catch (cause) {
      setError(errorText(cause));
    }
  };
  const retry = async (job: AIJob) => {
    try {
      const result = await api.retryAIJob(job.id, csrfToken);
      setJobs((current) =>
        current.map((entry) => (entry.id === job.id ? result.job : entry)),
      );
    } catch (cause) {
      setError(errorText(cause));
    }
  };
  const materialize = async (job: AIJob) => {
    if (
      job.status !== "completed" ||
      reports.some((report) => report.sourceJobId === job.id) ||
      materializedJobs.current.has(job.id)
    )
      return;
    materializedJobs.current.add(job.id);
    try {
      const artifact = await api.createArtifact(
        {
          vaultId: spaceId,
          kind: "deep-research",
          title: jobTitles.current.get(job.id) || t("Informe de datos"),
          content: extractAIText(job.result),
          metadata: {
            private: true,
            surface: "database-deep-research",
            sourceRevision: revision,
            sourceDatabaseIds: selectedIds,
            sourceViewIds: selectedViewIds,
            provenance: "authorized-vault-projection",
          },
          sourceJobId: job.id,
        },
        csrfToken,
      );
      setReports((current) => [
        normalizeArtifact(artifact.artifact),
        ...current,
      ]);
    } catch (cause) {
      materializedJobs.current.delete(job.id);
      setError(errorText(cause));
    }
  };
  useEffect(() => {
    for (const job of jobs.filter((entry) => entry.status === "completed"))
      void materialize(job);
  }, [jobs]);
  const openReport = async (report: UserArtifact) => {
    try {
      const response = await fetch(
        `/api/v2/me/artifacts/${encodeURIComponent(report.id)}`,
        { credentials: "same-origin", headers: { Accept: "application/json" } },
      );
      const body = response.ok
        ? ((await response.json()) as { artifact?: UserArtifact })
        : null;
      setActiveReport(normalizeArtifact(body?.artifact || report));
    } catch {
      setActiveReport(report);
    }
  };
  const removeReport = async (report: UserArtifact) => {
    if (!window.confirm(t("¿Eliminar este informe privado?"))) return;
    try {
      await api.deleteArtifact(report.id, csrfToken);
      setReports((current) =>
        current.filter((entry) => entry.id !== report.id),
      );
      if (activeReport?.id === report.id) setActiveReport(null);
    } catch (cause) {
      setError(errorText(cause));
    }
  };
  if (loading)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label={t("Cargando bases de datos autorizadas…")} />
      </div>
    );
  if (activeReport)
    return (
      <div
        className="flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
        data-testid="database-deep-research-report"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-neutral-200 p-4 dark:border-neutral-800">
          <button
            className="btn btn-ghost text-xs"
            onClick={() => setActiveReport(null)}
          >
            <Icon name="chevronLeft" size={13} />
            {t("Historial")}
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider text-teal-600">
              {t("Privado para ti")} · Markdown
            </p>
            <h1 className="truncate text-base font-semibold">
              {activeReport.title}
            </h1>
          </div>
          <button
            className="btn btn-ghost text-xs text-red-600"
            onClick={() => void removeReport(activeReport)}
            data-testid="database-deep-research-delete"
          >
            <Icon name="trash" size={13} />
            {t("Eliminar")}
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-5">
          <article className="prose prose-neutral mx-auto max-w-4xl dark:prose-invert">
            <MarkdownReader
              value={activeReport.content || `*${t("Informe sin contenido")}*`}
            />
          </article>
        </main>
      </div>
    );
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
      data-testid="database-deep-research-view"
    >
      <header className="shrink-0 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        <div className="flex flex-wrap items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#b30333]/15 text-[#b30333]">
            <Icon name="telescope" size={20} />
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-[#b30333]">
              {t("Bases de datos")}
            </p>
            <h1 className="text-xl font-semibold">
              {t("Deep Research de datos")}
            </h1>
            <p className="text-xs text-neutral-500">
              {t(
                "Investiga una selección autorizada y conserva el informe solo en tu cuenta.",
              )}
            </p>
          </div>
          <span className="ml-auto rounded-full border border-emerald-300/60 px-3 py-1 text-[11px] text-emerald-700 dark:text-emerald-300">
            <Icon name="lock" size={11} className="mr-1 inline" />
            {t("Privado")}
          </span>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto p-5">
        <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(19rem,.7fr)]">
          <section className="space-y-4">
            <form
              className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-900/60 dark:bg-indigo-950/20"
              onSubmit={(event) => void submit(event)}
              data-testid="database-deep-research-composer"
            >
              <div className="mb-3 flex items-center gap-2">
                <Icon name="edit" size={16} className="text-indigo-500" />
                <h2 className="font-semibold">{t("Nueva investigación")}</h2>
              </div>
              <textarea
                className="input min-h-24 w-full resize-y"
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
                placeholder={t("¿Qué quieres descubrir, comparar o explicar?")}
                required
                data-testid="database-deep-research-objective"
              />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-neutral-500">
                  {t("Proveedor")}
                  <select
                    className="input mt-1 w-full text-xs"
                    value={provider}
                    onChange={(event) => {
                      const next = event.target.value;
                      setProvider(next);
                      setModel(
                        preferences.chatModels?.[next] ||
                          DEFAULT_MODELS[next] ||
                          "",
                      );
                    }}
                  >
                    {[...EXECUTABLE_PROVIDERS].map((entry) => (
                      <option key={entry} value={entry}>
                        {PROVIDER_LABELS[
                          entry as keyof typeof PROVIDER_LABELS
                        ] || entry}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-neutral-500">
                  {t("Modelo")}
                  <select
                    className="input mt-1 w-full text-xs"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    data-testid="database-deep-research-model"
                  >
                    {serverModelsFor(preferences, provider, model).map(
                      (entry) => (
                        <option key={entry} value={entry}>
                          {entry}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              </div>
              <button
                className="btn btn-primary mt-3"
                disabled={busy || !objective.trim() || !selectedIds.length}
              >
                {busy ? t("Enviando…") : t("Iniciar investigación")}
              </button>
              <p className="mt-2 text-[11px] text-neutral-500">
                {tx(
                  "Se enviarán como máximo {n} filas, sin identificadores ni columnas sensibles.",
                  { n: MAX_ROWS.toLocaleString(getActiveLang()) },
                )}
              </p>
            </form>
            {error && (
              <p
                className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
                role="alert"
              >
                {error}
              </p>
            )}
            <section className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">{t("Fuentes autorizadas")}</h2>
                <span className="text-xs text-neutral-500">
                  {context.databases.reduce(
                    (sum, database) => sum + database.rows.length,
                    0,
                  )}{" "}
                  {t("filas de trabajo")}
                </span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {databases.length ? (
                  databases.map((database) => (
                    <label
                      key={database.id}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(database.id)}
                        onChange={() =>
                          setSelectedIds((current) =>
                            current.includes(database.id)
                              ? current.filter((id) => id !== database.id)
                              : [...current, database.id],
                          )
                        }
                      />
                      <Icon name="table" size={13} className="text-[#b30333]" />
                      <span className="min-w-0 flex-1 truncate">
                        {database.name}
                      </span>
                      <span className="text-[10px] text-neutral-500">
                        {database.total}
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="text-sm text-neutral-500">
                    {t("No hay bases disponibles en este vault.")}
                  </p>
                )}
              </div>
              {views.length > 0 && (
                <div className="mt-4">
                  <label className="text-xs font-medium text-neutral-500">
                    {t("Vistas (opcional)")}
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {views.map((view) => (
                      <label
                        key={view.id}
                        className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1 text-[11px] dark:border-neutral-800"
                      >
                        <input
                          type="checkbox"
                          checked={selectedViewIds.includes(view.id)}
                          onChange={() =>
                            setSelectedViewIds((current) =>
                              current.includes(view.id)
                                ? current.filter((id) => id !== view.id)
                                : [...current, view.id],
                            )
                          }
                        />
                        {view.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <label className="mt-4 block text-xs font-medium text-neutral-500">
                {t("Filtro de filas")}
                <input
                  className="input mt-1 w-full text-xs"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("Buscar en valores no sensibles…")}
                />
              </label>
              <p className="mt-3 text-[11px] text-neutral-500">
                {t("La instantánea de trabajo es de solo lectura.")}{" "}
                {context.redactedColumns.length > 0
                  ? tx("{n} columnas sensibles quedan fuera.", {
                      n: context.redactedColumns.length,
                    })
                  : t("No se han detectado columnas sensibles.")}
              </p>
            </section>
          </section>
          <aside className="space-y-4">
            <section
              className="rounded-2xl border border-neutral-200 p-4"
              data-testid="database-deep-research-history"
            >
              <div className="flex items-center gap-2">
                <Icon name="clock" size={15} className="text-indigo-500" />
                <h2 className="font-semibold">{t("Historial y estado")}</h2>
              </div>
              {activeJobs.length > 0 && (
                <div className="mt-3 space-y-2">
                  {activeJobs.map((job) => (
                    <div
                      key={job.id}
                      className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs dark:border-indigo-900 dark:bg-indigo-950/30"
                    >
                      <div className="flex items-center justify-between">
                        <strong>{statusLabel(job.status)}</strong>
                        <button
                          className="btn btn-ghost h-7 text-[11px]"
                          onClick={() => void cancel(job)}
                        >
                          {t("Cancelar")}
                        </button>
                      </div>
                      <p className="mt-1 truncate text-neutral-500">
                        {job.model} · {t("intento")} {job.attempt}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 space-y-2">
                {jobs
                  .filter((job) => !activeJobs.includes(job))
                  .map((job) => (
                    <div
                      key={job.id}
                      className="rounded-lg border border-neutral-200 p-3 text-xs dark:border-neutral-800"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <strong>{statusLabel(job.status)}</strong>
                        {(job.status === "failed" ||
                          job.status === "cancelled") && (
                          <button
                            className="btn btn-ghost h-7 text-[11px]"
                            onClick={() => void retry(job)}
                          >
                            {t("Reintentar")}
                          </button>
                        )}
                      </div>
                      <p className="mt-1 text-[10px] text-neutral-500">
                        {job.model} ·{" "}
                        {new Date(job.updatedAt).toLocaleString(
                          getActiveLang(),
                        )}
                      </p>
                      {job.error?.message && (
                        <p className="mt-1 text-red-600 dark:text-red-300">
                          {job.error.message}
                        </p>
                      )}
                    </div>
                  ))}
              </div>
              {!jobs.length && (
                <p className="mt-3 text-sm text-neutral-500">
                  {t("Todavía no hay investigaciones.")}
                </p>
              )}
            </section>
            <section className="rounded-2xl border border-neutral-200 p-4">
              <div className="flex items-center gap-2">
                <Icon name="book" size={15} className="text-teal-500" />
                <h2 className="font-semibold">{t("Informes privados")}</h2>
              </div>
              {reports.length ? (
                <div className="mt-3 space-y-2">
                  {reports.map((report) => (
                    <div
                      key={report.id}
                      className="flex items-center gap-2 rounded-lg border border-neutral-200 p-2 dark:border-neutral-800"
                    >
                      <button
                        className="min-w-0 flex-1 truncate text-left text-xs font-medium hover:text-indigo-500"
                        onClick={() => void openReport(report)}
                      >
                        {report.title}
                      </button>
                      <button
                        className="btn btn-ghost h-7 px-2 text-[11px] text-red-600"
                        title={t("Eliminar")}
                        aria-label={t("Eliminar")}
                        onClick={() => void removeReport(report)}
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-neutral-500">
                  {t("Los informes completados aparecerán aquí.")}
                </p>
              )}
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
