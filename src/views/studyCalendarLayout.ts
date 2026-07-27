import type { StudyCalendarEvent } from '@shared/types';

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface CalendarEventDayRange {
  start: number;
  end: number;
}

export interface CalendarEventSegment {
  event: StudyCalendarEvent;
  startColumn: number;
  span: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export interface CalendarWeekLayout {
  segments: CalendarEventSegment[];
  overflowByDay: number[];
  laneCount: number;
}

/** A DST-safe serial number for a date in the user's local calendar. */
export function calendarDay(value: Date): number {
  return Math.floor(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / DAY_MS);
}

export function eventDayRange(event: Pick<StudyCalendarEvent, 'startsAt' | 'endsAt'>): CalendarEventDayRange {
  const startsAt = new Date(event.startsAt);
  const start = calendarDay(startsAt);
  const endsAt = event.endsAt ? new Date(event.endsAt) : startsAt;
  const parsedEnd = Number.isFinite(endsAt.getTime()) ? calendarDay(endsAt) : start;
  return { start, end: Math.max(start, parsedEnd) };
}

export function eventSpansMultipleDays(event: Pick<StudyCalendarEvent, 'startsAt' | 'endsAt'>): boolean {
  const range = eventDayRange(event);
  return range.end > range.start;
}

export function eventsByCoveredDay(events: StudyCalendarEvent[]): Map<number, StudyCalendarEvent[]> {
  const byDay = new Map<number, StudyCalendarEvent[]>();
  for (const event of events) {
    const range = eventDayRange(event);
    for (let day = range.start; day <= range.end; day += 1) {
      byDay.set(day, [...(byDay.get(day) ?? []), event]);
    }
  }
  return byDay;
}

/**
 * Clips events to a visible Monday-Sunday row and assigns non-overlapping lanes.
 * Longer events are placed first so multi-day bars stay visible when space is tight.
 */
export function layoutCalendarWeek(
  events: StudyCalendarEvent[],
  weekStartsAt: Date,
  options: { maxLanes?: number; multiDayOnly?: boolean } = {},
): CalendarWeekLayout {
  const weekStart = calendarDay(weekStartsAt);
  const weekEnd = weekStart + 6;
  const maxLanes = options.maxLanes ?? Number.POSITIVE_INFINITY;
  const candidates = events
    .map((event) => ({ event, range: eventDayRange(event) }))
    .filter(({ range }) => range.end >= weekStart && range.start <= weekEnd)
    .filter(({ range }) => !options.multiDayOnly || range.end > range.start)
    .map(({ event, range }) => {
      const clippedStart = Math.max(range.start, weekStart);
      const clippedEnd = Math.min(range.end, weekEnd);
      return {
        event,
        range,
        startColumn: clippedStart - weekStart,
        span: clippedEnd - clippedStart + 1,
      };
    })
    .sort((left, right) =>
      (right.range.end - right.range.start) - (left.range.end - left.range.start)
      || left.startColumn - right.startColumn
      || new Date(left.event.startsAt).getTime() - new Date(right.event.startsAt).getTime()
      || left.event.id.localeCompare(right.event.id),
    );

  const occupied: boolean[][] = [];
  const segments: CalendarEventSegment[] = [];
  const overflowByDay = Array.from({ length: 7 }, () => 0);

  for (const candidate of candidates) {
    let lane = 0;
    while (
      lane < maxLanes
      && occupied[lane]?.slice(candidate.startColumn, candidate.startColumn + candidate.span).some(Boolean)
    ) lane += 1;

    if (lane >= maxLanes) {
      for (let column = candidate.startColumn; column < candidate.startColumn + candidate.span; column += 1) {
        overflowByDay[column] += 1;
      }
      continue;
    }

    occupied[lane] ??= Array.from({ length: 7 }, () => false);
    for (let column = candidate.startColumn; column < candidate.startColumn + candidate.span; column += 1) {
      occupied[lane][column] = true;
    }
    segments.push({
      event: candidate.event,
      startColumn: candidate.startColumn,
      span: candidate.span,
      lane,
      continuesBefore: candidate.range.start < weekStart,
      continuesAfter: candidate.range.end > weekEnd,
    });
  }

  return {
    segments,
    overflowByDay,
    laneCount: occupied.length,
  };
}
