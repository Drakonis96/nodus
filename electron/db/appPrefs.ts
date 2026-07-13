import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AppSettings } from '@shared/types';

// App-wide preferences that must be the SAME in every vault (not per-vault). Two
// families live here, both persisted in a single JSON in userData so that creating
// or switching vaults never resets them:
//
//  • GLOBAL_PREF_KEYS   — theme and interface / prompt language. Always present, so
//                         the first vault read seeds them unconditionally.
//  • SHARED_MODEL_KEYS  — the AI model configuration (favorites, every workload
//                         selector, local-provider base URLs and the image model).
//                         API keys are already shared across vaults, so the models
//                         chosen for them should travel too. These are seeded only
//                         from a vault that has actually configured them (see
//                         settingsRepo), so an unconfigured vault opened first can
//                         never lock in empty defaults for a configured one.
//
// Everything else in AppSettings stays per-vault (monitored collections, embeddings,
// onboarding flags, sync/backup, …).

export const GLOBAL_PREF_KEYS = ['theme', 'uiLanguage', 'promptLanguage', 'mascotEnabled', 'mascotAlwaysOnTop', 'mascotVaultCostumes'] as const;
export type GlobalPrefKey = (typeof GLOBAL_PREF_KEYS)[number];

export const SHARED_MODEL_KEYS = [
  'favorites',
  'localProviders',
  'extractionModel',
  'visionModel',
  'synthesisModel',
  'summaryModel',
  'fusionModel',
  'chatModel',
  'deepResearchModel',
  'immersionModel',
  'writingModel',
  'argumentMapModel',
  'authorModel',
  'studyModel',
  'tutorModel',
  'hypothesisModel',
  'improveModel',
  'questionGenModel',
  'gradingModel',
  'flashcardModel',
  'transcriptionModel',
  'sttProvider',
  'imageProvider',
  'imageModel',
  'imageStyle',
] as const;
export type SharedModelKey = (typeof SHARED_MODEL_KEYS)[number];

export type SharedPrefKey = GlobalPrefKey | SharedModelKey;
export const ALL_SHARED_KEYS: readonly SharedPrefKey[] = [...GLOBAL_PREF_KEYS, ...SHARED_MODEL_KEYS];

function prefsFile(): string {
  return path.join(app.getPath('userData'), 'app-prefs.json');
}

export function readGlobalPrefs(): Partial<Pick<AppSettings, SharedPrefKey>> {
  try {
    return JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
  } catch {
    return {};
  }
}

export function writeGlobalPrefs(patch: Partial<Pick<AppSettings, SharedPrefKey>>): void {
  const next = { ...readGlobalPrefs(), ...patch };
  fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
  fs.writeFileSync(prefsFile(), JSON.stringify(next, null, 2));
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
