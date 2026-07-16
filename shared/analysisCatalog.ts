/**
 * The machine-readable catalog of analyses the app can compute. It tells the AI what
 * it may ask for (catalogManifest), constrains the manual builder (columnRoles /
 * applicableKinds), and validates any request — from the AI or the UI — against the
 * real schema before the engine runs it (validateRequest). Pure and unit-tested so the
 * AI can never pick a column that doesn't exist or a nonsensical combination.
 */

import type { ColumnProfile, DatabaseProfile } from './dataProfile';
import type { DatabaseColumnType } from './databases';
import { ANALYSIS_KINDS } from './analysisSpec';
import type { AnalysisKind, AnalysisRequest } from './analysisSpec';

/** Cardinality ceiling for a column to serve as a grouping/contingency category. */
const LOW_CARD_LIMIT = 20;
/** Cardinality ceiling for a free-text column to count as categorical at all. */
const TEXT_CARD_LIMIT = 12;

export type ColumnRole = 'numeric' | 'category' | 'lowCard' | 'date';

export interface RoleColumn {
  id: string;
  name: string;
  type: ColumnProfile['type'];
  distinct?: number;
}

// ── column role classification ───────────────────────────────────────────────

export function isNumeric(col: ColumnProfile): boolean {
  if (valueTypeOf(col) === 'number') return !!col.number && col.number.count >= 2;
  if (col.type === 'relation') return (col.relationLinks ?? 0) > 0;
  return false;
}

/**
 * What a column's values behave as. Everything is its own type except a formula, which
 * behaves as whatever it computes — so every role below sees a derived column for what it
 * holds rather than for the word "formula". Falls back to `type` because a profile can reach
 * here from outside TypeScript (a test fixture, a persisted or hand-built object), and for
 * every non-formula column the two are the same anyway.
 */
function valueTypeOf(col: ColumnProfile): DatabaseColumnType {
  return col.valueType ?? col.type;
}

/** Distinct count for a categorical-ish column (select uses its distribution length). */
function categoryDistinct(col: ColumnProfile): number | null {
  const t = valueTypeOf(col);
  if (t === 'select' || t === 'multi_select') return col.distribution?.length ?? 0;
  if (t === 'checkbox') return 2;
  if (col.distinct != null) return col.distinct;
  return null;
}

/** Any categorical column (incl. free text and multi-select) — for top-N frequency. */
export function isCategory(col: ColumnProfile): boolean {
  const t = valueTypeOf(col);
  if (t === 'select' || t === 'multi_select' || t === 'checkbox') return (categoryDistinct(col) ?? 0) >= 1;
  if (t === 'title' || t === 'text') {
    const d = col.distinct ?? 0;
    return d >= 2 && d <= 200;
  }
  return false;
}

/** A bounded-cardinality category usable for grouping / chi-square. */
export function isLowCard(col: ColumnProfile): boolean {
  const t = valueTypeOf(col);
  if (t === 'select' || t === 'checkbox') {
    const d = categoryDistinct(col) ?? 0;
    return d >= 2 && d <= LOW_CARD_LIMIT;
  }
  if (t === 'title' || t === 'text') {
    const d = col.distinct ?? 0;
    return d >= 2 && d <= TEXT_CARD_LIMIT;
  }
  return false;
}

export function isDate(col: ColumnProfile): boolean {
  const t = valueTypeOf(col);
  return (t === 'date' || t === 'time') && !!col.dateRange;
}

// The AI plans from these, so a formula is announced as the number or text it computes —
// telling it a column's type is "formula" says nothing it can reason about.
const toRoleCol = (col: ColumnProfile): RoleColumn => ({ id: col.columnId, name: col.name, type: valueTypeOf(col), distinct: categoryDistinct(col) ?? col.distinct });

export interface ColumnRoles {
  numeric: RoleColumn[];
  category: RoleColumn[];
  lowCard: RoleColumn[];
  date: RoleColumn[];
}

export function columnRoles(profile: DatabaseProfile): ColumnRoles {
  return {
    numeric: profile.columns.filter(isNumeric).map(toRoleCol),
    category: profile.columns.filter(isCategory).map(toRoleCol),
    lowCard: profile.columns.filter(isLowCard).map(toRoleCol),
    date: profile.columns.filter(isDate).map(toRoleCol),
  };
}

// ── kind metadata ────────────────────────────────────────────────────────────

export interface ColumnSlot {
  role: ColumnRole;
  /** Spanish source label for the slot (UI translates via t()). */
  label: string;
  /** Accepts several columns (consumes the rest of `columns[]`; must be the LAST slot). */
  multi?: boolean;
  /** May be left empty. */
  optional?: boolean;
}

export interface KindMeta {
  id: AnalysisKind;
  /** Spanish source label (UI translates via t()). */
  label: string;
  /** Icon name from src/components/ui.tsx. */
  icon: string;
  /** Slots in the order `columns[]` must follow. */
  slots: ColumnSlot[];
  /** One-line ES description for the AI manifest. */
  describe: string;
}

export const KIND_META: Record<AnalysisKind, KindMeta> = {
  descriptive: {
    id: 'descriptive',
    label: 'Estadística descriptiva',
    icon: 'chartBar',
    slots: [{ role: 'numeric', label: 'Columnas numéricas', multi: true }],
    describe: 'Resumen numérico completo de UNA O VARIAS columnas numéricas (n, media, mediana, cuartiles, varianza, desviación, CV, asimetría, curtosis, atípicos) con tabla comparativa, histograma y diagramas de caja.',
  },
  correlation: {
    id: 'correlation',
    label: 'Correlación',
    icon: 'network',
    slots: [
      { role: 'numeric', label: 'Columna X' },
      { role: 'numeric', label: 'Columna Y' },
    ],
    describe: 'Relación entre DOS columnas numéricas: Pearson, Spearman, covarianza, regresión lineal (R²) y diagrama de dispersión con recta.',
  },
  correlation_matrix: {
    id: 'correlation_matrix',
    label: 'Matriz de correlación',
    icon: 'grid',
    slots: [{ role: 'numeric', label: 'Columnas (vacío = todas)', multi: true, optional: true }],
    describe: 'Mapa de calor de correlaciones de Pearson entre columnas numéricas. Sin columnas usa TODAS; o elige un subconjunto (≥2).',
  },
  covariance_matrix: {
    id: 'covariance_matrix',
    label: 'Matriz de covarianza',
    icon: 'grid',
    slots: [{ role: 'numeric', label: 'Columnas (vacío = todas)', multi: true, optional: true }],
    describe: 'Mapa de calor de covarianzas entre columnas numéricas (diagonal = varianza). Sin columnas usa TODAS; o elige un subconjunto (≥2).',
  },
  chi_square: {
    id: 'chi_square',
    label: 'Chi-cuadrado',
    icon: 'table',
    slots: [
      { role: 'lowCard', label: 'Categoría (filas)' },
      { role: 'lowCard', label: 'Categoría (columnas)' },
    ],
    describe: 'Independencia entre DOS columnas categóricas de baja cardinalidad: tabla de contingencia, χ², V de Cramér y mapa de calor.',
  },
  crosstab: {
    id: 'crosstab',
    label: 'Tabla cruzada',
    icon: 'table',
    slots: [
      { role: 'lowCard', label: 'Categoría (filas)' },
      { role: 'lowCard', label: 'Categoría (columnas)' },
      { role: 'numeric', label: 'Valor a agregar (opcional)', optional: true },
    ],
    describe: 'Tabla dinámica: cruza DOS categóricas y agrega en cada celda el recuento, o la media/suma de una columna numérica opcional. Mapa de calor + tabla con totales.',
  },
  group_compare: {
    id: 'group_compare',
    label: 'Comparar grupos',
    icon: 'scale',
    slots: [
      { role: 'lowCard', label: 'Agrupar por (categoría)' },
      { role: 'numeric', label: 'Medir (una o varias numéricas)', multi: true },
    ],
    describe: 'Compara UNA O VARIAS columnas numéricas entre los grupos de una categórica: medias/medianas por grupo, ANOVA de un factor (F, η²) y diagramas de caja.',
  },
  top_values: {
    id: 'top_values',
    label: 'Valores más frecuentes',
    icon: 'tags',
    slots: [{ role: 'category', label: 'Columna categórica o de texto' }],
    describe: 'Frecuencia de los valores más comunes de UNA columna categórica, de texto o de selección múltiple (barras).',
  },
  time_series: {
    id: 'time_series',
    label: 'Serie temporal',
    icon: 'calendar',
    slots: [
      { role: 'date', label: 'Columna de fecha' },
      { role: 'numeric', label: 'Valores (opcional, una o varias)', multi: true, optional: true },
    ],
    describe: 'Evolución en el tiempo: agrega por día/mes/año el recuento, o la media/suma de una o varias columnas numéricas (gráfico de líneas).',
  },
  data_quality: {
    id: 'data_quality',
    label: 'Calidad de los datos',
    icon: 'alert',
    slots: [],
    describe: 'Informe de completitud de TODA la tabla: % de relleno y valores distintos por columna, con avisos de columnas vacías, constantes o casi únicas (no necesita columnas).',
  },
};

export function kindMeta(kind: AnalysisKind): KindMeta {
  return KIND_META[kind];
}

// ── applicability & validation ───────────────────────────────────────────────

function rolePool(roles: ColumnRoles, role: ColumnRole): RoleColumn[] {
  return roles[role];
}

/** Which kinds can run at all given the columns present. */
export function applicableKinds(profile: DatabaseProfile): AnalysisKind[] {
  const roles = columnRoles(profile);
  return ANALYSIS_KINDS.filter((kind) => {
    const meta = KIND_META[kind];
    if (kind === 'correlation_matrix' || kind === 'covariance_matrix') return roles.numeric.length >= 2;
    if (kind === 'correlation') return roles.numeric.length >= 2;
    if (kind === 'chi_square' || kind === 'crosstab') return roles.lowCard.length >= 2;
    if (kind === 'data_quality') return profile.columns.length >= 1;
    // Every required slot (non-optional) must have at least one eligible column.
    return meta.slots.every((s) => s.optional || rolePool(roles, s.role).length >= 1);
  });
}

/**
 * Walk a flat `columns[]` into per-slot groups following the slot order. A `multi` slot
 * (always last) consumes the remaining ids; a single slot takes one (or zero if optional).
 */
export function assignColumns(kind: AnalysisKind, columns: string[]): { assigned: string[][]; error?: string } {
  const slots = KIND_META[kind].slots;
  const assigned: string[][] = slots.map(() => []);
  let cursor = 0;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (slot.multi) {
      assigned[i] = columns.slice(cursor);
      cursor = columns.length;
    } else if (cursor < columns.length) {
      assigned[i] = [columns[cursor]];
      cursor++;
    } else if (!slot.optional) {
      return { assigned, error: `Falta una columna para "${slot.label}".` };
    }
  }
  if (cursor < columns.length) return { assigned, error: 'Se han indicado demasiadas columnas.' };
  return { assigned };
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  /** The request with options defaulted, when ok. */
  normalized?: AnalysisRequest;
}

/** Validate a request (AI- or UI-originated) against the real schema. */
export function validateRequest(request: AnalysisRequest, profile: DatabaseProfile): ValidationResult {
  const roles = columnRoles(profile);
  const meta = KIND_META[request.kind];
  if (!meta) return { ok: false, error: `Tipo de análisis desconocido: ${request.kind}` };

  const byId = new Map(profile.columns.map((c) => [c.columnId, c]));
  const inRole = (id: string, role: ColumnRole) => rolePool(roles, role).some((c) => c.id === id);

  if (request.kind === 'data_quality') {
    if (profile.columns.length < 1) return { ok: false, error: 'La tabla no tiene columnas.' };
    return { ok: true, normalized: { kind: request.kind, columns: [] } };
  }

  const { assigned, error } = assignColumns(request.kind, request.columns);
  if (error) return { ok: false, error };

  // Every assigned column must exist and fill its slot's role.
  const flat: string[] = [];
  for (let i = 0; i < meta.slots.length; i++) {
    const slot = meta.slots[i];
    for (const id of assigned[i]) {
      if (!byId.has(id)) return { ok: false, error: `Columna inexistente: ${id}` };
      if (!inRole(id, slot.role)) return { ok: false, error: `La columna "${byId.get(id)!.name}" no sirve para ${slot.label}.` };
      flat.push(id);
    }
  }

  // Per-kind extra checks + option defaults.
  if (request.kind === 'descriptive' && assigned[0].length < 1) return { ok: false, error: 'Elige al menos una columna numérica.' };
  if (request.kind === 'group_compare' && assigned[1].length < 1) return { ok: false, error: 'Elige al menos una columna numérica para medir.' };
  if ((request.kind === 'correlation_matrix' || request.kind === 'covariance_matrix') && assigned[0].length === 1) {
    return { ok: false, error: 'Elige dos o más columnas (o ninguna para usar todas).' };
  }
  if (request.kind === 'correlation' || request.kind === 'chi_square') {
    if (assigned[0][0] === assigned[1][0]) return { ok: false, error: 'Elige dos columnas distintas.' };
  }
  if (request.kind === 'crosstab') {
    if (assigned[0][0] === assigned[1][0]) return { ok: false, error: 'Elige dos categorías distintas.' };
    const hasValue = assigned[2].length > 0;
    const aggregate = request.options?.aggregate ?? (hasValue ? 'mean' : 'count');
    return { ok: true, normalized: { kind: request.kind, columns: flat, options: { aggregate: hasValue ? aggregate : 'count' } } };
  }
  if (request.kind === 'time_series') {
    const hasValue = assigned[1].length > 0;
    return { ok: true, normalized: { kind: request.kind, columns: flat, options: { metric: request.options?.metric ?? (hasValue ? 'mean' : 'count'), bucket: request.options?.bucket ?? 'month' } } };
  }

  return { ok: true, normalized: { kind: request.kind, columns: flat, options: request.options } };
}

// ── AI manifest & default candidates ─────────────────────────────────────────

/** The capability manifest + role-tagged columns handed to the AI planner. */
export function catalogManifest(profile: DatabaseProfile): string {
  const roles = columnRoles(profile);
  const kinds = applicableKinds(profile);
  const lines: string[] = ['=== ANÁLISIS DISPONIBLES ==='];
  for (const kind of kinds) {
    const m = KIND_META[kind];
    const slotDesc = m.slots.map((s) => `${s.role}${s.multi ? '+' : ''}${s.optional ? '?' : ''}`).join(', ');
    const slots = m.slots.length ? ` · columnas: [${slotDesc}] (+ = varias, ? = opcional)` : ' · sin columnas';
    lines.push(`- ${kind}: ${m.describe}${slots}`);
  }
  lines.push('', '=== COLUMNAS POR ROL (usa SOLO estos ids) ===');
  const fmt = (cols: RoleColumn[]) => cols.map((c) => `"${c.id}" (${c.name})`).join(', ') || '(ninguna)';
  lines.push(`numeric: ${fmt(roles.numeric)}`);
  lines.push(`category: ${fmt(roles.category)}`);
  lines.push(`lowCard: ${fmt(roles.lowCard)}`);
  lines.push(`date: ${fmt(roles.date)}`);
  return lines.join('\n');
}

/**
 * A deterministic default set of analyses (fallback when the AI returns nothing and a
 * seed for the manual builder). Bounded so a wide table doesn't explode.
 */
export function applicableAnalyses(profile: DatabaseProfile): AnalysisRequest[] {
  const roles = columnRoles(profile);
  const out: AnalysisRequest[] = [];
  if (roles.numeric.length >= 2) out.push({ kind: 'correlation_matrix', columns: [] });
  if (roles.numeric.length) out.push({ kind: 'descriptive', columns: roles.numeric.slice(0, 4).map((n) => n.id) });
  if (roles.numeric.length >= 2) out.push({ kind: 'correlation', columns: [roles.numeric[0].id, roles.numeric[1].id] });
  if (roles.numeric.length >= 2) out.push({ kind: 'covariance_matrix', columns: [] });
  if (roles.lowCard.length >= 1 && roles.numeric.length >= 1) out.push({ kind: 'group_compare', columns: [roles.lowCard[0].id, ...roles.numeric.slice(0, 2).map((n) => n.id)] });
  if (roles.lowCard.length >= 2) out.push({ kind: 'chi_square', columns: [roles.lowCard[0].id, roles.lowCard[1].id] });
  if (roles.lowCard.length >= 2)
    out.push({ kind: 'crosstab', columns: roles.numeric.length ? [roles.lowCard[0].id, roles.lowCard[1].id, roles.numeric[0].id] : [roles.lowCard[0].id, roles.lowCard[1].id], options: { aggregate: roles.numeric.length ? 'mean' : 'count' } });
  for (const c of roles.category.slice(0, 2)) out.push({ kind: 'top_values', columns: [c.id] });
  if (roles.date.length >= 1) out.push({ kind: 'time_series', columns: roles.numeric.length ? [roles.date[0].id, roles.numeric[0].id] : [roles.date[0].id], options: { metric: roles.numeric.length ? 'mean' : 'count', bucket: 'month' } });
  out.push({ kind: 'data_quality', columns: [] });
  return out;
}
