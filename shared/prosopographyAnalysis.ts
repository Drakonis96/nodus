import type { ProsopNetworkEdge, ProsopProjection, ProsopTypedValue } from './prosopography';

export interface ProsopFrequencyItem {
  key: string;
  label: string;
  count: number;
  proportion: number;
  personIds: string[];
}

export interface ProsopFrequencyResult {
  variableId: string;
  populationN: number;
  knownN: number;
  missingN: number;
  items: ProsopFrequencyItem[];
  missingReasons: Record<string, number>;
}

function valueKey(value: ProsopTypedValue): string {
  switch (value.kind) {
    case 'text': return value.text;
    case 'number': return `${value.number}${value.unit ? ` ${value.unit}` : ''}`;
    case 'boolean': return String(value.boolean);
    case 'date': return value.date.display ?? `${value.date.startSort ?? ''}`;
    case 'term': return value.termId;
    case 'person': return value.personId;
    case 'place': return value.placeId;
    case 'organization': return value.organizationId;
    case 'event': return value.eventId;
  }
}

export function prosopFrequencies(projection: ProsopProjection, variableId: string): ProsopFrequencyResult {
  const groups = new Map<string, string[]>();
  const missingReasons: Record<string, number> = {};
  let knownN = 0;
  for (const row of projection.rows) {
    const cell = row.cells[variableId];
    if (!cell || cell.values.length === 0) {
      const reason = cell?.missingReason ?? 'not_researched';
      missingReasons[reason] = (missingReasons[reason] ?? 0) + 1;
      continue;
    }
    knownN += 1;
    for (const value of cell.values) {
      const key = valueKey(value);
      const list = groups.get(key) ?? [];
      if (!list.includes(row.personId)) list.push(row.personId);
      groups.set(key, list);
    }
  }
  return {
    variableId,
    populationN: projection.populationCount,
    knownN,
    missingN: projection.rows.length - knownN,
    items: [...groups.entries()]
      .map(([key, personIds]) => ({ key, label: key, count: personIds.length, proportion: knownN ? personIds.length / knownN : 0, personIds }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
    missingReasons,
  };
}

export interface ProsopCrosstabResult {
  rowVariableId: string;
  columnVariableId: string;
  populationN: number;
  completeN: number;
  rows: string[];
  columns: string[];
  cells: Array<{ row: string; column: string; count: number; personIds: string[] }>;
}

export function prosopCrosstab(projection: ProsopProjection, rowVariableId: string, columnVariableId: string): ProsopCrosstabResult {
  const cells = new Map<string, string[]>();
  const rows = new Set<string>();
  const columns = new Set<string>();
  let completeN = 0;
  for (const item of projection.rows) {
    const rowValues = item.cells[rowVariableId]?.values ?? [];
    const columnValues = item.cells[columnVariableId]?.values ?? [];
    if (!rowValues.length || !columnValues.length) continue;
    completeN += 1;
    for (const rowValue of rowValues) for (const columnValue of columnValues) {
      const row = valueKey(rowValue);
      const column = valueKey(columnValue);
      rows.add(row);
      columns.add(column);
      const key = `${row}\0${column}`;
      const people = cells.get(key) ?? [];
      if (!people.includes(item.personId)) people.push(item.personId);
      cells.set(key, people);
    }
  }
  return {
    rowVariableId,
    columnVariableId,
    populationN: projection.populationCount,
    completeN,
    rows: [...rows].sort(),
    columns: [...columns].sort(),
    cells: [...cells.entries()].map(([key, personIds]) => {
      const [row, column] = key.split('\0');
      return { row, column, count: personIds.length, personIds };
    }),
  };
}

export interface ProsopNetworkMetrics {
  nodeCount: number;
  edgeCount: number;
  density: number;
  components: string[][];
  degrees: Record<string, number>;
  byOrigin: Record<'explicit' | 'derived' | 'hypothesis', number>;
}

export function prosopNetworkMetrics(personIds: string[], edges: ProsopNetworkEdge[]): ProsopNetworkMetrics {
  const people = new Set(personIds);
  const active = edges.filter((edge) => edge.status === 'active' && people.has(edge.sourcePersonId) && people.has(edge.targetPersonId));
  const adjacency = new Map(personIds.map((id) => [id, new Set<string>()]));
  const byOrigin = { explicit: 0, derived: 0, hypothesis: 0 };
  for (const edge of active) {
    adjacency.get(edge.sourcePersonId)?.add(edge.targetPersonId);
    adjacency.get(edge.targetPersonId)?.add(edge.sourcePersonId);
    byOrigin[edge.origin] += 1;
  }
  const components: string[][] = [];
  const seen = new Set<string>();
  for (const personId of personIds) {
    if (seen.has(personId)) continue;
    const component: string[] = [];
    const queue = [personId];
    seen.add(personId);
    while (queue.length) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    components.push(component);
  }
  const possible = personIds.length > 1 ? (personIds.length * (personIds.length - 1)) / 2 : 0;
  return {
    nodeCount: personIds.length,
    edgeCount: active.length,
    density: possible ? active.length / possible : 0,
    components: components.sort((left, right) => right.length - left.length),
    degrees: Object.fromEntries([...adjacency].map(([id, neighbors]) => [id, neighbors.size])),
    byOrigin,
  };
}
