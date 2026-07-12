/**
 * Surface contradictory facts about a person — the same life event dated
 * differently across sources (birth "1850" in a census vs "1848" in a marriage
 * record). A genealogist reconciles these by weighing the sources; Nodus just flags
 * them. Pure, so it runs client-side over a ficha's already-loaded events.
 */

import { parseHistoricalDate } from './genealogyDates';

export interface ConflictEventInput {
  type: string;
  date: string | null;
}

export interface ConflictInput {
  birthDate: string | null;
  deathDate: string | null;
  events: ConflictEventInput[];
}

export interface ConflictValue {
  /** Where the year came from, e.g. "ficha", "nacimiento", "bautismo". */
  label: string;
  year: number;
  date: string;
}

export interface FactConflict {
  fact: 'birth' | 'death';
  values: ConflictValue[];
  /** The span in years between the earliest and latest assertion. */
  spanYears: number;
}

// Baptism can legitimately trail birth (and burial death) by up to a year or so;
// only a wider gap is treated as a genuine contradiction.
const WINDOW_YEARS = 2;

const EVENT_LABEL: Record<string, string> = {
  birth: 'nacimiento',
  baptism: 'bautismo',
  death: 'defunción',
  burial: 'entierro',
};

function collect(input: ConflictInput, own: string | null, ownLabel: string, eventTypes: string[]): ConflictValue[] {
  const values: ConflictValue[] = [];
  const push = (label: string, date: string | null) => {
    const parsed = parseHistoricalDate(date);
    if (parsed.year != null && date) values.push({ label, year: parsed.year, date });
  };
  push(ownLabel, own);
  for (const e of input.events) {
    if (eventTypes.includes(e.type)) push(EVENT_LABEL[e.type] ?? e.type, e.date);
  }
  return values;
}

function conflictFrom(fact: 'birth' | 'death', values: ConflictValue[]): FactConflict | null {
  if (values.length < 2) return null;
  const years = values.map((v) => v.year);
  const span = Math.max(...years) - Math.min(...years);
  if (span <= WINDOW_YEARS) return null;
  return { fact, values, spanYears: span };
}

/** Detect conflicting birth/death year assertions for a person. */
export function detectPersonConflicts(input: ConflictInput): FactConflict[] {
  const conflicts: FactConflict[] = [];
  const birth = conflictFrom('birth', collect(input, input.birthDate, 'ficha', ['birth', 'baptism']));
  if (birth) conflicts.push(birth);
  const death = conflictFrom('death', collect(input, input.deathDate, 'ficha', ['death', 'burial']));
  if (death) conflicts.push(death);
  return conflicts;
}
