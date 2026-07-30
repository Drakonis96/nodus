// The archive slice of the window.nodus contract. NodusApi extends it, so the
// renderer surface stays flat and every call site is unchanged.
// Declared in shared/types.ts itself; the resulting cycle is types-only and erased at build time.
import type {
  ArchiveCounts,
  ArchiveEntryCreateInput,
  ArchiveFolder,
  ArchiveIngestSummary,
  ArchiveItem,
  ArchiveItemInput,
  ArchiveListOptions,
  ArchiveTagCount,
  DocumentLinkSuggestion,
  PersonLinkSuggestion,
  RecordsScanSummary,
  ZoteroArchiveEntryImportInput,
} from '../types';

export interface ArchiveApi {
  // evidence archive
  archiveCounts(): Promise<ArchiveCounts>;
  listArchiveFolders(): Promise<ArchiveFolder[]>;
  createArchiveFolder(name: string, parentId?: string | null): Promise<ArchiveFolder>;
  renameArchiveFolder(id: string, name: string): Promise<ArchiveFolder | null>;
  deleteArchiveFolder(id: string): Promise<void>;
  listArchiveItemFolders(itemId: string): Promise<string[]>;
  setArchiveItemFolders(itemId: string, folderIds: string[]): Promise<ArchiveItem | null>;
  listArchiveItems(opts?: ArchiveListOptions): Promise<ArchiveItem[]>;
  getArchiveItem(id: string): Promise<ArchiveItem | null>;
  getArchiveItemBlob(id: string): Promise<Uint8Array | null>;
  createArchiveItem(input: ArchiveItemInput): Promise<ArchiveItem>;
  updateArchiveItem(id: string, patch: Partial<ArchiveItemInput>): Promise<ArchiveItem | null>;
  deleteArchiveItem(id: string): Promise<void>;
  addArchiveTag(id: string, tag: string): Promise<void>;
  removeArchiveTag(id: string, tag: string): Promise<void>;
  listArchiveTags(): Promise<ArchiveTagCount[]>;
  linkArchivePerson(itemId: string, personId: string): Promise<void>;
  unlinkArchivePerson(itemId: string, personId: string): Promise<void>;
  listArchiveItemsForPerson(personId: string): Promise<ArchiveItem[]>;
  pickAndIngestArchive(folderId?: string | null, docType?: string | null): Promise<ArchiveIngestSummary>;
  chooseArchiveEntryFiles(): Promise<string[]>;
  createArchiveEntry(input: ArchiveEntryCreateInput): Promise<ArchiveIngestSummary>;
  importZoteroArchiveEntry(input: ZoteroArchiveEntryImportInput): Promise<ArchiveIngestSummary>;
  createArchiveTextEntry(input: {
    title: string;
    content: string;
    folderId?: string | null;
    docType?: string | null;
    metadata?: Record<string, string> | null;
    source?: string | null;
    tags?: string[];
  }): Promise<ArchiveItem>;
  /** Records lens on a Zotero library work: extract persons/places/events from its text. */
  scanArchiveItem(itemId: string): Promise<RecordsScanSummary>;
  analyzeArchiveItem(itemId: string): Promise<{ unsupported: boolean; description: string | null }>;
  /** Replace an archive item's attached file (re-extracts text; keeps its links/tags). */
  replaceArchiveFile(itemId: string): Promise<{ replaced: boolean; item: ArchiveItem | null }>;
  /** Persons whose name appears in a document's text but who are not yet linked. */
  suggestPersonsForItem(itemId: string): Promise<PersonLinkSuggestion[]>;
  /** Documents that likely concern a person (lexical + semantic), not yet linked. */
  suggestDocumentsForPerson(personId: string): Promise<DocumentLinkSuggestion[]>;
  /** Embed text-bearing archive items for semantic discovery (idempotent). */
  indexArchive(): Promise<{ indexed: number; skipped: number }>;
  archiveIndexStatus(): Promise<{ indexed: number; total: number }>;
}
