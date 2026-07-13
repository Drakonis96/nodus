/**
 * Notion-style filtering and sorting for database rows. Pure and dependency-free so
 * the matching/ordering logic is unit-tested without a database; the view applies it
 * client-side to the loaded rows. Conditions combine with a single AND/OR conjunction
 * (added progressively); sorts are multi-column with a stable order.
 */

import { decodeCheckbox, decodeMultiSelect, decodeNumber } from './databases';
import type { DatabaseColumn, DatabaseColumnType, DatabaseRow } from './databases';

export type FilterOp =
  | 'contains'
  | 'notContains'
  | 'equals'
  | 'notEquals'
  | 'isEmpty'
  | 'notEmpty'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'before'
  | 'after'
  | 'isAnyOf'
  | 'isNoneOf'
  | 'hasAllOf'
  | 'isChecked'
  | 'isUnchecked';

export interface FilterCondition {
  id: string;
  columnId: string;
  op: FilterOp;
  /** Operand: a string for text/number/date; an array of option ids for select. */
  value?: string | string[] | null;
}

/** A nested group of conditions with its own conjunction (one level of nesting). */
export interface FilterGroup {
  id: string;
  conjunction: 'and' | 'or';
  conditions: FilterCondition[];
}

export interface DatabaseFilterState {
  /** Combines the top-level conditions AND the groups. */
  conjunction: 'and' | 'or';
  conditions: FilterCondition[];
  /** Optional nested groups, each combined internally by its own conjunction. */
  groups?: FilterGroup[];
}

export interface SortRule {
  columnId: string;
  dir: 'asc' | 'desc';
}

/** A saved view: a named layout with its own filter + sort. */
export interface DatabaseSavedView {
  id: string;
  databaseId: string;
  name: string;
  layout: 'table' | 'gallery';
  filter: DatabaseFilterState;
  sorts: SortRule[];
  position: number;
  createdAt: string;
}

export interface SavedViewInput {
  name: string;
  layout: 'table' | 'gallery';
  filter: DatabaseFilterState;
  sorts: SortRule[];
}

const OP_LABELS: Record<FilterOp, string> = {
  contains: 'contiene',
  notContains: 'no contiene',
  equals: 'es igual a',
  notEquals: 'no es igual a',
  isEmpty: 'está vacío',
  notEmpty: 'no está vacío',
  gt: 'mayor que',
  gte: 'mayor o igual que',
  lt: 'menor que',
  lte: 'menor o igual que',
  before: 'antes de',
  after: 'después de',
  isAnyOf: 'es alguno de',
  isNoneOf: 'no es ninguno de',
  hasAllOf: 'tiene todos',
  isChecked: 'marcado',
  isUnchecked: 'sin marcar',
};

export function opLabel(op: FilterOp): string {
  return OP_LABELS[op];
}

/** Operators offered for a column type (empty for non-filterable types like relation). */
export function operatorsForType(type: DatabaseColumnType): FilterOp[] {
  switch (type) {
    case 'title':
    case 'text':
    case 'ai':
      return ['contains', 'notContains', 'equals', 'notEquals', 'isEmpty', 'notEmpty'];
    case 'number':
      return ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'notEmpty'];
    case 'date':
    case 'time':
      return ['equals', 'before', 'after', 'isEmpty', 'notEmpty'];
    case 'select':
      return ['isAnyOf', 'isNoneOf', 'isEmpty', 'notEmpty'];
    case 'multi_select':
      return ['isAnyOf', 'hasAllOf', 'isNoneOf', 'isEmpty', 'notEmpty'];
    case 'checkbox':
      return ['isChecked', 'isUnchecked'];
    case 'attachment':
    case 'relation':
      return ['isEmpty', 'notEmpty'];
    default:
      return [];
  }
}

export function isColumnFilterable(type: DatabaseColumnType): boolean {
  return operatorsForType(type).length > 0;
}

export function opNeedsValue(op: FilterOp): boolean {
  return !['isEmpty', 'notEmpty', 'isChecked', 'isUnchecked'].includes(op);
}

function asArray(v: FilterCondition['value']): string[] {
  return Array.isArray(v) ? v : v == null ? [] : [v];
}

function matchesCondition(column: DatabaseColumn, row: DatabaseRow, cond: FilterCondition): boolean {
  const raw = row.cells[column.id] ?? null;
  const empty = raw == null || raw === '';
  switch (column.type) {
    case 'title':
    case 'text':
    case 'ai': {
      const text = (raw ?? '').toLowerCase();
      const q = String(cond.value ?? '').toLowerCase();
      switch (cond.op) {
        case 'contains':
          return text.includes(q);
        case 'notContains':
          return !text.includes(q);
        case 'equals':
          return text === q;
        case 'notEquals':
          return text !== q;
        case 'isEmpty':
          return empty;
        case 'notEmpty':
          return !empty;
        default:
          return true;
      }
    }
    case 'number': {
      const n = decodeNumber(raw);
      const target = decodeNumber(String(cond.value ?? ''));
      switch (cond.op) {
        case 'isEmpty':
          return n == null;
        case 'notEmpty':
          return n != null;
        default:
          if (n == null || target == null) return false;
          switch (cond.op) {
            case 'equals':
              return n === target;
            case 'notEquals':
              return n !== target;
            case 'gt':
              return n > target;
            case 'gte':
              return n >= target;
            case 'lt':
              return n < target;
            case 'lte':
              return n <= target;
            default:
              return true;
          }
      }
    }
    case 'date':
    case 'time': {
      const v = raw ?? '';
      const target = String(cond.value ?? '');
      switch (cond.op) {
        case 'isEmpty':
          return empty;
        case 'notEmpty':
          return !empty;
        case 'equals':
          return v === target;
        case 'before':
          return !empty && v < target;
        case 'after':
          return !empty && v > target;
        default:
          return true;
      }
    }
    case 'select': {
      const sel = raw;
      const set = asArray(cond.value);
      switch (cond.op) {
        case 'isEmpty':
          return empty;
        case 'notEmpty':
          return !empty;
        case 'isAnyOf':
          return sel != null && set.includes(sel);
        case 'isNoneOf':
          return sel == null || !set.includes(sel);
        default:
          return true;
      }
    }
    case 'multi_select': {
      const ids = decodeMultiSelect(raw);
      const set = asArray(cond.value);
      switch (cond.op) {
        case 'isEmpty':
          return ids.length === 0;
        case 'notEmpty':
          return ids.length > 0;
        case 'isAnyOf':
          return set.some((s) => ids.includes(s));
        case 'hasAllOf':
          return set.every((s) => ids.includes(s));
        case 'isNoneOf':
          return !set.some((s) => ids.includes(s));
        default:
          return true;
      }
    }
    case 'checkbox': {
      const checked = decodeCheckbox(raw);
      return cond.op === 'isChecked' ? checked : cond.op === 'isUnchecked' ? !checked : true;
    }
    case 'attachment': {
      const count = (row.attachments?.[column.id] ?? []).length;
      return cond.op === 'isEmpty' ? count === 0 : cond.op === 'notEmpty' ? count > 0 : true;
    }
    case 'relation': {
      const count = row.relationCounts?.[column.id] ?? 0;
      return cond.op === 'isEmpty' ? count === 0 : cond.op === 'notEmpty' ? count > 0 : true;
    }
    default:
      return true;
  }
}

export function isFilterActive(filter: DatabaseFilterState): boolean {
  return filter.conditions.length > 0 || (filter.groups?.some((g) => g.conditions.length > 0) ?? false);
}

export function applyDatabaseFilter(rows: DatabaseRow[], columns: DatabaseColumn[], filter: DatabaseFilterState): DatabaseRow[] {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const topConds = filter.conditions.filter((c) => byId.has(c.columnId));
  const groups = (filter.groups ?? [])
    .map((g) => ({ conjunction: g.conjunction, conds: g.conditions.filter((c) => byId.has(c.columnId)) }))
    .filter((g) => g.conds.length > 0);
  if (topConds.length === 0 && groups.length === 0) return rows;
  return rows.filter((row) => {
    const results: boolean[] = [];
    for (const c of topConds) results.push(matchesCondition(byId.get(c.columnId)!, row, c));
    for (const g of groups) {
      const rs = g.conds.map((c) => matchesCondition(byId.get(c.columnId)!, row, c));
      results.push(g.conjunction === 'or' ? rs.some(Boolean) : rs.every(Boolean));
    }
    return filter.conjunction === 'or' ? results.some(Boolean) : results.every(Boolean);
  });
}

/** Comparable key for a column's cell (option columns sort by option order). */
function sortKey(column: DatabaseColumn, row: DatabaseRow): { empty: boolean; num?: number; str?: string } {
  const raw = row.cells[column.id] ?? null;
  if (raw == null || raw === '') return { empty: true };
  switch (column.type) {
    case 'number': {
      const n = decodeNumber(raw);
      return n == null ? { empty: true } : { empty: false, num: n };
    }
    case 'checkbox':
      return { empty: false, num: decodeCheckbox(raw) ? 1 : 0 };
    case 'select': {
      const idx = column.options.findIndex((o) => o.id === raw);
      return { empty: false, num: idx < 0 ? column.options.length : idx };
    }
    case 'multi_select': {
      const ids = decodeMultiSelect(raw);
      const first = ids[0] ? column.options.findIndex((o) => o.id === ids[0]) : -1;
      return ids.length === 0 ? { empty: true } : { empty: false, num: first < 0 ? column.options.length : first };
    }
    default:
      return { empty: false, str: raw.toLowerCase() };
  }
}

export function sortDatabaseRows(rows: DatabaseRow[], columns: DatabaseColumn[], sorts: SortRule[]): DatabaseRow[] {
  if (sorts.length === 0) return rows;
  const byId = new Map(columns.map((c) => [c.id, c]));
  const active = sorts.filter((s) => byId.has(s.columnId));
  if (active.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const s of active) {
      const col = byId.get(s.columnId)!;
      const ka = sortKey(col, a);
      const kb = sortKey(col, b);
      // Empty values always sort last, regardless of direction.
      if (ka.empty && kb.empty) continue;
      if (ka.empty) return 1;
      if (kb.empty) return -1;
      let cmp = 0;
      if (ka.num != null && kb.num != null) cmp = ka.num - kb.num;
      else cmp = (ka.str ?? '').localeCompare(kb.str ?? '', 'es');
      if (cmp !== 0) return s.dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}
