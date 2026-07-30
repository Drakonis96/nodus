import { getDb } from './db/database';
import { addNotification } from './notifications';
import { nodiText } from '@shared/nodiNotifications';

type Row = Record<string, unknown>;

/** Deliver every due calendar reminder exactly once. Because delivery state is
 * stored in SQLite, reminders missed while Nodus or the computer was closed are
 * emitted on the first tick after the app opens. */
export function deliverDueStudyCalendarReminders(at = new Date()): number {
  const timestamp = at.toISOString();
  const rows = getDb().prepare(`
    SELECT id, title, description, starts_at, reminder_at
    FROM study_calendar_events
    WHERE deleted_at IS NULL AND reminder_at IS NOT NULL AND notified_at IS NULL AND reminder_at <= ?
    ORDER BY reminder_at
  `).all(timestamp) as Row[];
  const mark = getDb().prepare('UPDATE study_calendar_events SET notified_at=?,updated_at=? WHERE id=? AND notified_at IS NULL');
  let delivered = 0;
  for (const row of rows) {
    const reminderAt = new Date(String(row.reminder_at));
    const delayed = at.getTime() - reminderAt.getTime() > 60_000;
    // The event's own start time travels as a timestamp, not as a formatted date: the
    // renderer knows the reader's locale, this process only knows the vault's.
    const when = { datetime: new Date(String(row.starts_at)).toISOString() };
    const detail = row.description ? String(row.description) : '';
    const notification = addNotification({
      title: nodiText('studyCalendarTitle', { title: String(row.title) }),
      body: detail
        ? nodiText(delayed ? 'studyCalendarLateBodyWithDetail' : 'studyCalendarBodyWithDetail', { when, detail })
        : nodiText(delayed ? 'studyCalendarLateBody' : 'studyCalendarBody', { when }),
      kind: delayed ? 'warning' : 'info',
      dedupeKey: `study-calendar:${String(row.id)}:${String(row.reminder_at)}`,
      cooldownMs: 0,
    });
    if (notification && mark.run(timestamp, timestamp, String(row.id)).changes) delivered += 1;
  }
  return delivered;
}

let timer: NodeJS.Timeout | null = null;

export function startStudyCalendarReminders(): void {
  if (timer) return;
  deliverDueStudyCalendarReminders();
  timer = setInterval(() => deliverDueStudyCalendarReminders(), 30_000);
}

export function stopStudyCalendarReminders(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
