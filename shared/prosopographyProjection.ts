import type {
  MissingReason,
  ProsopAnalysisPolicy,
  ProsopMissingValue,
  ProsopProjection,
  ProsopProjectionCell,
  ProsopProjectionDefinition,
  ProsopResolution,
  ProsopStatement,
  ProsopStatementEntity,
  ProsopTypedValue,
} from './prosopography';
import { prosopFingerprint } from './prosopography';

export interface ProsopProjectionInput {
  definition: ProsopProjectionDefinition;
  statements: ProsopStatement[];
  entities: ProsopStatementEntity[];
  resolutions: ProsopResolution[];
  missingValues: ProsopMissingValue[];
  factoidSourceIds: Record<string, string>;
  now?: string;
}

function deduplicate(values: ProsopTypedValue[]): ProsopTypedValue[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function applyPolicy(
  values: ProsopTypedValue[],
  resolution: ProsopResolution | undefined,
  policy: ProsopAnalysisPolicy
): { values: ProsopTypedValue[]; warning: string | null } {
  const unique = deduplicate(values);
  if (resolution?.status === 'reviewed' && policy.multivalue === 'preferred_resolution') {
    const resolved = resolution.resolvedValue;
    return { values: resolved == null ? [] : Array.isArray(resolved) ? resolved : [resolved], warning: null };
  }
  if (unique.length <= 1 || policy.multivalue === 'all' || policy.multivalue === 'explode') {
    return { values: unique, warning: null };
  }
  if (policy.multivalue === 'exclude') return { values: [], warning: 'Caso multivalor excluido por la política declarada.' };
  if (policy.multivalue === 'first_chronological') return { values: unique.slice(0, 1), warning: 'Se ha seleccionado el primer valor según el orden de captura.' };
  if (policy.multivalue === 'last_chronological') return { values: unique.slice(-1), warning: 'Se ha seleccionado el último valor según el orden de captura.' };
  return { values: unique, warning: resolution ? null : 'No existe una resolución revisada; se conservan todos los valores.' };
}

export function buildProsopProjection(input: ProsopProjectionInput): ProsopProjection {
  const { definition } = input;
  const requestedPeople = new Set(definition.personIds);
  const requestedVariables = new Set(definition.variableIds);
  const allowedSources = new Set(definition.sourceIds);
  const subjectByStatement = new Map<string, string[]>();
  for (const entity of input.entities) {
    if (entity.entityKind !== 'person' || !['subject', 'principal', 'self'].includes(entity.role)) continue;
    const list = subjectByStatement.get(entity.statementId) ?? [];
    list.push(entity.entityId);
    subjectByStatement.set(entity.statementId, list);
  }
  const statementsByCell = new Map<string, ProsopStatement[]>();
  for (const statement of input.statements) {
    if (statement.status !== 'reviewed' || !statement.variableId || !requestedVariables.has(statement.variableId)) continue;
    const sourceId = input.factoidSourceIds[statement.factoidId];
    if (allowedSources.size && !allowedSources.has(sourceId)) continue;
    if (definition.sourceCutoff && statement.updatedAt > definition.sourceCutoff) continue;
    for (const personId of subjectByStatement.get(statement.statementId) ?? []) {
      if (!requestedPeople.has(personId)) continue;
      const key = `${personId}\0${statement.variableId}`;
      const list = statementsByCell.get(key) ?? [];
      list.push(statement);
      statementsByCell.set(key, list);
    }
  }
  const resolutionByCell = new Map(
    input.resolutions
      .filter((item) => item.status === 'reviewed')
      .map((item) => [`${item.personId}\0${item.variableId}`, item])
  );
  const missingByCell = new Map<string, MissingReason>();
  for (const item of input.missingValues) {
    if (item.status === 'active' && item.questionnaireVersionId === definition.questionnaireVersionId) {
      missingByCell.set(`${item.personId}\0${item.variableId}`, item.reason);
    }
  }

  const warnings = new Set<string>();
  const rows = definition.personIds.map((personId) => {
    const cells: Record<string, ProsopProjectionCell> = {};
    for (const variableId of definition.variableIds) {
      const key = `${personId}\0${variableId}`;
      const statements = statementsByCell.get(key) ?? [];
      const policy = definition.variablePolicies[variableId] ?? { multivalue: 'preferred_resolution', missing: 'include_reason' };
      const selected = applyPolicy(statements.map((item) => item.value), resolutionByCell.get(key), policy);
      if (selected.warning) warnings.add(selected.warning);
      const missingReason = selected.values.length ? null : missingByCell.get(key) ?? 'not_researched';
      if (missingReason === 'unresolved_contradiction') warnings.add('La proyección contiene contradicciones no resueltas.');
      cells[variableId] = {
        values: selected.values,
        statementIds: statements.map((item) => item.statementId),
        sourceIds: [...new Set(statements.map((item) => input.factoidSourceIds[item.factoidId]).filter(Boolean))],
        missingReason,
        warning: selected.warning,
      };
    }
    return { rowId: personId, personId, period: null, cells };
  });
  const fingerprintInput = {
    engine: 'prosop-projection-1',
    definition,
    statements: input.statements.map((item) => [item.statementId, item.updatedAt, item.status]),
    resolutions: input.resolutions.map((item) => [item.resolutionId, item.updatedAt, item.status]),
    missing: input.missingValues.map((item) => [item.missingId, item.updatedAt, item.status]),
  };
  return {
    definition,
    fingerprint: prosopFingerprint(fingerprintInput),
    rows,
    populationCount: definition.personIds.length,
    includedCount: rows.length,
    generatedAt: input.now ?? new Date().toISOString(),
    warnings: [...warnings],
  };
}

export function projectionMatrix(projection: ProsopProjection): Array<Record<string, unknown>> {
  return projection.rows.map((row) => {
    const result: Record<string, unknown> = { personId: row.personId };
    for (const [variableId, cell] of Object.entries(row.cells)) {
      result[variableId] = cell.values.length === 0 ? null : cell.values.length === 1 ? cell.values[0] : cell.values;
      result[`${variableId}__missing`] = cell.missingReason;
      result[`${variableId}__statements`] = cell.statementIds;
    }
    return result;
  });
}
