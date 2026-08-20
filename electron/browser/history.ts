// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * Private, app-global Browser history.
 *
 * This file deliberately is not part of GLOBAL_AUXILIARY_FILES: visits are not
 * vault data, Chromium data, backup data or sync data. The only process that
 * reads or writes it is Electron main.
 */

import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  BrowserHistoryRetention,
  BrowserHistoryStore,
  BrowserHistoryVisit,
} from '@shared/browserHistory';
import {
  deleteBrowserHistoryEntry,
  emptyBrowserHistoryStore,
  insertBrowserHistoryVisit,
  normalizeBrowserHistoryStore,
  pruneBrowserHistory,
} from '@shared/browserHistory';
import { getSettings } from '../db/settingsRepo';
import { readGlobalPrefsRaw } from '../db/appPrefs';

export const BROWSER_HISTORY_FILE = 'browser-history.json';

export function browserHistoryPath(): string {
  return path.join(app.getPath('userData'), BROWSER_HISTORY_FILE);
}

export class BrowserHistoryRepository {
  private loaded = false;
  private store = emptyBrowserHistoryStore();
  private writeQueue: Promise<void> = Promise.resolve();
  private writeGeneration = 0;
  private notifier: ((store: BrowserHistoryStore) => void) | null = null;

  constructor(private readonly file: string) {}

  setNotifier(notifier: ((store: BrowserHistoryStore) => void) | null): void {
    this.notifier = notifier;
  }

  private readOnce(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      this.store = normalizeBrowserHistoryStore(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      this.store = emptyBrowserHistoryStore();
    }
  }

  private snapshot(): BrowserHistoryStore {
    this.readOnce();
    return structuredClone(this.store);
  }

  private async persist(next: BrowserHistoryStore): Promise<BrowserHistoryStore> {
    this.store = normalizeBrowserHistoryStore(next);
    const snapshot = this.snapshot();
    const payload = `${JSON.stringify(snapshot)}\n`;
    const generation = this.writeGeneration;
    this.writeQueue = this.writeQueue.then(async () => {
      if (generation !== this.writeGeneration) return;
      await fsp.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp-${process.pid}-${randomUUID()}`;
      try {
        await fsp.writeFile(temporary, payload, { encoding: 'utf8', mode: 0o600 });
        await fsp.rename(temporary, this.file);
      } finally {
        await fsp.rm(temporary, { force: true }).catch(() => undefined);
      }
    });
    await this.writeQueue;
    this.notifier?.(snapshot);
    return snapshot;
  }

  async list(retention: BrowserHistoryRetention): Promise<BrowserHistoryStore> {
    this.readOnce();
    const next = pruneBrowserHistory(this.store, retention);
    if (next.revision !== this.store.revision) return this.persist(next);
    return this.snapshot();
  }

  async record(visit: BrowserHistoryVisit, retention: BrowserHistoryRetention): Promise<BrowserHistoryStore> {
    this.readOnce();
    const next = insertBrowserHistoryVisit(this.store, visit, randomUUID(), retention);
    if (next.revision === this.store.revision) return this.snapshot();
    return this.persist(next);
  }

  async delete(id: string): Promise<BrowserHistoryStore> {
    this.readOnce();
    const next = deleteBrowserHistoryEntry(this.store, String(id));
    if (next.revision === this.store.revision) return this.snapshot();
    return this.persist(next);
  }

  async clear(): Promise<BrowserHistoryStore> {
    this.readOnce();
    if (this.store.entries.length === 0) return this.snapshot();
    return this.persist({ version: 1, revision: this.store.revision + 1, entries: [] });
  }

  /** Electron quit hooks cannot await. Removing this non-backed-up file is atomic enough. */
  clearSync(): void {
    this.readOnce();
    this.writeGeneration += 1;
    this.store = { version: 1, revision: this.store.revision + 1, entries: [] };
    try { fs.rmSync(this.file, { force: true }); } catch { /* best effort during shutdown */ }
    this.notifier?.(this.snapshot());
  }
}

let defaultRepository: BrowserHistoryRepository | null = null;

export function browserHistoryRepository(): BrowserHistoryRepository {
  if (!defaultRepository) defaultRepository = new BrowserHistoryRepository(browserHistoryPath());
  return defaultRepository;
}

export function currentBrowserHistoryRetention(): BrowserHistoryRetention {
  return getSettings().browserHistoryRetention;
}

export function recordBrowserHistoryVisit(visit: BrowserHistoryVisit): void {
  void browserHistoryRepository().record(visit, currentBrowserHistoryRetention()).catch(() => undefined);
}

export function clearBrowserHistoryOnCloseIfConfigured(): void {
  // Shutdown calls this again after SQLite has closed. Read the app-global JSON
  // directly so the final backstop can never reopen a vault database.
  if (readGlobalPrefsRaw().browserClearHistoryOnClose === true) browserHistoryRepository().clearSync();
}

export function resetBrowserHistoryRepositoryForTests(): void {
  defaultRepository = null;
}
