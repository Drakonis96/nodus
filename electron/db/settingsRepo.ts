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
  syncMode: 'manual',
  readTag: 'leído',
  autoLightScan: false,
  autoDeepScanOnReadTag: false,
  autoResumeQueue: false,
  zoteroUserId: '0',
  zoteroStoragePath: '',
  monitoredCollections: [],
  theme: 'dark',
  animationSpeed: 1,
  concurrency: 1,
  unpaywallEmail: '',
  onboardingComplete: false,
  tourComplete: false,
  preferZoteroFulltext: true,
  ocrEnabled: false,
  ocrLanguages: 'spa+eng',
  ocrMaxPages: 300,
  deepContextMode: 'standard',
  deepStandardChunkWords: 1800,
  deepLongChunkWords: 30000,
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
