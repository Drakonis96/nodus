import fs from 'node:fs';
import path from 'node:path';
import type {
  LibraryCollectionRecord,
  LibraryItemRecord,
  LibraryRebuildResult,
} from '@shared/libraryTypes';
import {
  atomicWriteJson,
  readJsonFile,
  safeLibraryFolderName,
} from './libraryPaths';
import {
  isLibraryCollectionRecord,
  isLibraryItemRecord,
  legacyMetadataToRecord,
  recordContentHash,
} from './libraryRecord';

interface LibraryRootManifest {
  format: 'nodus.library';
  formatVersion: 1;
  createdAt: string;
  updatedAt: string;
  storage: {
    itemFolders: 'stable-source-id';
    originals: 'immutable';
    localCatalog: false;
  };
  sync: { strategy: 'immutable-records'; conflictPolicy: 'preserve-and-last-write-wins' };
  [key: string]: unknown;
}

export interface LibraryReconcileResult {
  itemRecords: LibraryItemRecord[];
  collectionRecords: LibraryCollectionRecord[];
  conflicts: number;
  invalidRecords: number;
}

type RecordKind = 'items' | 'collections';

function compareClocks(a: LibraryItemRecord | LibraryCollectionRecord, b: LibraryItemRecord | LibraryCollectionRecord): number {
  return a.clock.updatedAt.localeCompare(b.clock.updatedAt)
    || a.clock.revision - b.clock.revision
    || a.clock.deviceId.localeCompare(b.clock.deviceId)
    || a.clock.contentHash.localeCompare(b.clock.contentHash);
}

function versionFileName(record: LibraryItemRecord | LibraryCollectionRecord): string {
  const stamp = record.clock.updatedAt.replace(/[^0-9A-Za-z]/g, '');
  return `${stamp}-${record.clock.revision}-${safeLibraryFolderName(record.clock.deviceId)}-${record.clock.contentHash.slice(0, 12)}.json`;
}

export class LibraryDiskStore {
  readonly root: string;
  readonly deviceId: string;

  constructor(root: string, deviceId: string) {
    this.root = path.resolve(root);
    this.deviceId = deviceId;
  }

  initialize(): void {
    fs.mkdirSync(this.root, { recursive: true });
    fs.mkdirSync(path.join(this.root, '.nodus', 'records', 'items'), { recursive: true });
    fs.mkdirSync(path.join(this.root, '.nodus', 'records', 'collections'), { recursive: true });
    fs.mkdirSync(path.join(this.root, '.nodus', 'collections'), { recursive: true });
    fs.mkdirSync(path.join(this.root, '.nodus', 'conflicts'), { recursive: true });
    const file = path.join(this.root, 'library.json');
    const previous = readJsonFile<Record<string, unknown>>(file) ?? {};
    const now = new Date().toISOString();
    const manifest: LibraryRootManifest = {
      ...previous,
      format: 'nodus.library',
      formatVersion: 1,
      createdAt: typeof previous.createdAt === 'string' ? previous.createdAt : now,
      updatedAt: now,
      storage: { itemFolders: 'stable-source-id', originals: 'immutable', localCatalog: false },
      sync: { strategy: 'immutable-records', conflictPolicy: 'preserve-and-last-write-wins' },
    };
    atomicWriteJson(file, manifest);
  }

  itemFolder(storageId: string): string {
    return path.join(this.root, safeLibraryFolderName(storageId));
  }

  readMaterializedItem(storageId: string): LibraryItemRecord | null {
    const folder = this.itemFolder(storageId);
    const parsed = readJsonFile<unknown>(path.join(folder, 'metadata.json'));
    if (isLibraryItemRecord(parsed)) return parsed;
    return legacyMetadataToRecord(parsed, path.basename(folder));
  }

  readMaterializedCollection(id: string): LibraryCollectionRecord | null {
    const value = readJsonFile<unknown>(path.join(this.root, '.nodus', 'collections', `${safeLibraryFolderName(id)}.json`));
    return isLibraryCollectionRecord(value) ? value : null;
  }

  private versionsDirectory(kind: RecordKind, id: string): string {
    return path.join(this.root, '.nodus', 'records', kind, safeLibraryFolderName(id));
  }

  private writeVersion(kind: RecordKind, record: LibraryItemRecord | LibraryCollectionRecord): void {
    const directory = this.versionsDirectory(kind, record.id);
    const file = path.join(directory, versionFileName(record));
    if (!fs.existsSync(file)) atomicWriteJson(file, record);
  }

  private materializeItem(record: LibraryItemRecord): void {
    const folder = this.itemFolder(record.storageId);
    fs.mkdirSync(folder, { recursive: true });
    atomicWriteJson(path.join(folder, 'metadata.json'), record);
    const annotations = path.join(folder, record.files?.annotations ?? 'annotations.json');
    if (!record.deletedAt && !fs.existsSync(annotations)) atomicWriteJson(annotations, []);
  }

  private materializeCollection(record: LibraryCollectionRecord): void {
    atomicWriteJson(path.join(this.root, '.nodus', 'collections', `${safeLibraryFolderName(record.id)}.json`), record);
  }

  upsertItem(
    input: Omit<LibraryItemRecord, 'format' | 'formatVersion' | 'createdAt' | 'deletedAt' | 'clock'>
      & Partial<Pick<LibraryItemRecord, 'createdAt' | 'deletedAt'>>,
    expectedRevision?: number,
    now = new Date().toISOString(),
  ): LibraryItemRecord {
    this.initialize();
    const current = this.readMaterializedItem(input.storageId);
    if (expectedRevision !== undefined && (current?.clock.revision ?? 0) !== expectedRevision) {
      throw new Error('El documento cambió en otro dispositivo. Actualiza la biblioteca antes de volver a guardar.');
    }
    const revision = (current?.clock.revision ?? 0) + 1;
    const base = {
      ...input,
      format: 'nodus.library-item' as const,
      formatVersion: 1 as const,
      createdAt: input.createdAt ?? current?.createdAt ?? now,
      deletedAt: input.deletedAt ?? null,
    };
    const record: LibraryItemRecord = {
      ...base,
      clock: {
        deviceId: this.deviceId,
        revision,
        baseRevision: current?.clock.revision ?? 0,
        updatedAt: now,
        contentHash: recordContentHash(base),
      },
    };
    this.writeVersion('items', record);
    this.materializeItem(record);
    return record;
  }

  mergeItem(record: LibraryItemRecord): LibraryItemRecord {
    if (!isLibraryItemRecord(record)) throw new Error('El registro de biblioteca no es válido.');
    this.initialize();
    this.writeVersion('items', record);
    const current = this.readMaterializedItem(record.storageId);
    const winner = !current || compareClocks(current, record) < 0 ? record : current;
    this.materializeItem(winner);
    return winner;
  }

  upsertCollection(
    input: Omit<LibraryCollectionRecord, 'format' | 'formatVersion' | 'createdAt' | 'deletedAt' | 'clock'>
      & Partial<Pick<LibraryCollectionRecord, 'createdAt' | 'deletedAt'>>,
    expectedRevision?: number,
    now = new Date().toISOString(),
  ): LibraryCollectionRecord {
    this.initialize();
    const current = readJsonFile<unknown>(path.join(this.root, '.nodus', 'collections', `${safeLibraryFolderName(input.id)}.json`));
    const previous = isLibraryCollectionRecord(current) ? current : null;
    if (expectedRevision !== undefined && (previous?.clock.revision ?? 0) !== expectedRevision) {
      throw new Error('La colección cambió en otro dispositivo. Actualiza la biblioteca antes de volver a guardar.');
    }
    const base = {
      ...input,
      format: 'nodus.library-collection' as const,
      formatVersion: 1 as const,
      createdAt: input.createdAt ?? previous?.createdAt ?? now,
      deletedAt: input.deletedAt ?? null,
    };
    const record: LibraryCollectionRecord = {
      ...base,
      clock: {
        deviceId: this.deviceId,
        revision: (previous?.clock.revision ?? 0) + 1,
        baseRevision: previous?.clock.revision ?? 0,
        updatedAt: now,
        contentHash: recordContentHash(base),
      },
    };
    this.writeVersion('collections', record);
    this.materializeCollection(record);
    return record;
  }

  private readVersions<T extends LibraryItemRecord | LibraryCollectionRecord>(
    kind: RecordKind,
    validate: (value: unknown) => value is T,
  ): { records: T[]; invalid: number } {
    const root = path.join(this.root, '.nodus', 'records', kind);
    if (!fs.existsSync(root)) return { records: [], invalid: 0 };
    const records: T[] = [];
    let invalid = 0;
    for (const directory of fs.readdirSync(root, { withFileTypes: true })) {
      if (!directory.isDirectory()) continue;
      const folder = path.join(root, directory.name);
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.includes('.tmp-')) continue;
        const value = readJsonFile<unknown>(path.join(folder, entry.name));
        if (validate(value)) records.push(value);
        else invalid += 1;
      }
    }
    return { records, invalid };
  }

  private selectWinners<T extends LibraryItemRecord | LibraryCollectionRecord>(records: T[]): { winners: T[]; conflicts: number } {
    const grouped = new Map<string, T[]>();
    for (const record of records) grouped.set(record.id, [...(grouped.get(record.id) ?? []), record]);
    const winners: T[] = [];
    let conflicts = 0;
    for (const [id, versions] of grouped) {
      versions.sort(compareClocks);
      const winner = versions[versions.length - 1];
      winners.push(winner);
      const divergent = versions.filter((candidate) =>
        candidate.clock.baseRevision === winner.clock.baseRevision
        && candidate.clock.deviceId !== winner.clock.deviceId
        && candidate.clock.contentHash !== winner.clock.contentHash
      );
      if (divergent.length) {
        conflicts += divergent.length;
        for (const candidate of divergent) {
          const file = path.join(this.root, '.nodus', 'conflicts', safeLibraryFolderName(id), versionFileName(candidate));
          if (!fs.existsSync(file)) atomicWriteJson(file, candidate);
        }
      }
    }
    return { winners, conflicts };
  }

  reconcile(): LibraryReconcileResult {
    this.initialize();
    const items = this.readVersions('items', isLibraryItemRecord);
    const collections = this.readVersions('collections', isLibraryCollectionRecord);
    const selectedItems = this.selectWinners(items.records);
    const selectedCollections = this.selectWinners(collections.records);
    for (const item of selectedItems.winners) this.materializeItem(item);
    for (const collection of selectedCollections.winners) this.materializeCollection(collection);
    return {
      itemRecords: selectedItems.winners,
      collectionRecords: selectedCollections.winners,
      conflicts: selectedItems.conflicts + selectedCollections.conflicts,
      invalidRecords: items.invalid + collections.invalid,
    };
  }

  /** Enumerate materialized folders, including pre-contract extraction prototypes. */
  scanMaterializedItems(): { records: LibraryItemRecord[]; invalid: number } {
    if (!fs.existsSync(this.root)) return { records: [], invalid: 0 };
    const records: LibraryItemRecord[] = [];
    let invalid = 0;
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const file = path.join(this.root, entry.name, 'metadata.json');
      if (!fs.existsSync(file)) continue;
      const value = readJsonFile<unknown>(file);
      const record = isLibraryItemRecord(value) ? value : legacyMetadataToRecord(value, entry.name);
      if (record) records.push(record);
      else invalid += 1;
    }
    return { records, invalid };
  }

  scanMaterializedCollections(): { records: LibraryCollectionRecord[]; invalid: number } {
    const folder = path.join(this.root, '.nodus', 'collections');
    if (!fs.existsSync(folder)) return { records: [], invalid: 0 };
    const records: LibraryCollectionRecord[] = [];
    let invalid = 0;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.includes('.tmp-')) continue;
      const value = readJsonFile<unknown>(path.join(folder, entry.name));
      if (isLibraryCollectionRecord(value)) records.push(value);
      else invalid += 1;
    }
    return { records, invalid };
  }
}

export type LibraryStorageRebuildSummary = Pick<LibraryRebuildResult, 'conflicts' | 'invalidRecords'>;
