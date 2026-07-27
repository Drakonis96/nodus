// The world's calendar (schema v93): eras, months, and the derived absolute day every
// dated event sorts by.
//
// The one rule this file exists to enforce: `event_world_dates.world_day` is DERIVED from
// the calendar, so ANY edit to the calendar invalidates every stored value. Lengthening a
// month by one day shifts every date after it. Nothing in SQLite will notice — the
// timeline would simply come back in a subtly wrong order, which is the worst kind of
// wrong because it still looks like an order. Every mutation here therefore ends in
// recomputeWorldDays().

import { v4 as uuid } from 'uuid';
import { getDb } from './database';
import {
  EMPTY_CALENDAR,
  worldDayOf,
  type WorldCalendar,
  type WorldDate,
  type WorldEra,
  type WorldMonth,
} from '@shared/worldCalendar';

function now(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${uuid()}`;
}

interface EraRow {
  era_id: string;
  name: string;
  abbreviation: string | null;
  start_year: number;
  counts_backwards: number;
  sort_order: number;
}

interface MonthRow {
  month_id: string;
  name: string;
  days: number;
  sort_order: number;
}

export function getWorldCalendar(): WorldCalendar {
  const db = getDb();
  const head = db.prepare('SELECT name, notes FROM world_calendar WHERE id = 1').get() as
    | { name: string | null; notes: string | null }
    | undefined;
  const eras = (
    db.prepare('SELECT * FROM world_calendar_eras ORDER BY sort_order, start_year').all() as EraRow[]
  ).map<WorldEra>((row) => ({
    eraId: row.era_id,
    name: row.name,
    abbreviation: row.abbreviation,
    startYear: row.start_year,
    countsBackwards: !!row.counts_backwards,
    sortOrder: row.sort_order,
  }));
  const months = (
    db.prepare('SELECT * FROM world_calendar_months ORDER BY sort_order').all() as MonthRow[]
  ).map<WorldMonth>((row) => ({
    monthId: row.month_id,
    name: row.name,
    days: row.days,
    sortOrder: row.sort_order,
  }));
  if (!head && eras.length === 0 && months.length === 0) return EMPTY_CALENDAR;
  return { name: head?.name ?? null, notes: head?.notes ?? null, eras, months };
}

export interface WorldCalendarInput {
  name?: string | null;
  notes?: string | null;
  eras?: { eraId?: string; name: string; abbreviation?: string | null; startYear: number; countsBackwards?: boolean }[];
  months?: { monthId?: string; name: string; days: number }[];
}

/**
 * Replace the whole calendar in one transaction.
 *
 * Wholesale rather than per-row because the author edits it as one object in a single
 * dialog, and because a half-applied calendar (new months, old eras) would produce
 * absolute days that belong to neither. The recompute at the end is not optional.
 */
export function saveWorldCalendar(input: WorldCalendarInput): WorldCalendar {
  const db = getDb();
  const ts = now();
  const save = db.transaction(() => {
    db.prepare(
      `INSERT INTO world_calendar (id, name, notes, created_at, updated_at) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, notes = excluded.notes, updated_at = excluded.updated_at`
    ).run(input.name?.trim() || null, input.notes?.trim() || null, ts, ts);

    if (input.eras) {
      db.prepare('DELETE FROM world_calendar_eras').run();
      input.eras.forEach((era, index) => {
        db.prepare(
          `INSERT INTO world_calendar_eras
            (era_id, name, abbreviation, start_year, counts_backwards, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          era.eraId ?? newId('era'),
          era.name.trim(),
          era.abbreviation?.trim() || null,
          Math.trunc(era.startYear) || 0,
          era.countsBackwards ? 1 : 0,
          index,
          ts,
          ts
        );
      });
    }

    if (input.months) {
      db.prepare('DELETE FROM world_calendar_months').run();
      input.months.forEach((month, index) => {
        db.prepare(
          `INSERT INTO world_calendar_months (month_id, name, days, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(month.monthId ?? newId('mon'), month.name.trim(), Math.max(1, Math.trunc(month.days) || 1), index, ts, ts);
      });
    }
  });
  save();
  // Month lengths and era offsets both move every date that follows them.
  recomputeWorldDays();
  return getWorldCalendar();
}

/**
 * Recompute `world_day` for every dated event against the current calendar.
 *
 * Called after any calendar change and after any structured date is written. Cheap: a
 * world has thousands of events at most, and the alternative — deriving the day on every
 * read — cannot be used in an ORDER BY.
 */
export function recomputeWorldDays(): number {
  const db = getDb();
  const calendar = getWorldCalendar();
  const rows = db
    .prepare('SELECT event_id, era_id, world_year, month_index, day FROM event_world_dates')
    .all() as {
    event_id: string;
    era_id: string | null;
    world_year: number | null;
    month_index: number | null;
    day: number | null;
  }[];
  const update = db.prepare('UPDATE event_world_dates SET world_day = ? WHERE event_id = ?');
  const run = db.transaction(() => {
    for (const row of rows) {
      const worldDay = worldDayOf(calendar, {
        eraId: row.era_id,
        year: row.world_year,
        monthIndex: row.month_index,
        day: row.day,
      });
      update.run(worldDay, row.event_id);
    }
  });
  run();
  return rows.length;
}

/** The structured date of an event, if it has one. */
export function getEventWorldDateFull(eventId: string): (WorldDate & { worldDay: number | null }) | null {
  const row = getDb()
    .prepare('SELECT era_id, world_year, month_index, day, world_day FROM event_world_dates WHERE event_id = ?')
    .get(eventId) as
    | { era_id: string | null; world_year: number | null; month_index: number | null; day: number | null; world_day: number | null }
    | undefined;
  if (!row) return null;
  return {
    eraId: row.era_id,
    year: row.world_year,
    monthIndex: row.month_index,
    day: row.day,
    worldDay: row.world_day,
  };
}

/**
 * Write an event's structured date and its derived absolute day together.
 *
 * `worldOrder` survives as the tie-break for events that share a day (or that have only a
 * year): the calendar answers "when", not "in what order within that moment".
 */
export function setEventWorldDateFull(eventId: string, date: WorldDate, worldOrder = 0): void {
  const db = getDb();
  const calendar = getWorldCalendar();
  const year = date.year == null || !Number.isFinite(date.year) ? null : Math.trunc(date.year);
  if (year == null && date.monthIndex == null && date.day == null && worldOrder === 0) {
    db.prepare('DELETE FROM event_world_dates WHERE event_id = ?').run(eventId);
    return;
  }
  const worldDay = worldDayOf(calendar, { ...date, year });
  db.prepare(
    `INSERT INTO event_world_dates (event_id, world_year, world_order, era_id, month_index, day, world_day)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id) DO UPDATE SET
       world_year = excluded.world_year, world_order = excluded.world_order,
       era_id = excluded.era_id, month_index = excluded.month_index,
       day = excluded.day, world_day = excluded.world_day`
  ).run(
    eventId,
    year,
    Math.trunc(worldOrder) || 0,
    date.eraId ?? null,
    date.monthIndex == null ? null : Math.trunc(date.monthIndex),
    date.day == null ? null : Math.trunc(date.day),
    worldDay
  );
}
