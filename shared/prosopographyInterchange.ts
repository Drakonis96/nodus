import type {
  ProsopFactoid,
  ProsopProjection,
  ProsopSource,
  ProsopSourceSegment,
  ProsopStatement,
  ProsopStatementEntity,
} from './prosopography';

export interface ProsopIpifDocument {
  '@context': string[];
  type: 'ProsopographyDataset';
  version: 'draft-1';
  generatedAt: string;
  persons: Array<{ id: string; type: 'Person'; labels: string[] }>;
  sources: Array<{ id: string; type: 'Source'; label: string; citation: string; locator?: string }>;
  factoids: Array<{ id: string; type: 'Factoid'; source: string; segment: string; summary: string; status: string }>;
  statements: Array<{
    id: string;
    type: 'Statement';
    factoid: string;
    subjects: string[];
    predicate: string;
    value: unknown;
    literal: string;
    certainty: { reading: string; sourceAssertion: string; interpretation: string };
  }>;
}

export function toProsopIpif(input: {
  generatedAt?: string;
  people: Array<{ personId: string; names: string[] }>;
  sources: ProsopSource[];
  segments: ProsopSourceSegment[];
  factoids: ProsopFactoid[];
  statements: ProsopStatement[];
  entities: ProsopStatementEntity[];
}): ProsopIpifDocument {
  const subjects = new Map<string, string[]>();
  for (const entity of input.entities) {
    if (entity.entityKind !== 'person' || !['subject', 'principal', 'self'].includes(entity.role)) continue;
    const list = subjects.get(entity.statementId) ?? [];
    list.push(entity.entityId);
    subjects.set(entity.statementId, list);
  }
  return {
    '@context': ['https://linkedpasts.org/assets/linked-places-context-v1.1.jsonld', 'https://nodus.app/contexts/prosopography-draft-1.jsonld'],
    type: 'ProsopographyDataset',
    version: 'draft-1',
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    persons: input.people.map((item) => ({ id: item.personId, type: 'Person', labels: item.names })),
    sources: input.sources.map((item) => ({
      id: item.sourceId,
      type: 'Source',
      label: item.title,
      citation: item.citation,
    })),
    factoids: input.factoids.map((item) => ({
      id: item.factoidId,
      type: 'Factoid',
      source: item.sourceId,
      segment: item.sourceSegmentId,
      summary: item.summary,
      status: item.status,
    })),
    statements: input.statements.map((item) => ({
      id: item.statementId,
      type: 'Statement',
      factoid: item.factoidId,
      subjects: subjects.get(item.statementId) ?? [],
      predicate: item.variableId ?? item.statementType,
      value: item.value,
      literal: item.literalValue,
      certainty: {
        reading: item.readingCertainty,
        sourceAssertion: item.sourceAssertionCertainty,
        interpretation: item.interpretationCertainty,
      },
    })),
  };
}

export function projectionToLongRows(projection: ProsopProjection): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const item of projection.rows) {
    for (const [variableId, cell] of Object.entries(item.cells)) {
      if (!cell.values.length) {
        rows.push({
          person_id: item.personId,
          variable_id: variableId,
          value_kind: null,
          value: null,
          missing_reason: cell.missingReason,
          statement_ids: cell.statementIds.join('|'),
          source_ids: cell.sourceIds.join('|'),
          projection_fingerprint: projection.fingerprint,
        });
        continue;
      }
      for (const value of cell.values) {
        rows.push({
          person_id: item.personId,
          variable_id: variableId,
          value_kind: value.kind,
          value: JSON.stringify(value),
          missing_reason: null,
          statement_ids: cell.statementIds.join('|'),
          source_ids: cell.sourceIds.join('|'),
          projection_fingerprint: projection.fingerprint,
        });
      }
    }
  }
  return rows;
}
