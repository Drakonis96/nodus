import { decodeDatabaseDate, decodeDatabasePeople } from './databaseProperties';
import type { DatabaseColumn, DatabaseRow } from './databases';

/** Safe, serializable formula language. It deliberately has no member access, assignment,
 * loops, object construction or dynamic function lookup. */
export type FormulaExpression =
  | { type: 'literal'; value: string | number | boolean | null }
  | { type: 'property'; columnId: string }
  | { type: 'unary'; op: 'not' | 'negate'; value: FormulaExpression }
  | { type: 'binary'; op: 'add' | 'subtract' | 'multiply' | 'divide' | 'modulo' | 'equal' | 'not_equal' | 'gt' | 'gte' | 'lt' | 'lte' | 'and' | 'or'; left: FormulaExpression; right: FormulaExpression }
  | { type: 'call'; name: FormulaFunctionName; args: FormulaExpression[] };

export type FormulaFunctionName =
  | 'if' | 'coalesce' | 'concat' | 'lower' | 'upper' | 'length' | 'contains'
  | 'date' | 'dateAdd' | 'dateDiff' | 'year' | 'month'
  | 'list' | 'count' | 'unique' | 'sum' | 'average' | 'median' | 'min' | 'max' | 'first' | 'last'
  | 'columnTotal' | 'columnMean' | 'rank' | 'percentile' | 'percentOfTotal' | 'diffFromMean'
  | 'property' | 'relation' | 'page' | 'personLabel';

export type FormulaRuntimeValue = string | number | boolean | null | FormulaRuntimeValue[]
  | { kind: 'page'; id: string; title: string }
  | { kind: 'person'; id: string; label: string };

export type FormulaExpressionKind = 'number' | 'text' | 'boolean' | 'date' | 'list' | 'page' | 'person';

export interface FormulaExpressionContext {
  columns: Map<string, DatabaseColumn>;
  row: DatabaseRow;
  relatedValues?: (relationColumnId: string, targetColumnId: string) => FormulaRuntimeValue[];
  columnStats?: Map<string, { sorted: number[]; total: number; mean: number }>;
}

interface Token { kind: 'number' | 'string' | 'identifier' | 'operator' | 'punctuation' | 'eof'; value: string; at: number }

const FUNCTIONS = new Set<FormulaFunctionName>([
  'if', 'coalesce', 'concat', 'lower', 'upper', 'length', 'contains',
  'date', 'dateAdd', 'dateDiff', 'year', 'month', 'list', 'count', 'unique',
  'sum', 'average', 'median', 'min', 'max', 'first', 'last', 'property',
  'columnTotal', 'columnMean', 'rank', 'percentile', 'percentOfTotal', 'diffFromMean',
  'relation', 'page', 'personLabel',
]);

export const FORMULA_EXPRESSION_FUNCTIONS = [...FUNCTIONS];

function tokenize(source: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const at = i;
      let value = '';
      while (i < source.length && /[0-9.eE+-]/.test(source[i])) {
        const next = value + source[i];
        if (!/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d*)?$/.test(next)) break;
        value = next; i++;
      }
      if (!Number.isFinite(Number(value))) throw new Error(`Número no válido en ${at + 1}.`);
      out.push({ kind: 'number', value, at }); continue;
    }
    if (c === '"' || c === "'") {
      const quote = c; const at = i++; let value = '';
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') {
          i++;
          if (i >= source.length) throw new Error(`Cadena sin cerrar en ${at + 1}.`);
          const escaped = source[i++];
          value += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped;
        } else value += source[i++];
      }
      if (source[i] !== quote) throw new Error(`Cadena sin cerrar en ${at + 1}.`);
      i++; out.push({ kind: 'string', value, at }); continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const at = i; let value = '';
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) value += source[i++];
      out.push({ kind: 'identifier', value, at }); continue;
    }
    const pair = source.slice(i, i + 2);
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(pair)) {
      out.push({ kind: 'operator', value: pair, at: i }); i += 2; continue;
    }
    if ('+-*/%><!'.includes(c)) { out.push({ kind: 'operator', value: c, at: i++ }); continue; }
    if ('(),'.includes(c)) { out.push({ kind: 'punctuation', value: c, at: i++ }); continue; }
    throw new Error(`Símbolo no permitido «${c}» en ${i + 1}.`);
  }
  out.push({ kind: 'eof', value: '', at: source.length });
  return out;
}

const BINARY: Record<string, { precedence: number; op: Extract<FormulaExpression, { type: 'binary' }>['op'] }> = {
  '||': { precedence: 1, op: 'or' }, '&&': { precedence: 2, op: 'and' },
  '==': { precedence: 3, op: 'equal' }, '!=': { precedence: 3, op: 'not_equal' },
  '>': { precedence: 4, op: 'gt' }, '>=': { precedence: 4, op: 'gte' }, '<': { precedence: 4, op: 'lt' }, '<=': { precedence: 4, op: 'lte' },
  '+': { precedence: 5, op: 'add' }, '-': { precedence: 5, op: 'subtract' },
  '*': { precedence: 6, op: 'multiply' }, '/': { precedence: 6, op: 'divide' }, '%': { precedence: 6, op: 'modulo' },
};

export function parseFormulaExpression(source: string): FormulaExpression {
  const tokens = tokenize(source.trim());
  let cursor = 0;
  const peek = () => tokens[cursor];
  const take = () => tokens[cursor++];
  const expect = (value: string) => {
    const token = take();
    if (token.value !== value) throw new Error(`Se esperaba «${value}» en ${token.at + 1}.`);
  };
  const primary = (): FormulaExpression => {
    const token = take();
    if (token.kind === 'number') return { type: 'literal', value: Number(token.value) };
    if (token.kind === 'string') return { type: 'literal', value: token.value };
    if (token.kind === 'operator' && (token.value === '!' || token.value === '-')) {
      return { type: 'unary', op: token.value === '!' ? 'not' : 'negate', value: primary() };
    }
    if (token.value === '(') { const value = expression(0); expect(')'); return value; }
    if (token.kind === 'identifier') {
      if (token.value === 'true' || token.value === 'false') return { type: 'literal', value: token.value === 'true' };
      if (token.value === 'null') return { type: 'literal', value: null };
      if (!FUNCTIONS.has(token.value as FormulaFunctionName)) throw new Error(`Función no permitida «${token.value}».`);
      expect('(');
      const args: FormulaExpression[] = [];
      while (peek().value !== ')') {
        args.push(expression(0));
        if (peek().value !== ',') break;
        take();
      }
      expect(')');
      if (token.value === 'property') {
        const id = args[0];
        if (args.length !== 1 || id?.type !== 'literal' || typeof id.value !== 'string') throw new Error('property() necesita el id de una propiedad como texto.');
        return { type: 'property', columnId: id.value };
      }
      return { type: 'call', name: token.value as FormulaFunctionName, args };
    }
    throw new Error(`Expresión incompleta en ${token.at + 1}.`);
  };
  const expression = (min: number): FormulaExpression => {
    let left = primary();
    for (;;) {
      const def = BINARY[peek().value];
      if (!def || def.precedence < min) break;
      take();
      const right = expression(def.precedence + 1);
      left = { type: 'binary', op: def.op, left, right };
    }
    return left;
  };
  const result = expression(0);
  if (peek().kind !== 'eof') throw new Error(`Texto inesperado en ${peek().at + 1}.`);
  return result;
}

export function formulaExpressionDependencies(expression: FormulaExpression): string[] {
  const out = new Set<string>();
  const walk = (node: FormulaExpression) => {
    if (node.type === 'property') out.add(node.columnId);
    else if (node.type === 'unary') walk(node.value);
    else if (node.type === 'binary') { walk(node.left); walk(node.right); }
    else if (node.type === 'call') {
      if (node.name === 'relation') {
        const rel = node.args[0];
        if (rel?.type === 'literal' && typeof rel.value === 'string') out.add(rel.value);
      }
      node.args.forEach(walk);
    }
  };
  walk(expression);
  return [...out];
}

function columnKind(column: DatabaseColumn | undefined): FormulaExpressionKind {
  if (!column) return 'text';
  if (column.type === 'number' || column.type === 'rollup' || column.type === 'formula') return 'number';
  if (column.type === 'checkbox') return 'boolean';
  if (column.type === 'date' || column.type === 'created_time' || column.type === 'last_edited_time') return 'date';
  if (column.type === 'multi_select') return 'list';
  if (column.type === 'person' || column.type === 'created_by' || column.type === 'last_edited_by') return 'person';
  if (column.type === 'relation') return 'page';
  return 'text';
}

export function formulaExpressionResultKind(expression: FormulaExpression, columns: DatabaseColumn[] = []): FormulaExpressionKind {
  const byId = new Map(columns.map((column) => [column.id, column]));
  const infer = (node: FormulaExpression): FormulaExpressionKind => {
    if (node.type === 'literal') return typeof node.value === 'number' ? 'number' : typeof node.value === 'boolean' ? 'boolean' : 'text';
    if (node.type === 'property') return columnKind(byId.get(node.columnId));
    if (node.type === 'unary') return node.op === 'not' ? 'boolean' : 'number';
    if (node.type === 'binary') return ['equal', 'not_equal', 'gt', 'gte', 'lt', 'lte', 'and', 'or'].includes(node.op) ? 'boolean' : node.op === 'add' && (infer(node.left) === 'text' || infer(node.right) === 'text') ? 'text' : 'number';
    if (['date', 'dateAdd'].includes(node.name)) return 'date';
    if (node.name === 'relation' || node.name === 'list' || node.name === 'unique') return 'list';
    if (['count', 'sum', 'average', 'median', 'min', 'max', 'dateDiff', 'year', 'month', 'length',
      'columnTotal', 'columnMean', 'rank', 'percentile', 'percentOfTotal', 'diffFromMean'].includes(node.name)) return 'number';
    if (['contains'].includes(node.name)) return 'boolean';
    if (node.name === 'page') return 'page';
    if (node.name === 'if') return node.args[1] ? infer(node.args[1]) : 'text';
    return 'text';
  };
  return infer(expression);
}

function flatten(values: FormulaRuntimeValue[]): FormulaRuntimeValue[] {
  return values.flatMap((value) => Array.isArray(value) ? flatten(value) : [value]);
}
function numberOf(value: FormulaRuntimeValue): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}
function textOf(value: FormulaRuntimeValue): string {
  if (value == null) return '';
  if (Array.isArray(value)) return flatten(value).map(textOf).filter(Boolean).join(', ');
  if (typeof value === 'object') return value.kind === 'page' ? value.title : value.label;
  return String(value);
}
function comparable(value: FormulaRuntimeValue): string | number | boolean {
  const number = numberOf(value);
  return number ?? textOf(value);
}
function rawProperty(column: DatabaseColumn | undefined, row: DatabaseRow): FormulaRuntimeValue {
  if (!column) return null;
  const raw = row.cells[column.id] ?? null;
  if (raw == null || raw === '') return null;
  if (column.type === 'number' || column.type === 'formula' || column.type === 'rollup') return numberOf(raw);
  if (column.type === 'checkbox') return raw === '1' || raw === 'true';
  if (column.type === 'date' || column.type === 'created_time' || column.type === 'last_edited_time') return decodeDatabaseDate(raw)?.start ?? raw;
  if (column.type === 'person' || column.type === 'created_by' || column.type === 'last_edited_by') {
    return decodeDatabasePeople(raw).map((person) => ({ kind: 'person' as const, id: person.id, label: person.label }));
  }
  if (column.type === 'multi_select') {
    try { const ids = JSON.parse(raw); return Array.isArray(ids) ? ids.map(String) : [raw]; } catch { return [raw]; }
  }
  return raw;
}

function addDate(value: FormulaRuntimeValue, amount: FormulaRuntimeValue, unit: string): string | null {
  const date = new Date(textOf(value)); const count = numberOf(amount);
  if (!Number.isFinite(date.getTime()) || count == null) return null;
  if (unit === 'day' || unit === 'days') date.setUTCDate(date.getUTCDate() + count);
  else if (unit === 'week' || unit === 'weeks') date.setUTCDate(date.getUTCDate() + count * 7);
  else if (unit === 'month' || unit === 'months') date.setUTCMonth(date.getUTCMonth() + count);
  else if (unit === 'year' || unit === 'years') date.setUTCFullYear(date.getUTCFullYear() + count);
  else return null;
  return date.toISOString();
}

export function evaluateFormulaExpression(expression: FormulaExpression, context: FormulaExpressionContext): FormulaRuntimeValue {
  const evaluate = (node: FormulaExpression): FormulaRuntimeValue => {
    if (node.type === 'literal') return node.value;
    if (node.type === 'property') return rawProperty(context.columns.get(node.columnId), context.row);
    if (node.type === 'unary') {
      const value = evaluate(node.value);
      return node.op === 'not' ? !value : -(numberOf(value) ?? 0);
    }
    if (node.type === 'binary') {
      if (node.op === 'and') return Boolean(evaluate(node.left)) && Boolean(evaluate(node.right));
      if (node.op === 'or') return Boolean(evaluate(node.left)) || Boolean(evaluate(node.right));
      const left = evaluate(node.left); const right = evaluate(node.right);
      if (node.op === 'add' && (typeof left === 'string' || typeof right === 'string')) return textOf(left) + textOf(right);
      if (node.op === 'equal') return comparable(left) === comparable(right);
      if (node.op === 'not_equal') return comparable(left) !== comparable(right);
      if (node.op === 'gt') return comparable(left) > comparable(right);
      if (node.op === 'gte') return comparable(left) >= comparable(right);
      if (node.op === 'lt') return comparable(left) < comparable(right);
      if (node.op === 'lte') return comparable(left) <= comparable(right);
      const a = numberOf(left); const b = numberOf(right);
      if (a == null || b == null) return null;
      if (node.op === 'add') return a + b;
      if (node.op === 'subtract') return a - b;
      if (node.op === 'multiply') return a * b;
      if (node.op === 'divide') return b === 0 ? null : a / b;
      return b === 0 ? null : a % b;
    }
    if (['columnTotal', 'columnMean', 'rank', 'percentile', 'percentOfTotal', 'diffFromMean'].includes(node.name)) {
      const property = node.args[0];
      if (property?.type !== 'property') return null;
      const stats = context.columnStats?.get(property.columnId);
      const self = numberOf(evaluate(property));
      if (!stats) return null;
      if (node.name === 'columnTotal') return stats.total;
      if (node.name === 'columnMean') return stats.sorted.length ? stats.mean : null;
      if (self == null || !stats.sorted.length) return null;
      if (node.name === 'percentOfTotal') return stats.total === 0 ? null : (self / stats.total) * 100;
      if (node.name === 'diffFromMean') return self - stats.mean;
      if (node.name === 'rank') return 1 + stats.sorted.filter((value) => value > self).length;
      return (stats.sorted.filter((value) => value < self).length / stats.sorted.length) * 100;
    }
    const args = node.args.map(evaluate);
    if (node.name === 'if') return args[0] ? (args[1] ?? null) : (args[2] ?? null);
    if (node.name === 'coalesce') return args.find((value) => value != null && textOf(value) !== '') ?? null;
    if (node.name === 'concat') return args.map(textOf).join('');
    if (node.name === 'lower') return textOf(args[0]).toLocaleLowerCase();
    if (node.name === 'upper') return textOf(args[0]).toLocaleUpperCase();
    if (node.name === 'length') return Array.isArray(args[0]) ? flatten(args[0]).length : textOf(args[0]).length;
    if (node.name === 'contains') return textOf(args[0]).toLocaleLowerCase().includes(textOf(args[1]).toLocaleLowerCase());
    if (node.name === 'date') { const date = new Date(textOf(args[0])); return Number.isFinite(date.getTime()) ? date.toISOString() : null; }
    if (node.name === 'dateAdd') return addDate(args[0], args[1], textOf(args[2]));
    if (node.name === 'dateDiff') {
      const a = new Date(textOf(args[0])).getTime(); const b = new Date(textOf(args[1])).getTime();
      return Number.isFinite(a) && Number.isFinite(b) ? Math.round((a - b) / 86_400_000) : null;
    }
    if (node.name === 'year' || node.name === 'month') {
      const date = new Date(textOf(args[0]));
      return Number.isFinite(date.getTime()) ? (node.name === 'year' ? date.getUTCFullYear() : date.getUTCMonth() + 1) : null;
    }
    if (node.name === 'list') return flatten(args);
    if (node.name === 'relation') {
      const relationId = textOf(args[0]); const targetId = textOf(args[1]);
      return context.relatedValues?.(relationId, targetId) ?? [];
    }
    if (node.name === 'page') return { kind: 'page', id: textOf(args[0]), title: textOf(args[1] ?? args[0]) };
    if (node.name === 'personLabel') {
      const first = flatten([args[0]]).find((value): value is Extract<FormulaRuntimeValue, { kind: 'person' }> =>
        !Array.isArray(value) && typeof value === 'object' && value != null && value.kind === 'person');
      return first ? first.label : textOf(args[0]);
    }
    const values = flatten(args).filter((value) => value != null);
    if (node.name === 'count') return values.length;
    if (node.name === 'unique') return [...new Map(values.map((value) => [JSON.stringify(value), value])).values()];
    if (node.name === 'first') return values[0] ?? null;
    if (node.name === 'last') return values.at(-1) ?? null;
    const numbers = values.map(numberOf).filter((value): value is number => value != null).sort((a, b) => a - b);
    if (!numbers.length) return null;
    if (node.name === 'sum') return numbers.reduce((total, value) => total + value, 0);
    if (node.name === 'average') return numbers.reduce((total, value) => total + value, 0) / numbers.length;
    if (node.name === 'median') { const middle = Math.floor(numbers.length / 2); return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2; }
    if (node.name === 'min') return numbers[0];
    if (node.name === 'max') return numbers.at(-1) ?? null;
    return null;
  };
  return evaluate(expression);
}

export function formulaRuntimeToRaw(value: FormulaRuntimeValue): string | null {
  if (value == null) return null;
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.round(value * 1e10) / 1e10) : null;
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value);
  return value;
}

export function validateFormulaExpression(expression: FormulaExpression, columns: DatabaseColumn[]): string | null {
  const known = new Set(columns.map((column) => column.id));
  for (const dependency of formulaExpressionDependencies(expression)) {
    if (!known.has(dependency)) return 'La fórmula usa una propiedad que ya no existe.';
  }
  const validate = (node: FormulaExpression): string | null => {
    if (node.type === 'call') {
      if (node.name === 'if' && node.args.length !== 3) return 'if() necesita condición, resultado y alternativa.';
      if (node.name === 'relation' && (node.args.length !== 2 || node.args.some((arg) => arg.type !== 'literal' || typeof arg.value !== 'string'))) return 'relation() necesita los ids de relación y propiedad como texto.';
      if (['dateAdd'].includes(node.name) && node.args.length !== 3) return `${node.name}() necesita tres argumentos.`;
      if (['dateDiff', 'contains'].includes(node.name) && node.args.length !== 2) return `${node.name}() necesita dos argumentos.`;
      if (['columnTotal', 'columnMean', 'rank', 'percentile', 'percentOfTotal', 'diffFromMean'].includes(node.name)
        && (node.args.length !== 1 || node.args[0].type !== 'property')) return `${node.name}() necesita una propiedad.`;
      for (const arg of node.args) { const problem = validate(arg); if (problem) return problem; }
    } else if (node.type === 'binary') return validate(node.left) ?? validate(node.right);
    else if (node.type === 'unary') return validate(node.value);
    return null;
  };
  return validate(expression);
}

export function formulaExpressionGlobalStatDependencies(expression: FormulaExpression): string[] {
  const out = new Set<string>();
  const walk = (node: FormulaExpression) => {
    if (node.type === 'call') {
      if (['columnTotal', 'columnMean', 'rank', 'percentile', 'percentOfTotal', 'diffFromMean'].includes(node.name)
        && node.args[0]?.type === 'property') out.add(node.args[0].columnId);
      node.args.forEach(walk);
    } else if (node.type === 'binary') { walk(node.left); walk(node.right); }
    else if (node.type === 'unary') walk(node.value);
  };
  walk(expression);
  return [...out];
}

export function formulaExpressionRelations(expression: FormulaExpression): Array<{ relationColumnId: string; targetColumnId: string }> {
  const out = new Map<string, { relationColumnId: string; targetColumnId: string }>();
  const walk = (node: FormulaExpression) => {
    if (node.type === 'call') {
      if (node.name === 'relation') {
        const relation = node.args[0]; const target = node.args[1];
        if (relation?.type === 'literal' && typeof relation.value === 'string'
          && target?.type === 'literal' && typeof target.value === 'string') {
          out.set(`${relation.value}\0${target.value}`, { relationColumnId: relation.value, targetColumnId: target.value });
        }
      }
      node.args.forEach(walk);
    } else if (node.type === 'binary') { walk(node.left); walk(node.right); }
    else if (node.type === 'unary') walk(node.value);
  };
  walk(expression);
  return [...out.values()];
}

export function explainFormulaExpression(expression: FormulaExpression, columns: DatabaseColumn[]): string {
  const names = new Map(columns.map((column) => [column.id, column.name]));
  const show = (node: FormulaExpression): string => {
    if (node.type === 'literal') return typeof node.value === 'string' ? `«${node.value}»` : String(node.value);
    if (node.type === 'property') return names.get(node.columnId) ?? '?';
    if (node.type === 'unary') return `${node.op === 'not' ? 'no' : 'menos'} ${show(node.value)}`;
    if (node.type === 'binary') return `(${show(node.left)} ${node.op.replaceAll('_', ' ')} ${show(node.right)})`;
    if (node.name === 'relation') return `valores relacionados de ${show(node.args[0])} → ${show(node.args[1])}`;
    return `${node.name}(${node.args.map(show).join(', ')})`;
  };
  return show(expression);
}
