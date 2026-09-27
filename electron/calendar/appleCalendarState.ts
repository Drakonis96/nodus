import fs from 'node:fs';
import path from 'node:path';
import type { AppleCalendarBinding } from './appleCalendarCore';

export interface AppleCalendarState {
  version: 1;
  vaults: Record<string, { selected: string; bindings: Record<string, AppleCalendarBinding> }>;
}

export function readAppleCalendarState(file: string): AppleCalendarState {
  if (!fs.existsSync(file)) return { version: 1, vaults: {} };
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8')) as AppleCalendarState;
    const object = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value);
    if (state.version !== 1 || !object(state.vaults)) throw new Error();
    for (const vault of Object.values(state.vaults)) {
      if (!vault || typeof vault.selected !== 'string' || !object(vault.bindings) || !vault.bindings[vault.selected]) throw new Error();
      for (const [id, binding] of Object.entries(vault.bindings)) {
        if (!binding || binding.calendarId !== id || typeof binding.enabled !== 'boolean'
          || typeof binding.calendarName !== 'string' || !object(binding.links)
          || (binding.pending !== undefined && !object(binding.pending))) throw new Error();
        for (const link of Object.values(binding.links)) {
          if (!link || typeof link.nativeId !== 'string' || typeof link.fingerprint !== 'string'
            || !Number.isFinite(link.start) || !Number.isFinite(link.end)) throw new Error();
        }
        for (const [eventId, operation] of Object.entries(binding.pending ?? {})) {
          if (!operation || operation.eventId !== eventId || typeof operation.fingerprint !== 'string'
            || operation.mutation?.calendarId !== id || typeof operation.mutation.marker !== 'string'
            || !['upsert', 'remove'].includes(operation.mutation.action)) throw new Error();
        }
      }
    }
    return state;
  } catch { throw new Error('APPLE_CALENDAR_STATE'); }
}

export function writeAppleCalendarState(file: string, state: AppleCalendarState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp`;
  const descriptor = fs.openSync(temporary, 'w', 0o600);
  try { fs.writeFileSync(descriptor, JSON.stringify(state)); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, file);
}
