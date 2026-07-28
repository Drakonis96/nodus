import type {
  CustomHistoricalEventType,
  EventTypeValue,
  EventTypeVocabularyScope,
} from './types';

export const EMPTY_CUSTOM_EVENT_TYPES: Record<EventTypeVocabularyScope, CustomHistoricalEventType[]> = {
  records: [],
  worldbuilding: [],
};

export function createCustomEventType(label: string): CustomHistoricalEventType {
  return `custom:${encodeURIComponent(label.trim().replace(/\s+/g, ' '))}`;
}

export function isCustomEventType(value: string): value is CustomHistoricalEventType {
  if (!value.startsWith('custom:') || value.length <= 7) return false;
  try {
    return decodeURIComponent(value.slice(7)).trim().length > 0;
  } catch {
    return false;
  }
}

export function customEventTypeLabel(value: CustomHistoricalEventType): string {
  try {
    return decodeURIComponent(value.slice(7));
  } catch {
    return value.slice(7);
  }
}

export function eventTypeLabel(value: EventTypeValue, builtInLabels: Record<string, string>): string {
  return isCustomEventType(value) ? customEventTypeLabel(value) : builtInLabels[value] ?? value;
}

export function sanitizeCustomEventTypes(value: unknown): Record<EventTypeVocabularyScope, CustomHistoricalEventType[]> {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<Record<EventTypeVocabularyScope, unknown>>
    : {};
  const sanitize = (entries: unknown): CustomHistoricalEventType[] => {
    if (!Array.isArray(entries)) return [];
    return [...new Set(entries.filter((entry): entry is CustomHistoricalEventType =>
      typeof entry === 'string' && isCustomEventType(entry)
    ))].slice(0, 100);
  };
  return {
    records: sanitize(input.records),
    worldbuilding: sanitize(input.worldbuilding),
  };
}
