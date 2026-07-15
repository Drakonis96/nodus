import type { AppSettings, ModelRef } from './types';

export const MODEL_SETTINGS_VERSION = 3;

/** Text/vision task selections managed together by the basic/advanced mode. */
export const GRANULAR_MODEL_KEYS = [
  'extractionModel',
  'visionModel',
  'summaryModel',
  'fusionModel',
  'chatModel',
  'nodiModel',
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
] as const satisfies readonly (keyof AppSettings)[];

export type GranularModelKey = (typeof GRANULAR_MODEL_KEYS)[number];

/** These task selectors were global through 2.2 and became per-vault in 2.3. Their
 * old values intentionally remain in app-prefs.json and are recovery evidence for
 * the faulty 2.3 migration. */
export const LEGACY_GLOBAL_GRANULAR_MODEL_KEYS = [
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
] as const satisfies readonly GranularModelKey[];

function modelKey(model: ModelRef): string {
  return `${model.provider}\u0000${model.model}`;
}

function isModelRef(value: unknown): value is ModelRef {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ModelRef>;
  return typeof candidate.provider === 'string' && candidate.provider.length > 0
    && typeof candidate.model === 'string' && candidate.model.length > 0;
}

/**
 * One-time conversion from the former always-granular settings.
 *
 * A single distinct text model means the old configuration was effectively basic.
 * Multiple distinct models select advanced mode. Missing legacy selections are
 * materialised from the former general model so advanced selectors always contain
 * concrete values instead of exposing an "inherit" pseudo-option.
 */
export function migrateModelSettings<T extends Pick<AppSettings, 'modelSettingsVersion' | 'modelSettingsMode' | 'synthesisModel' | GranularModelKey>>(
  settings: T,
  legacyGlobalPrefs: Partial<Record<GranularModelKey, unknown>> = {}
): { settings: T; changed: boolean } {
  if (settings.modelSettingsVersion >= MODEL_SETTINGS_VERSION) return { settings, changed: false };

  const next = { ...settings } as T;
  const currentConfigured = [settings.synthesisModel, ...GRANULAR_MODEL_KEYS.map((key) => settings[key])]
    .filter((model): model is ModelRef => Boolean(model?.provider && model.model));
  const currentDistinct = new Set(currentConfigured.map(modelKey));
  const legacyModels = LEGACY_GLOBAL_GRANULAR_MODEL_KEYS
    .map((key) => [key, legacyGlobalPrefs[key]] as const)
    .filter((entry): entry is readonly [typeof entry[0], ModelRef] => isModelRef(entry[1]));
  const legacyHasDifferentSelection = legacyModels.some(([, model]) => !currentDistinct.has(modelKey(model)));

  // 2.3 could only see the new common selectors, conclude that the setup was basic,
  // and replace every task selector with the general model. If the retired global
  // fields prove that distinct task choices existed, restore them verbatim.
  const recoverIgnoredV23Choices = currentDistinct.size <= 1 && legacyHasDifferentSelection;
  if (recoverIgnoredV23Choices) {
    for (const [key, model] of legacyModels) next[key] = model;
  }

  const configured = [next.synthesisModel, ...GRANULAR_MODEL_KEYS.map((key) => next[key])]
    .filter((model): model is ModelRef => Boolean(model?.provider && model.model));
  const distinct = new Map(configured.map((model) => [modelKey(model), model]));
  const wasLegacy = settings.modelSettingsVersion < 2;
  next.modelSettingsVersion = MODEL_SETTINGS_VERSION;
  if (wasLegacy || recoverIgnoredV23Choices) next.modelSettingsMode = distinct.size <= 1 ? 'basic' : 'advanced';
  next.synthesisModel ??= configured[0] ?? null;

  for (const key of GRANULAR_MODEL_KEYS) next[key] ??= next.synthesisModel;
  return { settings: next, changed: true };
}
