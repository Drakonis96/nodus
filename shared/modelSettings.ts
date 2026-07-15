import type { AppSettings, ModelRef } from './types';

export const MODEL_SETTINGS_VERSION = 2;

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

function modelKey(model: ModelRef): string {
  return `${model.provider}\u0000${model.model}`;
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
  settings: T
): { settings: T; changed: boolean } {
  if (settings.modelSettingsVersion >= MODEL_SETTINGS_VERSION) return { settings, changed: false };

  const configured = [settings.synthesisModel, ...GRANULAR_MODEL_KEYS.map((key) => settings[key])]
    .filter((model): model is ModelRef => Boolean(model?.provider && model.model));
  const distinct = new Map(configured.map((model) => [modelKey(model), model]));
  const basic = distinct.size <= 1;
  const next = {
    ...settings,
    modelSettingsVersion: MODEL_SETTINGS_VERSION,
    modelSettingsMode: basic ? 'basic' : 'advanced',
    synthesisModel: settings.synthesisModel ?? configured[0] ?? null,
  } as T;

  for (const key of GRANULAR_MODEL_KEYS) next[key] ??= next.synthesisModel;
  return { settings: next, changed: true };
}
