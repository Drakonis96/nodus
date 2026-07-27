/**
 * The world's own calendar: turning an invented date into a number that sorts, and back
 * into a string a reader recognises.
 *
 * Why this exists at all: `parseHistoricalDate` understands Gregorian years 1–3000 and
 * Earth month names, so "13 de Lluvia, 1204 T.E." yields a null sort key and a timeline
 * that looks chronological while being in insertion order. The integer year in
 * `event_world_dates` fixed the ordering BETWEEN years; this fixes it WITHIN one, and
 * gives the author a date picker instead of a text box.
 *
 * Design constraints, all of them deliberate:
 *
 *   - The calendar is OPTIONAL. A writer must be able to create their first character
 *     without inventing twelve month names first. With no months defined everything
 *     degrades to the integer year, which is what already worked.
 *   - NO leap years. Leap rules are an accident of Earth's orbit; modelling them would
 *     make every absolute-day computation conditional for something almost no invented
 *     calendar wants. A year is the sum of its months, always.
 *   - `worldDay` is DERIVED and stored, because SQLite has to ORDER BY it. Every calendar
 *     edit therefore has to recompute it — the one maintenance cost this design carries.
 *
 * Pure and dependency-free so all of it is unit-tested without a database.
 */

export interface WorldEra {
  eraId: string;
  name: string;
  abbreviation: string | null;
  /** The absolute year this era's year 1 corresponds to. */
  startYear: number;
  /** True for eras that count down towards their end, the way BC does. */
  countsBackwards: boolean;
  sortOrder: number;
}

export interface WorldMonth {
  monthId: string;
  name: string;
  days: number;
  sortOrder: number;
}

export interface WorldCalendar {
  name: string | null;
  notes: string | null;
  eras: WorldEra[];
  months: WorldMonth[];
}

/** A date as the author entered it: era + year, optionally narrowed to month and day. */
export interface WorldDate {
  eraId: string | null;
  year: number | null;
  /** 0-based index into `months`; null when the author only gave a year. */
  monthIndex: number | null;
  /** 1-based day within the month; null when only the month is known. */
  day: number | null;
}

export const EMPTY_CALENDAR: WorldCalendar = { name: null, notes: null, eras: [], months: [] };

/** True when the calendar can actually date something (it has at least one month). */
export function hasCalendar(calendar: WorldCalendar): boolean {
  return calendar.months.length > 0;
}

export function daysPerYear(calendar: WorldCalendar): number {
  return calendar.months.reduce((total, month) => total + Math.max(1, month.days), 0);
}

/** The absolute year an era-relative year falls on. */
export function absoluteYear(calendar: WorldCalendar, eraId: string | null, year: number): number {
  const era = calendar.eras.find((entry) => entry.eraId === eraId);
  if (!era) return year;
  // Year 1 of an era IS its start year, so the offset is year - 1 in both directions.
  return era.countsBackwards ? era.startYear - (year - 1) : era.startYear + (year - 1);
}

/** The inverse: which era a given absolute year belongs to, and its year within it. */
export function toEraYear(calendar: WorldCalendar, absolute: number): { era: WorldEra | null; year: number } {
  // Forward eras are chosen by the latest one that has already begun; a backwards era is
  // matched only when the absolute year is at or before its start.
  const forward = [...calendar.eras]
    .filter((era) => !era.countsBackwards && era.startYear <= absolute)
    .sort((a, b) => b.startYear - a.startYear)[0];
  if (forward) return { era: forward, year: absolute - forward.startYear + 1 };
  const backward = [...calendar.eras]
    .filter((era) => era.countsBackwards && era.startYear >= absolute)
    .sort((a, b) => a.startYear - b.startYear)[0];
  if (backward) return { era: backward, year: backward.startYear - absolute + 1 };
  return { era: null, year: absolute };
}

/** Days elapsed before the given 0-based month starts. */
function daysBeforeMonth(calendar: WorldCalendar, monthIndex: number): number {
  let total = 0;
  for (let i = 0; i < monthIndex && i < calendar.months.length; i += 1) {
    total += Math.max(1, calendar.months[i].days);
  }
  return total;
}

/**
 * The absolute day a date falls on, or null when it cannot be placed.
 *
 * A date with only a year lands on day 0 of that year, so it sorts BEFORE everything
 * dated inside it — which is what a reader expects from "1229" sitting next to
 * "13 de Lluvia, 1229".
 */
export function worldDayOf(calendar: WorldCalendar, date: WorldDate): number | null {
  if (date.year == null || !Number.isFinite(date.year)) return null;
  const perYear = daysPerYear(calendar);
  if (perYear <= 0) return null;
  const year = absoluteYear(calendar, date.eraId, Math.trunc(date.year));
  if (date.monthIndex == null) return year * perYear;
  const monthIndex = Math.min(Math.max(0, Math.trunc(date.monthIndex)), calendar.months.length - 1);
  const monthDays = Math.max(1, calendar.months[monthIndex]?.days ?? 1);
  const day = date.day == null ? 1 : Math.min(Math.max(1, Math.trunc(date.day)), monthDays);
  return year * perYear + daysBeforeMonth(calendar, monthIndex) + day;
}

/** Turn an absolute day back into a date. The inverse of {@link worldDayOf}. */
export function fromWorldDay(calendar: WorldCalendar, worldDay: number): WorldDate | null {
  const perYear = daysPerYear(calendar);
  if (perYear <= 0) return null;
  // Floor division so negative absolute days (eras before the epoch) land in the right year.
  const year = Math.floor(worldDay / perYear);
  const dayOfYear = worldDay - year * perYear;
  const { era, year: eraYear } = toEraYear(calendar, year);
  if (dayOfYear === 0) return { eraId: era?.eraId ?? null, year: eraYear, monthIndex: null, day: null };
  let remaining = dayOfYear;
  for (let index = 0; index < calendar.months.length; index += 1) {
    const days = Math.max(1, calendar.months[index].days);
    if (remaining <= days) return { eraId: era?.eraId ?? null, year: eraYear, monthIndex: index, day: remaining };
    remaining -= days;
  }
  return { eraId: era?.eraId ?? null, year: eraYear, monthIndex: calendar.months.length - 1, day: remaining };
}

/**
 * The readable form of a structured date, in the author's own calendar. Used to fill the
 * display string when the author enters a date through the picker instead of typing it.
 */
export function formatWorldDate(calendar: WorldCalendar, date: WorldDate): string {
  if (date.year == null) return '';
  const era = calendar.eras.find((entry) => entry.eraId === date.eraId);
  const suffix = era ? ` ${era.abbreviation?.trim() || era.name}` : '';
  const month = date.monthIndex != null ? calendar.months[date.monthIndex] : null;
  if (month && date.day != null) return `${date.day} de ${month.name}, ${date.year}${suffix}`;
  if (month) return `${month.name} de ${date.year}${suffix}`;
  return `${date.year}${suffix}`;
}

/**
 * Whole years between two absolute days. This is the age a writer means — "tenía 25
 * años" — not a precise duration, so it truncates rather than rounding.
 */
export function yearsBetween(calendar: WorldCalendar, fromDay: number, toDay: number): number | null {
  const perYear = daysPerYear(calendar);
  if (perYear <= 0) return null;
  return Math.floor((toDay - fromDay) / perYear);
}

/**
 * A character's age at a given moment, from whatever the sheet actually has.
 *
 * Falls back to plain year arithmetic when there is no calendar, because the integer year
 * is what most sheets carry and an age is worth showing even when it is approximate.
 * Returns null rather than a guess when the birth year is unknown or the moment is before
 * it — a negative age on screen reads as a bug, not as information.
 */
export function ageAt(
  calendar: WorldCalendar,
  birth: { year: number | null; worldDay: number | null },
  moment: { year: number | null; worldDay: number | null }
): number | null {
  if (birth.worldDay != null && moment.worldDay != null && hasCalendar(calendar)) {
    const years = yearsBetween(calendar, birth.worldDay, moment.worldDay);
    return years != null && years >= 0 ? years : null;
  }
  if (birth.year == null || moment.year == null) return null;
  const years = moment.year - birth.year;
  return years >= 0 ? years : null;
}

/**
 * Problems with a calendar the author is editing. Reported rather than enforced: a
 * half-built calendar has to be saveable, or it cannot be built at all.
 */
export function validateCalendar(calendar: WorldCalendar): string[] {
  const problems: string[] = [];
  if (calendar.months.some((month) => month.days < 1)) {
    problems.push('Algún mes tiene menos de un día.');
  }
  if (calendar.months.some((month) => !month.name.trim())) {
    problems.push('Algún mes no tiene nombre.');
  }
  if (calendar.eras.some((era) => !era.name.trim())) {
    problems.push('Alguna era no tiene nombre.');
  }
  const starts = calendar.eras.filter((era) => !era.countsBackwards).map((era) => era.startYear);
  if (new Set(starts).size !== starts.length) {
    problems.push('Dos eras empiezan el mismo año: las fechas de ese año serían ambiguas.');
  }
  return problems;
}
