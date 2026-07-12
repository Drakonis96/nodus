import { getDb } from './database';
import type { AppSettings } from '@shared/types';
import { DEFAULT_EMBEDDING_MODELS, DEFAULT_LOCAL_BASE_URLS, normalizeEmbeddingProvider } from '@shared/providers';
import { providerKeyMap } from '../secrets/secretStore';

const DEFAULT_LOCAL_PROVIDERS: AppSettings['localProviders'] = {
  ollama: { baseUrl: DEFAULT_LOCAL_BASE_URLS.ollama },
  lmstudio: { baseUrl: DEFAULT_LOCAL_BASE_URLS.lmstudio },
};

const DEFAULTS: Omit<AppSettings, 'providerKeys'> = {
  embeddingProvider: 'openai',
  embeddingModel: DEFAULT_EMBEDDING_MODELS.openai,
  localProviders: DEFAULT_LOCAL_PROVIDERS,
  favorites: [],
  defaultModel: null,
  extractionModel: null,
  visionModel: null,
  synthesisModel: null,
  summaryModel: null,
  fusionModel: null,
  chatModel: null,
  deepResearchModel: null,
  immersionModel: null,
  writingModel: null,
  argumentMapModel: null,
  authorModel: null,
  studyModel: null,
  tutorModel: null,
  hypothesisModel: null,
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
  concurrency: 1,
  chatReasoning: 'off',
  openRouterThroughput: true,
  unpaywallEmail: '',
  onboardingComplete: false,
  tourComplete: false,
  advancedTourComplete: true,
  demoMode: false,
  demoPriorVaultType: null,
  genealogyTourComplete: false,
  preferZoteroFulltext: true,
  ocrEnabled: false,
  ocrLanguages: 'spa+eng',
  ocrMaxPages: 300,
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
  autoBackupEnabled: false,
  autoBackupFolder: '',
  autoBackupIntervalHours: 24,
  lastAutoBackupAt: null,
  lastAutoBackupStatus: null,
};

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
  // Deep-merge local-provider config so a stored partial (or a newly added
  // provider absent from an older settings blob) keeps its default base URL.
  merged.localProviders = {
    ollama: { ...DEFAULT_LOCAL_PROVIDERS.ollama, ...parsed.localProviders?.ollama },
    lmstudio: { ...DEFAULT_LOCAL_PROVIDERS.lmstudio, ...parsed.localProviders?.lmstudio },
  };
  merged.embeddingProvider = normalizeEmbeddingProvider((parsed as Partial<AppSettings>).embeddingProvider);
  if (!merged.embeddingModel?.trim()) merged.embeddingModel = DEFAULT_EMBEDDING_MODELS[merged.embeddingProvider];
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
  return { ...merged, providerKeys: providerKeyMap() };
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  // providerKeys is derived from the secret store, never persisted.
  const { providerKeys: _ignore, ...rest } = { ...current, ...patch };
  writeRaw('app', JSON.stringify(rest));
  return getSettings();
}

