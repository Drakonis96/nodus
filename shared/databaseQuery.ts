import type { DatabaseRow, DatabaseRowHit, DatabaseRowSort } from './databases';
import type { DatabaseFilterState, FilterCondition, FilterOp, SortRule } from './databaseFilters';

export const DATABASE_ROW_PAGE_DEFAULT = 200;
export const DATABASE_ROW_PAGE_MAX = 500;
export const DATABASE_ROW_CURSOR_VERSION = 1;

export interface FilterConditionNode {
  type: 'condition';
  columnId: string;
  op: FilterOp;
  value?: string | string[] | null;
}

export interface FilterGroupNode {
  type: 'group';
  operator: 'and' | 'or';
  children: FilterNode[];
}

/** Fully recursive query filter. Empty groups are neutral and ignored. */
export type FilterNode = FilterConditionNode | FilterGroupNode;

export interface GroupRule {
  columnId: string;
  dir?: 'asc' | 'desc';
}

export interface DatabaseRowQuery {
  databaseId: string;
  /** A view supplies filter/sorts when the corresponding explicit field is omitted. */
  viewId?: string | null;
  filter?: FilterNode | null;
  sorts?: SortRule[];
  groups?: GroupRule[];
  cursor?: string | null;
  limit?: number;
  /** Backward is used by the bounded UI page window after older pages are discarded. */
  direction?: 'forward' | 'backward';
  /** Compatibility ordering for legacy listDatabaseRows callers. */
  rowSort?: DatabaseRowSort;
}

export interface DatabaseRowPage {
  rows: DatabaseRow[];
  nextCursor: string | null;
  previousCursor: string | null;
  totalCount: number;
  revision: number;
  queryHash: string;
  hasMore: boolean;
}

export interface DatabaseRowSearchQuery {
  query: string;
  cursor?: string | null;
  limit?: number;
}

export interface DatabaseRowSearchPage {
  hits: DatabaseRowHit[];
  nextCursor: string | null;
  queryHash: string;
  revision: string;
  hasMore: boolean;
}

export interface DatabaseRowCursorPayload {
  v: typeof DATABASE_ROW_CURSOR_VERSION;
  queryHash: string;
  revision: number;
  values: Array<string | number>;
}

export function clampDatabaseRowPageLimit(value: number | undefined): number {
  if (value == null) return DATABASE_ROW_PAGE_DEFAULT;
  if (!Number.isFinite(value)) throw new Error('El límite de página debe ser un número finito.');
  return Math.min(DATABASE_ROW_PAGE_MAX, Math.max(1, Math.floor(value)));
}

function conditionNode(condition: FilterCondition): FilterConditionNode {
  return { type: 'condition', columnId: condition.columnId, op: condition.op, value: condition.value };
}

/** Lossless adapter from the current one-level view filter to the recursive public AST. */
export function databaseFilterStateToNode(filter: DatabaseFilterState): FilterNode | null {
  const children: FilterNode[] = filter.conditions.map(conditionNode);
  for (const group of filter.groups ?? []) {
    if (group.conditions.length === 0) continue;
    children.push({ type: 'group', operator: group.conjunction, children: group.conditions.map(conditionNode) });
  }
  if (children.length === 0) return null;
  return { type: 'group', operator: filter.conjunction, children };
}

export function assertFilterNode(value: unknown, depth = 0): asserts value is FilterNode {
  if (depth > 32) throw new Error('El filtro supera la profundidad máxima de 32 niveles.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Nodo de filtro no válido.');
  const node = value as Partial<FilterNode> & Record<string, unknown>;
  if (node.type === 'condition') {
    if (typeof node.columnId !== 'string' || !node.columnId) throw new Error('La condición no indica una propiedad válida.');
    if (typeof node.op !== 'string') throw new Error('La condición no indica un operador válido.');
    return;
  }
  if (node.type === 'group') {
    if (node.operator !== 'and' && node.operator !== 'or') throw new Error('El grupo no indica un operador válido.');
    if (!Array.isArray(node.children)) throw new Error('El grupo de filtros no contiene una lista válida.');
    if (node.children.length > 100) throw new Error('Un grupo no puede contener más de 100 filtros.');
    for (const child of node.children) assertFilterNode(child, depth + 1);
    return;
  }
  throw new Error('Tipo de nodo de filtro desconocido.');
}
