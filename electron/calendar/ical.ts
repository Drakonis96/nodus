import type { StudyCalendarEvent } from '@shared/studyPlanner';

const stamp = (value: string | number) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const text = (value: string) => value.replace(/\r\n?/g, '\n').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, '\\$&');
const dateOnly = (value: Date) => `${value.getFullYear()}${String(value.getMonth() + 1).padStart(2, '0')}${String(value.getDate()).padStart(2, '0')}`;

/** RFC 5545 content lines are at most 75 octets, without splitting UTF-8 characters. */
export function foldIcsLine(line: string): string {
  const lines: string[] = [];
  let current = '';
  let bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > 75) { lines.push(current); current = ' '; bytes = 1; }
    current += character;
    bytes += size;
  }
  lines.push(current);
  return lines.join('\r\n');
}

export type CalendarExportEvent = Pick<StudyCalendarEvent, 'id' | 'title' | 'startsAt' | 'endsAt' | 'description' | 'url' | 'allDay' | 'reminderAt'>;

/** Nodus displays the end day inclusively; calendar interchange uses an exclusive end. */
export function calendarEventDates(event: Pick<CalendarExportEvent, 'startsAt' | 'endsAt' | 'allDay'>): { start: Date; end: Date } {
  const start = new Date(event.startsAt);
  let end = new Date(event.endsAt ?? event.startsAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) throw new Error('Invalid calendar date.');
  if (event.allDay) {
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    if (end < start) end = new Date(start);
    end.setDate(end.getDate() + 1);
  } else if (end <= start) {
    end = new Date(start.getTime() + 60 * 60_000);
  }
  return { start, end };
}

export function renderCalendarIcs(events: CalendarExportEvent[], at = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nodus//Study Calendar//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Nodus', 'X-WR-CALDESC:Calendario de Nodus'];
  for (const event of events) {
    const { start, end } = calendarEventDates(event);
    lines.push('BEGIN:VEVENT', `UID:${text(event.id)}@nodus`, `DTSTAMP:${stamp(at.getTime())}`);
    lines.push(event.allDay ? `DTSTART;VALUE=DATE:${dateOnly(start)}` : `DTSTART:${stamp(start.getTime())}`);
    lines.push(event.allDay ? `DTEND;VALUE=DATE:${dateOnly(end)}` : `DTEND:${stamp(end.getTime())}`);
    lines.push(`SUMMARY:${text(event.title)}`, `DESCRIPTION:${text(event.description)}`);
    if (/^https?:\/\//i.test(event.url)) lines.push(`URL:${event.url.replace(/[\r\n]/g, '')}`);
    if (event.reminderAt && Number.isFinite(Date.parse(event.reminderAt))) lines.push('BEGIN:VALARM', `TRIGGER;VALUE=DATE-TIME:${stamp(event.reminderAt)}`, 'ACTION:DISPLAY', `DESCRIPTION:${text(event.title)}`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}
