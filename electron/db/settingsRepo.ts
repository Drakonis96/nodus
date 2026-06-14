import { getDb } from './database';
import type { AppSettings } from '@shared/types';
import { hasApiKey } from '../secrets/secretStore';

const DEFAULTS: Omit<AppSettings, 'hasApiKey'> = {
  aiProvider: 'anthropic',
  aiModel: 'claude-sonnet-4-6',
  embeddingModel: 'text-embedding-3-small',
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
  return { ...DEFAULTS, ...parsed, hasApiKey: hasApiKey() };
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  // hasApiKey is derived, never persisted.
  const { hasApiKey: _ignore, ...rest } = { ...current, ...patch };
  writeRaw('app', JSON.stringify(rest));
  return getSettings();
}
