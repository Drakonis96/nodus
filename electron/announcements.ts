import { app, net } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  ANNOUNCEMENTS_URL,
  isAnnouncementVisible,
  parseAnnouncements,
  sortAnnouncements,
  type Announcement,
  type AnnouncementEntry,
} from '@shared/announcements';
import { getSettings } from './db/settingsRepo';

/**
 * The published announcements, fetched about as rarely as anything can be and still be
 * called current.
 *
 * The cost of a channel like this is not the transfer, it is the habit: a poll every few
 * minutes, or a socket held open, would show up as battery on a laptop and as a steady
 * presence signal on the other end. Neither buys anything — a notice that arrives four
 * hours late is a notice that arrived. So this rides the update check's existing timer
 * (see UPDATE_CHECK_INTERVAL_MS in main.ts) rather than starting a second one, and asks
 * conditionally: the response's ETag comes back as `If-None-Match`, so the ordinary
 * answer is a 304 with no body at all.
 *
 * Main-process only, like the tutorial catalogue and for the same reason: fetching from
 * the renderer would mean widening the CSP for another remote host.
 *
 * State (last good payload, its ETag, and which notices this person has read) is a single
 * JSON in userData. It is deliberately NOT the Nodi notification store: that one is capped
 * at 50 and has a "Clear" button, and an announcement must survive both.
 */

const STATE_FILE = 'announcements.json';
const FETCH_TIMEOUT_MS = 6_000;

interface AnnouncementsState {
  /** Validator from the last 200, replayed as If-None-Match. */
  etag?: string;
  /** Last successful check, for diagnostics only — the schedule does not read it. */
  checkedAt?: number;
  /** The raw payload exactly as served, re-parsed on every read. */
  payload?: unknown;
  /** id → when it was read, in ms. Pruned to the ids still being published. */
  read?: Record<string, number>;
}

let notify: (() => void) | null = null;
let checking = false;

/** Register a callback invoked when the list or its read marks change. */
export function setAnnouncementsNotifier(cb: (() => void) | null): void {
  notify = cb;
}

function statePath(): string {
  return path.join(app.getPath('userData'), STATE_FILE);
}

function readState(): AnnouncementsState {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as AnnouncementsState) : {};
  } catch {
    return {};
  }
}

function writeState(state: AnnouncementsState): void {
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(state), 'utf8');
  } catch (error) {
    console.warn('[announcements] could not persist state:', error);
  }
}

/** Overridable so a verification run can serve a list without publishing one. */
function announcementsUrl(): string {
  return process.env.NODUS_ANNOUNCEMENTS_URL || ANNOUNCEMENTS_URL;
}

/**
 * Whether the user still wants this channel. A settings read can throw before a vault
 * is open; that is not consent, so the check is skipped and the next tick tries again.
 */
function announcementsAllowed(): boolean {
  if (process.env.NODUS_DISABLE_ANNOUNCEMENTS === '1') return false;
  try {
    return getSettings().announcementsEnabled !== false;
  } catch {
    return false;
  }
}

/** The notices this build should show today, newest first, with their read marks. */
export function listAnnouncements(): AnnouncementEntry[] {
  const state = readState();
  const { announcements } = parseAnnouncements(state.payload);
  const read = state.read ?? {};
  const visible = announcements.filter((announcement) => isAnnouncementVisible(announcement, {
    now: Date.now(),
    version: app.getVersion(),
  }));
  return sortAnnouncements(visible).map((announcement) => ({
    ...announcement,
    read: Boolean(read[announcement.id]),
  }));
}

export function unreadAnnouncementCount(): number {
  return listAnnouncements().reduce((total, entry) => total + (entry.read ? 0 : 1), 0);
}

/**
 * Mark one notice read. Per notice on purpose: the point of an announcement is that
 * somebody actually read it, so opening the panel must not clear the lot the way the
 * activity feed does.
 */
export function markAnnouncementRead(id: string): AnnouncementEntry[] {
  const state = readState();
  const read = { ...(state.read ?? {}) };
  if (!read[id]) {
    read[id] = Date.now();
    writeState({ ...state, read });
    notify?.();
  }
  return listAnnouncements();
}

/** Drop read marks for notices that are no longer published, so the map stays small. */
function pruneRead(read: Record<string, number>, announcements: readonly Announcement[]): Record<string, number> {
  const live = new Set(announcements.map((announcement) => announcement.id));
  const kept: Record<string, number> = {};
  for (const [id, at] of Object.entries(read)) if (live.has(id)) kept[id] = at;
  return kept;
}

/**
 * Ask for the list. Never throws and never reports failure to the user: an unreachable
 * file means the app shows the notices it already had, which is the same thing it shows
 * when there is nothing to announce.
 */
export async function refreshAnnouncements(reason: string): Promise<void> {
  if (checking || !announcementsAllowed()) return;
  checking = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const state = readState();
    // Electron's net stack, so the app's proxy configuration applies. No cache-buster:
    // the whole point is to let the CDN answer 304, and a unique URL per check would
    // force a full transfer every time.
    const response = await net.fetch(announcementsUrl(), {
      signal: controller.signal,
      headers: state.etag ? { 'If-None-Match': state.etag } : {},
    });
    if (response.status === 304) {
      writeState({ ...state, checkedAt: Date.now() });
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const { announcements, rejected } = parseAnnouncements(payload);
    if (rejected > 0) console.warn(`[announcements] ignored ${rejected} malformed entr${rejected === 1 ? 'y' : 'ies'}`);
    writeState({
      etag: response.headers.get('etag') ?? undefined,
      checkedAt: Date.now(),
      payload,
      read: pruneRead(state.read ?? {}, announcements),
    });
    console.log(`[announcements] ${announcements.length} notice(s) after check (${reason})`);
    notify?.();
  } catch (error) {
    console.log('[announcements] check skipped:', error instanceof Error ? error.message : error);
  } finally {
    clearTimeout(timer);
    checking = false;
  }
}
