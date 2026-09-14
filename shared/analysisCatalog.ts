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
import type { PromptLanguage } from './types';

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

const MANIFEST_COPY: Record<PromptLanguage, { available: string; columnsByRole: string; columns: string; multiple: string; optional: string; noColumns: string; none: string; descriptions: Record<AnalysisKind, string> }> = {
  es: { available: 'ANÁLISIS DISPONIBLES', columnsByRole: 'COLUMNAS POR ROL (usa SOLO estos ids)', columns: 'columnas', multiple: 'varias', optional: 'opcional', noColumns: 'sin columnas', none: 'ninguna', descriptions: Object.fromEntries(Object.entries(KIND_META).map(([kind, meta]) => [kind, meta.describe])) as Record<AnalysisKind, string> },
  en: { available: 'AVAILABLE ANALYSES', columnsByRole: 'COLUMNS BY ROLE (use ONLY these ids)', columns: 'columns', multiple: 'multiple', optional: 'optional', noColumns: 'no columns', none: 'none', descriptions: {
    descriptive: 'Complete numeric summary of ONE OR MORE numeric columns (n, mean, median, quartiles, variance, standard deviation, CV, skewness, kurtosis, outliers), with a comparison table, histogram, and box plots.', correlation: 'Relationship between TWO numeric columns: Pearson, Spearman, covariance, linear regression (R²), and a scatter plot with regression line.', correlation_matrix: 'Pearson-correlation heat map between numeric columns. With no columns, use ALL; or choose a subset (≥2).', covariance_matrix: 'Covariance heat map between numeric columns (diagonal = variance). With no columns, use ALL; or choose a subset (≥2).', chi_square: 'Independence between TWO low-cardinality categorical columns: contingency table, χ², Cramér’s V, and heat map.', crosstab: 'Pivot table: cross TWO categorical columns and aggregate in each cell either the count or the mean/sum of an optional numeric column. Heat map plus totals table.', group_compare: 'Compare ONE OR MORE numeric columns across the groups of one categorical column: group means/medians, one-way ANOVA (F, η²), and box plots.', top_values: 'Frequency of the most common values in ONE categorical, text, or multi-select column (bars).', time_series: 'Change over time: aggregate by day/month/year either the count or the mean/sum of one or more numeric columns (line chart).', data_quality: 'Completeness report for the ENTIRE table: fill percentage and distinct values by column, with warnings for empty, constant, or nearly unique columns (requires no columns).',
  } },
  fr: { available: 'ANALYSES DISPONIBLES', columnsByRole: 'COLONNES PAR RÔLE (utilisez UNIQUEMENT ces ids)', columns: 'colonnes', multiple: 'plusieurs', optional: 'facultatif', noColumns: 'sans colonnes', none: 'aucune', descriptions: {
    descriptive: 'Résumé numérique complet d’UNE OU PLUSIEURS colonnes numériques (n, moyenne, médiane, quartiles, variance, écart-type, CV, asymétrie, kurtosis, valeurs atypiques), avec tableau comparatif, histogramme et boîtes à moustaches.', correlation: 'Relation entre DEUX colonnes numériques : Pearson, Spearman, covariance, régression linéaire (R²) et nuage de points avec droite.', correlation_matrix: 'Carte thermique des corrélations de Pearson entre colonnes numériques. Sans colonne, utilise TOUTES les colonnes ; sinon un sous-ensemble (≥2).', covariance_matrix: 'Carte thermique des covariances entre colonnes numériques (diagonale = variance). Sans colonne, utilise TOUTES les colonnes ; sinon un sous-ensemble (≥2).', chi_square: 'Indépendance entre DEUX colonnes catégorielles de faible cardinalité : table de contingence, χ², V de Cramér et carte thermique.', crosstab: 'Tableau croisé : croise DEUX catégories et agrège dans chaque cellule le décompte, ou la moyenne/somme d’une colonne numérique facultative. Carte thermique et tableau avec totaux.', group_compare: 'Compare UNE OU PLUSIEURS colonnes numériques entre les groupes d’une catégorie : moyennes/médianes par groupe, ANOVA à un facteur (F, η²) et boîtes à moustaches.', top_values: 'Fréquence des valeurs les plus courantes d’UNE colonne catégorielle, textuelle ou à sélection multiple (barres).', time_series: 'Évolution temporelle : agrège par jour/mois/année le décompte, ou la moyenne/somme d’une ou plusieurs colonnes numériques (courbe).', data_quality: 'Rapport de complétude de TOUTE la table : pourcentage rempli et valeurs distinctes par colonne, avec alertes pour les colonnes vides, constantes ou presque uniques (aucune colonne requise).',
  } },
  de: { available: 'VERFÜGBARE ANALYSEN', columnsByRole: 'SPALTEN NACH ROLLE (NUR diese IDs verwenden)', columns: 'Spalten', multiple: 'mehrere', optional: 'optional', noColumns: 'ohne Spalten', none: 'keine', descriptions: {
    descriptive: 'Vollständige numerische Zusammenfassung EINER ODER MEHRERER numerischer Spalten (n, Mittelwert, Median, Quartile, Varianz, Standardabweichung, CV, Schiefe, Kurtosis, Ausreißer) mit Vergleichstabelle, Histogramm und Boxplots.', correlation: 'Zusammenhang zwischen ZWEI numerischen Spalten: Pearson, Spearman, Kovarianz, lineare Regression (R²) und Streudiagramm mit Gerade.', correlation_matrix: 'Heatmap der Pearson-Korrelationen zwischen numerischen Spalten. Ohne Spalten ALLE verwenden; oder eine Teilmenge (≥2).', covariance_matrix: 'Heatmap der Kovarianzen zwischen numerischen Spalten (Diagonale = Varianz). Ohne Spalten ALLE verwenden; oder eine Teilmenge (≥2).', chi_square: 'Unabhängigkeit zwischen ZWEI kategorialen Spalten mit niedriger Kardinalität: Kontingenztabelle, χ², Cramérs V und Heatmap.', crosstab: 'Pivot-Tabelle: kreuzt ZWEI kategoriale Spalten und aggregiert je Zelle die Anzahl oder Mittelwert/Summe einer optionalen numerischen Spalte. Heatmap und Tabelle mit Summen.', group_compare: 'Vergleicht EINE ODER MEHRERE numerische Spalten zwischen Gruppen einer kategorialen Spalte: Mittelwerte/Mediane, einfaktorielle ANOVA (F, η²) und Boxplots.', top_values: 'Häufigkeit der häufigsten Werte EINER kategorialen, Text- oder Mehrfachauswahlspalte (Balken).', time_series: 'Zeitliche Entwicklung: aggregiert nach Tag/Monat/Jahr die Anzahl oder Mittelwert/Summe einer oder mehrerer numerischer Spalten (Liniendiagramm).', data_quality: 'Vollständigkeitsbericht für die GESAMTE Tabelle: Füllgrad und verschiedene Werte je Spalte, mit Warnungen für leere, konstante oder fast eindeutige Spalten (keine Spalten erforderlich).',
  } },
  pt: { available: 'ANÁLISES DISPONÍVEIS', columnsByRole: 'COLUNAS POR FUNÇÃO (usa APENAS estes ids)', columns: 'colunas', multiple: 'várias', optional: 'opcional', noColumns: 'sem colunas', none: 'nenhuma', descriptions: {
    descriptive: 'Resumo numérico completo de UMA OU VÁRIAS colunas numéricas (n, média, mediana, quartis, variância, desvio-padrão, CV, assimetria, curtose, atípicos), com tabela comparativa, histograma e diagramas de caixa.', correlation: 'Relação entre DUAS colunas numéricas: Pearson, Spearman, covariância, regressão linear (R²) e diagrama de dispersão com reta.', correlation_matrix: 'Mapa de calor das correlações de Pearson entre colunas numéricas. Sem colunas usa TODAS; ou escolhe um subconjunto (≥2).', covariance_matrix: 'Mapa de calor das covariâncias entre colunas numéricas (diagonal = variância). Sem colunas usa TODAS; ou escolhe um subconjunto (≥2).', chi_square: 'Independência entre DUAS colunas categóricas de baixa cardinalidade: tabela de contingência, χ², V de Cramér e mapa de calor.', crosstab: 'Tabela dinâmica: cruza DUAS categóricas e agrega em cada célula a contagem, ou a média/soma de uma coluna numérica opcional. Mapa de calor e tabela com totais.', group_compare: 'Compara UMA OU VÁRIAS colunas numéricas entre os grupos de uma categórica: médias/medianas por grupo, ANOVA de um fator (F, η²) e diagramas de caixa.', top_values: 'Frequência dos valores mais comuns de UMA coluna categórica, de texto ou seleção múltipla (barras).', time_series: 'Evolução temporal: agrega por dia/mês/ano a contagem, ou a média/soma de uma ou várias colunas numéricas (gráfico de linhas).', data_quality: 'Relatório de completude de TODA a tabela: percentagem preenchida e valores distintos por coluna, com avisos para colunas vazias, constantes ou quase únicas (não requer colunas).',
  } },
  'pt-BR': { available: 'ANÁLISES DISPONÍVEIS', columnsByRole: 'COLUNAS POR FUNÇÃO (use SOMENTE estes ids)', columns: 'colunas', multiple: 'várias', optional: 'opcional', noColumns: 'sem colunas', none: 'nenhuma', descriptions: {
    descriptive: 'Resumo numérico completo de UMA OU VÁRIAS colunas numéricas (n, média, mediana, quartis, variância, desvio-padrão, CV, assimetria, curtose, atípicos), com tabela comparativa, histograma e diagramas de caixa.', correlation: 'Relação entre DUAS colunas numéricas: Pearson, Spearman, covariância, regressão linear (R²) e gráfico de dispersão com reta.', correlation_matrix: 'Mapa de calor das correlações de Pearson entre colunas numéricas. Sem colunas usa TODAS; ou escolha um subconjunto (≥2).', covariance_matrix: 'Mapa de calor das covariâncias entre colunas numéricas (diagonal = variância). Sem colunas usa TODAS; ou escolha um subconjunto (≥2).', chi_square: 'Independência entre DUAS colunas categóricas de baixa cardinalidade: tabela de contingência, χ², V de Cramér e mapa de calor.', crosstab: 'Tabela dinâmica: cruza DUAS categóricas e agrega em cada célula a contagem, ou a média/soma de uma coluna numérica opcional. Mapa de calor e tabela com totais.', group_compare: 'Compara UMA OU VÁRIAS colunas numéricas entre os grupos de uma categórica: médias/medianas por grupo, ANOVA de um fator (F, η²) e diagramas de caixa.', top_values: 'Frequência dos valores mais comuns de UMA coluna categórica, textual ou de seleção múltipla (barras).', time_series: 'Evolução no tempo: agrega por dia/mês/ano a contagem, ou a média/soma de uma ou várias colunas numéricas (gráfico de linhas).', data_quality: 'Relatório de completude de TODA a tabela: porcentagem preenchida e valores distintos por coluna, com avisos para colunas vazias, constantes ou quase únicas (não requer colunas).',
  } },
  it: { available: 'ANALISI DISPONIBILI', columnsByRole: 'COLONNE PER RUOLO (usa SOLO questi id)', columns: 'colonne', multiple: 'più di una', optional: 'facoltativo', noColumns: 'senza colonne', none: 'nessuna', descriptions: {
    descriptive: 'Riepilogo numerico completo di UNA O PIÙ colonne numeriche (n, media, mediana, quartili, varianza, deviazione standard, CV, asimmetria, curtosi, anomalie), con tabella comparativa, istogramma e box plot.', correlation: 'Relazione tra DUE colonne numeriche: Pearson, Spearman, covarianza, regressione lineare (R²) e diagramma di dispersione con retta.', correlation_matrix: 'Mappa di calore delle correlazioni di Pearson tra colonne numeriche. Senza colonne usa TUTTE; oppure scegli un sottoinsieme (≥2).', covariance_matrix: 'Mappa di calore delle covarianze tra colonne numeriche (diagonale = varianza). Senza colonne usa TUTTE; oppure scegli un sottoinsieme (≥2).', chi_square: 'Indipendenza tra DUE colonne categoriali a bassa cardinalità: tabella di contingenza, χ², V di Cramér e mappa di calore.', crosstab: 'Tabella pivot: incrocia DUE categorie e aggrega in ogni cella il conteggio, oppure media/somma di una colonna numerica facoltativa. Mappa di calore e tabella con totali.', group_compare: 'Confronta UNA O PIÙ colonne numeriche fra i gruppi di una categoria: medie/mediane per gruppo, ANOVA a un fattore (F, η²) e box plot.', top_values: 'Frequenza dei valori più comuni di UNA colonna categoriale, testuale o a selezione multipla (barre).', time_series: 'Evoluzione nel tempo: aggrega per giorno/mese/anno il conteggio, oppure media/somma di una o più colonne numeriche (grafico a linee).', data_quality: 'Rapporto di completezza dell’INTERA tabella: percentuale compilata e valori distinti per colonna, con avvisi per colonne vuote, costanti o quasi univoche (non richiede colonne).',
  } },
  tr: { available: 'KULLANILABİLİR ANALİZLER', columnsByRole: 'ROLE GÖRE SÜTUNLAR (YALNIZCA bu kimlikleri kullan)', columns: 'sütunlar', multiple: 'birden çok', optional: 'isteğe bağlı', noColumns: 'sütun yok', none: 'yok', descriptions: {
    descriptive: 'BİR VEYA DAHA FAZLA sayısal sütunun tam sayısal özeti (n, ortalama, medyan, çeyrekler, varyans, standart sapma, CV, çarpıklık, basıklık, aykırı değerler); karşılaştırma tablosu, histogram ve kutu grafikleriyle.', correlation: 'İKİ sayısal sütun arasındaki ilişki: Pearson, Spearman, kovaryans, doğrusal regresyon (R²) ve doğrulu saçılım grafiği.', correlation_matrix: 'Sayısal sütunlar arasındaki Pearson korelasyonlarının ısı haritası. Sütun verilmezse TÜMÜNÜ; aksi halde bir alt kümeyi (≥2) kullan.', covariance_matrix: 'Sayısal sütunlar arasındaki kovaryansların ısı haritası (köşegen = varyans). Sütun verilmezse TÜMÜNÜ; aksi halde bir alt kümeyi (≥2) kullan.', chi_square: 'Düşük kardinaliteli İKİ kategorik sütun arasındaki bağımsızlık: olumsallık tablosu, χ², Cramér V ve ısı haritası.', crosstab: 'Pivot tablo: İKİ kategorik sütunu çaprazlar ve her hücrede sayımı ya da isteğe bağlı sayısal sütunun ortalama/toplamını birleştirir. Isı haritası ve toplamlı tablo.', group_compare: 'BİR VEYA DAHA FAZLA sayısal sütunu bir kategorik sütunun grupları arasında karşılaştırır: grup ortalamaları/medyanları, tek yönlü ANOVA (F, η²) ve kutu grafikleri.', top_values: 'BİR kategorik, metin veya çoklu seçim sütunundaki en yaygın değerlerin sıklığı (çubuklar).', time_series: 'Zaman içindeki değişim: gün/ay/yıla göre sayımı ya da bir veya daha çok sayısal sütunun ortalama/toplamını birleştirir (çizgi grafik).', data_quality: 'TÜM tablonun doluluk raporu: sütun başına doluluk yüzdesi ve farklı değerler; boş, sabit veya neredeyse benzersiz sütun uyarılarıyla (sütun gerektirmez).',
  } },
  'zh-Hans': { available: '可用分析', columnsByRole: '按角色的列（只能使用这些 id）', columns: '列', multiple: '多个', optional: '可选', noColumns: '无列', none: '无', descriptions: {
    descriptive: '对一列或多列数值列进行完整数值摘要（n、平均值、中位数、四分位数、方差、标准差、CV、偏度、峰度、异常值），并附比较表、直方图和箱线图。', correlation: '两列数值列之间的关系：Pearson、Spearman、协方差、线性回归（R²），以及带回归线的散点图。', correlation_matrix: '数值列之间的 Pearson 相关热力图。不指定列时使用全部列；或选择一个子集（≥2）。', covariance_matrix: '数值列之间的协方差热力图（对角线 = 方差）。不指定列时使用全部列；或选择一个子集（≥2）。', chi_square: '两列低基数分类列之间的独立性：列联表、χ²、Cramér V 和热力图。', crosstab: '透视表：交叉两列分类列，并在每个单元格中聚合计数，或可选数值列的平均值/总和。热力图加总计表。', group_compare: '比较一列或多列数值列在一列分类列各分组间的差异：各组的平均值/中位数、单因素 ANOVA（F、η²）和箱线图。', top_values: '一列分类列、文本列或多选列中最常见值的频数（条形图）。', time_series: '随时间的变化：按日/月/年聚合计数，或一列或多列数值列的平均值/总和（折线图）。', data_quality: '整张表的完整性报告：各列的填充百分比和不同值数量，并对空列、常量列或几乎唯一的列发出警告（不需要指定列）。',
  } },
  'zh-Hant': { available: '可用分析', columnsByRole: '按角色的欄位（只能使用這些 id）', columns: '欄位', multiple: '多個', optional: '選用', noColumns: '無欄位', none: '無', descriptions: {
    descriptive: '對一欄或多欄數值欄位進行完整數值摘要（n、平均值、中位數、四分位數、變異數、標準差、CV、偏態、峰度、離群值），並附比較表、直方圖和箱形圖。', correlation: '兩欄數值欄位之間的關係：Pearson、Spearman、共變異數、線性迴歸（R²），以及帶迴歸線的散佈圖。', correlation_matrix: '數值欄位之間的 Pearson 相關熱力圖。不指定欄位時使用全部欄位；或選擇一個子集（≥2）。', covariance_matrix: '數值欄位之間的共變異數熱力圖（對角線 = 變異數）。不指定欄位時使用全部欄位；或選擇一個子集（≥2）。', chi_square: '兩欄低基數分類欄位之間的獨立性：列聯表、χ²、Cramér V 和熱力圖。', crosstab: '樞紐分析表：交叉兩欄分類欄位，並在每個儲存格中彙總計數，或選用數值欄位的平均值/總和。熱力圖加總計表。', group_compare: '比較一欄或多欄數值欄位在一欄分類欄位各分組間的差異：各組的平均值/中位數、單因子 ANOVA（F、η²）和箱形圖。', top_values: '一欄分類欄位、文字欄位或多選欄位中最常見值的頻率（長條圖）。', time_series: '隨時間的變化：按日/月/年彙總計數，或一欄或多欄數值欄位的平均值/總和（折線圖）。', data_quality: '整張表的完整性報告：各欄的填充百分比和不同值數量，並對空欄、常數欄或幾乎唯一的欄位發出警告（不需要指定欄位）。',
  } },
  vi: { available: 'CÁC PHÂN TÍCH KHẢ DỤNG', columnsByRole: 'CỘT THEO VAI TRÒ (chỉ dùng các id này)', columns: 'cột', multiple: 'nhiều', optional: 'tùy chọn', noColumns: 'không có cột', none: 'không', descriptions: {
    descriptive: 'Tóm tắt số liệu đầy đủ cho MỘT HOẶC NHIỀU cột số (n, trung bình, trung vị, tứ phân vị, phương sai, độ lệch chuẩn, CV, độ xiên, độ nhọn, giá trị ngoại lai), kèm bảng so sánh, biểu đồ tần suất và biểu đồ hộp.', correlation: 'Quan hệ giữa HAI cột số: Pearson, Spearman, hiệp phương sai, hồi quy tuyến tính (R²) và biểu đồ phân tán có đường hồi quy.', correlation_matrix: 'Bản đồ nhiệt tương quan Pearson giữa các cột số. Nếu không chỉ định cột, dùng TẤT CẢ; hoặc chọn một tập con (≥2).', covariance_matrix: 'Bản đồ nhiệt hiệp phương sai giữa các cột số (đường chéo = phương sai). Nếu không chỉ định cột, dùng TẤT CẢ; hoặc chọn một tập con (≥2).', chi_square: 'Tính độc lập giữa HAI cột phân loại có số lượng giá trị thấp: bảng dự phòng, χ², V của Cramér và bản đồ nhiệt.', crosstab: 'Bảng tổng hợp: giao HAI cột phân loại và tổng hợp trong mỗi ô số đếm, hoặc trung bình/tổng của một cột số tùy chọn. Bản đồ nhiệt kèm bảng tổng.', group_compare: 'So sánh MỘT HOẶC NHIỀU cột số giữa các nhóm của một cột phân loại: trung bình/trung vị theo nhóm, ANOVA một yếu tố (F, η²) và biểu đồ hộp.', top_values: 'Tần suất của các giá trị phổ biến nhất trong MỘT cột phân loại, văn bản hoặc chọn nhiều (biểu đồ cột).', time_series: 'Diễn biến theo thời gian: tổng hợp theo ngày/tháng/năm số đếm, hoặc trung bình/tổng của một hoặc nhiều cột số (biểu đồ đường).', data_quality: 'Báo cáo mức độ hoàn thiện của TOÀN BỘ bảng: tỷ lệ điền và số giá trị khác nhau theo từng cột, kèm cảnh báo về cột trống, hằng số hoặc gần như duy nhất (không cần chỉ định cột).',
  } },
  ja: { available: '利用可能な分析', columnsByRole: '役割別の列（これらの id のみを使用）', columns: '列', multiple: '複数', optional: '任意', noColumns: '列なし', none: 'なし', descriptions: {
    descriptive: '1 つ以上の数値列の完全な数値要約（n、平均、中央値、四分位数、分散、標準偏差、CV、歪度、尖度、外れ値）。比較表、ヒストグラム、箱ひげ図付き。', correlation: '2 つの数値列の関係：Pearson、Spearman、共分散、線形回帰（R²）、回帰直線付き散布図。', correlation_matrix: '数値列間の Pearson 相関ヒートマップ。列を指定しない場合はすべてを使用。または部分集合（≥2）を選択。', covariance_matrix: '数値列間の共分散ヒートマップ（対角線 = 分散）。列を指定しない場合はすべてを使用。または部分集合（≥2）を選択。', chi_square: 'カーディナリティの低い 2 つのカテゴリ列間の独立性：分割表、χ²、Cramér の V、ヒートマップ。', crosstab: 'ピボットテーブル：2 つのカテゴリ列をクロス集計し、各セルに件数、または任意の数値列の平均/合計を集計。ヒートマップと合計表付き。', group_compare: '1 つ以上の数値列を 1 つのカテゴリ列のグループ間で比較：グループごとの平均/中央値、一元配置 ANOVA（F、η²）、箱ひげ図。', top_values: '1 つのカテゴリ列、テキスト列、または複数選択列の最頻値の頻度（棒グラフ）。', time_series: '時間の経過に伴う変化：日/月/年ごとに件数、または 1 つ以上の数値列の平均/合計を集計（折れ線グラフ）。', data_quality: 'テーブル全体の完全性レポート：列ごとの入力率と異なる値の数。空の列、定数列、ほぼ一意の列に関する警告付き（列の指定は不要）。',
  } },
  ru: { available: 'ДОСТУПНЫЕ АНАЛИЗЫ', columnsByRole: 'СТОЛБЦЫ ПО РОЛИ (используйте ТОЛЬКО эти id)', columns: 'столбцы', multiple: 'несколько', optional: 'необязательно', noColumns: 'без столбцов', none: 'нет', descriptions: {
    descriptive: 'Полная числовая сводка по ОДНОМУ ИЛИ НЕСКОЛЬКИМ числовым столбцам (n, среднее, медиана, квартили, дисперсия, стандартное отклонение, CV, асимметрия, эксцесс, выбросы) со сравнительной таблицей, гистограммой и ящичными диаграммами.', correlation: 'Связь между ДВУМЯ числовыми столбцами: Pearson, Spearman, ковариация, линейная регрессия (R²) и диаграмма рассеяния с линией регрессии.', correlation_matrix: 'Тепловая карта корреляций Pearson между числовыми столбцами. Без столбцов использует ВСЕ; или выберите подмножество (≥2).', covariance_matrix: 'Тепловая карта ковариаций между числовыми столбцами (диагональ = дисперсия). Без столбцов использует ВСЕ; или выберите подмножество (≥2).', chi_square: 'Независимость между ДВУМЯ категориальными столбцами с низкой кардинальностью: таблица сопряжённости, χ², V Крамера и тепловая карта.', crosstab: 'Сводная таблица: пересекает ДВА категориальных столбца и агрегирует в каждой ячейке количество либо среднее/сумму необязательного числового столбца. Тепловая карта и таблица с итогами.', group_compare: 'Сравнивает ОДИН ИЛИ НЕСКОЛЬКО числовых столбцов между группами одного категориального столбца: средние/медианы по группам, однофакторный ANOVA (F, η²) и ящичные диаграммы.', top_values: 'Частота наиболее распространённых значений ОДНОГО категориального, текстового столбца или столбца с множественным выбором (столбчатая диаграмма).', time_series: 'Изменение во времени: агрегирует по дням/месяцам/годам количество либо среднее/сумму одного или нескольких числовых столбцов (линейный график).', data_quality: 'Отчёт о полноте ВСЕЙ таблицы: процент заполнения и число различных значений по столбцам, с предупреждениями о пустых, постоянных или почти уникальных столбцах (столбцы не требуются).',
  } },
  uk: { available: 'ДОСТУПНІ АНАЛІЗИ', columnsByRole: 'СТОВПЦІ ЗА РОЛЛЮ (використовуйте ЛИШЕ ці id)', columns: 'стовпці', multiple: 'кілька', optional: 'необов’язково', noColumns: 'без стовпців', none: 'немає', descriptions: {
    descriptive: 'Повний числовий підсумок по ОДНОМУ АБО КІЛЬКОХ числових стовпцях (n, середнє, медіана, квартилі, дисперсія, стандартне відхилення, CV, асиметрія, ексцес, викиди) з порівняльною таблицею, гістограмою та ящиковими діаграмами.', correlation: 'Зв’язок між ДВОМА числовими стовпцями: Pearson, Spearman, коваріація, лінійна регресія (R²) та діаграма розсіювання з лінією регресії.', correlation_matrix: 'Теплова карта кореляцій Pearson між числовими стовпцями. Без стовпців використовує ВСІ; або виберіть підмножину (≥2).', covariance_matrix: 'Теплова карта коваріацій між числовими стовпцями (діагональ = дисперсія). Без стовпців використовує ВСІ; або виберіть підмножину (≥2).', chi_square: 'Незалежність між ДВОМА категоріальними стовпцями з низькою кардинальністю: таблиця спряженості, χ², V Крамера та теплова карта.', crosstab: 'Зведена таблиця: перехрещує ДВА категоріальні стовпці та агрегує в кожній комірці кількість або середнє/суму необов’язкового числового стовпця. Теплова карта й таблиця з підсумками.', group_compare: 'Порівнює ОДИН АБО КІЛЬКА числових стовпців між групами одного категоріального стовпця: середні/медіани за групами, однофакторний ANOVA (F, η²) та ящикові діаграми.', top_values: 'Частота найпоширеніших значень ОДНОГО категоріального, текстового стовпця або стовпця з множинним вибором (стовпчикова діаграма).', time_series: 'Зміна в часі: агрегує за днями/місяцями/роками кількість або середнє/суму одного чи кількох числових стовпців (лінійний графік).', data_quality: 'Звіт про повноту ВСІЄЇ таблиці: відсоток заповнення та кількість різних значень за стовпцями, з попередженнями про порожні, сталі або майже унікальні стовпці (стовпці не потрібні).',
  } },
  ko: { available: '사용 가능한 분석', columnsByRole: '역할별 열 (이 id만 사용)', columns: '열', multiple: '여러 개', optional: '선택 사항', noColumns: '열 없음', none: '없음', descriptions: {
    descriptive: '하나 이상의 수치 열에 대한 전체 수치 요약(n, 평균, 중앙값, 사분위수, 분산, 표준편차, CV, 왜도, 첨도, 이상값)과 비교 표, 히스토그램, 상자 그림입니다.', correlation: '두 수치 열 간의 관계: Pearson, Spearman, 공분산, 선형 회귀(R²), 회귀선이 있는 산점도.', correlation_matrix: '수치 열 간의 Pearson 상관 히트맵. 열을 지정하지 않으면 전체를 사용하며, 부분집합(≥2)을 선택할 수도 있습니다.', covariance_matrix: '수치 열 간의 공분산 히트맵(대각선 = 분산). 열을 지정하지 않으면 전체를 사용하며, 부분집합(≥2)을 선택할 수도 있습니다.', chi_square: '카디널리티가 낮은 두 범주형 열 간의 독립성: 분할표, χ², Cramér의 V, 히트맵.', crosstab: '피벗 테이블: 두 범주형 열을 교차하고 각 셀에 개수 또는 선택적 수치 열의 평균/합계를 집계합니다. 히트맵과 합계 표.', group_compare: '하나 이상의 수치 열을 한 범주형 열의 그룹 간에 비교합니다: 그룹별 평균/중앙값, 일원 ANOVA(F, η²), 상자 그림.', top_values: '하나의 범주형, 텍스트 또는 다중 선택 열에서 가장 흔한 값의 빈도(막대).', time_series: '시간에 따른 변화: 일/월/년별로 개수 또는 하나 이상의 수치 열의 평균/합계를 집계합니다(선 그래프).', data_quality: '전체 테이블의 완전성 보고서: 열별 채움 비율과 서로 다른 값의 수, 비어 있거나 상수이거나 거의 고유한 열에 대한 경고 포함(열이 필요하지 않음).',
  } },
};

/** The capability manifest + role-tagged columns handed to the AI planner. */
export function catalogManifest(profile: DatabaseProfile, language: PromptLanguage = 'es'): string {
  const copy = MANIFEST_COPY[language] ?? MANIFEST_COPY.es;
  const roles = columnRoles(profile);
  const kinds = applicableKinds(profile);
  const lines: string[] = [`=== ${copy.available} ===`];
  for (const kind of kinds) {
    const m = KIND_META[kind];
    const slotDesc = m.slots.map((s) => `${s.role}${s.multi ? '+' : ''}${s.optional ? '?' : ''}`).join(', ');
    const slots = m.slots.length ? ` · ${copy.columns}: [${slotDesc}] (+ = ${copy.multiple}, ? = ${copy.optional})` : ` · ${copy.noColumns}`;
    lines.push(`- ${kind}: ${copy.descriptions[kind]}${slots}`);
  }
  lines.push('', `=== ${copy.columnsByRole} ===`);
  const fmt = (cols: RoleColumn[]) => cols.map((c) => `"${c.id}" (${c.name})`).join(', ') || `(${copy.none})`;
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
