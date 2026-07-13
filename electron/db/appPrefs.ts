import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AppSettings } from '@shared/types';

// App-wide preferences that must be the SAME in every vault (not per-vault): the theme
// and the interface / prompt language. They live in a single JSON in userData so that
// creating or switching vaults never resets the look or language. Everything else in
// AppSettings stays per-vault (models, monitored collections, onboarding flags, …).

export const GLOBAL_PREF_KEYS = ['theme', 'uiLanguage', 'promptLanguage'] as const;
export type GlobalPrefKey = (typeof GLOBAL_PREF_KEYS)[number];

function prefsFile(): string {
  return path.join(app.getPath('userData'), 'app-prefs.json');
}

export function readGlobalPrefs(): Partial<Pick<AppSettings, GlobalPrefKey>> {
  try {
    return JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
  } catch {
    return {};
  }
}

export function writeGlobalPrefs(patch: Partial<Pick<AppSettings, GlobalPrefKey>>): void {
  const next = { ...readGlobalPrefs(), ...patch };
  fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
  fs.writeFileSync(prefsFile(), JSON.stringify(next, null, 2));
}

/** Split a settings patch into its global (shared) and per-vault parts. */
export function splitGlobalPatch(patch: Partial<AppSettings>): {
  global: Partial<Pick<AppSettings, GlobalPrefKey>>;
  local: Partial<AppSettings>;
} {
  const global: Partial<Pick<AppSettings, GlobalPrefKey>> = {};
  const local: Partial<AppSettings> = { ...patch };
  for (const key of GLOBAL_PREF_KEYS) {
    if (key in patch) {
      (global as Record<string, unknown>)[key] = patch[key];
      delete (local as Record<string, unknown>)[key];
    }
  }
  return { global, local };
}
