// The databases slice of the window.nodus contract. NodusApi extends it, so the
// renderer surface stays flat and every call site is unchanged.
import type { CsvImportPlanData } from '../databaseCsv';
import type { BulkAttachOptions } from '../databaseBulk';
import type { DatabaseAttachment, DatabaseColumn, DatabaseColumnConfig, DatabaseColumnType, DatabaseDetail, DatabaseRelation, DatabaseRow, DatabaseRowHit, DatabaseRowSort, DatabaseSearchHit, DatabaseSelectOption, DatabaseSummary, RelationTarget, RelationTargetKind } from '../databases';
import type { DatabaseSavedView, SavedViewInput } from '../databaseFilters';
import type { DatabaseProfile } from '../dataProfile';
import type { DbChatTurn } from '../databaseChat';
import type { AnalysisRequest, AnalysisResult, AnalysisSuggestion } from '../analysisSpec';
// Declared in shared/types.ts itself; the resulting cycle is types-only and erased at build time.
import type {
  DatabaseChatConversation,
  DatabaseChatConversationSummary,
  DatabaseChatRequest,
} from '../types';

export interface DatabasesApi {
  // databases mode (Notion-like structured data)
  listDatabases(): Promise<DatabaseSummary[]>;
  searchDatabases(query: string, includeContent: boolean): Promise<DatabaseSearchHit[]>;
  searchDatabaseRows(query: string, limit?: number): Promise<DatabaseRowHit[]>;
  getDatabase(id: string): Promise<DatabaseSummary | null>;
  getDatabaseDetail(id: string): Promise<DatabaseDetail | null>;
  databaseStats(id: string): Promise<{ rowCount: number; vaultTotal: number; percent: number }>;
  createDatabase(name: string, icon?: string | null): Promise<DatabaseSummary>;
  renameDatabase(id: string, name: string): Promise<DatabaseSummary | null>;
  setDatabaseIcon(id: string, icon: string | null): Promise<DatabaseSummary | null>;
  deleteDatabase(id: string): Promise<void>;
  reorderDatabases(ids: string[]): Promise<void>;
  createDatabaseColumn(
    databaseId: string,
    name: string,
    type: DatabaseColumnType,
    config?: DatabaseColumnConfig
  ): Promise<DatabaseColumn>;
  updateDatabaseColumn(
    id: string,
    patch: { name?: string; type?: DatabaseColumnType; config?: DatabaseColumnConfig }
  ): Promise<DatabaseColumn | null>;
  deleteDatabaseColumn(id: string): Promise<void>;
  reorderDatabaseColumns(databaseId: string, ids: string[]): Promise<void>;
  addDatabaseOption(columnId: string, label: string, color?: string | null): Promise<DatabaseSelectOption>;
  updateDatabaseOption(id: string, patch: { label?: string; color?: string | null }): Promise<void>;
  deleteDatabaseOption(id: string): Promise<void>;
  reorderDatabaseOptions(columnId: string, ids: string[]): Promise<void>;
  listDatabaseRows(
    databaseId: string,
    opts?: { sort?: DatabaseRowSort; limit?: number; offset?: number }
  ): Promise<DatabaseRow[]>;
  getDatabaseRow(id: string): Promise<DatabaseRow | null>;
  createDatabaseRow(databaseId: string): Promise<DatabaseRow>;
  deleteDatabaseRow(id: string): Promise<void>;
  setDatabaseCell(rowId: string, columnId: string, raw: string | null): Promise<DatabaseRow | null>;
  runDatabaseComparisonCell(rowId: string, columnId: string): Promise<DatabaseRow | null>;
  runDatabaseComparisonColumn(databaseId: string, columnId: string): Promise<{ done: number }>;
  onDatabaseComparisonProgress(
    cb: (payload: { vaultId: string; databaseId: string; columnId: string; done: number; total: number }) => void
  ): () => void;
  listDatabaseAttachments(rowId: string, columnId: string): Promise<DatabaseAttachment[]>;
  getDatabaseAttachmentBlob(id: string): Promise<Uint8Array | null>;
  /**
   * The attachment's downscaled preview, falling back to the original when there is none.
   * `mimeType` describes the returned bytes, which is not the attachment's own type when a
   * thumb was generated.
   */
  getDatabaseAttachmentThumb(id: string): Promise<{ bytes: Uint8Array; mimeType: string | null } | null>;
  deleteDatabaseAttachment(id: string): Promise<void>;
  downloadDatabaseAttachment(id: string): Promise<{ canceled: boolean; path: string | null }>;
  pickAndAttachDatabaseFiles(
    rowId: string,
    columnId: string
  ): Promise<{ added: number; attachments: DatabaseAttachment[] }>;
  runDatabaseAiCell(rowId: string, columnId: string): Promise<string>;
  runDatabaseAiColumn(databaseId: string, columnId: string): Promise<{ done: number; failed: number }>;
  generateDatabaseAiImage(rowId: string, columnId: string): Promise<DatabaseAttachment>;
  generateDatabaseAiImageColumn(databaseId: string, columnId: string): Promise<{ done: number; failed: number }>;
  onDatabaseAiProgress(
    cb: (payload: { vaultId: string; databaseId: string; columnId: string; done: number; total: number }) => void
  ): () => void;
  listDatabaseRelations(rowId: string, columnId: string): Promise<DatabaseRelation[]>;
  addDatabaseRelation(
    rowId: string,
    columnId: string,
    targetKind: RelationTargetKind,
    targetId: string,
    targetVaultId?: string | null
  ): Promise<DatabaseRelation>;
  removeDatabaseRelation(id: string): Promise<void>;
  searchDatabaseRelationTargets(
    kind: RelationTargetKind,
    query: string,
    databaseId?: string
  ): Promise<RelationTarget[]>;
  parseCsvForImport(): Promise<CsvImportPlanData | null>;
  createDatabaseFromCsv(
    name: string,
    headers: string[],
    rows: string[][],
    types: (DatabaseColumnType | null)[]
  ): Promise<DatabaseSummary>;
  /** Import the CSV held in the main process behind `token`. A null type discards the column. */
  createDatabaseFromCsvToken(
    token: string,
    name: string,
    types: (DatabaseColumnType | null)[]
  ): Promise<DatabaseSummary>;
  /** Drop a parsed CSV the user decided not to import, so its rows stop occupying memory. */
  releaseCsvImport(token: string): Promise<void>;
  onCsvImportProgress(cb: (p: { done: number; total: number; finished: boolean }) => void): () => void;
  exportDatabase(databaseId: string, format: 'csv' | 'json' | 'xlsx'): Promise<{ canceled: boolean; path?: string }>;
  getDatabaseProfile(databaseId: string): Promise<{ databaseName: string; profile: DatabaseProfile } | null>;
  analyzeDatabaseReport(databaseId: string): Promise<{ databaseName: string; profileText: string; report: string }>;
  suggestDatabaseAnalyses(databaseId: string): Promise<{ databaseName: string; suggestions: AnalysisSuggestion[] }>;
  runDatabaseAnalysis(databaseId: string, request: AnalysisRequest): Promise<{ databaseName: string; request: AnalysisRequest; result: AnalysisResult }>;
  narrateDatabaseAnalysis(result: AnalysisResult): Promise<string>;
  dbChatStream(request: DatabaseChatRequest, handlers: { onDelta: (delta: string) => void }): Promise<{ text: string }>;
  cancelDbChat(): Promise<void>;
  listDatabaseChatConversations(): Promise<DatabaseChatConversationSummary[]>;
  getDatabaseChatConversation(id: string): Promise<DatabaseChatConversation | null>;
  createDatabaseChatConversation(input: { title: string; databaseIds: string[] }): Promise<DatabaseChatConversation>;
  saveDatabaseChatConversation(id: string, messages: DbChatTurn[], databaseIds: string[]): Promise<DatabaseChatConversation | null>;
  deleteDatabaseChatConversation(id: string): Promise<void>;
  listDatabaseViews(databaseId: string): Promise<DatabaseSavedView[]>;
  createDatabaseView(databaseId: string, input: SavedViewInput): Promise<DatabaseSavedView>;
  updateDatabaseView(id: string, patch: Partial<SavedViewInput>): Promise<DatabaseSavedView | null>;
  deleteDatabaseView(id: string): Promise<void>;
  pickBulkDatabaseFiles(mode?: 'files' | 'folder'): Promise<{ name: string; path: string }[]>;
  bulkAttachDatabaseFiles(
    databaseId: string,
    refColumnId: string,
    attachmentColumnId: string,
    files: { name: string; path: string }[],
    options?: BulkAttachOptions
  ): Promise<{ attached: number; matched: number; unmatched: number }>;
  onDatabaseBulkProgress(
    cb: (payload: { databaseId: string; done: number; total: number; attached: number; matched: number; finished: boolean }) => void
  ): () => void;
}
