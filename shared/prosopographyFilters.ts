import type { JsonValue, ProsopFilterGroup, ProsopFilterRule } from './prosopography';

export type ProsopFilterRecord = Record<string, unknown>;

function comparable(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'object') {
    if ('text' in value!) return String((value as { text: unknown }).text);
    if ('number' in value!) return Number((value as { number: unknown }).number);
    if ('boolean' in value!) return Boolean((value as { boolean: unknown }).boolean);
    for (const key of ['termId', 'personId', 'placeId', 'organizationId', 'eventId']) {
      if (key in value!) return String((value as Record<string, unknown>)[key]);
    }
  }
  return String(value);
}

function values(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

export function evaluateProsopFilterRule(record: ProsopFilterRecord, rule: ProsopFilterRule): boolean {
  const actualValues = values(record[rule.field]).map(comparable);
  const expected = rule.value as JsonValue | undefined;
  switch (rule.operator) {
    case 'is_missing':
      return actualValues.every((value) => value == null || value === '');
    case 'is_known':
      return actualValues.some((value) => value != null && value !== '');
    case 'eq':
      return actualValues.some((value) => value === expected);
    case 'neq':
      return actualValues.every((value) => value !== expected);
    case 'contains':
      return actualValues.some((value) => String(value ?? '').toLocaleLowerCase().includes(String(expected ?? '').toLocaleLowerCase()));
    case 'starts_with':
      return actualValues.some((value) => String(value ?? '').toLocaleLowerCase().startsWith(String(expected ?? '').toLocaleLowerCase()));
    case 'in': {
      const options = Array.isArray(expected) ? expected : [expected];
      return actualValues.some((value) => options.some((option) => Object.is(option, value)));
    }
    case 'gt':
      return actualValues.some((value) => Number(value) > Number(expected));
    case 'gte':
      return actualValues.some((value) => Number(value) >= Number(expected));
    case 'lt':
      return actualValues.some((value) => Number(value) < Number(expected));
    case 'lte':
      return actualValues.some((value) => Number(value) <= Number(expected));
    case 'between': {
      const [minimum, maximum] = Array.isArray(expected) ? expected : [];
      return actualValues.some((value) => Number(value) >= Number(minimum) && Number(value) <= Number(maximum));
    }
  }
}

export function evaluateProsopFilter(record: ProsopFilterRecord, group: ProsopFilterGroup): boolean {
  if (group.rules.length === 0) return true;
  const results = group.rules.map((item) =>
    'conjunction' in item ? evaluateProsopFilter(record, item) : evaluateProsopFilterRule(record, item)
  );
  return group.conjunction === 'and' ? results.every(Boolean) : results.some(Boolean);
}

export function validateProsopFilter(group: ProsopFilterGroup, allowedFields?: Set<string>): string[] {
  const errors: string[] = [];
  if (group.conjunction !== 'and' && group.conjunction !== 'or') errors.push('Conjunción de filtro no reconocida.');
  for (const item of group.rules) {
    if ('conjunction' in item) errors.push(...validateProsopFilter(item, allowedFields));
    else if (!item.field) errors.push('Una regla de filtro necesita un campo.');
    else if (allowedFields && !allowedFields.has(item.field)) errors.push(`Campo de filtro no permitido: ${item.field}.`);
  }
  return errors;
}
