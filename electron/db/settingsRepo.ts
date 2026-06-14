import { getDb } from './database';
import type { AppSettings } from '@shared/types';
import { providerKeyMap } from '../secrets/secretStore';

const DEFAULTS: Omit<AppSettings, 'providerKeys'> = {
  embeddingModel: 'text-embedding-3-small',
  favorites: [],
  defaultModel: null,
  syncMode: 'manual',
  readTag: 'leído',
  zoteroUserId: '0',
  zoteroStoragePath: '',
  monitoredCollections: [],
  theme: 'dark',
  animationSpeed: 1,
  concurrency: 1,
  unpaywallEmail: '',
  onboardingComplete: false,
  preferZoteroFulltext: true,
  ocrEnabled: false,
  ocrLanguages: 'spa+eng',
  ocrMaxPages: 300,
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
  return { ...DEFAULTS, ...parsed, providerKeys: providerKeyMap() };
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  // providerKeys is derived from the secret store, never persisted.
  const { providerKeys: _ignore, ...rest } = { ...current, ...patch };
  writeRaw('app', JSON.stringify(rest));
  return getSettings();
}
