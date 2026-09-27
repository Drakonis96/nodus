import { createHash } from 'node:crypto';
import type { AppleCalendarEventLink, AppleCalendarEventPayload, AppleCalendarMutation } from '@shared/appleCalendar';
import type { StudyCalendarEvent } from '@shared/studyPlanner';
import { calendarEventDates } from './ical';

export interface AppleCalendarBinding {
  enabled: boolean;
  calendarId: string;
  calendarName: string;
  links: Record<string, AppleCalendarEventLink>;
  /** Persist intent before calling EventKit, including creates whose acknowledgement may be lost. */
  pending?: Record<string, AppleCalendarOperation>;
  lastSyncedAt: string | null;
}

export interface AppleCalendarOperation {
  eventId: string;
  fingerprint: string;
  mutation: AppleCalendarMutation;
}

export function appleCalendarPayload(event: StudyCalendarEvent): AppleCalendarEventPayload {
  const dates = calendarEventDates(event);
  return {
    title: event.title, description: event.description, url: event.url,
    start: dates.start.getTime(), end: dates.end.getTime(), allDay: event.allDay,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    reminder: event.reminderAt ? Date.parse(event.reminderAt)
      : event.reminderMinutes == null ? null : dates.start.getTime() - event.reminderMinutes * 60_000,
  };
}

export function appleCalendarMarker(vaultId: string, eventId: string): string {
  // An exact, durable ownership marker allows recovery if a process dies after a save.
  return `[Nodus:${encodeURIComponent(vaultId)}:${encodeURIComponent(eventId)}]`;
}

export function planAppleCalendarChanges(vaultId: string, events: StudyCalendarEvent[], binding: AppleCalendarBinding): AppleCalendarOperation[] {
  const operations: AppleCalendarOperation[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    const payload = appleCalendarPayload(event);
    const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const link = binding.links[event.id];
    seen.add(event.id);
    if (link?.fingerprint === fingerprint) continue;
    operations.push({ eventId: event.id, fingerprint, mutation: {
      action: 'upsert', calendarId: binding.calendarId, marker: appleCalendarMarker(vaultId, event.id),
      nativeId: link?.nativeId, previousStart: link?.start, previousEnd: link?.end, event: payload,
    } });
  }
  for (const id of Object.keys(binding.links)) {
    if (seen.has(id)) continue;
    const link = binding.links[id];
    operations.push({ eventId: id, fingerprint: '', mutation: {
      action: 'remove', calendarId: binding.calendarId, marker: appleCalendarMarker(vaultId, id),
      nativeId: link.nativeId, previousStart: link.start, previousEnd: link.end,
    } });
  }
  return operations;
}

/** Replay durable intent before planning newer edits, even when an event was
 * deleted locally during a crash. EventKit recovers commits by ownership marker. */
export async function syncAppleCalendarBinding(vaultId: string, events: StudyCalendarEvent[], binding: AppleCalendarBinding, io: {
  persist: () => void;
  mutate: (mutation: AppleCalendarMutation) => Promise<{ nativeId?: string }>;
  progress?: (pending: number) => void;
  shouldContinue?: () => boolean;
}): Promise<void> {
  const apply = async (operation: AppleCalendarOperation) => {
    (binding.pending ??= {})[operation.eventId] = operation;
    io.persist(); // Never write to Apple unless the recovery intent is on disk.
    const result = await io.mutate(operation.mutation);
    acknowledgeAppleCalendarChange(binding, operation, result.nativeId);
    io.persist();
  };
  const recovery = Object.values(binding.pending ?? {});
  for (const operation of recovery) {
    if (io.shouldContinue && !io.shouldContinue()) return;
    await apply(operation);
  }
  const operations = planAppleCalendarChanges(vaultId, events, binding);
  io.progress?.(operations.length);
  for (const [index, operation] of operations.entries()) {
    if (io.shouldContinue && !io.shouldContinue()) return;
    await apply(operation);
    io.progress?.(operations.length - index - 1);
  }
  if (operations.length || recovery.length || !binding.lastSyncedAt) {
    binding.lastSyncedAt = new Date().toISOString();
    io.persist();
  }
}

export function acknowledgeAppleCalendarChange(binding: AppleCalendarBinding, operation: AppleCalendarOperation, nativeId?: string): void {
  if (operation.mutation.action === 'remove') delete binding.links[operation.eventId];
  else {
    if (!nativeId) throw new Error('Apple Calendar did not return an event identifier.');
    const event = operation.mutation.event!;
    binding.links[operation.eventId] = { nativeId, fingerprint: operation.fingerprint, start: event.start, end: event.end };
  }
  if (binding.pending) delete binding.pending[operation.eventId];
}
