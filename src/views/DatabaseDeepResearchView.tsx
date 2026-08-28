import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  PromptLanguage,
  ModelRef,
  DatabaseDetail,
  DatabaseRow,
  DatabaseSavedView,
  DatabaseSummary,
} from "@shared/types";
import type {
  DatabaseDeepResearchExportFormat,
  DatabaseDeepResearchJob,
  DatabaseDeepResearchJobInput,
  DatabaseDeepResearchPreview,
  DatabaseDeepResearchReport,
  DatabaseResearchArtifact,
  DatabaseResearchClaim,
  DatabaseResearchDepth,
  DatabaseResearchPhase,
  DatabaseResearchProgress,
  DatabaseResearchSemanticRoles,
  DatabaseResearchStepKind,
  DatabaseDeepResearchReportType,
} from "@shared/databaseDeepResearch";
import {
  DATABASE_DEEP_RESEARCH_REPORT_TYPE_OPTIONS,
  getDatabaseDeepResearchEligibility,
  DATABASE_RESEARCH_BUDGETS,
  DATABASE_RESEARCH_STEP_KINDS,
  redactDatabaseResearchMarkdown,
} from "@shared/databaseDeepResearch";
import type { DatabaseDeepResearchSnapshot } from "../app/viewSnapshots";
import { Icon } from "../components/ui";
import { Markdown } from "../components/Markdown";
import { ModelPicker } from "../components/ModelPicker";
import { getActiveLang, t, tx } from "../i18n";

const DATABASE_REPORT_TYPES = DATABASE_DEEP_RESEARCH_REPORT_TYPE_OPTIONS;
const REPORT_TYPE_ICONS: Record<DatabaseDeepResearchReportType, string> = {
  general: "sparkles",
  data_quality: "shield",
  cohort_comparison: "users",
  temporal_anomalies: "clock",
  relationships_integrity: "network",
  causal_impact: "gitBranch",
  survival_retention: "activity",
  privacy_attachments: "lock",
  formulas_reconciliation: "calculator",
};

const REPORT_LANGUAGE_OPTIONS: Array<{ id: PromptLanguage; label: string }> = [
  { id: "es", label: "Español" },
  { id: "en", label: "English" },
  { id: "fr", label: "Français" },
  { id: "de", label: "Deutsch" },
  { id: "pt", label: "Português (Portugal)" },
  { id: "pt-BR", label: "Português (Brasil)" },
  { id: "it", label: "Italiano" },
  { id: "tr", label: "Türkçe" },
];

function reportTypeApplicability(
  reportType: DatabaseDeepResearchReportType,
  columns: DatabaseDetail["columns"],
  roles: DatabaseResearchSemanticRoles,
  sourceCount: number,
): { enabled: boolean; reason?: string } {
  const eligibility = getDatabaseDeepResearchEligibility(reportType, {
    columns: columns.map((column) => ({ id: column.id, type: column.type })),
    roles,
    databaseCount: sourceCount,
  });
  return {
    enabled: eligibility.applicable,
    reason: eligibility.reasons.length ? eligibility.reasons.join(" ") : undefined,
  };
}

type PreviewSection = { title: string; focus: string; evidenceCount: number };
type ReportSection = { id: string; title: string; markdown: string };
type ReportChart = {
  id: string;
  title: string;
  data: Array<Record<string, unknown>>;
};
interface EvidenceItem {
  id: string;
  label: string;
  excerpt: string;
  databaseName?: string;
  rowIds: string[];
  method?: string;
  n?: number;
  denominator?: number;
  interval?: { low: number; high: number; level: number };
  pValue?: number | null;
  qValue?: number | null;
  confidence?: number | null;
  columnIds?: string[];
  filters?: { query: string; columnIds: string[] };
  hash?: string;
  warnings?: string[];
  status?: DatabaseResearchClaim["status"];
}
interface ReaderReport {
  id: string;
  runId: string;
  title: string;
  summary: string;
  markdown: string;
  createdAt: string;
  sections: ReportSection[];
  charts: ReportChart[];
  evidence: EvidenceItem[];
  costUsd?: number;
  qualityStatus?: string;
  reportType: DatabaseDeepResearchReportType;
}

const inputClass = "input min-h-10 w-full";
const cardClass =
  "rounded-2xl border border-neutral-200 bg-white/70 p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-950/35";
const muted = "text-xs leading-5 text-neutral-500 dark:text-neutral-400";
const DEPTHS: Array<{
  id: DatabaseResearchDepth;
  label: string;
  detail: string;
  multiplier: number;
}> = [
  {
    id: "focused",
    label: "Enfocada",
    detail: "Una pasada, síntesis compacta",
    multiplier: 0.6,
  },
  {
    id: "deep",
    label: "Profunda",
    detail: "Cobertura y contraste recomendados",
    multiplier: 1,
  },
  {
    id: "exhaustive",
    label: "Exhaustiva",
    detail: "Más iteraciones y evidencia",
    multiplier: 2.8,
  },
];
const ROLE_DEFS: Array<{
  id: keyof DatabaseResearchSemanticRoles;
  label: string;
  hint: string;
  multiple?: boolean;
}> = [
  {
    id: "outcome",
    label: "Resultado",
    hint: "Variable que quieres explicar o estimar.",
  },
  {
    id: "treatment",
    label: "Tratamiento",
    hint: "Exposición, intervención o grupo comparado.",
  },
  {
    id: "confounders",
    label: "Confusores",
    hint: "Variables que pueden explicar una asociación.",
    multiple: true,
  },
  {
    id: "group",
    label: "Cohorte o grupo",
    hint: "Categoría que define los grupos que se compararán.",
  },
  {
    id: "metrics",
    label: "Métricas",
    hint: "Medidas numéricas que se resumirán o compararán.",
    multiple: true,
  },
  { id: "time", label: "Tiempo", hint: "Fecha o instante de la observación." },
  {
    id: "duration",
    label: "Duración",
    hint: "Tiempo hasta el resultado o evento.",
  },
  { id: "event", label: "Evento", hint: "Indicador de que el evento ocurrió." },
  {
    id: "entity",
    label: "Entidad",
    hint: "Unidad, persona o registro observado.",
  },
  {
    id: "text",
    label: "Texto",
    hint: "Columnas textuales para contexto.",
    multiple: true,
  },
  { id: "location", label: "Ubicación", hint: "Lugar o coordenada asociada." },
  {
    id: "sensitive",
    label: "Datos sensibles",
    hint: "Columnas que deben redactarse y auditarse con precaución.",
    multiple: true,
  },
  {
    id: "reconciliation",
    label: "Reconciliación",
    hint: "Columnas de totales, fórmulas o controles que deben cuadrar.",
    multiple: true,
  },
];
const PHASE_LABELS: Record<DatabaseResearchStepKind, string> = {
  snapshot: "Capturar snapshot",
  semantic_profile: "Perfilar semántica",
  planning: "Planificar análisis",
  calculations: "Calcular resultados",
  sensitivity: "Comprobar sensibilidad",
  adversarial_review: "Revisar objeciones",
  verification: "Verificar evidencia",
  assembly: "Ensamblar informe",
};
const PHASE_HINTS: Record<DatabaseResearchStepKind, string> = {
  snapshot: "Fija las filas, vistas y filtros usados.",
  semantic_profile: "Describe tipos, cobertura y valores ausentes.",
  planning: "Explicita hipótesis, estimandos y riesgos.",
  calculations: "Ejecuta los cálculos reproducibles.",
  sensitivity: "Mide la estabilidad ante supuestos alternativos.",
  adversarial_review: "Busca contraejemplos y explicaciones rivales.",
  verification: "Contrasta claims con su ledger de evidencia.",
  assembly: "Redacta el informe y sus limitaciones.",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
function phaseLabel(phase: string | null | undefined): string {
  return phase && phase in PHASE_LABELS
    ? t(PHASE_LABELS[phase as DatabaseResearchStepKind])
    : phase || t("En cola");
}
function progressPercent(value: number): number {
  const n = Number(value) || 0;
  return Math.round(Math.min(100, Math.max(0, n <= 1 ? n * 100 : n)));
}
function outputMetric(
  value: unknown,
  keys: Set<string>,
  depth = 0,
): number | null {
  if (depth > 5 || value == null || typeof value !== "object") return null;
  for (const [key, item] of Object.entries(value as Record<string, unknown>))
    if (keys.has(key) && typeof item === "number" && Number.isFinite(item))
      return item;
  for (const item of Object.values(value as Record<string, unknown>)) {
    const found = outputMetric(item, keys, depth + 1);
    if (found != null) return found;
  }
  return null;
}
function outputInterval(value: unknown): EvidenceItem["interval"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const interval = (value as Record<string, unknown>).confidenceInterval;
  return Array.isArray(interval) &&
    interval.length === 2 &&
    interval.every((item) => typeof item === "number" && Number.isFinite(item))
    ? { low: interval[0] as number, high: interval[1] as number, level: 0.95 }
    : undefined;
}
function artifactEvidence(artifact: DatabaseResearchArtifact): EvidenceItem {
  const inputs = artifact.inputs ?? {};
  const unusable =
    artifact.n <= 0 ||
    artifact.warnings.some((warning) =>
      /empty|failed|insufficient|not enough|error|non[- ]?converg/i.test(
        warning,
      ),
    );
  const status = unusable
    ? "unverifiable"
    : ["kaplanMeier", "logRank", "coxPH", "ipw", "simpson"].includes(
          artifact.method,
        ) || artifact.warnings.length > 0
      ? "sensitive"
      : [
            "correlation",
            "linearRegression",
            "logisticRegression",
            "pca",
            "changePoints",
            "acf",
            "relationGraph",
          ].includes(artifact.method)
        ? "exploratory"
        : "verified";
  return {
    id: artifact.id,
    label: artifact.method || t("Resultado reproducible"),
    excerpt: "Resultado agregado disponible; los valores de celdas están redactados.",
    // Row identifiers are sensitive operational data and are not needed to
    // reproduce an aggregate claim in the reader.
    rowIds: [],
    method: artifact.method,
    n: artifact.n,
    denominator: artifact.denominator,
    interval: outputInterval(artifact.output),
    pValue: outputMetric(artifact.output, new Set(["p", "pValue"])),
    qValue: outputMetric(artifact.output, new Set(["qValue"])),
    columnIds: Array.isArray(inputs.columnIds)
      ? inputs.columnIds.map(String)
      : undefined,
    filters: artifact.filters ? { ...artifact.filters, query: "" } : undefined,
    hash: artifact.hash,
    warnings: artifact.warnings,
    status,
  };
}
function claimEvidence(claim: DatabaseResearchClaim): EvidenceItem {
  const evidence = claim.evidence ?? {};
  return {
    id: claim.id,
    label: claim.text,
    excerpt: "Afirmación respaldada por evidencia determinista; valores sensibles omitidos.",
    rowIds: [],
    method: typeof evidence.method === "string" ? evidence.method : undefined,
    n: typeof evidence.n === "number" ? evidence.n : undefined,
    denominator:
      typeof evidence.denominator === "number"
        ? evidence.denominator
        : undefined,
    interval: claim.interval ?? undefined,
    pValue: claim.pValue,
    qValue: claim.qValue,
    confidence: claim.confidence,
    columnIds: Array.isArray(evidence.columnIds)
      ? evidence.columnIds.map(String)
      : undefined,
    filters:
      typeof evidence.filters === "object" && evidence.filters
        ? { ...(evidence.filters as { query: string; columnIds: string[] }), query: "" }
        : undefined,
    hash: typeof evidence.hash === "string" ? evidence.hash : undefined,
    warnings: claim.limitations,
    status: claim.status,
  };
}
function normalizeReport(report: DatabaseDeepResearchReport): ReaderReport {
  const structured = report.structured ?? {};
  const rawSections = Array.isArray(structured.sections)
    ? structured.sections
    : [];
  const rawArtifacts = Array.isArray(structured.evidenceLedger)
    ? structured.evidenceLedger
    : [];
  const rawClaims = Array.isArray(structured.claims) ? structured.claims : [];
  const rawCharts = Array.isArray(structured.charts) ? structured.charts : [];
  const metadata = report.metadata ?? {};
  const cost = metadata.costUsd ?? metadata.estimatedCostUsd;
  const reportType = String(
    (report as DatabaseDeepResearchReport & { reportType?: unknown }).reportType ??
      metadata.reportType ??
      "general",
  ) as DatabaseDeepResearchReportType;
  return {
    id: report.id,
    runId: report.runId,
    title: report.title,
    summary: report.summary ?? "",
    markdown: redactDatabaseResearchMarkdown(report.markdown),
    createdAt: report.createdAt,
    sections: rawSections
      .filter(
        (item): item is ReportSection =>
          !!item && typeof item === "object" && typeof item.title === "string",
      )
      .map((item) => ({
        id: item.id || item.title,
        title: item.title,
        markdown: redactDatabaseResearchMarkdown(item.markdown || ""),
      })),
    charts: rawCharts
      .filter(
        (item): item is ReportChart =>
          !!item &&
          typeof item === "object" &&
          typeof item.id === "string" &&
          typeof item.title === "string" &&
          Array.isArray(item.data),
      )
      .map((item) => ({
        ...item,
        data: item.data.filter((row) => row && typeof row === "object"),
      })),
    evidence: [
      ...rawArtifacts
        .filter(
          (item): item is DatabaseResearchArtifact =>
            !!item && typeof item === "object",
        )
        .map(artifactEvidence),
      ...rawClaims
        .filter(
          (item): item is DatabaseResearchClaim =>
            !!item && typeof item === "object",
        )
        .map(claimEvidence),
    ],
    costUsd: typeof cost === "number" ? cost : undefined,
    qualityStatus:
      typeof report.quality?.status === "string"
        ? report.quality.status
        : undefined,
    reportType: DATABASE_REPORT_TYPES.some((item) => item.id === reportType)
      ? reportType
      : "general",
  };
}

function ReportCharts({ charts }: { charts: ReportChart[] }) {
  if (!charts.length) return null;
  return (
    <section
      data-testid="database-deep-research-charts"
      className="mb-8 grid gap-4 lg:grid-cols-2"
    >
      {charts.map((chart) => {
        const points = chart.data.map((row) => {
          const value =
            typeof row.value === "number" && Number.isFinite(row.value)
              ? row.value
              : typeof row.rate === "number" && Number.isFinite(row.rate)
              ? row.rate
              : typeof row.median === "number" && Number.isFinite(row.median)
                ? row.median
                : 0;
          return {
            label: String(row.label ?? row.columnId ?? row.artifactId ?? "—"),
            value,
            n: typeof row.n === "number" && Number.isFinite(row.n) ? row.n : null,
          };
        });
        const scale = Math.max(
          1,
          ...points.map((point) => Math.abs(point.value)),
        );
        const hasNegative = points.some((point) => point.value < 0);
        return (
          <figure
            key={chart.id}
            className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800"
            aria-label={chart.title}
          >
            <figcaption className="mb-3 text-sm font-semibold">
              {chart.title}
            </figcaption>
            <div className="space-y-2">
              {points.map((point, index) => (
                <div
                  key={`${point.label}:${index}`}
                  className="grid grid-cols-[minmax(5rem,.8fr)_2fr_auto] items-center gap-2 text-xs"
                >
                  <span
                    className="truncate text-neutral-500"
                    title={point.label}
                  >
                    {point.label}
                  </span>
                  <span
                    className="relative h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-900"
                    role="img"
                    aria-label={`${point.label}: ${Number(point.value.toPrecision(6))}${point.n == null ? "" : `, n=${point.n}`}`}
                  >
                    {hasNegative ? <span className="absolute inset-y-0 left-1/2 w-px bg-neutral-400/70" /> : null}
                    <span
                      className={`absolute h-full rounded-full ${point.value < 0 ? "bg-amber-500" : "bg-cyan-500"}`}
                      style={{
                        width: `${Math.max(1, Math.min(hasNegative ? 50 : 100, (Math.abs(point.value) / scale) * (hasNegative ? 50 : 100)))}%`,
                        left: hasNegative ? (point.value < 0 ? "50%" : "50%") : "0",
                        transform: point.value < 0 ? "translateX(-100%)" : undefined,
                      }}
                    />
                  </span>
                  <span className="font-mono tabular-nums">
                    {Number(point.value.toPrecision(6))}{point.n == null ? "" : ` · n=${point.n}`}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between font-mono text-[10px] tabular-nums text-neutral-400" aria-hidden="true">
              <span>{hasNegative ? Number((-scale).toPrecision(4)) : 0}</span>
              {hasNegative ? <span>0</span> : null}
              <span>{Number(scale.toPrecision(4))}</span>
            </div>
          </figure>
        );
      })}
    </section>
  );
}
function EmptyState({
  icon = "table",
  children,
}: {
  icon?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-28 place-items-center rounded-xl border border-dashed border-neutral-300 p-5 text-center text-sm text-neutral-500 dark:border-neutral-700">
      <Icon name={icon} size={22} className="mb-2 opacity-50" />
      {children}
    </div>
  );
}
function SectionHeading({
  icon,
  title,
  detail,
}: {
  icon: string;
  title: string;
  detail?: string;
}) {
  return (
    <div className="mb-3 flex items-start gap-2">
      <Icon name={icon} size={17} className="mt-0.5 text-cyan-500" />
      <div>
        <h2 className="font-semibold">{title}</h2>
        {detail && <p className={muted}>{detail}</p>}
      </div>
    </div>
  );
}
function roleValue(
  roles: DatabaseResearchSemanticRoles,
  id: keyof DatabaseResearchSemanticRoles,
): string | string[] {
  const value = roles[id];
  return Array.isArray(value) ? value : (value ?? "");
}

export function DatabaseDeepResearchView({
  settings,
  snapshot,
  onSnapshotChange,
}: {
  settings: import("@shared/types").AppSettings;
  snapshot?: DatabaseDeepResearchSnapshot;
  onSnapshotChange?: (patch: Partial<DatabaseDeepResearchSnapshot>) => void;
}) {
  const [databases, setDatabases] = useState<DatabaseSummary[]>([]);
  const [details, setDetails] = useState<
    Array<{
      detail: DatabaseDetail;
      rows: DatabaseRow[];
      views: DatabaseSavedView[];
    }>
  >([]);
  const [selectedDatabaseIds, setSelectedDatabaseIds] = useState<string[]>(
    snapshot?.selectedDatabaseIds ?? [],
  );
  const [selectedViewIds, setSelectedViewIds] = useState<string[]>(
    snapshot?.selectedViewIds ?? [],
  );
  const [objective, setObjective] = useState("");
  const [reportType, setReportType] = useState<DatabaseDeepResearchReportType>("general");
  const [reportLanguage, setReportLanguage] = useState<PromptLanguage>(() => getActiveLang() as PromptLanguage);
  const [query, setQuery] = useState("");
  const [columnIds, setColumnIds] = useState<string[]>([]);
  const [depth, setDepth] = useState<DatabaseResearchDepth>("deep");
  const [maxCostUsd, setMaxCostUsd] = useState(2.5);
  const [model, setModel] = useState<ModelRef | null>(
    settings.deepResearchModel ?? null,
  );
  const [roles, setRoles] = useState<DatabaseResearchSemanticRoles>({});
  const [preview, setPreview] = useState<DatabaseDeepResearchPreview | null>(
    null,
  );
  const [previewSections, setPreviewSections] = useState<PreviewSection[]>([]);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<DatabaseDeepResearchJob[]>([]);
  const [reports, setReports] = useState<ReaderReport[]>([]);
  const [reportFilter, setReportFilter] = useState<DatabaseDeepResearchReportType | "all">("all");
  const [reader, setReader] = useState<ReaderReport | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceItem | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [includeSnapshot, setIncludeSnapshot] = useState(false);
  const selectedDetails = useMemo(
    () =>
      details.filter(({ detail }) =>
        selectedDatabaseIds.includes(detail.database.id),
      ),
    [details, selectedDatabaseIds],
  );
  const columns = useMemo(
    () => selectedDetails.flatMap(({ detail }) => detail.columns),
    [selectedDetails],
  );
  const columnOwners = useMemo(
    () =>
      new Map(
        selectedDetails.flatMap(({ detail }) =>
          detail.columns.map(
            (column) => [column.id, detail.database.id] as const,
          ),
        ),
      ),
    [selectedDetails],
  );
  const preset = DATABASE_RESEARCH_BUDGETS[depth];
  const input = useMemo<DatabaseDeepResearchJobInput & { reportType: DatabaseDeepResearchReportType }>(
    () => ({
      objective: objective.trim(),
      reportType,
      language: reportLanguage,
      databaseIds: selectedDatabaseIds,
      viewIds: selectedViewIds,
      filters: { query: query.trim(), columnIds },
      roles,
      model,
      depth,
      budget: { ...preset, depth, maxRows: 500_000, maxCostUsd },
      includeAttachmentContent: false,
    }),
    [
      objective,
      reportType,
      reportLanguage,
      selectedDatabaseIds,
      selectedViewIds,
      query,
      columnIds,
      roles,
      model,
      depth,
      preset,
      maxCostUsd,
    ],
  );
  const reportTypeStates = useMemo(
    () => new Map(DATABASE_REPORT_TYPES.map((item) => [
      item.id,
      reportTypeApplicability(item.id, columns, roles, selectedDatabaseIds.length),
    ])),
    [columns, roles, selectedDatabaseIds.length],
  );
  const visibleReports = useMemo(
    () => reportFilter === "all" ? reports : reports.filter((report) => report.reportType === reportFilter),
    [reportFilter, reports],
  );

  const load = useCallback(async () => {
    const list = await window.nodus.listDatabases();
    setDatabases(list);
    setSelectedDatabaseIds((current) =>
      current.length
        ? current.filter((id) => list.some((db) => db.id === id))
        : list.map((db) => db.id),
    );
    const loaded = await Promise.all(
      list.map(async (database) => {
        const detail = await window.nodus.getDatabaseDetail(database.id);
        if (!detail) return null;
        const [rows, views] = await Promise.all([
          window.nodus.listDatabaseRows(database.id, { limit: 120 }),
          window.nodus.listDatabaseViews(database.id),
        ]);
        return { detail, rows, views };
      }),
    );
    setDetails(
      loaded.filter(Boolean) as Array<{
        detail: DatabaseDetail;
        rows: DatabaseRow[];
        views: DatabaseSavedView[];
      }>,
    );
  }, []);
  const loadJobsAndReports = useCallback(async () => {
    const [loadedJobs, loadedReports] = await Promise.all([
      window.nodus.listDatabaseDeepResearchJobs(),
      window.nodus.listDatabaseDeepResearchReports(),
    ]);
    setJobs(loadedJobs);
    setReports(
      loadedReports.map((report) =>
        normalizeReport(report as DatabaseDeepResearchReport),
      ),
    );
  }, []);
  useEffect(() => {
    void load().catch((error) => setPreviewError((error as Error).message));
    void loadJobsAndReports().catch((error) =>
      setPreviewError((error as Error).message),
    );
  }, [load, loadJobsAndReports]);
  useEffect(
    () =>
      window.nodus.onDatabaseDeepResearchProgress(
        (progress: DatabaseResearchProgress) => {
          setJobs((current) =>
            current.map((job) =>
              job.id === progress.runId
                ? {
                    ...job,
                    status: progress.status,
                    progress: progressPercent(progress.progress),
                    phase: progress.phase ?? progress.step ?? job.phase,
                    error: progress.error ?? job.error,
                  }
                : job,
            ),
          );
          if (
            ["completed", "partial", "failed", "cancelled", "stale"].includes(
              progress.status,
            )
          )
            void loadJobsAndReports();
        },
      ),
    [loadJobsAndReports],
  );
  const makePreview = useCallback(async () => {
    if (!selectedDatabaseIds.length) {
      setPreview(null);
      setPreviewSections([]);
      return;
    }
    setPreviewBusy(true);
    setPreviewError(null);
    try {
      const next = await window.nodus.previewDatabaseDeepResearch(input);
      setPreview(next);
      setPreviewSections(next.sections);
    } catch (error) {
      setPreviewError((error as Error).message);
    } finally {
      setPreviewBusy(false);
    }
  }, [input, selectedDatabaseIds.length]);
  useEffect(() => {
    const timer = window.setTimeout(() => void makePreview(), 250);
    return () => window.clearTimeout(timer);
  }, [makePreview]);
  const toggleDatabase = (id: string) =>
    setSelectedDatabaseIds((current) => {
      const next = current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id];
      const allowedColumns = new Set(
        details
          .filter(({ detail }) => next.includes(detail.database.id))
          .flatMap(({ detail }) => detail.columns.map((column) => column.id)),
      );
      const allowedViews = new Set(
        details
          .filter(({ detail }) => next.includes(detail.database.id))
          .flatMap(({ views }) => views.map((view) => view.id)),
      );
      setColumnIds((selected) =>
        selected.filter((columnId) => allowedColumns.has(columnId)),
      );
      setSelectedViewIds((selected) => {
        const sanitized = selected.filter((viewId) => allowedViews.has(viewId));
        onSnapshotChange?.({
          selectedDatabaseIds: next,
          selectedViewIds: sanitized,
        });
        return sanitized;
      });
      setRoles(
        (currentRoles) =>
          Object.fromEntries(
            Object.entries(currentRoles).flatMap(([role, value]) => {
              const kept = (
                Array.isArray(value) ? value : value ? [value] : []
              ).filter((columnId) => allowedColumns.has(columnId));
              return kept.length
                ? [[role, Array.isArray(value) ? kept : kept[0]]]
                : [];
            }),
          ) as DatabaseResearchSemanticRoles,
      );
      return next;
    });
  const toggleView = (id: string) =>
    setSelectedViewIds((current) => {
      const owner = details.find(({ views }) =>
        views.some((view) => view.id === id),
      );
      const siblingIds = new Set(owner?.views.map((view) => view.id) ?? []);
      const next = current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current.filter((value) => !siblingIds.has(value)), id];
      onSnapshotChange?.({ selectedViewIds: next });
      return next;
    });
  const toggleColumn = (id: string) =>
    setColumnIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  const updateSection = (
    index: number,
    field: "title" | "focus",
    value: string,
  ) =>
    setPreviewSections((current) =>
      current.map((section, i) =>
        i === index ? { ...section, [field]: value } : section,
      ),
    );
  const setRole = (
    id: keyof DatabaseResearchSemanticRoles,
    value: string | string[],
  ) =>
    setRoles((current) => ({
      ...current,
      [id]: Array.isArray(value) ? value : value || undefined,
    }));
  const startResearch = async () => {
    if (!objective.trim()) {
      setToast(t("Escribe un objetivo antes de iniciar la investigación."));
      return;
    }
    if (!selectedDatabaseIds.length) {
      setToast(t("Selecciona al menos una base de datos."));
      return;
    }
    if (!model) {
      setToast(t("Selecciona un modelo antes de iniciar la investigación."));
      return;
    }
    if (!reportTypeStates.get(reportType)?.enabled) {
      setToast(t(reportTypeStates.get(reportType)?.reason ?? "Este tipo de informe no es aplicable a la selección."));
      return;
    }
    const sensitiveGroups = [
      [roles.duration, roles.event, ...(roles.confounders ?? [])],
      [roles.treatment, roles.outcome, ...(roles.confounders ?? [])],
    ];
    if (
      sensitiveGroups.some(
        (group) =>
          new Set(
            group
              .filter((id): id is string => Boolean(id))
              .map((id) => columnOwners.get(id)),
          ).size > 1,
      )
    ) {
      setToast(
        t("Los roles sensibles deben pertenecer a una sola base de datos."),
      );
      return;
    }
    if (preview && preview.estimatedCostUsd > maxCostUsd) {
      setToast(t("Ajusta la profundidad o aumenta el límite"));
      return;
    }
    setBusy(true);
    try {
      const job = await window.nodus.enqueueDatabaseDeepResearch({
        ...input,
        model,
        planSections: previewSections,
      });
      setJobs((current) => [
        job,
        ...current.filter((item) => item.id !== job.id),
      ]);
      setToast(t("Investigación añadida a la cola."));
      void loadJobsAndReports();
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const clearFinishedJobs = async () => {
    await window.nodus.clearFinishedDatabaseDeepResearchJobs();
    await loadJobsAndReports();
  };
  const cancelJob = async (id: string) => {
    await window.nodus.cancelDatabaseDeepResearchJob(id);
    await loadJobsAndReports();
  };
  const deleteReport = async (id: string) => {
    await window.nodus.deleteDatabaseDeepResearchReport(id);
    setReports((current) => current.filter((report) => report.id !== id));
    if (reader?.id === id) setReader(null);
  };
  const openReport = useCallback(
    async (report: ReaderReport) => {
      const loaded = await window.nodus.getDatabaseDeepResearchReport(
        report.id,
      );
      setReader(
        loaded ? normalizeReport(loaded as DatabaseDeepResearchReport) : report,
      );
      setEvidenceOpen(false);
      setSelectedEvidence(null);
      onSnapshotChange?.({ openReportId: report.id });
    },
    [onSnapshotChange],
  );
  useEffect(() => {
    if (!reader && snapshot?.openReportId) {
      const report = reports.find((item) => item.id === snapshot.openReportId);
      if (report) void openReport(report);
    }
  }, [openReport, reader, reports, snapshot?.openReportId]);
  const exportReport = async (format: DatabaseDeepResearchExportFormat) => {
    if (!reader) return;
    if (
      includeSnapshot &&
      format === "zip" &&
      !window.confirm(
        t(
          "El ZIP incluirá el snapshot bruto de las filas seleccionadas. ¿Continuar?",
        ),
      )
    )
      return;
    try {
      const result = await window.nodus.exportDatabaseDeepResearchReport(
        reader.id,
        { format, includeSnapshot: includeSnapshot && format === "zip" },
      );
      if (!result.canceled)
        setToast(tx("Exportado: {path}", { path: result.path ?? "" }));
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setExportOpen(false);
    }
  };
  const activeJob =
    jobs.find((job) => job.status === "running" || job.status === "stale") ??
    jobs[0];
  const staleJobs = jobs.filter((job) => job.status === "stale");
  const partialJobs = jobs.filter((job) => job.status === "partial");
  const activePhase = activeJob?.phase as
    DatabaseResearchPhase | null | undefined;

  return (
    <div
      className="h-full overflow-y-auto"
      data-testid="database-deep-research"
    >
      <div className="mx-auto max-w-7xl space-y-5 p-5 md:p-7">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-100 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300">
              <Icon name="telescope" size={21} />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[.18em] text-cyan-600 dark:text-cyan-400">
                {t("Bases de datos")}
              </p>
              <h1 className="text-2xl font-semibold tracking-tight">
                {t("Deep Research de datos")}
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-neutral-500 dark:text-neutral-400">
                {t(
                  "Investiga tus tablas con una pregunta clara, trazabilidad de fuentes y control del coste.",
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800">
            <Icon name="lock" size={13} className="text-emerald-500" />
            {t("Solo usa datos de este vault")}
          </div>
        </header>
        {staleJobs.length > 0 && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100"
          >
            <Icon name="alert" size={16} className="mt-0.5" />
            <span>
              {tx(
                "{n} investigación(es) usan un snapshot obsoleto. Revisa las fuentes antes de confiar en el informe.",
                { n: staleJobs.length },
              )}
            </span>
          </div>
        )}
        {partialJobs.length > 0 && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-violet-300 bg-violet-50 px-4 py-3 text-sm text-violet-900 dark:border-violet-900/70 dark:bg-violet-950/30 dark:text-violet-100"
          >
            <Icon name="alert" size={16} className="mt-0.5" />
            <span>
              {tx(
                "{n} investigación(es) terminaron parcialmente. Revisa limitaciones y evidencia antes de usar sus conclusiones.",
                { n: partialJobs.length },
              )}
            </span>
          </div>
        )}
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(21rem,.75fr)]">
          <main className="space-y-5">
            <section
              className={cardClass}
              data-testid="database-deep-research-composer"
            >
              <SectionHeading
                icon="edit"
                title={t("1. Define el objetivo")}
                detail={t(
                  "La pregunta guía qué filas se leen y cómo se organiza la respuesta.",
                )}
              />
              <textarea
                data-testid="database-deep-research-objective"
                className={`${inputClass} min-h-24 resize-y py-3`}
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
                placeholder={t(
                  "¿Qué quieres descubrir, comparar o explicar con estas bases de datos?",
                )}
              />
              <div className="mt-4">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <label className="text-xs font-medium text-neutral-500">
                    {t("Tipo de informe")}
                  </label>
                  <span className="text-[11px] text-neutral-400">
                    {t("Elige el enfoque; Nodus validará sus requisitos.")}
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {DATABASE_REPORT_TYPES.map((item) => {
                    const state = reportTypeStates.get(item.id) ?? { enabled: true };
                    const selected = reportType === item.id;
                    return (
                      <button
                        type="button"
                        key={item.id}
                        disabled={!state.enabled}
                        title={state.enabled ? t(item.description) : t(state.reason ?? "No aplicable a esta selección.")}
                        aria-pressed={selected}
                        data-testid={`database-deep-research-report-type-${item.id}`}
                        onClick={() => setReportType(item.id)}
                        className={`rounded-xl border p-3 text-left transition-colors ${selected ? "border-cyan-500 bg-cyan-50 text-cyan-900 dark:bg-cyan-950/35 dark:text-cyan-100" : "border-neutral-200 dark:border-neutral-800"} ${!state.enabled ? "cursor-not-allowed opacity-45" : "hover:border-cyan-400"}`}
                      >
                        <span className="flex items-center gap-2 text-xs font-semibold">
                          <Icon name={REPORT_TYPE_ICONS[item.id]} size={14} className="text-cyan-500" />
                          {t(item.label)}
                        </span>
                        <span className="mt-1 block text-[11px] leading-4 opacity-75">
                          {state.enabled ? t(item.description) : t(state.reason ?? "No aplicable a esta selección.")}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-500">
                    {t("Bases y vistas")}
                  </label>
                  <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-neutral-200 p-2 dark:border-neutral-800">
                    {databases.length ? (
                      databases.map((database) => (
                        <div key={database.id}>
                          <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900">
                            <input
                              type="checkbox"
                              checked={selectedDatabaseIds.includes(
                                database.id,
                              )}
                              onChange={() => toggleDatabase(database.id)}
                            />
                            <Icon
                              name={database.icon || "table"}
                              size={14}
                              className="text-cyan-500"
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {database.name}
                            </span>
                            <span className="text-[10px] text-neutral-500">
                              {database.rowCount}
                            </span>
                          </label>
                          {selectedDatabaseIds.includes(database.id) &&
                            details
                              .find(
                                ({ detail }) =>
                                  detail.database.id === database.id,
                              )
                              ?.views.map((view) => (
                                <label
                                  key={view.id}
                                  className="ml-7 flex cursor-pointer items-center gap-2 py-1 text-xs text-neutral-500"
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedViewIds.includes(view.id)}
                                    onChange={() => toggleView(view.id)}
                                  />
                                  {view.name}
                                </label>
                              ))}
                        </div>
                      ))
                    ) : (
                      <EmptyState>
                        {t("No hay bases de datos disponibles.")}
                      </EmptyState>
                    )}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-500">
                    {t("Filtro de filas")}
                  </label>
                  <input
                    className={inputClass}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("Buscar texto dentro de las filas…")}
                  />
                  <p className={`${muted} mt-2`}>
                    {t(
                      "El filtro solo recorta el conjunto de trabajo; no modifica tus bases.",
                    )}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {columns.map((column) => (
                      <label
                        key={column.id}
                        className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1 text-xs dark:border-neutral-800"
                      >
                        <input
                          type="checkbox"
                          checked={columnIds.includes(column.id)}
                          onChange={() => toggleColumn(column.id)}
                        />
                        {column.name}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </section>
            <section
              className={cardClass}
              data-testid="database-deep-research-roles"
            >
              <SectionHeading
                icon="layers"
                title={t("2. Asigna roles a las columnas")}
                detail={t(
                  "Ayuda al planificador a distinguir resultados, tratamientos, tiempo y confusores.",
                )}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                {ROLE_DEFS.map((role) => (
                  <label key={role.id} className="text-xs text-neutral-500">
                    {t(role.label)}
                    <select
                      multiple={role.multiple}
                      size={role.multiple ? 3 : undefined}
                      className={`${inputClass} mt-1`}
                      value={
                        role.multiple
                          ? (roleValue(roles, role.id) as string[])
                          : (roleValue(roles, role.id) as string)
                      }
                      onChange={(event) =>
                        setRole(
                          role.id,
                          role.multiple
                            ? Array.from(
                                event.target.selectedOptions,
                                (option) => option.value,
                              )
                            : event.target.value,
                        )
                      }
                    >
                      {!role.multiple && (
                        <option value="">
                          {t("Detectar automáticamente")}
                        </option>
                      )}
                      {columns.map((column) => (
                        <option
                          key={`${role.id}:${column.id}`}
                          value={column.id}
                        >
                          {column.name}
                        </option>
                      ))}
                    </select>
                    <span className="mt-1 block text-[11px] text-neutral-400">
                      {t(role.hint)}
                    </span>
                  </label>
                ))}
              </div>
            </section>
            <section
              className={cardClass}
              data-testid="database-deep-research-preview"
            >
              <SectionHeading
                icon="eye"
                title={t("3. Preview editable")}
                detail={t(
                  "Revisa la muestra y ajusta la estructura antes de gastar presupuesto.",
                )}
              />
              {previewBusy ? (
                <div className="flex items-center gap-2 py-5 text-sm text-neutral-500">
                  <Icon name="sync" className="animate-spin" size={15} />
                  {t("Preparando preview…")}
                </div>
              ) : preview ? (
                <>
                  <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      [t("Filas"), preview.rowCount],
                      [t("Fuentes"), preview.sourceCount],
                      [t("Tokens"), preview.estimatedTokens.toLocaleString()],
                      [
                        t("Estimación"),
                        `$${preview.estimatedCostUsd.toFixed(2)}`,
                      ],
                    ].map(([label, value]) => (
                      <div
                        key={String(label)}
                        className="rounded-xl bg-neutral-100 p-3 dark:bg-neutral-900"
                      >
                        <div className="text-[11px] uppercase tracking-wide text-neutral-500">
                          {label}
                        </div>
                        <div className="mt-1 font-semibold">{value}</div>
                      </div>
                    ))}
                  </div>
                  {Array.isArray((preview as DatabaseDeepResearchPreview & { warnings?: string[] }).warnings) &&
                    (preview as DatabaseDeepResearchPreview & { warnings?: string[] }).warnings!.length > 0 && (
                    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                      {(preview as DatabaseDeepResearchPreview & { warnings: string[] }).warnings.map((warning) => <p key={warning}>{warning}</p>)}
                    </div>
                  )}
                  {preview.eligibility && !preview.eligibility.applicable && (
                    <div className="mb-4 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
                      <strong>{t("Este tipo de informe no es aplicable a la selección.")}</strong>
                      {preview.eligibility.reasons.map((reason) => <p key={reason} className="mt-1">{t(reason)}</p>)}
                    </div>
                  )}
                  {(preview.requiredAnalyses?.length || preview.optionalAnalyses?.length) ? (
                    <div className="mb-4 grid gap-3 sm:grid-cols-2" data-testid="database-deep-research-analysis-requirements">
                      <div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
                        <p className="mb-2 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
                          {t("Análisis obligatorios")}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {(preview.requiredAnalyses ?? []).map((analysis) => (
                            <code key={analysis} className="rounded-md bg-cyan-50 px-2 py-1 text-[11px] text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-200">{analysis}</code>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
                        <p className="mb-2 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
                          {t("Análisis opcionales")}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {(preview.optionalAnalyses ?? []).map((analysis) => (
                            <code key={analysis} className="rounded-md bg-neutral-100 px-2 py-1 text-[11px] text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">{analysis}</code>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    {previewSections.map((section, index) => (
                      <div
                        key={`${index}:${section.title}`}
                        className="grid gap-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800 sm:grid-cols-[1fr_1.4fr_auto]"
                      >
                        <input
                          className="input h-9 text-sm"
                          value={section.title}
                          onChange={(event) =>
                            updateSection(index, "title", event.target.value)
                          }
                          aria-label={tx("Título de sección {n}", {
                            n: index + 1,
                          })}
                        />
                        <input
                          className="input h-9 text-sm"
                          value={section.focus}
                          onChange={(event) =>
                            updateSection(index, "focus", event.target.value)
                          }
                          aria-label={tx("Foco de sección {n}", {
                            n: index + 1,
                          })}
                        />
                        <span className="self-center text-xs text-neutral-500">
                          {tx("{n} evidencias", { n: section.evidenceCount })}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4">
                    <p className="mb-2 text-xs font-medium text-neutral-500">
                      {t("Muestra de evidencia")}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {preview.evidence.slice(0, 6).map((item) => (
                        <button
                          key={item.id}
                          className="rounded-xl border border-neutral-200 p-3 text-left hover:border-cyan-500 dark:border-neutral-800"
                          onClick={() => {
                            setSelectedEvidence({
                              id: item.id,
                              label: item.label,
                              excerpt: item.excerpt,
                              rowIds: item.rowId ? [item.rowId] : [],
                              databaseName: item.databaseName,
                            });
                            setEvidenceOpen(true);
                          }}
                        >
                          <div className="truncate text-sm font-medium">
                            {item.label}
                          </div>
                          <div className="mt-1 line-clamp-2 text-xs text-neutral-500">
                            {item.excerpt}
                          </div>
                          <div className="mt-2 text-[10px] text-cyan-600">
                            {item.databaseName}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <EmptyState>
                  {selectedDatabaseIds.length
                    ? t("No hay filas para esta selección.")
                    : t("Selecciona una base para ver el preview.")}
                </EmptyState>
              )}
              {previewError && (
                <p className="mt-3 text-sm text-rose-500">{previewError}</p>
              )}
            </section>
          </main>
          <aside className="space-y-5">
            <section
              className={cardClass}
              data-testid="database-deep-research-budget"
            >
              <SectionHeading
                icon="chartBar"
                title={t("Presupuesto y modelo")}
                detail={t(
                  "El límite se comprueba antes de encolar el trabajo.",
                )}
              />
              <div className="space-y-4">
                <label className="block text-xs text-neutral-500">
                  {t("Modelo")}
                  <ModelPicker
                    settings={settings}
                    value={model}
                    onChange={setModel}
                    allowEmpty={false}
                    className="mt-1"
                    ariaLabel={t(
                      "Modelo para la investigación de bases de datos",
                    )}
                  />
                </label>
                <label className="block text-xs text-neutral-500">
                  {t("Idioma del informe")}
                  <select
                    data-testid="database-deep-research-language"
                    className={`${inputClass} mt-1`}
                    value={reportLanguage}
                    onChange={(event) => setReportLanguage(event.target.value as PromptLanguage)}
                  >
                    {REPORT_LANGUAGE_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <div>
                  <div className="mb-2 flex items-center justify-between text-xs text-neutral-500">
                    <span>{t("Profundidad")}</span>
                    <span className="font-medium text-neutral-700 dark:text-neutral-300">
                      {t(
                        DEPTHS.find((item) => item.id === depth)?.label ??
                          "Profunda",
                      )}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {DEPTHS.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        className={`rounded-lg border px-2 py-2 text-left text-xs transition-colors ${depth === item.id ? "border-cyan-500 bg-cyan-50 text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-200" : "border-neutral-200 dark:border-neutral-800"}`}
                        onClick={() => setDepth(item.id)}
                      >
                        <span className="block font-medium">
                          {t(item.label)}
                        </span>
                        <span className="mt-1 block text-[10px] opacity-70">
                          {t(item.detail)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <label className="block text-xs text-neutral-500">
                  {t("Límite del coste estimado (USD)")}
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      className={`${inputClass} flex-1`}
                      type="number"
                      min="0"
                      step="0.25"
                      value={maxCostUsd}
                      onChange={(event) =>
                        setMaxCostUsd(
                          Math.max(0, Number(event.target.value) || 0),
                        )
                      }
                    />
                    <span className="text-xs text-neutral-500">USD</span>
                  </div>
                </label>
                <div className="rounded-xl bg-cyan-50 p-3 text-sm text-cyan-900 dark:bg-cyan-950/35 dark:text-cyan-100">
                  <div className="flex items-center justify-between">
                    <span>{t("Coste estimado")}</span>
                    <strong>
                      ${(preview?.estimatedCostUsd ?? 0).toFixed(2)}
                    </strong>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cyan-200 dark:bg-cyan-900">
                    <div
                      className="h-full rounded-full bg-cyan-500"
                      style={{
                        width: `${Math.min(100, maxCostUsd ? ((preview?.estimatedCostUsd ?? 0) / maxCostUsd) * 100 : 100)}%`,
                      }}
                    />
                  </div>
                  <p className="mt-2 text-xs opacity-75">
                    {preview && preview.estimatedCostUsd <= maxCostUsd
                      ? t("Dentro del límite")
                      : t("Ajusta la profundidad o aumenta el límite")}
                  </p>
                </div>
                <button
                  data-testid="database-deep-research-start"
                  className="btn btn-primary min-h-11 w-full justify-center gap-2"
                  onClick={() => void startResearch()}
                  disabled={
                    busy ||
                    previewBusy ||
                    !objective.trim() ||
                    !selectedDatabaseIds.length ||
                    !model ||
                    (!!preview && preview.estimatedCostUsd > maxCostUsd)
                  }
                >
                  <Icon
                    name={busy ? "sync" : "play"}
                    size={15}
                    className={busy ? "animate-spin" : ""}
                  />
                  {busy ? t("Encolando…") : t("Iniciar investigación")}
                </button>
              </div>
            </section>
            <section
              className={cardClass}
              data-testid="database-deep-research-timeline"
            >
              <SectionHeading
                icon="clock"
                title={t("Timeline de ejecución")}
                detail={t("Cada fase deja un rastro revisable.")}
              />
              <ol className="space-y-3">
                {DATABASE_RESEARCH_STEP_KINDS.map((kind) => {
                  const current = activePhase === kind;
                  const done =
                    activeJob?.status === "completed" ||
                    (activeJob?.progress ?? 0) >=
                      ((DATABASE_RESEARCH_STEP_KINDS.indexOf(kind) + 1) /
                        DATABASE_RESEARCH_STEP_KINDS.length) *
                        100;
                  return (
                    <li key={kind} className="flex items-start gap-3">
                      <span
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${current ? "bg-cyan-500 text-white" : done ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-neutral-100 text-neutral-500 dark:bg-neutral-900"}`}
                      >
                        {done
                          ? "✓"
                          : DATABASE_RESEARCH_STEP_KINDS.indexOf(kind) + 1}
                      </span>
                      <div>
                        <div className="text-sm font-medium">
                          {t(PHASE_LABELS[kind])}
                        </div>
                        <p className={muted}>{t(PHASE_HINTS[kind])}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          </aside>
        </div>
        <section
          className={cardClass}
          data-testid="database-deep-research-jobs"
        >
          <div className="flex items-start justify-between gap-3">
            <SectionHeading
              icon="layers"
              title={t("Trabajos")}
              detail={t(
                "La cola conserva estado, fase y coste de cada investigación.",
              )}
            />
            {jobs.some((job) =>
              ["failed", "cancelled", "stale"].includes(job.status),
            ) && (
              <button
                className="btn btn-ghost shrink-0 text-xs"
                onClick={() => void clearFinishedJobs()}
              >
                {t("Limpiar finalizados")}
              </button>
            )}
          </div>
          {jobs.length ? (
            <div className="grid gap-2 md:grid-cols-2">
              {jobs.map((job) => (
                <article
                  key={job.id}
                  className={`rounded-xl border p-3 dark:border-neutral-800 ${job.status === "stale" ? "border-amber-400 bg-amber-50/50 dark:bg-amber-950/20" : job.status === "partial" ? "border-violet-400 bg-violet-50/50 dark:bg-violet-950/20" : "border-neutral-200"}`}
                >
                  <div className="flex items-start gap-2">
                    <Icon
                      name={
                        job.status === "completed"
                          ? "check"
                          : ["failed", "stale", "partial"].includes(job.status)
                            ? "alert"
                            : "sync"
                      }
                      size={15}
                      className={
                        job.status === "running"
                          ? "animate-spin text-cyan-500"
                          : "text-neutral-500"
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {job.title}
                      </div>
                      <div className="mt-1 text-xs text-neutral-500">
                        {phaseLabel(job.phase)} ·{" "}
                        {progressPercent(job.progress)}% ·{" "}
                        {formatDate(job.createdAt)}
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-900">
                        <div
                          className="h-full bg-cyan-500 transition-all"
                          style={{ width: `${progressPercent(job.progress)}%` }}
                        />
                      </div>
                      {job.status === "stale" && (
                        <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                          {t(
                            "Snapshot obsoleto: verifica las fuentes antes de reutilizar este resultado.",
                          )}
                        </p>
                      )}
                      {job.status === "partial" && (
                        <p className="mt-2 text-xs font-medium text-violet-700 dark:text-violet-300">
                          {t(
                            "Informe parcial: contiene limitaciones o artefactos no verificables.",
                          )}
                        </p>
                      )}
                    </div>
                    {["queued", "running"].includes(job.status) && (
                      <button
                        className="btn btn-ghost h-8 w-8 p-0"
                        aria-label={t("Cancelar")}
                        onClick={() => void cancelJob(job.id)}
                      >
                        <Icon name="x" size={13} />
                      </button>
                    )}
                  </div>
                  {job.error && (
                    <p className="mt-2 text-xs text-rose-500">{job.error}</p>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <EmptyState icon="clock">
              {t("Todavía no hay investigaciones en la cola.")}
            </EmptyState>
          )}
        </section>
        <section
          className={cardClass}
          data-testid="database-deep-research-gallery"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <SectionHeading
              icon="grid"
              title={t("Galería de resultados")}
              detail={t("Abre un informe para leerlo y revisar sus fuentes.")}
            />
            <label className="text-xs text-neutral-500">
              {t("Filtrar por tipo")}
              <select
                data-testid="database-deep-research-gallery-filter"
                className="input mt-1 min-w-48 py-1.5 text-xs"
                value={reportFilter}
                onChange={(event) => setReportFilter(event.target.value as DatabaseDeepResearchReportType | "all")}
              >
                <option value="all">{t("Todos los tipos")}</option>
                {DATABASE_REPORT_TYPES.map((item) => <option key={item.id} value={item.id}>{t(item.label)}</option>)}
              </select>
            </label>
          </div>
          {visibleReports.length ? (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {visibleReports.map((report) => (
                <article
                  key={report.id}
                  className={`rounded-xl border p-4 dark:border-neutral-800 ${report.qualityStatus === "partial" ? "border-violet-400" : "border-neutral-200"}`}
                >
                  <button
                    className="w-full text-left transition-colors hover:border-cyan-500"
                    onClick={() => void openReport(report)}
                  >
                    <div className="flex items-start gap-2">
                      <Icon
                        name="fileText"
                        size={16}
                        className="mt-0.5 text-cyan-500"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
                            {report.title}
                          </h3>
                          <span className="shrink-0 rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-medium text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300">
                            {t(DATABASE_REPORT_TYPES.find((item) => item.id === report.reportType)?.label ?? "Investigación general")}
                          </span>
                          {report.qualityStatus === "partial" && (
                            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                              {t("Parcial")}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-3 text-xs text-neutral-500">
                          {report.summary}
                        </p>
                        <span className="mt-3 block text-[10px] text-neutral-400">
                          {formatDate(report.createdAt)}
                          {report.costUsd != null
                            ? ` · $${report.costUsd.toFixed(2)}`
                            : ""}
                        </span>
                      </div>
                    </div>
                  </button>
                  <button
                    className="btn btn-ghost mt-2 text-xs text-rose-600"
                    onClick={() => void deleteReport(report.id)}
                  >
                    {t("Eliminar informe")}
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState icon="fileText">
              {t(
                "Tus resultados aparecerán aquí cuando termine una investigación.",
              )}
            </EmptyState>
          )}
        </section>
        {toast && (
          <div
            role="status"
            className="fixed bottom-5 right-5 z-30 flex max-w-sm items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
          >
            <span className="flex-1">{toast}</span>
            <button
              className="text-neutral-500"
              onClick={() => setToast(null)}
              aria-label={t("Cerrar")}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        )}
      </div>
      {reader && (
        <div
          className="fixed inset-0 z-40 bg-black/50 p-4 md:p-8"
          role="dialog"
          aria-modal="true"
          aria-label={reader.title}
        >
          <div
            data-testid="database-deep-research-reader"
            className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-neutral-950"
          >
            <header className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
              <button
                className="btn btn-ghost gap-1.5"
                onClick={() => {
                  setReader(null);
                  onSnapshotChange?.({ openReportId: null });
                }}
              >
                <Icon name="arrowLeft" size={14} />
                {t("Volver")}
              </button>
              <h2 className="min-w-0 flex-1 truncate font-semibold">
                {reader.title}
              </h2>
              <span className="shrink-0 rounded-full bg-cyan-100 px-2.5 py-1 text-xs font-medium text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300">
                {t(DATABASE_REPORT_TYPES.find((item) => item.id === reader.reportType)?.label ?? "Investigación general")}
              </span>
              {reader.qualityStatus === "partial" && (
                <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                  {t("Informe parcial")}
                </span>
              )}
              <div className="relative">
                <button
                  className="btn btn-ghost gap-1.5"
                  onClick={() => setExportOpen((current) => !current)}
                >
                  <Icon name="download" size={14} />
                  {t("Exportar")}
                </button>
                {exportOpen && (
                  <div className="absolute right-0 top-10 z-50 w-48 rounded-xl border border-neutral-200 bg-white p-2 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
                    <label className="mb-2 flex items-center gap-2 px-2 py-1 text-xs">
                      <input
                        type="checkbox"
                        checked={includeSnapshot}
                        onChange={(event) =>
                          setIncludeSnapshot(event.target.checked)
                        }
                      />
                      {t("Incluir snapshot en ZIP")}
                    </label>
                    {(
                      [
                        "markdown",
                        "pdf",
                        "zip",
                      ] as DatabaseDeepResearchExportFormat[]
                    ).map((format) => (
                      <button
                        key={format}
                        className="block w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        onClick={() => void exportReport(format)}
                      >
                        {format === "markdown"
                          ? "Markdown (.md)"
                          : format.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                className="btn btn-ghost gap-1.5"
                onClick={() => setEvidenceOpen((current) => !current)}
              >
                <Icon name="book" size={14} />
                {t("Evidencia")}
                {reader.evidence.length ? ` (${reader.evidence.length})` : ""}
              </button>
            </header>
            <div className="flex min-h-0 flex-1">
              <aside className="hidden w-56 shrink-0 overflow-y-auto border-r border-neutral-200 p-4 lg:block dark:border-neutral-800">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  {t("Secciones")}
                </h3>
                {reader.sections.map((section) => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className="mb-1 block rounded-lg px-2 py-1.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-900"
                  >
                    {section.title}
                  </a>
                ))}
              </aside>
              <article className="min-w-0 flex-1 overflow-y-auto p-6 md:p-10">
                <ReportCharts charts={reader.charts} />
                {reader.sections.length ? (
                  reader.sections.map((section) => (
                    <section key={section.id} id={section.id} className="mb-8">
                      <h3 className="mb-3 text-lg font-semibold">
                        {section.title}
                      </h3>
                      <Markdown content={section.markdown} />
                    </section>
                  ))
                ) : (
                  <Markdown content={reader.markdown} />
                )}
              </article>
              {evidenceOpen && (
                <aside
                  data-testid="database-deep-research-evidence-drawer"
                  className="w-96 shrink-0 overflow-y-auto border-l border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/60"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-semibold">{t("Evidencia")}</h3>
                    <button
                      className="text-neutral-500"
                      onClick={() => setEvidenceOpen(false)}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                  {reader.evidence.length ? (
                    <div className="space-y-2">
                      {reader.evidence.map((item) => (
                        <button
                          key={item.id}
                          className={`w-full rounded-xl border p-3 text-left ${selectedEvidence?.id === item.id ? "border-cyan-500" : "border-neutral-200 dark:border-neutral-800"}`}
                          onClick={() => setSelectedEvidence(item)}
                        >
                          <div className="text-xs font-medium">
                            {item.label}
                          </div>
                          <p className="mt-1 text-xs leading-5 text-neutral-500">
                            {item.excerpt}
                          </p>
                          <div className="mt-2 grid grid-cols-2 gap-1 text-[10px] text-neutral-500">
                            {item.method && (
                              <span>
                                {t("Método")}: {item.method}
                              </span>
                            )}
                            {item.n != null && <span>n={item.n}</span>}
                            {item.denominator != null && (
                              <span>
                                {t("Denominador")}: {item.denominator}
                              </span>
                            )}
                            {item.interval && (
                              <span>
                                {t("IC")}: [{item.interval.low},{" "}
                                {item.interval.high}]
                              </span>
                            )}
                            {item.pValue != null && (
                              <span>p={item.pValue}</span>
                            )}
                            {item.qValue != null && (
                              <span>q={item.qValue}</span>
                            )}
                            {item.confidence != null && (
                              <span>
                                {t("Confianza")}: {item.confidence}
                              </span>
                            )}
                            {item.columnIds?.length && (
                              <span>
                                {t("Columnas")}: {item.columnIds.join(", ")}
                              </span>
                            )}
                            <span>
                              {t("Filas")}:{" "}
                              {item.rowIds.length > 0
                                ? item.rowIds.join(", ")
                                : t("Conjunto filtrado; IDs redactados")}
                            </span>
                            {item.filters && (
                              <span>
                                {t("Filtros")}:{" "}
                                {item.filters.query ||
                                  item.filters.columnIds.join(", ") ||
                                  "—"}
                              </span>
                            )}
                            {item.hash && (
                              <span>
                                {t("Hash")}: {item.hash.slice(0, 12)}
                              </span>
                            )}
                          </div>
                          {item.databaseName && (
                            <span className="mt-2 block text-[10px] text-cyan-600">
                              {item.databaseName}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <EmptyState icon="book">
                      {t("Este informe no tiene evidencias detalladas.")}
                    </EmptyState>
                  )}
                </aside>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
