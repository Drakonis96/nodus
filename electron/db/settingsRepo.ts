import { getDb } from './database';
import type { AppSettings } from '@shared/types';
import { DEFAULT_EMBEDDING_MODELS, DEFAULT_LOCAL_BASE_URLS, normalizeEmbeddingProvider } from '@shared/providers';
import { NODI_ORB_DEFAULT_COLOR } from '@shared/nodiOrb';
import { lockedApiKeyProviders, providerKeyMap } from '../secrets/secretStore';
import { GRANULAR_MODEL_KEYS, migrateModelSettings } from '@shared/modelSettings';
import { recoverV23SharedModelPrefs, recoverV23VaultEmbeddingSelection } from './modelPrefsRecovery';
import {
  GLOBAL_PREF_KEYS,
  SHARED_MODEL_KEYS,
  readGlobalPrefs,
  splitGlobalPatch,
  writeGlobalPrefs,
  type SharedModelKey,
} from './appPrefs';

const DEFAULT_LOCAL_PROVIDERS: AppSettings['localProviders'] = {
  ollama: { baseUrl: DEFAULT_LOCAL_BASE_URLS.ollama },
  lmstudio: { baseUrl: DEFAULT_LOCAL_BASE_URLS.lmstudio },
};

function sanitizeCodexReasoningEfforts(value: unknown): AppSettings['codexReasoningEfforts'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      // The official protocol intentionally leaves effort extensible. Accept a small,
      // identifier-shaped value here; the live model catalog validates support again.
      .filter(([model, effort]) => model.trim().length > 0 && /^[a-z][a-z0-9_-]{0,31}$/.test(String(effort)))
  ) as AppSettings['codexReasoningEfforts'];
}

const DEFAULTS: Omit<AppSettings, 'providerKeys' | 'lockedProviderKeys'> = {
  embeddingProvider: 'openai',
  embeddingModel: DEFAULT_EMBEDDING_MODELS.openai,
  localProviders: DEFAULT_LOCAL_PROVIDERS,
  favorites: [],
  defaultModel: null,
  modelSettingsMode: 'basic',
  modelSettingsVersion: 0,
  extractionModel: null,
  visionModel: null,
  synthesisModel: null,
  summaryModel: null,
  fusionModel: null,
  chatModel: null,
  nodiModel: null,
  deepResearchModel: null,
  immersionModel: null,
  writingModel: null,
  argumentMapModel: null,
  authorModel: null,
  studyModel: null,
  tutorModel: null,
  hypothesisModel: null,
  improveModel: null,
  studyImproveToolbarStyleIds: ['builtin:formal', 'builtin:academic', 'builtin:clear', 'builtin:concise'],
  questionGenModel: null,
  gradingModel: null,
  flashcardModel: null,
  transcriptionModel: null,
  studyAiFallbackModels: {},
  studyAiSubjectModels: {},
  studyAiMonthlyBudgetUsd: 0,
  studyAiBudgetWarningPercent: 80,
  studyAiEnabled: true,
  studyAnalyticsEnabled: true,
  studySyncEnabled: true,
  studySharingEnabled: true,
  studyAiPrivacyMode: 'hybrid',
  studyAiExcludedSubjectIds: [],
  studyAiLocalOnly: false,
  studyAiConfirmExternal: true,
  studentPseudonymsEnabled: true,
  studyAiMaxInputChars: 120000,
  studyAiMaxOutputTokens: 4000,
  studyAiTemperature: 0.15,
  studyAiRetryCount: 1,
  sttProvider: 'transformers',
  sttTransformersModel: 'Xenova/whisper-tiny',
  sttWhisperCppModel: 'base',
  sttWhisperCppExecutable: '',
  imageProvider: 'google',
  imageModel: 'gemini-3.1-flash-lite-image',
  imageStyle: 'antique_book',
  audioProvider: 'piper',
  audioVoice: '',
  audioSpeed: 1,
  syncMode: 'manual',
  readTag: 'leído',
  autoLightScan: false,
  autoDeepScanOnReadTag: false,
  autoSummaryAfterDeep: true,
  autoBridgeAfterQueue: true,
  autoResumeQueue: false,
  zoteroUserId: '0',
  zoteroStoragePath: '',
  monitoredCollections: [],
  theme: 'dark',
  uiLanguage: 'es',
  promptLanguage: 'es',
  animationSpeed: 1,
  interfaceScale: 1,
  accessibleFont: false,
  highContrast: false,
  reduceMotion: false,
  readingFocusMode: false,
  mascotEnabled: true,
  mascotAlwaysOnTop: false,
  mascotVaultCostumes: true,
  // The classic Nodi stays the default: an existing install must never wake up with a
  // different mascot. New users and upgraders are asked once, then this holds their pick.
  mascotStyle: 'classic',
  mascotStyleChosen: false,
  mascotOrbColorMode: 'auto',
  mascotOrbColor: NODI_ORB_DEFAULT_COLOR,
  concurrency: 1,
  chatReasoning: 'off',
  codexReasoningEfforts: {},
  openRouterThroughput: true,
  unpaywallEmail: '',
  onboardingComplete: false,
  basicsTutorialVersion: 0,
  tourComplete: false,
  advancedTourComplete: true,
  demoMode: false,
  demoPriorVaultType: null,
  genealogyTourComplete: false,
  databasesTourComplete: false,
  studyTourComplete: false,
  preferZoteroFulltext: true,
  ocrEnabled: false,
  ocrLanguages: 'spa+eng',
  ocrMaxPages: 300,
  toolkitOcrLanguages: 'spa+eng',
  toolkitOutputDir: null,
  toolkitOpenFolderOnDone: false,
  deepContextMode: 'standard',
  deepStandardChunkWords: 1800,
  deepLongChunkWords: 30000,
  themesLocked: false,
  mcpEnabled: false,
  mcpPort: 4319,
  mcpToken: '',
  copilotEnabled: false,
  copilotPort: 4320,
  copilotToken: '',
  sidebarOrder: [],
  sidebarHidden: [],
  sidebarCustomized: false,
  treeFrame: 'oak',
  treeFocusPersonId: null,
  treeOrientation: 'ancestors_top',
  treePaternalColor: '#2563eb',
  treeMaternalColor: '#dc2626',
  recoverySetupVersion: 0,
  backupVaultIds: [],
  backupIncludePreferences: true,
  backupIncludeHistories: true,
  backupIncludeGeneratedMedia: true,
  backupIncludeApiKeys: true,
  autoBackupEnabled: false,
  autoBackupFolder: '',
  autoBackupIntervalHours: 24,
  autoBackupDays: [],
  autoBackupHour: 3,
  autoBackupMinute: 0,
  lastAutoBackupAt: null,
  lastAutoBackupStatus: null,
};

/** A shared model key counts as "configured" when it differs from its factory default,
 *  i.e. the user actually chose something. Only such values are allowed to seed the
 *  shared store, so a fresh vault never locks in empty defaults for the others. */
function isConfiguredModelPref(key: SharedModelKey, value: unknown): boolean {
  if (value == null) return false;
  const fallback = (DEFAULTS as Record<string, unknown>)[key];
  if (typeof value === 'string') return value.trim().length > 0 && value !== fallback;
  return JSON.stringify(value) !== JSON.stringify(fallback);
}

function readRaw(key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

function writeRaw(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

export function getSettings(): AppSettings {
  const raw = readRaw('app');
  let parsed: Partial<AppSettings> = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  }
  const merged = { ...DEFAULTS, ...parsed };
  merged.codexReasoningEfforts = sanitizeCodexReasoningEfforts(parsed.codexReasoningEfforts);
  merged.studyImproveToolbarStyleIds = [...new Set((Array.isArray(merged.studyImproveToolbarStyleIds) ? merged.studyImproveToolbarStyleIds : [])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0))].slice(0, 4);
  // Pre-2.3 builds called the Transformers.js worker simply "local".
  if ((parsed as { sttProvider?: string }).sttProvider === 'local') merged.sttProvider = 'transformers';
  if (parsed.studyAiPrivacyMode === undefined && parsed.studyAiLocalOnly) merged.studyAiPrivacyMode = 'local';
  merged.studyAiLocalOnly = merged.studyAiPrivacyMode === 'local';
  // Deep-merge local-provider config so a stored partial (or a newly added
  // provider absent from an older settings blob) keeps its default base URL.
  merged.localProviders = {
    ollama: { ...DEFAULT_LOCAL_PROVIDERS.ollama, ...parsed.localProviders?.ollama },
    lmstudio: { ...DEFAULT_LOCAL_PROVIDERS.lmstudio, ...parsed.localProviders?.lmstudio },
  };
  merged.embeddingProvider = normalizeEmbeddingProvider((parsed as Partial<AppSettings>).embeddingProvider);
  if (!merged.embeddingModel?.trim()) merged.embeddingModel = DEFAULT_EMBEDDING_MODELS[merged.embeddingProvider];
  Object.assign(merged, recoverV23VaultEmbeddingSelection(merged as AppSettings));
  // v1.4.0 and older exposed one global header selector. Preserve that user's
  // choice once by seeding the workload settings, then retire the global value
  // so future selectors cannot affect one another through a hidden fallback.
  const legacyDefault = (parsed as Partial<AppSettings>).defaultModel;
  if (legacyDefault) {
    merged.extractionModel ??= legacyDefault;
    merged.synthesisModel ??= legacyDefault;
    merged.summaryModel ??= legacyDefault;
    merged.fusionModel ??= legacyDefault;
    merged.defaultModel = null;
    writeRaw('app', JSON.stringify(merged));
  }
  // App-wide preferences (theme, language) are shared across every vault: overlay the
  // global store, seeding it once from this vault's value so existing users keep their
  // current theme/language when the first new vault is created.
  const globalPrefs = recoverV23SharedModelPrefs() as ReturnType<typeof readGlobalPrefs>;
  const seed: Record<string, unknown> = {};
  for (const key of GLOBAL_PREF_KEYS) {
    if (globalPrefs[key] === undefined) seed[key] = merged[key];
    else (merged as Record<string, unknown>)[key] = globalPrefs[key];
  }
  // AI model configuration is shared too (API keys already are). Overlay the shared
  // store when it holds a real value; otherwise seed it — but ONLY from a vault that has
  // actually changed a key away from its default, so an unconfigured vault opened first
  // can never overwrite a configured one with empty values. A stored `null` counts as
  // "unset" (not an overlay): otherwise a per-vault value just seeded by the legacy
  // defaultModel migration would be clobbered back to null by the shared store.
  for (const key of SHARED_MODEL_KEYS) {
    if (globalPrefs[key] !== undefined && globalPrefs[key] !== null) {
      (merged as Record<string, unknown>)[key] = globalPrefs[key];
    } else if (isConfiguredModelPref(key, merged[key])) {
      seed[key] = merged[key];
    }
  }
  merged.codexReasoningEfforts = sanitizeCodexReasoningEfforts(merged.codexReasoningEfforts);
  if ((merged.sttProvider as string) === 'local') {
    merged.sttProvider = 'transformers';
    seed.sttProvider = 'transformers';
  }
  const modelMigration = migrateModelSettings(merged, globalPrefs);
  if (modelMigration.changed) {
    Object.assign(merged, modelMigration.settings);
    // Keep a local fallback for the migrated payload. Common capability values
    // (including mode/version) are mirrored through the global preference store.
    const { providerKeys: _providerKeys, lockedProviderKeys: _lockedProviderKeys, ...persisted } = merged as AppSettings;
    writeRaw('app', JSON.stringify(persisted));
    for (const key of SHARED_MODEL_KEYS) {
      if (key in merged) seed[key] = merged[key];
    }
  }
  // Modes are exclusive. Basic mode synchronizes every text task to one model;
  // advanced mode materializes any old empty slot so its picker is always concrete.
  let synchronized = false;
  for (const key of GRANULAR_MODEL_KEYS) {
    const current = merged[key];
    const general = merged.synthesisModel;
    const differsFromGeneral = current?.provider !== general?.provider || current?.model !== general?.model;
    const shouldMaterialize = merged.modelSettingsMode === 'advanced' && current == null && general != null;
    if ((merged.modelSettingsMode === 'basic' && differsFromGeneral) || shouldMaterialize) {
      merged[key] = general;
      synchronized = true;
      if ((SHARED_MODEL_KEYS as readonly string[]).includes(key)) seed[key] = general;
    }
  }
  if (synchronized && !modelMigration.changed) {
    const { providerKeys: _providerKeys, lockedProviderKeys: _lockedProviderKeys, ...persisted } = merged as AppSettings;
    writeRaw('app', JSON.stringify(persisted));
  }
  if (Object.keys(seed).length) writeGlobalPrefs(seed);
  return { ...merged, providerKeys: providerKeyMap(), lockedProviderKeys: lockedApiKeyProviders() };
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  if (patch.codexReasoningEfforts !== undefined) {
    patch = { ...patch, codexReasoningEfforts: sanitizeCodexReasoningEfforts(patch.codexReasoningEfforts) };
  }
  if (patch.studyImproveToolbarStyleIds) {
    patch = { ...patch, studyImproveToolbarStyleIds: [...new Set(patch.studyImproveToolbarStyleIds.filter((value) => typeof value === 'string' && value.trim()))].slice(0, 4) };
  }
  if (patch.modelSettingsMode === undefined && GRANULAR_MODEL_KEYS.some((key) => patch[key] != null)) {
    patch = { ...patch, modelSettingsMode: 'advanced' };
  }
  if (patch.studyAiLocalOnly !== undefined && patch.studyAiPrivacyMode === undefined) {
    patch = { ...patch, studyAiPrivacyMode: patch.studyAiLocalOnly ? 'local' : 'hybrid' };
  }
  const current = getSettings();
  // Shared keys (theme/language + the AI model configuration) go to the global store;
  // everything else stays per-vault. Model keys are also kept in the per-vault blob as a
  // fallback, so switching vaults never loses a value.
  const { global, local } = splitGlobalPatch(patch);
  if (Object.keys(global).length) writeGlobalPrefs(global);
  // providerKeys is derived from the secret store, never persisted.
  const { providerKeys: _ignore, lockedProviderKeys: _ignoreLocked, ...rest } = { ...current, ...local };
  // Never persist the theme/language keys into the per-vault blob (they'd shadow the
  // shared store and drift), so keep them exclusively in the global prefs file.
  for (const key of GLOBAL_PREF_KEYS) delete (rest as Record<string, unknown>)[key];
  writeRaw('app', JSON.stringify(rest));
  return getSettings();
}
