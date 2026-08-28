import type { AppLanguage } from './types';
import type { DatabaseColumnType } from './databases';

/** Stable, contextual report modes. Keep `general` first for legacy callers. */
export const DATABASE_DEEP_RESEARCH_REPORT_TYPES = [
  'general',
  'data_quality',
  'cohort_comparison',
  'temporal_anomalies',
  'relationships_integrity',
  'causal_impact',
  'survival_retention',
  'privacy_attachments',
  'formulas_reconciliation',
] as const;
export type DatabaseDeepResearchReportType =
  (typeof DATABASE_DEEP_RESEARCH_REPORT_TYPES)[number];
/** A user may ask the local semantic profiler to choose a specialised mode. */
export type DatabaseDeepResearchRequestedReportType = DatabaseDeepResearchReportType | 'auto';

export const DATABASE_DEEP_RESEARCH_PROMPT_LANGUAGES = [
  'es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr',
] as const satisfies readonly AppLanguage[];
export type DatabaseDeepResearchPromptLanguage =
  (typeof DATABASE_DEEP_RESEARCH_PROMPT_LANGUAGES)[number];

const REPORT_TYPE_SET = new Set<string>(DATABASE_DEEP_RESEARCH_REPORT_TYPES);
const PROMPT_LANGUAGE_SET = new Set<string>(DATABASE_DEEP_RESEARCH_PROMPT_LANGUAGES);

export function normalizeDatabaseDeepResearchReportType(value: unknown): DatabaseDeepResearchReportType {
  return typeof value === 'string' && REPORT_TYPE_SET.has(value)
    ? value as DatabaseDeepResearchReportType
    : 'general';
}

export function isDatabaseDeepResearchReportType(value: unknown): value is DatabaseDeepResearchReportType {
  return typeof value === 'string' && REPORT_TYPE_SET.has(value);
}

export function normalizeDatabaseDeepResearchPromptLanguage(value: unknown): DatabaseDeepResearchPromptLanguage {
  if (value == null || value === '') return 'en';
  if (typeof value === 'string' && PROMPT_LANGUAGE_SET.has(value)) {
    return value as DatabaseDeepResearchPromptLanguage;
  }
  throw new Error(`Unsupported database research prompt language: ${String(value)}`);
}

export interface DatabaseDeepResearchReportTypeOption {
  id: DatabaseDeepResearchReportType;
  label: string;
  description: string;
}

/** Stable source labels; renderer translations may replace these labels by id. */
export const DATABASE_DEEP_RESEARCH_REPORT_TYPE_OPTIONS: readonly DatabaseDeepResearchReportTypeOption[] = [
  { id: 'general', label: 'Investigación general', description: 'Exploración adaptativa y verificable de los datos seleccionados.' },
  { id: 'data_quality', label: 'Calidad de datos', description: 'Cobertura, missingness, duplicados, validez e integridad del conjunto.' },
  { id: 'cohort_comparison', label: 'Comparación de cohortes', description: 'Compara grupos con magnitudes de efecto, incertidumbre y corrección de multiplicidad.' },
  { id: 'temporal_anomalies', label: 'Anomalías temporales', description: 'Detecta tendencia, estacionalidad, drift y cambios de régimen.' },
  { id: 'relationships_integrity', label: 'Relaciones e integridad', description: 'Audita joins, huérfanos, ciclos, cardinalidad y redes entre bases.' },
  { id: 'causal_impact', label: 'Impacto causal', description: 'Estima asociaciones bajo un contrato causal explícito y supuestos visibles.' },
  { id: 'survival_retention', label: 'Supervivencia y retención', description: 'Analiza duración, evento, censura, retención y riesgo relativo.' },
  { id: 'privacy_attachments', label: 'Privacidad y adjuntos', description: 'Audita PII, exposición, metadatos y disponibilidad de archivos.' },
  { id: 'formulas_reconciliation', label: 'Fórmulas y reconciliación', description: 'Reconstruye lineage, dependencias, divergencias y totales.' },
] as const;

export interface DatabaseResearchSchemaColumn {
  id: string;
  type: DatabaseColumnType | string;
  /** Local-only metadata used for deterministic semantic matching. Never sent to providers. */
  databaseId?: string;
  name?: string;
  config?: Record<string, unknown>;
  profile?: { filled?: number; fillRate?: number; distinct?: number; valueType?: string };
}

export interface DatabaseDeepResearchAutoConfiguration {
  requestedReportType: DatabaseDeepResearchRequestedReportType;
  reportType: DatabaseDeepResearchReportType;
  roles: DatabaseResearchSemanticRoles;
  confidence: number;
  warnings: string[];
  limitations: string[];
  partial: boolean;
}

const AUTO_NUMERIC = new Set(['number', 'formula', 'rollup']);
const AUTO_TEMPORAL = new Set(['date', 'time', 'created_time', 'last_edited_time']);
const AUTO_BINARY = new Set(['number', 'formula', 'rollup', 'checkbox']);
const AUTO_GROUP = new Set(['select', 'status', 'checkbox']);
const AUTO_SENSITIVE = new Set(['person', 'created_by', 'last_edited_by', 'email', 'phone', 'location', 'files', 'attachment', 'ai_image']);
const AUTO_KEYWORDS: Record<string, string[]> = {
  outcome: ['outcome', 'result', 'resultado', 'metric', 'measure', 'score', 'target', 'valor', 'amount', 'revenue', 'impact'],
  treatment: ['treatment', 'tratamiento', 'variant', 'variante', 'intervention', 'exposure', 'exposicion', 'experiment', 'arm'],
  time: ['time', 'date', 'fecha', 'hora', 'timestamp', 'created', 'updated', 'month', 'day', 'year'],
  duration: ['duration', 'duracion', 'tenure', 'lifetime', 'survival', 'days', 'dias', 'age', 'edad'],
  event: ['event', 'evento', 'churn', 'retained', 'retencion', 'converted', 'conversion', 'failure', 'failed', 'status'],
  group: ['group', 'grupo', 'cohort', 'cohorte', 'segment', 'segmento', 'category', 'categoria', 'variant', 'region', 'country', 'pais'],
  entity: ['id', 'identifier', 'identificador', 'name', 'nombre', 'title', 'titulo', 'entity', 'cliente', 'customer', 'user'],
  location: ['location', 'ubicacion', 'lat', 'lon', 'longitude', 'latitude', 'address', 'direccion', 'country', 'pais'],
  metrics: ['metric', 'metrica', 'measure', 'medida', 'score', 'valor', 'value', 'amount', 'revenue', 'ingreso', 'total', 'count', 'rate'],
  confounders: ['confound', 'confus', 'covariate', 'covariable', 'control', 'age', 'edad', 'baseline', 'income', 'ingreso'],
  text: ['text', 'texto', 'description', 'descripcion', 'notes', 'notas', 'comment', 'comentario', 'summary', 'resumen'],
  sensitive: ['email', 'correo', 'phone', 'telefono', 'person', 'persona', 'address', 'direccion', 'location', 'ubicacion', 'attachment', 'adjunto', 'file', 'archivo'],
};

const AUTO_REPORT_KEYWORDS: Partial<Record<DatabaseDeepResearchReportType, string[]>> = {
  data_quality: ['calidad', 'quality', 'missing', 'faltante', 'duplicad', 'validez', 'integridad de datos', 'nettoyage', 'datenqualitat', 'qualidade', 'qualita', 'veri kalitesi'],
  cohort_comparison: ['cohorte', 'cohort', 'grupo', 'group', 'segment', 'comparar', 'compare', 'comparaison', 'vergleich', 'confronta', 'karsilastir'],
  temporal_anomalies: ['anomalia', 'anomaly', 'tendencia', 'trend', 'estacional', 'season', 'tiempo', 'temporal', 'serie', 'drift', 'zeitreihe', 'tendance'],
  relationships_integrity: ['relacion', 'relationship', 'join', 'huerfan', 'orphan', 'cardinalidad', 'network', 'red', 'integrite referentielle', 'beziehung'],
  causal_impact: ['causal', 'causa', 'impacto', 'impact', 'tratamiento', 'treatment', 'intervencion', 'intervention', 'effet causal', 'kausal'],
  survival_retention: ['supervivencia', 'survival', 'retencion', 'retention', 'churn', 'abandono', 'censura', 'hazard', 'risque', 'bindung'],
  privacy_attachments: ['privacidad', 'privacy', 'pii', 'personal', 'sensible', 'sensitive', 'adjunto', 'attachment', 'datenschutz', 'confidentialite'],
  formulas_reconciliation: ['formula', 'reconcili', 'lineage', 'dependenc', 'total', 'divergenc', 'abgleich', 'riconciliazione'],
};

function normalizedSemanticText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
}

function autoScore(column: DatabaseResearchSchemaColumn, role: string): number {
  const type = String(column.type);
  const valueType = String(column.profile?.valueType ?? type);
  const text = `${column.name ?? ''} ${Object.keys(column.config ?? {}).join(' ')}`.toLocaleLowerCase();
  const keywords = AUTO_KEYWORDS[role] ?? [];
  const keywordHit = keywords.some((word) => text.includes(word));
  let score = keywordHit ? 0.72 : 0.1;
  if (role === 'outcome' || role === 'metrics' || role === 'confounders') score += AUTO_NUMERIC.has(valueType) ? 0.2 : -0.4;
  if (role === 'treatment' || role === 'event') score += AUTO_BINARY.has(valueType) ? 0.18 : -0.3;
  if (role === 'group') score += AUTO_GROUP.has(type) ? 0.2 : -0.25;
  if (role === 'time') score += AUTO_TEMPORAL.has(type) ? 0.25 : -0.3;
  if (role === 'duration') score += (AUTO_TEMPORAL.has(type) || AUTO_NUMERIC.has(valueType)) ? 0.16 : -0.25;
  if (role === 'sensitive') score += AUTO_SENSITIVE.has(type) ? 0.35 : -0.25;
  if (role === 'location') score += (type === 'location' || type === 'text') ? 0.12 : -0.15;
  if (role === 'entity') score += (type === 'title' || type === 'text') ? 0.08 : 0;
  if (column.profile?.fillRate != null && column.profile.fillRate < 0.1) score -= 0.15;
  return Math.max(0, Math.min(1, score));
}

/** Deterministic local-first mode/role selection. It receives only schema and aggregate profiles. */
export function autoConfigureDatabaseDeepResearch(
  requested: DatabaseDeepResearchRequestedReportType = 'auto',
  input: DatabaseDeepResearchEligibilityInput & { columns: readonly DatabaseResearchSchemaColumn[]; objective?: string },
  overrides: DatabaseResearchSemanticRoles = {},
): DatabaseDeepResearchAutoConfiguration {
  const columns = input.columns ?? [];
  const warnings: string[] = [];
  const limitations: string[] = [];
  const roles: DatabaseResearchSemanticRoles = structuredClone(overrides ?? {});
  const ranked = (role: string, allowed?: ReadonlySet<string>) => columns
    .map((column) => ({ column, score: autoScore(column, role) }))
    .filter((item) => !allowed || allowed.has(String(item.column.type)) || (role === 'outcome' && allowed.has(String(item.column.profile?.valueType ?? item.column.type))))
    .sort((a, b) => b.score - a.score || String(a.column.id).localeCompare(String(b.column.id)));
  const choose = (role: keyof DatabaseResearchSemanticRoles, allowed?: ReadonlySet<string>) => {
    if (roles[role] != null && (!Array.isArray(roles[role]) || roles[role].length)) return 0.9;
    const best = ranked(String(role), allowed)[0];
    if (!best || best.score < 0.55) return 0;
    roles[role] = best.column.id;
    return best.score;
  };
  const chooseArray = (role: 'metrics' | 'confounders' | 'text' | 'sensitive', allowed?: ReadonlySet<string>) => {
    if (Array.isArray(roles[role]) && roles[role]!.length) return 0.9;
    const picks = ranked(role, allowed).filter((item) => item.score >= 0.55).slice(0, role === 'metrics' ? 8 : 4).map((item) => item.column.id);
    if (picks.length) roles[role] = picks;
    return picks.length ? Math.max(...ranked(role, allowed).slice(0, picks.length).map((item) => item.score)) : 0;
  };
  const scores: number[] = [];
  scores.push(choose('outcome', AUTO_NUMERIC));
  scores.push(choose('treatment', AUTO_BINARY));
  scores.push(choose('time', AUTO_TEMPORAL));
  scores.push(choose('duration', new Set([...AUTO_TEMPORAL, ...AUTO_NUMERIC])));
  scores.push(choose('event', AUTO_BINARY));
  scores.push(choose('group', AUTO_GROUP));
  scores.push(choose('entity'));
  scores.push(chooseArray('metrics', AUTO_NUMERIC));
  scores.push(chooseArray('confounders', AUTO_NUMERIC));
  scores.push(chooseArray('text', new Set(['text', 'title', 'ai'])));
  scores.push(chooseArray('sensitive', AUTO_SENSITIVE));
  const average = scores.filter((score) => score > 0).length ? scores.filter((score) => score > 0).reduce((a, b) => a + b, 0) / scores.filter((score) => score > 0).length : 0;

  let reportType: DatabaseDeepResearchReportType = requested === 'auto' ? 'general' : requested;
  let partial = false;
  if (requested === 'auto') {
    const objective = normalizedSemanticText(String(input.objective ?? ''));
    const candidates = Object.entries(AUTO_REPORT_KEYWORDS)
      .map(([type, keywords]) => ({
        type: type as DatabaseDeepResearchReportType,
        score: (keywords ?? []).reduce((total, keyword) => total + (objective.includes(normalizedSemanticText(keyword)) ? 1 : 0), 0),
      }))
      .filter(({ type, score }) => score > 0 && getDatabaseDeepResearchEligibility(type, { ...input, roles }).applicable)
      .sort((a, b) => b.score - a.score || a.type.localeCompare(b.type));
    reportType = candidates[0]?.type ?? 'general';
    if (reportType === 'general' && objective) warnings.push('No se encontró un contrato especializado con confianza suficiente; se usará investigación general.');
  } else {
    const eligibility = getDatabaseDeepResearchEligibility(requested, { ...input, roles });
    if (!eligibility.applicable) {
      warnings.push(`El tipo solicitado puede no ser aplicable: ${eligibility.reasons.join(' ')}`);
      limitations.push(...eligibility.reasons);
      reportType = 'general';
      partial = true;
    }
  }
  const sourceSensitiveRoleIds = reportType === 'causal_impact'
    ? [roles.outcome, roles.treatment, ...(roles.confounders ?? [])]
    : reportType === 'survival_retention'
      ? [roles.duration, roles.event, roles.group, ...(roles.confounders ?? [])]
      : reportType === 'temporal_anomalies'
        ? [roles.time, roles.outcome]
        : [];
  const columnSources = new Map(columns.map((column) => [column.id, column.databaseId]));
  const roleSources = new Set(sourceSensitiveRoleIds
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .map((id) => columnSources.get(id))
    .filter((databaseId): databaseId is string => typeof databaseId === 'string' && databaseId.length > 0));
  if (roleSources.size > 1) {
    const reason = 'Los roles detectados pertenecen a bases de datos distintas y no pueden formar un único contrato especializado.';
    warnings.push(`${reason} Se usará investigación general.`);
    limitations.push(reason);
    reportType = 'general';
    partial = requested !== 'auto';
  }
  if (average < 0.55) warnings.push('La confianza semántica local es baja; revisa los roles en Opciones avanzadas.');
  return { requestedReportType: requested, reportType, roles, confidence: Number(average.toFixed(3)), warnings, limitations, partial };
}

export interface DatabaseDeepResearchEligibilityInput {
  columns: readonly DatabaseResearchSchemaColumn[];
  roles?: DatabaseResearchSemanticRoles | null;
  databaseCount?: number;
}

export interface DatabaseDeepResearchEligibility {
  reportType: DatabaseDeepResearchReportType;
  applicable: boolean;
  reasons: string[];
  missingRoles: string[];
  availableColumns: string[];
}

const numericTypes = new Set(['number', 'formula', 'rollup']);
// Cohort calculations currently require one scalar label per row. Set-valued
// and identity columns need an explicit, user-visible mapping before they can
// be interpreted as mutually exclusive cohorts.
const cohortGroupTypes = new Set(['select', 'status', 'checkbox']);
const temporalTypes = new Set(['date', 'time', 'created_time', 'last_edited_time']);
const relationalTypes = new Set(['relation', 'rollup']);
const sensitiveTypes = new Set(['person', 'created_by', 'last_edited_by', 'email', 'phone', 'location', 'files', 'attachment', 'ai_image']);

function hasRole(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function roleColumns(roles: DatabaseResearchSemanticRoles | null | undefined): string[] {
  if (!roles) return [];
  return Object.values(roles).flatMap((value) => Array.isArray(value) ? value : value ? [value] : [])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

/** Determine applicability before any model call. This is deliberately deterministic. */
export function getDatabaseDeepResearchEligibility(
  reportType: unknown,
  input: DatabaseDeepResearchEligibilityInput,
): DatabaseDeepResearchEligibility {
  const normalized = normalizeDatabaseDeepResearchReportType(reportType);
  const columns = input.columns ?? [];
  const roles = input.roles ?? {};
  const types = new Set(columns.map((column) => String(column.type)));
  const hasRelation = columns.some((column) => relationalTypes.has(String(column.type)));
  const hasSensitive = columns.some((column) => sensitiveTypes.has(String(column.type)));
  const hasFormula = columns.some((column) => ['formula', 'rollup', 'comparison', 'relation'].includes(String(column.type)));
  const reasons: string[] = [];
  const missingRoles: string[] = [];
  let applicable = true;
  const requireRole = (key: keyof DatabaseResearchSemanticRoles, label: string) => {
    if (!hasRole(roles[key])) { applicable = false; missingRoles.push(String(key)); reasons.push(`Selecciona un rol ${label}.`); }
  };
  const roleType = (key: keyof DatabaseResearchSemanticRoles) => {
    const id = roles[key];
    return typeof id === 'string' ? String(columns.find((column) => column.id === id)?.type ?? '') : '';
  };
  const requireRoleType = (key: keyof DatabaseResearchSemanticRoles, allowed: ReadonlySet<string>, message: string) => {
    if (hasRole(roles[key]) && !allowed.has(roleType(key))) { applicable = false; reasons.push(message); }
  };
  const requireRoleArray = (key: 'metrics' | 'confounders', label: string) => {
    const values = roles[key];
    if (!Array.isArray(values) || values.length === 0) {
      applicable = false;
      missingRoles.push(key);
      reasons.push(`Selecciona al menos ${label}.`);
      return [];
    }
    return values;
  };
  const binaryTypes = new Set(['number', 'formula', 'rollup', 'checkbox']);
  const durationTypes = new Set(['number', 'formula', 'rollup', 'date', 'time', 'created_time', 'last_edited_time']);
  switch (normalized) {
    case 'cohort_comparison':
      requireRole('group', 'de cohorte o grupo');
      requireRoleType('group', cohortGroupTypes, 'El grupo debe ser select, status o checkbox; las categorías multivalor y de personas requieren un mapeo explícito aún no configurado.');
      if (requireRoleArray('metrics', 'una métrica numérica').some((id) => !numericTypes.has(String(columns.find((column) => column.id === id)?.type ?? '')))) { applicable = false; reasons.push('Todas las métricas deben ser numéricas.'); }
      break;
    case 'temporal_anomalies':
      requireRole('time', 'temporal');
      requireRoleType('time', temporalTypes, 'El rol temporal debe ser una fecha, hora o timestamp.');
      if (requireRoleArray('metrics', 'una métrica numérica temporal').some((id) => !numericTypes.has(String(columns.find((column) => column.id === id)?.type ?? '')))) { applicable = false; reasons.push('Todas las métricas temporales deben ser numéricas.'); }
      break;
    case 'relationships_integrity':
      if (!hasRelation) { applicable = false; reasons.push('Selecciona al menos una relación o rollup que conecte los datos.'); }
      break;
    case 'causal_impact':
      requireRole('outcome', 'resultado');
      requireRole('treatment', 'tratamiento');
      requireRoleArray('confounders', 'un confusor');
      requireRoleType('outcome', numericTypes, 'El resultado debe ser numérico.');
      requireRoleType('treatment', binaryTypes, 'El tratamiento debe ser binario numérico o checkbox; las categorías requieren un mapeo explícito aún no configurado.');
      if ((roles.confounders ?? []).some((id) => !numericTypes.has(String(columns.find((column) => column.id === id)?.type ?? '')))) { applicable = false; reasons.push('Todos los confusores deben ser numéricos.'); }
      break;
    case 'survival_retention':
      requireRole('duration', 'duración');
      requireRole('event', 'evento');
      requireRoleType('duration', durationTypes, 'La duración debe ser numérica o temporal.');
      requireRoleType('event', binaryTypes, 'El evento debe ser binario numérico o checkbox; las categorías requieren un mapeo explícito aún no configurado.');
      break;
    case 'privacy_attachments':
      if (!hasSensitive && !types.has('url') && !types.has('ai')) { applicable = false; reasons.push('No hay columnas de PII, ubicación o adjuntos seleccionadas.'); }
      break;
    case 'formulas_reconciliation':
      if (!hasFormula) { applicable = false; reasons.push('No hay fórmulas, rollups, comparaciones o relaciones que reconciliar.'); }
      break;
    case 'general':
    case 'data_quality':
      break;
  }
  return { reportType: normalized, applicable, reasons, missingRoles, availableColumns: roleColumns(roles) };
}

/**
 *
 * Durable contract for Deep Research runs started from a structured database.
 *
 * This file intentionally contains no AI or statistics code.  A run is an
 * orchestration record: the eventual engine can add steps, claims and a report
 * without changing the renderer/MCP contract or losing work on restart.
 */

export const DATABASE_RESEARCH_RUN_STATUSES = [
  "queued",
  "running",
  "completed",
  "partial",
  "failed",
  "stale",
  "cancelling",
  "cancelled",
] as const;
export type DatabaseResearchRunStatus =
  (typeof DATABASE_RESEARCH_RUN_STATUSES)[number];

export const DATABASE_RESEARCH_STEP_KINDS = [
  "snapshot",
  "semantic_profile",
  "planning",
  "calculations",
  "sensitivity",
  "adversarial_review",
  "verification",
  "assembly",
] as const;
export type DatabaseResearchStepKind =
  (typeof DATABASE_RESEARCH_STEP_KINDS)[number];
export const DATABASE_RESEARCH_PHASES = [
  ...DATABASE_RESEARCH_STEP_KINDS,
  "done",
] as const;
export type DatabaseResearchPhase = (typeof DATABASE_RESEARCH_PHASES)[number];

export const DATABASE_RESEARCH_DEPTHS = [
  "focused",
  "deep",
  "exhaustive",
] as const;
export type DatabaseResearchDepth = (typeof DATABASE_RESEARCH_DEPTHS)[number];

export const DATABASE_RESEARCH_BUDGETS = {
  focused: { rounds: 2, maxTasks: 20, resamples: 1_000 },
  deep: { rounds: 4, maxTasks: 60, resamples: 5_000 },
  exhaustive: { rounds: 8, maxTasks: 160, resamples: 20_000 },
} as const satisfies Record<
  DatabaseResearchDepth,
  { rounds: number; maxTasks: number; resamples: number }
>;

/** Conservative UI/queue estimate. It is intentionally model-independent so
 * preview and enqueue enforce the same user-selected ceiling. */
export function estimateDatabaseDeepResearchCost(
  rowCount: number,
  sourceCount: number,
  depth: DatabaseResearchDepth,
): { estimatedTokens: number; estimatedCostUsd: number } {
  const multiplier =
    depth === "exhaustive" ? 2.8 : depth === "focused" ? 0.6 : 1;
  // The lane makes one planner, critic, verifier and writer call, plus at most
  // one editor revision. completeJson allows a conservative second attempt
  // when a provider returns malformed JSON. Reserve the whole envelope so a
  // user ceiling is not an optimistic row-only guess.
  const firstAttemptTokens = 1_800 * 3 + 5_200 * 2;
  const maximumAgentOutputTokens = firstAttemptTokens * 2;
  const estimatedTokens = Math.max(
    800,
    Math.round(
      (Math.max(0, rowCount) * 180 + Math.max(1, sourceCount) * 420) *
        multiplier,
    ) + maximumAgentOutputTokens,
  );
  return {
    estimatedTokens,
    estimatedCostUsd: Number(((estimatedTokens / 1_000_000) * 3.2).toFixed(2)),
  };
}

export interface DatabaseResearchFilters {
  query: string;
  columnIds: string[];
}

/** Semantic roles are explicit contracts, not hints inferred by a model. Causal
 * and survival methods are rejected unless their required roles are present. */
export interface DatabaseResearchSemanticRoles {
  outcome?: string;
  treatment?: string;
  confounders?: string[];
  time?: string;
  duration?: string;
  event?: string;
  entity?: string;
  text?: string[];
  location?: string;
  group?: string;
  metrics?: string[];
  sensitive?: string[];
  reconciliation?: string[];
  [role: string]: string | string[] | undefined;
}

export interface DatabaseResearchBudget {
  depth: DatabaseResearchDepth;
  rounds: number;
  maxTasks: number;
  resamples: number;
  maxRows: number;
  /** Ceiling for the conservative estimate used before queueing. Provider
   * invoices remain authoritative when a provider does not expose usage. */
  maxCostUsd?: number;
  seed?: number | string;
}

/** Non-row context allowed in model prompts. It describes the analytical
 * surface without exposing cell values or free text. */
export interface DatabaseResearchModelContext {
  schema: Array<{ databaseId: string; columns: Array<{ id: string; type: string }> }>;
  semanticRoles: DatabaseResearchSemanticRoles;
  rowCounts: Record<string, { captured: number; total: number; truncated: boolean }>;
  allowedOperations: string[];
  requestedOutline?: Array<{ title: string; focus: string }>;
}

const REPORT_ANALYSIS_REQUIREMENTS: Record<DatabaseDeepResearchReportType, { required: string[]; optional: string[] }> = {
  general: { required: ['missingness', 'describe', 'robustSummary'], optional: ['correlation', 'cohortComparison', 'changePoints', 'relationIntegrity'] },
  data_quality: { required: ['missingness', 'qualityAudit'], optional: ['chiSquare', 'textAudit', 'geoAudit', 'attachmentAudit', 'relationIntegrity'] },
  cohort_comparison: { required: ['cohortComparison', 'multipleTesting'], optional: ['chiSquare', 'kruskalWallis', 'bootstrap', 'permutation', 'simpson'] },
  temporal_anomalies: { required: ['temporalAudit', 'acf', 'changePoints'], optional: ['bootstrap', 'missingness'] },
  relationships_integrity: { required: ['relationIntegrity'], optional: ['relationGraph', 'formulaAudit'] },
  causal_impact: { required: ['ipw'], optional: ['simpson', 'multipleTesting'] },
  survival_retention: { required: ['kaplanMeier'], optional: ['logRank', 'coxPH', 'multipleTesting'] },
  privacy_attachments: { required: ['qualityAudit'], optional: ['attachmentAudit', 'textAudit', 'geoAudit'] },
  formulas_reconciliation: { required: ['formulaAudit'], optional: ['relationIntegrity', 'describe'] },
};

export function getDatabaseDeepResearchAnalysisRequirements(reportType: unknown): { required: string[]; optional: string[] } {
  const requirements = REPORT_ANALYSIS_REQUIREMENTS[normalizeDatabaseDeepResearchReportType(reportType)];
  return { required: [...requirements.required], optional: [...requirements.optional] };
}

export interface DatabaseDeepResearchRequest {
  reportType?: DatabaseDeepResearchReportType;
  objective: string;
  databaseIds: string[];
  viewIds: string[];
  filters: DatabaseResearchFilters;
  roles: DatabaseResearchSemanticRoles;
  includedCellTypes?: string[];
  includeAttachmentContent: boolean;
  audience?: string | null;
  language?: DatabaseDeepResearchPromptLanguage | null;
  model: { provider: string; model: string } | null;
  depth: DatabaseResearchDepth;
  budget: DatabaseResearchBudget;
}

export interface DatabaseResearchPlan {
  reportType?: DatabaseDeepResearchReportType;
  questions: string[];
  hypotheses: string[];
  estimands: string[];
  analyses: Array<{
    id: string;
    operation: string;
    columnIds: string[];
    rationale: string;
  }>;
  risks: string[];
  confounders: string[];
  stoppingCriteria: string[];
  dataFingerprint: string | null;
}

export interface DatabaseResearchArtifact {
  id: string;
  method: string;
  inputs: Record<string, unknown>;
  output: unknown;
  seed: number;
  n: number;
  denominator: number;
  filters: DatabaseResearchFilters;
  hash: string;
  warnings: string[];
}

export const DATABASE_RESEARCH_STEP_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type DatabaseResearchStepStatus =
  (typeof DATABASE_RESEARCH_STEP_STATUSES)[number];

export interface DatabaseResearchRequest {
  reportType?: DatabaseDeepResearchReportType;
  databaseId: string;
  objective: string;
  title?: string | null;
  language?: string | null;
  model?: { provider: string; model: string } | null;
  options?: Record<string, unknown>;
}

/** Renderer/MCP queue input. Multiple databases and view selections are kept in
 * `options` while the durable foreign key anchors the run to the first source. */
export interface DatabaseDeepResearchJobInput {
  reportType?: DatabaseDeepResearchRequestedReportType;
  /** Enables deterministic schema/profile based local configuration. */
  autoConfigure?: boolean;
  requestedReportType?: DatabaseDeepResearchRequestedReportType;
  autoConfiguration?: DatabaseDeepResearchAutoConfiguration;
  objective: string;
  databaseIds: string[];
  viewIds: string[];
  filters: DatabaseResearchFilters;
  roles: DatabaseResearchSemanticRoles;
  model: { provider: string; model: string } | null;
  depth: DatabaseResearchDepth;
  budget?: Partial<DatabaseResearchBudget>;
  /** User-edited preview outline carried into the durable request. */
  planSections?: Array<{
    title: string;
    focus: string;
    evidenceCount?: number;
  }>;
  language?: DatabaseDeepResearchPromptLanguage | null;
  audience?: string | null;
  includedCellTypes?: string[];
  includeAttachmentContent?: boolean;
}

export interface DatabaseDeepResearchJob {
  id: string;
  reportType?: DatabaseDeepResearchReportType;
  title: string;
  status: DatabaseResearchRunStatus;
  progress: number;
  phase: string;
  createdAt: string;
  error: string | null;
}

export type DatabaseDeepResearchReportAnnotationColor = 'yellow' | 'rose' | 'blue' | 'mint' | 'lavender' | 'peach';
export interface DatabaseDeepResearchReportAnnotation {
  id: string;
  reportId: string;
  scope: string;
  kind: 'highlight' | 'comment' | 'bookmark';
  color: DatabaseDeepResearchReportAnnotationColor | null;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  prefix: string;
  suffix: string;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface DatabaseDeepResearchReportAnnotationInput {
  reportId: string;
  scope?: string;
  kind: DatabaseDeepResearchReportAnnotation['kind'];
  color?: DatabaseDeepResearchReportAnnotationColor | null;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  prefix?: string;
  suffix?: string;
  comment?: string | null;
}

export interface DatabaseDeepResearchPreview {
  requestedReportType?: DatabaseDeepResearchRequestedReportType;
  reportType?: DatabaseDeepResearchReportType;
  resolvedReportType?: DatabaseDeepResearchReportType;
  suggestedRoles?: DatabaseResearchSemanticRoles;
  confidence?: number;
  warnings?: string[];
  limitations?: string[];
  preflight?: { ok: boolean; partial: boolean; warnings: string[] };
  eligibility?: DatabaseDeepResearchEligibility;
  availableReportTypes?: DatabaseDeepResearchEligibility[];
  rowCount: number;
  sourceCount: number;
  estimatedTokens: number;
  estimatedCostUsd: number;
  requiredAnalyses?: string[];
  optionalAnalyses?: string[];
  sections: Array<{ title: string; focus: string; evidenceCount: number }>;
  evidence: Array<{
    id: string;
    label: string;
    excerpt: string;
    databaseName?: string;
    rowId?: string;
  }>;
}

export interface DatabaseResearchRun {
  id: string;
  databaseId: string;
  objective: string;
  title: string | null;
  reportType?: DatabaseDeepResearchReportType;
  language: string | null;
  model: { provider: string; model: string } | null;
  options: Record<string, unknown>;
  request: Record<string, unknown>;
  plan: Record<string, unknown>;
  snapshotManifest: Record<string, unknown>;
  snapshotFingerprint: string | null;
  provider: string | null;
  budget: Record<string, unknown>;
  revision: number;
  status: DatabaseResearchRunStatus;
  progress: number;
  phase: DatabaseResearchStepKind | "done" | null;
  currentStep: DatabaseResearchStepKind | null;
  error: string | null;
  reportId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface DatabaseResearchStep {
  id: string;
  runId: string;
  kind: DatabaseResearchStepKind;
  ordinal: number;
  status: DatabaseResearchStepStatus;
  progress: number;
  message: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  task: string | null;
  agent: string | null;
  params: Record<string, unknown>;
  resultHash: string | null;
  seed: number | null;
  durationMs: number | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DatabaseResearchClaim {
  id: string;
  runId: string;
  text: string;
  claimType: string | null;
  status: "verified" | "sensitive" | "exploratory" | "unverifiable";
  confidence: number | null;
  sourceRowIds: string[];
  evidence: Record<string, unknown>;
  artifactRefs: string[];
  effect?: number | null;
  interval?: { low: number; high: number; level: number } | null;
  pValue?: number | null;
  qValue?: number | null;
  sensitivity?: Record<string, unknown>;
  limitations?: string[];
  ordinal: number;
  createdAt: string;
}

export interface DatabaseResearchReport {
  id: string;
  runId: string;
  title: string;
  reportType?: DatabaseDeepResearchReportType;
  markdown: string;
  summary: string | null;
  bibliography: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
  structured: Record<string, unknown>;
  quality: Record<string, unknown>;
  provenance: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DatabaseDeepResearchReport extends DatabaseResearchReport {
  structured: {
    sections?: Array<{ id: string; title: string; markdown: string }>;
    charts?: Array<{ id: string; title: string; data: unknown }>;
    evidenceLedger?: DatabaseResearchArtifact[];
    cellTypeCoverage?: Array<{
      columnId: string;
      type: string;
      status: "analyzed" | "metadata_only" | "not_analyzable";
      reason?: string;
    }>;
    methodology?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export type DatabaseDeepResearchExportFormat = "markdown" | "pdf" | "zip";
export interface DatabaseDeepResearchExportOptions {
  format: DatabaseDeepResearchExportFormat;
  /** Raw snapshot data is never exported unless this is explicitly true. */
  includeSnapshot?: boolean;
}

/**
 * Redact database-derived payloads at presentation boundaries. Statistical
 * scalars remain available for evidence, while arbitrary strings (which may be
 * PII or prompt-injection text) never leave the trusted process.
 */
export function redactDatabaseResearchOutput(value: unknown, depth = 0): unknown {
  if (depth > 12 || value == null) return value == null ? value : '[redacted]';
  if (typeof value === 'string') return '[redacted]';
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactDatabaseResearchOutput(item, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    redactDatabaseResearchOutput(item, depth + 1),
  ]));
}

/**
 * Sanitise a persisted report at an untrusted boundary (MCP/export). Unlike
 * `redactDatabaseResearchOutput`, this keeps a small set of structural strings
 * that are useful to a consumer (method/status/hash), while every other string
 * is treated as cell-derived data. In particular, labels, row/column IDs,
 * relation targets, text terms and attachment names never cross this boundary.
 */
const SAFE_RESEARCH_TECHNICAL_KEYS = new Set([
  'status', 'phase', 'kind', 'operation', 'method', 'claimType', 'reportType',
  'language', 'provider', 'model', 'format', 'version', 'mimeType', 'intervalMethod',
]);
const SAFE_RESEARCH_OBJECT_KEYS = new Set([
  ...SAFE_RESEARCH_TECHNICAL_KEYS,
  // Report containers must retain their shape for safe readers and
  // reproducible exports. Their values are still recursively sanitized below.
  'evidenceLedger', 'evidence', 'sections', 'charts', 'cellTypeCoverage',
  'sourceCoverage', 'methodology', 'claims', 'quality', 'provenance', 'metadata',
  'bibliography', 'report', 'requestedOutline', 'reviewWarnings', 'narrativeMode',
  'deterministic', 'rawRowsExposedToModel', 'modelProsePersisted', 'resumed',
  'coverage', 'title', 'markdown', 'description', 'name',
  'id', 'runId', 'artifactId', 'artifactRef', 'hash', 'sha256', 'snapshotFingerprint',
  'n', 'denominator', 'total', 'missing', 'observed', 'rate', 'effect', 'estimate',
  'statistic', 'p', 'pValue', 'qValue', 'q', 'confidence', 'interval', 'low', 'high',
  'chi2', 'dof', 'cramersV', 'expected', 'counts', 'rowLevels', 'columnLevels',
  'level', 'mean', 'median', 'mad', 'variance', 'stdDev', 'standardError', 'coefficient',
  'coefficients', 'hazardRatio', 'hazardRatios', 'survival', 'time', 'atRisk', 'events',
  'censored', 'points', 'sourceIndexes', 'timestamps', 'droppedMissing', 'warnings',
  'columns', 'columnIds', 'filters', 'inputs', 'output', 'seed', 'iterations',
  'components', 'eigenvalues', 'explainedVariance', 'scores', 'nodes', 'degree',
  'betweenness', 'communities', 'components', 'externalTargets', 'orphanTargets',
  'duplicateEdges', 'manyToManySources', 'tests', 'familySize', 'alpha', 'bhRejected',
  'holmRejected', 'adjusted', 'rejected', 'groups', 'events', 'warnings', 'assumptions',
  'nodeCount', 'componentSizes', 'externalTargetCount', 'orphanTargetCount',
  'duplicateRows', 'distinct', 'duplicateValues', 'invalidNumeric', 'missingRate',
  'invalid', 'unavailable', 'bytes', 'uniqueHashes', 'mimeTypes', 'dependencies',
  'unknownDependencies', 'errors', 'cycles', 'reconciliation', 'checked', 'reconciled',
  'divergent', 'tolerance', 'overlap', 'balanceBefore', 'balanceAfter', 'weights',
  'trend', 'seasonality', 'drift', 'rollingOrigin', 'folds', 'mae', 'rmse',
  'slopePerDay', 'intercept', 'rSquared', 'period', 'strength', 'profile',
  'beforeMean', 'afterMean', 'difference', 'standardizedDifference',
  'cadenceMedianMs', 'cadenceCv', 'changePoints', 'lags', 'acf', 'languageCounts',
  'tfidf', 'cooccurrence', 'nearDuplicates', 'distances', 'outliers',
]);

export function sanitizeDatabaseResearchExternal(
  value: unknown,
  key = '',
  depth = 0,
): unknown {
  if (depth > 12 || value == null) return value == null ? value : '[redacted]';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const technical = SAFE_RESEARCH_TECHNICAL_KEYS.has(key);
    const hash = /(?:hash|fingerprint|sha256|artifactref)/i.test(key) && /^[a-f0-9]{32,128}$/i.test(value);
    if (technical || hash) return value;
    return '[redacted]';
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeDatabaseResearchExternal(item, key, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, item], index) => [
    SAFE_RESEARCH_OBJECT_KEYS.has(childKey) ? childKey : `field_${index + 1}`,
    sanitizeDatabaseResearchExternal(item, childKey, depth + 1),
  ]));
}

/** Remove serialized result payloads and common direct identifiers from report
 * prose. This is intentionally conservative and is used by reader/export. */
export function redactDatabaseResearchMarkdown(markdown: string): string {
  if (typeof markdown !== 'string') return '';
  return markdown
    .replace(/^(\s*-\s*(?:Resultado|Result|Résultat|Ergebnis|Risultato|Sonuç):).*$/gim, '$1 `[aggregated values redacted]`')
    .replace(/^(\s*\*\*(?:Objetivo|Objective|Objectif|Ziel|Obiettivo|Amaç):\*\*).*$/gim, '$1 [redacted]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email redactado]')
    .replace(/https?:\/\/[^\s)]+/gi, '[URL redactada]')
    .replace(/(?<![\d-])(?:\+?\d[\d\s().-]{7,}\d)(?![\d-])/g, '[teléfono redactado]');
}

export interface DatabaseResearchRunDetail {
  run: DatabaseResearchRun;
  steps: DatabaseResearchStep[];
  claims: DatabaseResearchClaim[];
  report: DatabaseResearchReport | null;
}

export interface DatabaseResearchProgress {
  runId: string;
  status: DatabaseResearchRunStatus;
  progress: number;
  step: DatabaseResearchStepKind | null;
  phase: DatabaseResearchStepKind | "done" | null;
  message: string | null;
  error?: string | null;
}

export interface DatabaseResearchRunQuery {
  databaseId?: string;
  reportType?: DatabaseDeepResearchReportType;
  status?: DatabaseResearchRunStatus | "all";
  limit?: number;
  offset?: number;
}
export interface DatabaseResearchReportQuery {
  /** Runtime handlers validate this against DATABASE_DEEP_RESEARCH_REPORT_TYPES. */
  reportType?: string;
  limit?: number;
  offset?: number;
  query?: string;
}

export function isDatabaseResearchRunStatus(
  value: unknown,
): value is DatabaseResearchRunStatus {
  return (
    typeof value === "string" &&
    (DATABASE_RESEARCH_RUN_STATUSES as readonly string[]).includes(value)
  );
}

export function isDatabaseResearchStepKind(
  value: unknown,
): value is DatabaseResearchStepKind {
  return (
    typeof value === "string" &&
    (DATABASE_RESEARCH_STEP_KINDS as readonly string[]).includes(value)
  );
}

export function isDatabaseResearchPhase(
  value: unknown,
): value is DatabaseResearchPhase {
  return (
    typeof value === "string" &&
    (DATABASE_RESEARCH_PHASES as readonly string[]).includes(value)
  );
}

export function normalizeDatabaseResearchRequest(
  input: DatabaseResearchRequest,
): DatabaseResearchRequest {
  if (!input || typeof input !== "object")
    throw new Error("La petición de investigación no es válida.");
  const databaseId = String(input.databaseId ?? "").trim();
  const objective = String(input.objective ?? "").trim();
  if (!databaseId)
    throw new Error("La investigación necesita una base de datos.");
  if (!objective) throw new Error("La investigación necesita un objetivo.");
  if (objective.length > 20_000)
    throw new Error(
      "El objetivo de investigación supera el límite de 20.000 caracteres.",
    );
  const model =
    input.model == null
      ? null
      : {
          provider: String(input.model.provider ?? "").trim(),
          model: String(input.model.model ?? "").trim(),
        };
  if (model && (!model.provider || !model.model))
    throw new Error("El modelo de investigación no es válido.");
  return {
    reportType: normalizeDatabaseDeepResearchReportType(input.reportType ?? input.options?.reportType),
    databaseId,
    objective,
    title:
      input.title == null
        ? null
        : String(input.title).trim().slice(0, 2_000) || null,
    language: normalizeDatabaseDeepResearchPromptLanguage(input.language),
    model,
    options:
      input.options &&
      typeof input.options === "object" &&
      !Array.isArray(input.options)
        ? structuredClone(input.options)
        : {},
  };
}

export function normalizeDatabaseDeepResearchJobInput(
  input: DatabaseDeepResearchJobInput,
): DatabaseDeepResearchJobInput {
  if (!input || typeof input !== "object")
    throw new Error("La petición de investigación no es válida.");
  const objective = String(input.objective ?? "").trim();
  if (!objective || objective.length > 20_000)
    throw new Error("El objetivo debe tener entre 1 y 20.000 caracteres.");
  const databaseIds = [
    ...new Set(
      (input.databaseIds ?? []).map((id) => String(id).trim()).filter(Boolean),
    ),
  ];
  if (!databaseIds.length || databaseIds.length > 100)
    throw new Error("Selecciona entre 1 y 100 bases de datos.");
  const viewIds = [
    ...new Set(
      (input.viewIds ?? []).map((id) => String(id).trim()).filter(Boolean),
    ),
  ].slice(0, 100);
  const depth = DATABASE_RESEARCH_DEPTHS.includes(input.depth)
    ? input.depth
    : "deep";
  const requestedReportType: DatabaseDeepResearchRequestedReportType = input.requestedReportType === 'auto' || input.reportType === 'auto'
    ? 'auto'
    : normalizeDatabaseDeepResearchReportType(input.requestedReportType ?? input.reportType);
  const reportType = requestedReportType === 'auto' ? 'general' : requestedReportType;
  const preset = DATABASE_RESEARCH_BUDGETS[depth];
  const model =
    input.model == null
      ? null
      : {
          provider: String(input.model.provider ?? "").trim(),
          model: String(input.model.model ?? "").trim(),
        };
  if (model && (!model.provider || !model.model))
    throw new Error("El modelo de investigación no es válido.");
  const maxRows = Math.max(
    1,
    Math.min(
      500_000,
      Math.trunc(Number(input.budget?.maxRows ?? 500_000)) || 500_000,
    ),
  );
  const maxCostUsd = Number(input.budget?.maxCostUsd);
  const budget: DatabaseResearchBudget = {
    depth,
    rounds: preset.rounds,
    maxTasks: preset.maxTasks,
    resamples: preset.resamples,
    maxRows,
    ...(Number.isFinite(maxCostUsd) && maxCostUsd >= 0 ? { maxCostUsd } : {}),
    ...(input.budget?.seed == null ? {} : { seed: input.budget.seed }),
  };
  const planSections = (input.planSections ?? [])
    .slice(0, 50)
    .map((section) => ({
      title: String(section?.title ?? "")
        .trim()
        .slice(0, 300),
      focus: String(section?.focus ?? "")
        .trim()
        .slice(0, 2_000),
      evidenceCount: Math.max(
        0,
        Math.trunc(Number(section?.evidenceCount ?? 0)) || 0,
      ),
    }))
    .filter((section) => section.title && section.focus);
  return {
    reportType,
    requestedReportType,
    autoConfigure: input.autoConfigure === true || requestedReportType === 'auto',
    autoConfiguration: input.autoConfiguration,
    objective,
    databaseIds,
    viewIds,
    filters: {
      query: String(input.filters?.query ?? "")
        .trim()
        .slice(0, 2_000),
      columnIds: [
        ...new Set(
          (input.filters?.columnIds ?? [])
            .map((id) => String(id).trim())
            .filter(Boolean),
        ),
      ].slice(0, 500),
    },
    roles: structuredClone(input.roles ?? {}),
    model,
    depth,
    budget,
    planSections,
    language: normalizeDatabaseDeepResearchPromptLanguage(input.language),
    audience:
      input.audience == null
        ? null
        : String(input.audience).trim().slice(0, 200) || null,
    includedCellTypes: [
      ...new Set((input.includedCellTypes ?? []).map(String)),
    ].slice(0, 100),
    includeAttachmentContent: input.includeAttachmentContent === true,
  };
}
