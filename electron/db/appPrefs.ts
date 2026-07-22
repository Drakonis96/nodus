import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AppSettings } from '@shared/types';

// App-wide preferences that must be the SAME in every vault (not per-vault). Two
// families live here, both persisted in a single JSON in userData so that creating
// or switching vaults never resets them:
//
//  • GLOBAL_PREF_KEYS   — theme/interface preferences, model favorites and the
//                         recovery policy. Always present, so the first vault read
//                         seeds them unconditionally.
//  • SHARED_MODEL_KEYS  — the AI model configuration (every workload selector,
//                         local-provider base URLs and the image model).
//                         API keys are already shared across vaults, so the models
//                         chosen for them should travel too. These are seeded only
//                         from a vault that has actually configured them (see
//                         settingsRepo), so an unconfigured vault opened first can
//                         never lock in empty defaults for a configured one.
//
// Everything else in AppSettings stays per-vault (including granular feature/task
// overrides, monitored collections and vault onboarding flags).

export const GLOBAL_PREF_KEYS = [
  'theme',
  'uiLanguage',
  'promptLanguage',
  'interfaceScale',
  'accessibleFont',
  'highContrast',
  'reduceMotion',
  'readingFocusMode',
  'favorites',
  'mascotEnabled',
  'mascotAlwaysOnTop',
  'mascotVaultCostumes',
  'mascotStyle',
  'mascotStyleChosen',
  'mascotOrbColorMode',
  'mascotOrbColor',
  'basicsTutorialVersion',
  'recoverySetupVersion',
  'backupVaultIds',
  'backupIncludePreferences',
  'backupIncludeHistories',
  'backupIncludeGeneratedMedia',
  'backupIncludeApiKeys',
  'autoBackupEnabled',
  'autoBackupFolder',
  'autoBackupIntervalHours',
  'autoBackupDays',
  'autoBackupHour',
  'autoBackupMinute',
  'lastAutoBackupAt',
  'lastAutoBackupStatus',
] as const;
export type GlobalPrefKey = (typeof GLOBAL_PREF_KEYS)[number];

export const SHARED_MODEL_KEYS = [
  'codexReasoningEfforts',
  'localProviders',
  'providerFreeTier',
  'extractionModel',
  'visionModel',
  'synthesisModel',
  'summaryModel',
  'fusionModel',
  'nodiModel',
  'transcriptionModel',
  'sttProvider',
  'sttTransformersModel',
  'sttWhisperCppModel',
  'sttWhisperCppExecutable',
  'imageProvider',
  'imageModel',
  'imageQuality',
  'imageStyle',
  'audioProvider',
  'audioVoice',
  'audioSpeed',
] as const;
export type SharedModelKey = (typeof SHARED_MODEL_KEYS)[number];

export type SharedPrefKey = GlobalPrefKey | SharedModelKey;
export const ALL_SHARED_KEYS: readonly SharedPrefKey[] = [...GLOBAL_PREF_KEYS, ...SHARED_MODEL_KEYS];

function prefsFile(): string {
  return path.join(app.getPath('userData'), 'app-prefs.json');
}

export function readGlobalPrefsRaw(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function readGlobalPrefs(): Partial<Pick<AppSettings, SharedPrefKey>> {
  return readGlobalPrefsRaw() as Partial<Pick<AppSettings, SharedPrefKey>>;
}

export function writeGlobalPrefsRaw(patch: Record<string, unknown>): void {
  const next = { ...readGlobalPrefsRaw(), ...patch };
  const target = prefsFile();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(temporary, JSON.stringify(next, null, 2));
  fs.renameSync(temporary, target);
}

export function writeGlobalPrefs(patch: Partial<Pick<AppSettings, SharedPrefKey>>): void {
  writeGlobalPrefsRaw(patch as Record<string, unknown>);
}

/** Split a settings patch into its global (shared) and per-vault parts. Language/theme
 *  keys move out of the per-vault blob entirely; the shared model keys are mirrored to
 *  the global store but kept in `local` too, so each vault retains a per-vault fallback. */
export function splitGlobalPatch(patch: Partial<AppSettings>): {
  global: Partial<Pick<AppSettings, SharedPrefKey>>;
  local: Partial<AppSettings>;
} {
  const global: Partial<Pick<AppSettings, SharedPrefKey>> = {};
  const local: Partial<AppSettings> = { ...patch };
  for (const key of GLOBAL_PREF_KEYS) {
    if (key in patch) {
      (global as Record<string, unknown>)[key] = patch[key];
      delete (local as Record<string, unknown>)[key];
    }
  }
  for (const key of SHARED_MODEL_KEYS) {
    if (key in patch) {
      (global as Record<string, unknown>)[key] = patch[key];
    }
  }
  return { global, local };
}
