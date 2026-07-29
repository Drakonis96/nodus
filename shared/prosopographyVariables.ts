import type {
  MissingReason,
  ProsopTypedValue,
  ProsopValueKind,
  ProsopVariableRevision,
} from './prosopography';
import { missingReasons, validateTypedValue } from './prosopography';

export interface ProsopVariableDraft {
  label: string;
  key: string;
  question: string;
  description?: string;
  valueType: ProsopValueKind;
  cardinality: 'one' | 'many';
  unit?: string | null;
  vocabularyId?: string | null;
  missingReasons?: MissingReason[];
  sensitivity?: 'ordinary' | 'sensitive' | 'restricted';
  instructions?: string;
}

export function normalizeVariableKey(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

export function validateVariableDraft(draft: ProsopVariableDraft): string[] {
  const errors: string[] = [];
  if (!draft.label.trim()) errors.push('La variable necesita una etiqueta.');
  const key = normalizeVariableKey(draft.key || draft.label);
  if (!key) errors.push('La variable necesita una clave estable.');
  if (!draft.question.trim()) errors.push('La variable necesita una pregunta común.');
  if (draft.valueType === 'term' && !draft.vocabularyId) errors.push('Una variable codificada necesita un vocabulario.');
  if (draft.valueType !== 'number' && draft.unit?.trim()) errors.push('Solo las variables numéricas pueden declarar una unidad.');
  const reasons = draft.missingReasons ?? [...missingReasons];
  if (reasons.some((reason) => !missingReasons.includes(reason))) errors.push('La variable contiene una razón de ausencia desconocida.');
  return errors;
}

export function coerceProsopValue(kind: ProsopValueKind, raw: unknown, unit: string | null = null): ProsopTypedValue {
  switch (kind) {
    case 'text':
      return { kind, text: String(raw ?? '').trim() };
    case 'number': {
      const normalized = typeof raw === 'string' ? raw.trim().replace(',', '.') : raw;
      return { kind, number: Number(normalized), unit };
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { kind, boolean: raw };
      const normalized = String(raw ?? '').trim().toLowerCase();
      if (['true', '1', 'sí', 'si', 'yes'].includes(normalized)) return { kind, boolean: true };
      if (['false', '0', 'no'].includes(normalized)) return { kind, boolean: false };
      return { kind, boolean: Boolean(raw) };
    }
    case 'date': {
      if (raw && typeof raw === 'object' && 'startSort' in raw) return { kind, date: raw as ProsopTypedValue & never };
      const display = String(raw ?? '').trim();
      const year = display.match(/-?\d{3,4}/)?.[0];
      const sort = year ? Number(year) : null;
      return { kind, date: { display, startSort: sort, endSort: sort, precision: year ? 'year' : 'unknown' } };
    }
    case 'term':
      return { kind, termId: String(raw ?? ''), literal: null };
    case 'person':
      return { kind, personId: String(raw ?? ''), literal: null };
    case 'place':
      return { kind, placeId: String(raw ?? ''), literal: null };
    case 'organization':
      return { kind, organizationId: String(raw ?? ''), literal: null };
    case 'event':
      return { kind, eventId: String(raw ?? ''), literal: null };
  }
}

export function validateValueForRevision(value: ProsopTypedValue, revision: ProsopVariableRevision): string[] {
  const errors = validateTypedValue(value);
  if (value.kind !== revision.valueType) errors.push(`La variable espera ${revision.valueType}, no ${value.kind}.`);
  if (value.kind === 'term' && revision.vocabularyId == null) errors.push('La revisión no declara el vocabulario del término.');
  if (value.kind === 'number' && revision.unit && value.unit !== revision.unit) errors.push(`La unidad debe ser ${revision.unit}.`);
  return errors;
}

export function variableRevisionChanged(
  previous: Pick<ProsopVariableRevision, 'valueType' | 'cardinality' | 'unit' | 'vocabularyId' | 'sensitivity'>,
  next: Pick<ProsopVariableRevision, 'valueType' | 'cardinality' | 'unit' | 'vocabularyId' | 'sensitivity'>
): { breaking: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (previous.valueType !== next.valueType) reasons.push('Cambió el tipo de valor.');
  if (previous.cardinality !== next.cardinality) reasons.push('Cambió la cardinalidad.');
  if (previous.unit !== next.unit) reasons.push('Cambió la unidad.');
  if (previous.vocabularyId !== next.vocabularyId) reasons.push('Cambió el vocabulario.');
  if (previous.sensitivity !== next.sensitivity) reasons.push('Cambió la sensibilidad.');
  return { breaking: reasons.length > 0, reasons };
}
