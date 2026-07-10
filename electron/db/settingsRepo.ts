import { getDb } from './database';
import type { AppSettings, EmbeddingProvider } from '@shared/types';
import { providerKeyMap } from '../secrets/secretStore';

const DEFAULTS: Omit<AppSettings, 'providerKeys'> = {
  embeddingProvider: 'openai',
  embeddingModel: 'text-embedding-3-small',
  favorites: [],
  defaultModel: null,
  extractionModel: null,
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
  merged.embeddingProvider = normalizeEmbeddingProvider((parsed as Partial<AppSettings>).embeddingProvider);
  if (!merged.embeddingModel?.trim()) merged.embeddingModel = defaultEmbeddingModel(merged.embeddingProvider);
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

function normalizeEmbeddingProvider(provider: unknown): EmbeddingProvider {
  return provider === 'openai' || provider === 'openrouter' || provider === 'gemini' ? provider : 'openai';
}

function defaultEmbeddingModel(provider: EmbeddingProvider): string {
  switch (provider) {
    case 'openrouter':
      return 'baai/bge-m3';
    case 'gemini':
      return 'gemini-embedding-001';
    case 'openai':
      return 'text-embedding-3-small';
  }
}
