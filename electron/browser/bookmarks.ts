// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * Global, local persistence for Nodus Bookmarks.
 *
 * The file belongs to Nodus userData, not Chromium's persistent partition. It
 * therefore survives Browser destruction and browsing-data clearing, and is
 * included by the normal auxiliary-file backup path.
 */

import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  BrowserBookmark,
  BrowserBookmarkDraft,
  BrowserBookmarkFolder,
  BrowserBookmarkFolderDraft,
  BrowserBookmarkNodeRef,
  BrowserBookmarkStore,
} from '@shared/browserBookmarks';
import {
  deleteBrowserBookmarkNode,
  emptyBrowserBookmarkStore,
  insertBrowserBookmark,
  insertBrowserBookmarkFolder,
  moveBrowserBookmarkNode,
  normalizeBrowserBookmarkStore,
  updateBrowserBookmark,
  updateBrowserBookmarkFolder,
} from '@shared/browserBookmarks';

export const BROWSER_BOOKMARKS_FILE = 'browser-bookmarks.json';

export function browserBookmarksPath(): string {
  return path.join(app.getPath('userData'), BROWSER_BOOKMARKS_FILE);
}

export class BrowserBookmarksRepository {
  private loaded = false;
  private store = emptyBrowserBookmarkStore();
  private writeQueue: Promise<void> = Promise.resolve();
  private notifier: ((store: BrowserBookmarkStore) => void) | null = null;

  constructor(private readonly file: string) {}

  setNotifier(notifier: ((store: BrowserBookmarkStore) => void) | null): void {
    this.notifier = notifier;
  }

  private readOnce(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      this.store = normalizeBrowserBookmarkStore(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      this.store = emptyBrowserBookmarkStore();
    }
  }

  snapshot(): BrowserBookmarkStore {
    this.readOnce();
    return structuredClone(this.store);
  }

  /** Re-read after the normal backup restore replaces the auxiliary file. */
  reloadFromDisk(): BrowserBookmarkStore {
    this.loaded = false;
    this.readOnce();
    const snapshot = this.snapshot();
    this.notifier?.(snapshot);
    return snapshot;
  }

  private async persist(next: BrowserBookmarkStore): Promise<BrowserBookmarkStore> {
    this.store = normalizeBrowserBookmarkStore(next);
    const snapshot = this.snapshot();
    const payload = `${JSON.stringify(snapshot, null, 2)}\n`;
    this.writeQueue = this.writeQueue.then(async () => {
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

  async replace(next: BrowserBookmarkStore): Promise<BrowserBookmarkStore> {
    this.readOnce();
    return this.persist(next);
  }

  async createBookmark(draft: BrowserBookmarkDraft): Promise<{ store: BrowserBookmarkStore; bookmark: BrowserBookmark; duplicate: boolean }> {
    this.readOnce();
    const result = insertBrowserBookmark(this.store, draft, randomUUID());
    if (result.duplicate) return { store: this.snapshot(), bookmark: result.bookmark, duplicate: true };
    return { store: await this.persist(result.store), bookmark: result.bookmark, duplicate: false };
  }

  async editBookmark(id: string, patch: Partial<BrowserBookmarkDraft>): Promise<BrowserBookmarkStore> {
    this.readOnce();
    return this.persist(updateBrowserBookmark(this.store, id, patch));
  }

  async createFolder(draft: BrowserBookmarkFolderDraft): Promise<{ store: BrowserBookmarkStore; folder: BrowserBookmarkFolder }> {
    this.readOnce();
    const result = insertBrowserBookmarkFolder(this.store, draft, randomUUID());
    if (result.store.revision === this.store.revision) return { store: this.snapshot(), folder: result.folder };
    return { store: await this.persist(result.store), folder: result.folder };
  }

  async editFolder(id: string, patch: Partial<BrowserBookmarkFolderDraft>): Promise<BrowserBookmarkStore> {
    this.readOnce();
    return this.persist(updateBrowserBookmarkFolder(this.store, id, patch));
  }

  async deleteNode(ref: BrowserBookmarkNodeRef): Promise<BrowserBookmarkStore> {
    this.readOnce();
    return this.persist(deleteBrowserBookmarkNode(this.store, ref));
  }

  async moveNode(ref: BrowserBookmarkNodeRef, parentId: string | null, index: number): Promise<BrowserBookmarkStore> {
    this.readOnce();
    return this.persist(moveBrowserBookmarkNode(this.store, ref, parentId, index));
  }
}

let defaultRepository: BrowserBookmarksRepository | null = null;

export function browserBookmarksRepository(): BrowserBookmarksRepository {
  if (!defaultRepository) defaultRepository = new BrowserBookmarksRepository(browserBookmarksPath());
  return defaultRepository;
}

/** Tests that swap app userData can discard the lazily-created singleton. */
export function resetBrowserBookmarksRepositoryForTests(): void {
  defaultRepository = null;
}
