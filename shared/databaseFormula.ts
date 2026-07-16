/**
 * Formula columns: a computed property described by a structured spec rather than a typed
 * expression. This mirrors how charts work in this vault (a structured spec + a shown query,
 * never evaluated code): a spec cannot have a syntax error, it is inspectable, and the whole
 * thing is unit-testable without a database.
 *
 * The point is the audience. Someone who does not use Excel does not fail at `=IF(A1>5,…)`
 * because the logic is hard — they fail at the notation. So a formula here is a *recipe*
 * ("Operación", "Si… entonces") whose operands are picked from dropdowns of real column
 * names, and the `ifThen` recipe reuses the very same condition shape as the filter bar, so
 * the comparison vocabulary is learned once.
 *
 * This module holds the spec and the pure helpers over it. Evaluation lives in
 * databaseFormulaEval.ts: the evaluator needs the filter engine's matchesCondition, while
 * databaseFilters needs formulaResultKind from here — splitting the two keeps that from
 * becoming a runtime import cycle (the type-only import below is erased at compile time).
 */

import type { DatabaseColumn, DatabaseColumnType } from './databases';
import type { FilterCondition, FilterOp } from './databaseFilters';

/** An operand of an arithmetic recipe: another column, or a fixed number. */
export type FormulaOperand = { kind: 'column'; columnId: string } | { kind: 'number'; value: number };

/**
 * What an "Operación" does. add/subtract/multiply/divide fold left to right, so there is no
 * operator precedence to explain — the reason each recipe takes one operation over N operands
 * instead of a free-form expression. The rest treat their operands as an unordered set.
 */
export type ArithmeticOp =
  | 'add'
  | 'subtract'
  | 'multiply'
  | 'divide'
  | 'average'
  | 'min'
  | 'max'
  | 'median'
  | 'countFilled';

/** A statistic of one column across every row of the table, evaluated per row. */
export type ColumnStatFn =
  | 'percentOfTotal'
  | 'rank'
  | 'diffFromMean'
  | 'percentile'
  | 'columnTotal'
  | 'columnMean';

/** What a rule (or the fallback) puts in the cell when it wins. */
export type FormulaOutput =
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'column'; columnId: string }
  | { kind: 'empty' };

/** One "Si… entonces…" rule: conditions (combined by one conjunction) → an output. */
export interface FormulaRule {
  id: string;
  conjunction: 'and' | 'or';
  conditions: FilterCondition[];
  output: FormulaOutput;
  /** Paints the cell when this rule wins — the "semáforo" this feature exists for. */
  color?: string | null;
}

/** A piece of a "Texto combinado": a column's display value, or fixed text. */
export type ConcatPart = { kind: 'column'; columnId: string } | { kind: 'text'; value: string };

export type FormulaSpec =
  | { kind: 'arithmetic'; op: ArithmeticOp; operands: FormulaOperand[] }
  | { kind: 'columnStat'; fn: ColumnStatFn; columnId: string }
  | { kind: 'ifThen'; rules: FormulaRule[]; otherwise: FormulaOutput; otherwiseColor?: string | null }
  | { kind: 'concat'; parts: ConcatPart[] };

export type FormulaKind = FormulaSpec['kind'];

/**
 * Conditional formatting on the *result*, for any recipe ("si el total pasa de 100, rojo").
 * Distinct from a rule's own colour: that one says "this branch means red", this one says
 * "any result over 100 is red", and a formula can want either without the other.
 */
export interface FormulaColorRule {
  id: string;
  op: FilterOp;
  value?: string | null;
  color: string;
}

/** The recipes offered in the editor, in the order they are shown. */
export const FORMULA_RECIPES: { id: FormulaKind; label: string; icon: string; hint: string }[] = [
  { id: 'arithmetic', label: 'Operación', icon: 'plus', hint: 'Suma, resta, multiplica o divide columnas' },
  { id: 'columnStat', label: 'Estadística de columna', icon: 'chartBar', hint: 'Compara cada fila con el resto de la tabla' },
  { id: 'ifThen', label: 'Si… entonces…', icon: 'route', hint: 'Reglas que deciden qué mostrar, y de qué color' },
  { id: 'concat', label: 'Texto combinado', icon: 'quote', hint: 'Une columnas y texto en una frase' },
];

export const ARITHMETIC_OPS: { id: ArithmeticOp; label: string; symbol: string; ordered: boolean }[] = [
  { id: 'add', label: 'Suma', symbol: '+', ordered: false },
  { id: 'subtract', label: 'Resta', symbol: '−', ordered: true },
  { id: 'multiply', label: 'Multiplica', symbol: '×', ordered: false },
  { id: 'divide', label: 'Divide', symbol: '÷', ordered: true },
  { id: 'average', label: 'Media', symbol: '', ordered: false },
  { id: 'min', label: 'Mínimo', symbol: '', ordered: false },
  { id: 'max', label: 'Máximo', symbol: '', ordered: false },
  { id: 'median', label: 'Mediana', symbol: '', ordered: false },
  { id: 'countFilled', label: 'Cuántas tienen valor', symbol: '', ordered: false },
];

export const COLUMN_STAT_FNS: { id: ColumnStatFn; label: string; hint: string }[] = [
  { id: 'percentOfTotal', label: '% del total', hint: 'Qué parte del total suma esta fila' },
  { id: 'rank', label: 'Posición', hint: '1 = el valor más alto de la tabla' },
  { id: 'diffFromMean', label: 'Diferencia con la media', hint: 'Cuánto se aleja esta fila de la media' },
  { id: 'percentile', label: 'Percentil', hint: 'Qué % de filas quedan por debajo' },
  { id: 'columnTotal', label: 'Total de la columna', hint: 'La misma suma en todas las filas' },
  { id: 'columnMean', label: 'Media de la columna', hint: 'La misma media en todas las filas' },
];

/** Column types a formula can read as a number. */
const NUMERIC_SOURCE_TYPES = new Set<DatabaseColumnType>(['number', 'checkbox', 'formula', 'rollup']);

/** Whether a column can feed an arithmetic operand or a column statistic. */
export function isNumericSource(column: DatabaseColumn): boolean {
  if (column.type === 'formula') return formulaResultKind(column.config.formula as FormulaSpec | undefined) === 'number';
  return NUMERIC_SOURCE_TYPES.has(column.type);
}

/** What an output contributes to the column's result kind, or null when it says nothing. */
function outputKind(o: FormulaOutput): 'number' | 'text' | null {
  if (o.kind === 'number') return 'number';
  if (o.kind === 'text') return 'text';
  return null; // 'empty' and 'column' don't pin the kind down on their own
}

/**
 * Whether the column holds numbers or text — what it sorts and filters as. Derived from the
 * spec rather than stored, so it can never drift out of step with the formula.
 */
export function formulaResultKind(spec: FormulaSpec | undefined | null): 'number' | 'text' {
  if (!spec) return 'text';
  switch (spec.kind) {
    case 'arithmetic':
    case 'columnStat':
      return 'number';
    case 'concat':
      return 'text';
    case 'ifThen': {
      const kinds = [...spec.rules.map((r) => outputKind(r.output)), outputKind(spec.otherwise)].filter(Boolean);
      // Mixed or unpinned outputs compare as text: it is the only kind that can hold both.
      return kinds.length > 0 && kinds.every((k) => k === 'number') ? 'number' : 'text';
    }
  }
}

/** Every column id this spec reads, for dependency ordering and cycle detection. */
export function formulaDependencies(spec: FormulaSpec | undefined | null): string[] {
  if (!spec) return [];
  const out = new Set<string>();
  switch (spec.kind) {
    case 'arithmetic':
      for (const o of spec.operands) if (o.kind === 'column') out.add(o.columnId);
      break;
    case 'columnStat':
      if (spec.columnId) out.add(spec.columnId);
      break;
    case 'ifThen':
      for (const r of spec.rules) {
        for (const c of r.conditions) if (c.columnId) out.add(c.columnId);
        if (r.output.kind === 'column') out.add(r.output.columnId);
      }
      if (spec.otherwise.kind === 'column') out.add(spec.otherwise.columnId);
      break;
    case 'concat':
      for (const p of spec.parts) if (p.kind === 'column') out.add(p.columnId);
      break;
  }
  return [...out];
}

/** A spec the editor can save but that cannot be evaluated yet, in the user's words. */
export function validateFormula(spec: FormulaSpec | undefined | null, columns: DatabaseColumn[]): string | null {
  if (!spec) return 'Esta columna todavía no tiene fórmula.';
  const known = new Set(columns.map((c) => c.id));
  for (const id of formulaDependencies(spec)) {
    if (!known.has(id)) return 'La fórmula usa una columna que ya no existe.';
  }
  switch (spec.kind) {
    case 'arithmetic':
      if (spec.operands.length < (spec.op === 'countFilled' ? 1 : 2)) return 'Elige al menos dos columnas o números.';
      return null;
    case 'columnStat':
      if (!spec.columnId) return 'Elige la columna que quieres medir.';
      return null;
    case 'ifThen':
      if (spec.rules.length === 0) return 'Añade al menos una regla.';
      if (spec.rules.some((r) => r.conditions.length === 0)) return 'Cada regla necesita al menos una condición.';
      return null;
    case 'concat':
      if (spec.parts.length === 0) return 'Añade al menos una columna o un texto.';
      return null;
  }
}

/** The default spec for a freshly picked recipe. */
export function emptyFormula(kind: FormulaKind): FormulaSpec {
  switch (kind) {
    case 'arithmetic':
      return { kind: 'arithmetic', op: 'add', operands: [] };
    case 'columnStat':
      return { kind: 'columnStat', fn: 'percentOfTotal', columnId: '' };
    case 'ifThen':
      return { kind: 'ifThen', rules: [], otherwise: { kind: 'text', value: '' } };
    case 'concat':
      return { kind: 'concat', parts: [] };
  }
}

/**
 * The type a column's cell compares and sorts as. Everything is itself except a formula,
 * which behaves as whatever it computes — otherwise a numeric formula would sort as text
 * and put "10" before "9". Lives here rather than in databaseFilters so that module can
 * import it without this one having to import the filter engine back.
 */
export function comparableType(column: DatabaseColumn): DatabaseColumnType {
  if (column.type !== 'formula') return column.type;
  return formulaResultKind(column.config.formula as FormulaSpec | undefined);
}
