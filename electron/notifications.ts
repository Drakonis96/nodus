import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { NodiNotification } from '@shared/types';
import { nodiText, nodiTextSignature, type NodiNotificationText } from '@shared/nodiNotifications';

// Lightweight, app-wide notification centre for the Nodi companion. Stored as a
// single JSON file in userData (no schema migration) and capped so it can't grow
// unbounded. Any part of the app can push a notification via addNotification();
// the renderer is told to refresh through the notifier callback below.
//
// Notifications are stored as translation keys, never as prose. This file is global
// while the UI language is a per-vault setting, so prose written here would be stuck
// in the language of whatever vault raised it — see shared/nodiNotifications.

const MAX = 50;
const DEFAULT_COOLDOWN_MS = 30_000;
const lastEmitted = new Map<string, number>();

function file(): string {
  return path.join(app.getPath('userData'), 'nodi-notifications.json');
}

function read(): NodiNotification[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return Array.isArray(parsed) ? (parsed as NodiNotification[]) : [];
  } catch {
    return [];
  }
}

function write(list: NodiNotification[]): void {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(list.slice(0, MAX), null, 2));
}

let notify: (() => void) | null = null;
/** Register a callback invoked whenever the notification list changes (used to
 *  push a refresh event to the renderer). */
export function setNotificationsNotifier(cb: (() => void) | null): void {
  notify = cb;
}

export function listNotifications(): NodiNotification[] {
  return read().sort((a, b) => b.createdAt - a.createdAt);
}

export function unreadNotificationCount(): number {
  return read().reduce((n, x) => n + (x.read ? 0 : 1), 0);
}

/** Identify a line for deduplication whether it is a key or raw provider prose. */
function signature(line: NodiNotificationText | string | undefined): string {
  if (!line) return '';
  return typeof line === 'string' ? line : nodiTextSignature(line);
}

export function addNotification(input: {
  /** A catalogue entry. Plain strings are accepted only for prose with no key —
   *  in practice a provider error, which cannot be translated in advance. */
  title: NodiNotificationText | string;
  body?: NodiNotificationText | string;
  kind?: NodiNotification['kind'];
  dedupeKey?: string;
  cooldownMs?: number;
}): NodiNotification | null {
  const dedupeKey = input.dedupeKey ?? `${signature(input.title)}\0${signature(input.body)}`;
  const cooldownMs = Math.max(0, input.cooldownMs ?? DEFAULT_COOLDOWN_MS);
  const timestamp = Date.now();
  if (timestamp - (lastEmitted.get(dedupeKey) ?? 0) < cooldownMs) return null;
  lastEmitted.set(dedupeKey, timestamp);
  const item: NodiNotification = {
    id: `ntf-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    ...(typeof input.title === 'string' ? { title: input.title } : { titleText: input.title }),
    ...(input.body === undefined
      ? {}
      : typeof input.body === 'string'
        ? { body: input.body }
        : { bodyText: input.body }),
    kind: input.kind ?? 'info',
    createdAt: timestamp,
    read: false,
  };
  write([item, ...read()]);
  notify?.();
  return item;
}

export function markNotificationRead(id: string): void {
  write(read().map((x) => (x.id === id ? { ...x, read: true } : x)));
  notify?.();
}

export function markAllNotificationsRead(): void {
  write(read().map((x) => ({ ...x, read: true })));
  notify?.();
}

export function clearNotifications(): void {
  write([]);
  lastEmitted.clear();
  notify?.();
}

/** Seed a one-time welcome notification so the centre isn't empty on first run.
 *  Idempotent: keyed on a marker file next to the store. */
export function seedWelcomeNotification(): void {
  const marker = path.join(app.getPath('userData'), 'nodi-welcome.seed');
  try {
    if (fs.existsSync(marker)) return;
    fs.writeFileSync(marker, '1');
  } catch {
    return;
  }
  addNotification({
    title: nodiText('welcomeTitle'),
    body: nodiText('welcomeBody'),
    kind: 'success',
  });
}
