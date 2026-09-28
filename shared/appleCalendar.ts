export interface AppleCalendarDestination {
  id: string;
  title: string;
  source: string;
}

export interface AppleCalendarSyncStatus {
  available: boolean;
  enabled: boolean;
  calendarId: string | null;
  calendarName: string | null;
  phase: 'off' | 'idle' | 'syncing' | 'error';
  pending: number;
  lastSyncedAt: string | null;
  error: string | null;
}

/** Only the public event fields travel to Apple; study notes/associations stay local. */
export interface AppleCalendarEventPayload {
  title: string;
  description: string;
  url: string;
  start: number;
  end: number;
  allDay: boolean;
  timeZone: string;
  reminder: number | null;
}

export interface AppleCalendarEventLink {
  nativeId: string;
  fingerprint: string;
  start: number;
  end: number;
}

export interface AppleCalendarMutation {
  action: 'upsert' | 'remove';
  calendarId: string;
  marker: string;
  nativeId?: string;
  previousStart?: number;
  previousEnd?: number;
  event?: AppleCalendarEventPayload;
}
