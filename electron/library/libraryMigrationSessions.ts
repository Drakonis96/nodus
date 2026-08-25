import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  LibraryMigrationCreatedRecord,
  LibraryMigrationPreview,
  LibraryMigrationProgress,
  LibraryMigrationSession,
  LibraryMigrationStartRequest,
} from '@shared/libraryTypes';
import type { VaultSummary } from '@shared/types';
import { atomicWriteJson, readJsonFile, resolveLibraryFile, safeLibraryFolderName } from './libraryPaths';
import { LibraryCatalog } from './libraryCatalog';
import {
  LibraryMigrationCanceledError,
  type LibraryMigrationMutation,
  migrateVaultLibraries,
  previewVaultLibraries,
} from './libraryMigration';
import { LibraryDiskStore } from './libraryStorage';

const SESSION_FORMAT_VERSION = 1 as const;

function defaultCheckpoint(now: string): LibraryMigrationSession['checkpoint'] {
  return { phase: 'inventory', vaultId: null, processedItems: 0, totalItems: 0, percent: 0, recordedAt: now };
}

function linkKey(link: { itemId: string; vaultId: string; workId: string }): string {
  return `${link.itemId}\u0000${link.vaultId}\u0000${link.workId}`;
}

export class LibraryMigrationSessionManager {
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly store: LibraryDiskStore,
    private readonly catalog: LibraryCatalog,
    private readonly getVaults: () => VaultSummary[],
    private readonly onProgress?: (progress: LibraryMigrationProgress) => void,
  ) {}

  private sessionsDirectory(): string {
    const directory = path.join(this.store.root, '.nodus', 'migrations');
    fs.mkdirSync(directory, { recursive: true });
    return directory;
  }

  private sessionFile(id: string): string {
    return path.join(this.sessionsDirectory(), `${safeLibraryFolderName(id)}.json`);
  }

  private journalFile(id: string): string {
    return path.join(this.sessionsDirectory(), `${safeLibraryFolderName(id)}.journal.ndjson`);
  }

  private save(session: LibraryMigrationSession): LibraryMigrationSession {
    session.updatedAt = new Date().toISOString();
    atomicWriteJson(this.sessionFile(session.id), session);
    return session;
  }

  private applyMutation(session: LibraryMigrationSession, mutation: LibraryMigrationMutation): void {
    if (mutation.kind === 'link-created') {
      if (!session.createdLinks.some((link) => linkKey(link) === linkKey(mutation))) {
        session.createdLinks.push({ itemId: mutation.itemId, vaultId: mutation.vaultId, workId: mutation.workId });
      }
      return;
    }
    const kind = mutation.kind.startsWith('item') ? 'item' : 'collection';
    const existing = session.createdRecords.find((record) => record.kind === kind && record.id === mutation.id);
    if (mutation.kind.endsWith('updated')) {
      if (existing) {
        existing.revision = mutation.revision;
        existing.contentHash = mutation.contentHash;
        if ('storageId' in mutation) existing.storageId = mutation.storageId;
      }
      return;
    }
    const record: LibraryMigrationCreatedRecord = {
      kind, id: mutation.id, revision: mutation.revision, contentHash: mutation.contentHash,
      ...('storageId' in mutation ? { storageId: mutation.storageId } : {}),
    };
    if (existing) Object.assign(existing, record);
    else session.createdRecords.push(record);
  }

  private appendMutation(session: LibraryMigrationSession, mutation: LibraryMigrationMutation): void {
    fs.appendFileSync(this.journalFile(session.id), `${JSON.stringify(mutation)}\n`, { encoding: 'utf8', mode: 0o600 });
    this.applyMutation(session, mutation);
  }

  private load(id: string): LibraryMigrationSession | null {
    const value = readJsonFile<LibraryMigrationSession>(this.sessionFile(id));
    if (!value || value.format !== 'nodus.library-migration-session' || value.formatVersion !== SESSION_FORMAT_VERSION || value.id !== id) return null;
    const journal = this.journalFile(id);
    if (fs.existsSync(journal)) {
      for (const line of fs.readFileSync(journal, 'utf8').split(/\r?\n/).filter(Boolean)) {
        try { this.applyMutation(value, JSON.parse(line) as LibraryMigrationMutation); } catch { /* Preserve the valid session and ignore a torn final append. */ }
      }
    }
    // A persisted `running` session without an in-memory controller means the
    // process stopped between checkpoints. Treat it as safely paused so the next
    // desktop process can resume or roll it back instead of leaving a dead state.
    if (value.status === 'running' && !this.controllers.has(id)) value.status = 'canceled';
    return value;
  }

  preview(): LibraryMigrationPreview {
    return previewVaultLibraries(this.getVaults(), this.store);
  }

  list(): LibraryMigrationSession[] {
    const directory = this.sessionsDirectory();
    return fs.readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .flatMap((name) => {
        const id = name.slice(0, -5);
        const session = this.load(id);
        return session ? [session] : [];
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async start(request: LibraryMigrationStartRequest): Promise<LibraryMigrationSession> {
    if (this.controllers.size) throw new Error('Ya hay una migración de Biblioteca en curso.');
    const preview = this.preview();
    const selected = [...new Set(request.selectedVaultIds)].filter((id) => preview.vaults.some((vault) => vault.id === id && vault.available));
    if (!selected.length) throw new Error('Selecciona al menos un vault académico disponible.');
    const now = new Date().toISOString();
    const session: LibraryMigrationSession = {
      format: 'nodus.library-migration-session', formatVersion: SESSION_FORMAT_VERSION,
      id: randomUUID(), status: 'preview', createdAt: now, updatedAt: now,
      selectedVaultIds: selected, preview: { ...preview, selectedVaultIds: selected }, checkpoint: defaultCheckpoint(now),
      createdRecords: [], createdLinks: [], report: null, verification: null, rollbackConflicts: [], error: null,
    };
    this.save(session);
    return this.run(session);
  }

  async resume(id: string): Promise<LibraryMigrationSession> {
    if (this.controllers.size) throw new Error('Ya hay una migración de Biblioteca en curso.');
    const session = this.load(id);
    if (!session) throw new Error('No se encontró la sesión de migración.');
    if (!['canceled', 'failed'].includes(session.status)) throw new Error('La sesión no está disponible para reanudarse.');
    return this.run(session);
  }

  cancel(id: string): boolean {
    const controller = this.controllers.get(id);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  private async run(session: LibraryMigrationSession): Promise<LibraryMigrationSession> {
    const vaults = this.getVaults().filter((vault) => session.selectedVaultIds.includes(vault.id));
    const missing = session.selectedVaultIds.filter((id) => !vaults.some((vault) => vault.id === id));
    if (missing.length) throw new Error(`Ya no están disponibles los vaults: ${missing.join(', ')}`);
    const controller = new AbortController();
    this.controllers.set(session.id, controller);
    session.status = 'running'; session.error = null; this.save(session);
    let lastSavedAt = 0;
    try {
      session.report = await migrateVaultLibraries({
        vaults, store: this.store, catalog: this.catalog, signal: controller.signal,
        onMutation: (mutation) => this.appendMutation(session, mutation),
        onProgress: (progress) => {
          const next = { ...progress, sessionId: session.id };
          session.checkpoint = {
            phase: next.phase, vaultId: next.vaultId, processedItems: next.processedItems,
            totalItems: next.totalItems, percent: next.percent, recordedAt: new Date().toISOString(),
          };
          this.onProgress?.(next);
          if (next.phase !== 'items' || next.processedItems - lastSavedAt >= 100) {
            this.save(session); lastSavedAt = next.processedItems;
          }
        },
      });
      session.checkpoint = { ...session.checkpoint, phase: 'verify', percent: 99, recordedAt: new Date().toISOString() };
      this.onProgress?.({
        sessionId: session.id, phase: 'verify', vaultIndex: vaults.length, vaultCount: vaults.length,
        vaultId: null, vaultName: null, processedItems: session.checkpoint.processedItems,
        totalItems: session.checkpoint.totalItems, percent: 99,
      });
      session.verification = this.verify();
      if (!Object.entries(session.verification).filter(([key]) => key !== 'checkedAt').every(([, value]) => value === true)) {
        throw new Error('La verificación final detectó registros, archivos o enlaces incompletos.');
      }
      session.status = 'completed';
      session.checkpoint = { ...session.checkpoint, phase: 'complete', percent: 100, recordedAt: new Date().toISOString() };
      this.onProgress?.({
        sessionId: session.id, phase: 'complete', vaultIndex: vaults.length, vaultCount: vaults.length,
        vaultId: null, vaultName: null, processedItems: session.checkpoint.processedItems,
        totalItems: session.checkpoint.totalItems, percent: 100,
      });
    } catch (error) {
      if (error instanceof LibraryMigrationCanceledError || controller.signal.aborted) session.status = 'canceled';
      else { session.status = 'failed'; session.error = error instanceof Error ? error.message : String(error); }
    } finally {
      this.controllers.delete(session.id);
      this.save(session);
    }
    return session;
  }

  private verify(): NonNullable<LibraryMigrationSession['verification']> {
    const items = this.store.scanMaterializedItems();
    const collections = this.store.scanMaterializedCollections();
    const existingItems = new Set(items.records.map((item) => item.id));
    const filesPresent = items.records.every((item) => {
      const folder = this.store.itemFolder(item.storageId);
      const declared = [
        ...item.attachments.map((attachment) => attachment.relativePath),
        ...(item.files ? [item.files.reader, item.files.original].filter((file): file is string => Boolean(file)) : []),
      ];
      return declared.every((file) => resolveLibraryFile(folder, file) !== null);
    });
    const links = this.catalog.listVaultLinks();
    const status = this.catalog.status(this.store.root, this.store.deviceId);
    return {
      catalogMatches: status.items === items.records.filter((item) => !item.deletedAt).length,
      manifestsValid: items.invalid === 0 && collections.invalid === 0,
      filesPresent,
      linksValid: links.every((link) => existingItems.has(link.itemId)),
      checkedAt: new Date().toISOString(),
    };
  }

  rollback(id: string): LibraryMigrationSession {
    if (this.controllers.has(id)) throw new Error('Cancela la migración antes de revertirla.');
    const session = this.load(id);
    if (!session) throw new Error('No se encontró la sesión de migración.');
    if (session.status === 'rolled-back') return session;
    const conflicts: string[] = [];
    for (const record of [...session.createdRecords].reverse()) {
      const removed = record.kind === 'item'
        ? Boolean(record.storageId && this.store.rollbackCreatedItem({ ...record, storageId: record.storageId }))
        : this.store.rollbackCreatedCollection(record);
      if (!removed) conflicts.push(`${record.kind}:${record.id}`);
    }
    const createdLinks = new Set(session.createdLinks.map(linkKey));
    const retainedLinks = this.catalog.listVaultLinks().filter((link) => !createdLinks.has(linkKey(link)));
    this.catalog.rebuild(this.store);
    this.catalog.replaceVaultLinks(retainedLinks);
    session.rollbackConflicts = conflicts;
    session.status = 'rolled-back';
    session.checkpoint = { ...session.checkpoint, phase: 'rollback', percent: 100, recordedAt: new Date().toISOString() };
    session.verification = this.verify();
    return this.save(session);
  }
}
