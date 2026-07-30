// databases channels, moved verbatim out of the monolithic registerIpc.
// The channel names are unchanged; scripts/test-ipc-contract.mjs is what proves it.
import type { IpcContext } from './context';
import crypto from 'node:crypto';
import { withVaultDatabase } from '../db/database';
import * as dbMode from '../db/databasesRepo';
import * as databaseChatHistory from '../db/databaseChatRepo';
import { runAiCell, runAiColumn } from '../ai/databaseAiColumn';
import { runAiImageCell, runAiImageColumn } from '../ai/databaseAiImageColumn';
import { getDatabaseProfile, generateAnalysisReport, suggestDatabaseAnalyses, runDatabaseAnalysis, narrateAnalysisResult } from '../ai/databaseAnalysis';
import type { AnalysisRequest, AnalysisResult } from '@shared/analysisSpec';
import { streamDatabaseChat, DatabaseChatRequest } from '../ai/databaseChat';
import { exportDatabase } from '../export/databaseExport';
import type { ExportFormat } from '@shared/databaseExport';
import { parseCsv, detectDelimiter } from '../extraction/tabular';
import { buildCsvImportPlan } from '@shared/databaseCsv';
import { matchFilesToRows, codeTemplateToRegex, BulkAttachOptions } from '@shared/databaseBulk';
import { makeThumbnail } from '../db/attachmentThumb';
import { yieldToEventLoop, YIELD_EVERY } from '../util/async';
import type { DatabaseColumnConfig, DatabaseColumnType, RelationTargetKind } from '@shared/databases';
import type { SavedViewInput } from '@shared/databaseFilters';
import path from 'node:path';
import fs from 'node:fs';
import { dialog } from 'electron';
import { showImportOpenDialog } from '../privacy';
import { getSettings } from '../db/settingsRepo';
import { extractFromPath } from '../extraction/textExtractor';
import { getActiveVault } from '../vaults/vaultRegistry';
import { analyzeImageBytes } from '../ai/imageAnalysis';
import { isVisionMime } from '@shared/imageAnalysis';

/**
 * Rows of the CSV the import modal is currently showing, kept out of the renderer: a real
 * sheet is tens of MB, and round-tripping it through the modal froze the UI. One entry at a
 * time — the modal can only show one import.
 */
const pendingCsvImports = new Map<string, { headers: string[]; rows: string[][] }>();
/** How many rows the import modal previews. */
const CSV_PREVIEW_ROWS = 50;
/** Guards against a mis-picked folder (a home directory) walking the whole disk. */
const BULK_WALK_MAX_DEPTH = 8;
const BULK_WALK_MAX_FILES = 50_000;

/** Best-effort MIME type from a file extension, for database attachments. */
function dbGuessMime(ext: string): string | null {
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.epub': 'application/epub+zip',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.markdown': 'text/markdown',
    '.csv': 'text/csv',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.json': 'application/json',
  };
  return map[ext.toLowerCase()] ?? null;
}

export function registerDatabasesIpc({ h, getWindow, chatAborters }: IpcContext): void {
  // ── Databases mode (Notion-like structured data) ───────────────────────────
  h('db:list', async () => dbMode.listDatabases());
  h('db:search', async (_e, query: string, includeContent: boolean) => dbMode.searchDatabases(query, includeContent));
  h('db:searchRows', async (_e, query: string, limit?: number) => dbMode.searchDatabaseRows(query, limit));
  h('db:get', async (_e, id: string) => dbMode.getDatabase(id));
  h('db:detail', async (_e, id: string) => dbMode.getDatabaseDetail(id));
  h('db:stats', async (_e, id: string) => dbMode.databaseStats(id));
  h('db:create', async (_e, name: string, icon?: string | null) => dbMode.createDatabase(name, icon ?? null));
  h('db:rename', async (_e, id: string, name: string) => dbMode.renameDatabase(id, name));
  h('db:setIcon', async (_e, id: string, icon: string | null) => dbMode.setDatabaseIcon(id, icon));
  h('db:delete', async (_e, id: string) => {
    dbMode.deleteDatabase(id);
  });
  h('db:reorder', async (_e, ids: string[]) => {
    dbMode.reorderDatabases(ids);
  });
  h('db:createColumn', async (_e, databaseId: string, name: string, type: DatabaseColumnType, config?: DatabaseColumnConfig) =>
    dbMode.createColumn(databaseId, name, type, config ?? {})
  );
  h('db:updateColumn', async (_e, id: string, patch: { name?: string; type?: DatabaseColumnType; config?: DatabaseColumnConfig }) =>
    dbMode.updateColumn(id, patch)
  );
  h('db:deleteColumn', async (_e, id: string) => {
    dbMode.deleteColumn(id);
  });
  h('db:reorderColumns', async (_e, databaseId: string, ids: string[]) => {
    dbMode.reorderColumns(databaseId, ids);
  });
  h('db:addOption', async (_e, columnId: string, label: string, color?: string | null) =>
    dbMode.addOption(columnId, label, color ?? null)
  );
  h('db:updateOption', async (_e, id: string, patch: { label?: string; color?: string | null }) => {
    dbMode.updateOption(id, patch);
  });
  h('db:deleteOption', async (_e, id: string) => {
    dbMode.deleteOption(id);
  });
  h('db:reorderOptions', async (_e, columnId: string, ids: string[]) => {
    dbMode.reorderOptions(columnId, ids);
  });
  h('db:listRows', async (_e, databaseId: string, opts?: { sort?: dbMode.DatabaseRowSort; limit?: number; offset?: number }) =>
    dbMode.listRows(databaseId, opts ?? {})
  );
  h('db:getRow', async (_e, id: string) => dbMode.getRow(id));
  h('db:createRow', async (_e, databaseId: string) => dbMode.createRow(databaseId));
  h('db:deleteRow', async (_e, id: string) => {
    dbMode.deleteRow(id);
  });
  h('db:setCell', async (_e, rowId: string, columnId: string, raw: string | null) => dbMode.setCell(rowId, columnId, raw));
  h('db:runComparisonCell', async (_e, rowId: string, columnId: string) => {
    const vaultId = getActiveVault().id;
    return withVaultDatabase(vaultId, () => dbMode.runComparisonCell(rowId, columnId));
  });
  h('db:runComparisonColumn', async (_e, databaseId: string, columnId: string) => {
    const vaultId = getActiveVault().id;
    return withVaultDatabase(vaultId, () =>
      dbMode.runComparisonColumn(databaseId, columnId, (done, total) =>
        getWindow()?.webContents.send('db:comparisonProgress', { vaultId, databaseId, columnId, done, total })
      )
    );
  });
  h('db:listAttachments', async (_e, rowId: string, columnId: string) => dbMode.listAttachments(rowId, columnId));
  h('db:getAttachmentBlob', async (_e, id: string) => dbMode.getAttachmentBlob(id));
  h('db:getAttachmentThumb', async (_e, id: string) => dbMode.getAttachmentThumb(id));
  h('db:deleteAttachment', async (_e, id: string) => {
    dbMode.deleteAttachment(id);
  });
  h('db:downloadAttachment', async (_e, id: string) => {
    const att = dbMode.getAttachment(id);
    const blob = dbMode.getAttachmentBlob(id);
    if (!att || !blob) return { canceled: true, path: null };
    const win = getWindow();
    const picked = await dialog.showSaveDialog(win ?? undefined!, {
      title: 'Descargar adjunto',
      defaultPath: att.fileName ?? 'adjunto',
    });
    if (picked.canceled || !picked.filePath) return { canceled: true, path: null };
    fs.writeFileSync(picked.filePath, blob);
    return { canceled: false, path: picked.filePath };
  });
  h('db:runAiCell', async (_e, rowId: string, columnId: string) => {
    const vaultId = getActiveVault().id;
    return withVaultDatabase(vaultId, () => runAiCell(rowId, columnId));
  });
  h('db:runAiColumn', async (_e, databaseId: string, columnId: string) => {
    const vaultId = getActiveVault().id;
    return withVaultDatabase(vaultId, () =>
      runAiColumn(databaseId, columnId, (done, total) =>
        getWindow()?.webContents.send('db:aiProgress', { vaultId, databaseId, columnId, done, total })
      )
    );
  });
  h('db:generateAiImage', async (_e, rowId: string, columnId: string) => {
    const vaultId = getActiveVault().id;
    return withVaultDatabase(vaultId, () => runAiImageCell(rowId, columnId));
  });
  h('db:generateAiImageColumn', async (_e, databaseId: string, columnId: string) => {
    const vaultId = getActiveVault().id;
    return withVaultDatabase(vaultId, () =>
      runAiImageColumn(databaseId, columnId, (done, total) =>
        getWindow()?.webContents.send('db:aiProgress', { vaultId, databaseId, columnId, done, total })
      )
    );
  });
  h('db:pickBulkFiles', async (_e, mode: 'files' | 'folder' = 'files') => {
    const win = getWindow();
    const picked = await showImportOpenDialog(win ?? undefined!, {
      title: mode === 'folder' ? 'Elegir una carpeta para subida masiva' : 'Elegir archivos para subida masiva',
      properties: mode === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'],
      ...(mode === 'folder' ? {} : { filters: [{ name: 'Todos los archivos', extensions: ['*'] }] }),
    });
    if (picked.canceled) return [];
    if (mode === 'files') return picked.filePaths.map((p) => ({ name: path.basename(p), path: p }));
    // A real catalogue is a tree of folders, not a flat selection the user can shift-click:
    // walk it so "pick the folder" is the whole interaction.
    const out: { name: string; path: string }[] = [];
    const walk = (dir: string, depth: number) => {
      if (depth > BULK_WALK_MAX_DEPTH || out.length >= BULK_WALK_MAX_FILES) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (out.length >= BULK_WALK_MAX_FILES) return;
        if (e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, depth + 1);
        else if (e.isFile()) out.push({ name: e.name, path: full });
      }
    };
    for (const root of picked.filePaths) walk(root, 0);
    return out;
  });
  h('db:bulkAttach', async (
    _e,
    databaseId: string,
    refColumnId: string,
    attachmentColumnId: string,
    files: { name: string; path: string }[],
    options: BulkAttachOptions = {}
  ) => {
    const rows = dbMode.listRows(databaseId).map((r) => ({ rowId: r.id, refValue: r.cells[refColumnId] ?? null }));
    const matches = matchFilesToRows(files.map((f) => f.name), rows, {
      fuzzy: options.fuzzy ?? false,
      codePattern: options.codeTemplate ? codeTemplateToRegex(options.codeTemplate) : null,
    });
    // Pair by index, not by name: walking a folder tree turns up files that share a name
    // across folders, and keying a map on the name would file them all under one row.
    const rowByIndex = matches.map((m) => m.rowId);
    const settings = getSettings();
    const ocr = { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages };
    const visionModel = options.describe
      ? settings.visionModel ?? settings.extractionModel ?? settings.synthesisModel ?? null
      : null;
    const total = files.length;
    let attached = 0;
    let matched = 0;
    let done = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const rowId = rowByIndex[i];
      if (rowId) {
        matched++;
        try {
          const buf = fs.readFileSync(f.path);
          const contentHash = crypto.createHash('sha256').update(buf).digest('hex');
          if (!dbMode.attachmentExists(rowId, attachmentColumnId, contentHash)) {
            const mimeType = dbGuessMime(path.extname(f.path));
            let extractedText: string | null = null;
            let description: string | null = null;
            // Both passes are opt-in: a photo catalogue is thousands of files, and OCRing or
            // describing every one of them is hours of work the user rarely wants.
            if (options.ocr) {
              try {
                const doc = await extractFromPath(f.path, { ocr });
                extractedText = doc.text && doc.text.trim() ? doc.text : null;
              } catch {
                /* keep the blob even if extraction fails */
              }
            }
            if (visionModel && isVisionMime(mimeType)) {
              const analysis = await analyzeImageBytes(buf, mimeType!, visionModel).catch(() => null);
              if (analysis) {
                description = analysis.description || null;
                if (!extractedText && analysis.text.trim()) extractedText = analysis.text;
              }
            }
            dbMode.addAttachment({
              rowId,
              columnId: attachmentColumnId,
              fileName: f.name,
              mimeType,
              bytes: buf.length,
              blob: buf,
              contentHash,
              extractedText,
              description,
              thumb: makeThumbnail(buf, mimeType),
            });
            attached++;
          }
        } catch {
          /* unreadable file — skip */
        }
      }
      done++;
      getWindow()?.webContents.send('db:bulkProgress', { databaseId, done, total, attached, matched, finished: false });
      // Reading, hashing and downscaling a file is all synchronous, and with OCR and the
      // vision pass both off (the common case) nothing else in this loop awaits — so a
      // 7k-image catalogue would hold the main process for ~100s and the progress emits
      // above would only reach the renderer once it finished.
      if (done % YIELD_EVERY === 0) await yieldToEventLoop();
    }
    getWindow()?.webContents.send('db:bulkProgress', { databaseId, done: total, total, attached, matched, finished: true });
    return { attached, matched, unmatched: total - matched };
  });
  h('db:parseCsvForImport', async () => {
    const win = getWindow();
    const picked = await showImportOpenDialog(win ?? undefined!, {
      title: 'Importar CSV',
      properties: ['openFile'],
      filters: [{ name: 'CSV', extensions: ['csv', 'tsv', 'txt'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    const filePath = picked.filePaths[0];
    const text = fs.readFileSync(filePath, 'utf8');
    const parsed = parseCsv(text, detectDelimiter(text));
    const plan = buildCsvImportPlan(parsed);
    // The rows stay here: a real sheet is tens of MB, and shipping it to the renderer only
    // to have it shipped straight back to db:createFromCsv cost two structured clones of
    // ~180k strings and froze the UI. The modal only ever renders headers + a preview.
    const token = crypto.randomUUID();
    pendingCsvImports.clear();
    pendingCsvImports.set(token, { headers: plan.headers, rows: plan.rows });
    return {
      token,
      fileName: path.basename(filePath),
      headers: plan.headers,
      suggestedTypes: plan.suggestedTypes,
      suggestions: plan.suggestions,
      rowCount: plan.rows.length,
      sampleRows: plan.rows.slice(0, CSV_PREVIEW_ROWS),
    };
  });
  h('db:releaseCsvImport', async (_e, token: string) => {
    pendingCsvImports.delete(token);
  });
  h('db:createFromCsvToken', async (_e, token: string, name: string, types: (DatabaseColumnType | null)[]) => {
    const pending = pendingCsvImports.get(token);
    if (!pending) throw new Error('El CSV importado ya no está disponible. Vuelve a elegir el archivo.');
    const send = (done: number, total: number) =>
      getWindow()?.webContents.send('db:csvImportProgress', { done, total, finished: done >= total });
    const created = dbMode.createDatabaseFromCsv(name, pending.headers, pending.rows, types, send);
    // Only drop the rows once they are safely in the database: if the import throws, the
    // modal reports the error and the user can hit Import again without re-picking the file.
    pendingCsvImports.delete(token);
    return created;
  });
  h('db:createFromCsv', async (_e, name: string, headers: string[], rows: string[][], types: (DatabaseColumnType | null)[]) =>
    dbMode.createDatabaseFromCsv(name, headers, rows, types)
  );
  h('db:export', async (_e, databaseId: string, format: ExportFormat) => {
    const result = exportDatabase(databaseId, format);
    if (!result) return { canceled: true };
    const win = getWindow();
    const picked = await dialog.showSaveDialog(win ?? undefined!, { title: 'Exportar base de datos', defaultPath: result.fileName });
    if (picked.canceled || !picked.filePath) return { canceled: true };
    fs.writeFileSync(picked.filePath, result.content);
    return { canceled: false, path: picked.filePath };
  });
  h('db:profile', async (_e, databaseId: string) => getDatabaseProfile(databaseId));
  h('db:analyzeReport', async (_e, databaseId: string) => {
    const vaultId = getActiveVault().id;
    return withVaultDatabase(vaultId, () => generateAnalysisReport(databaseId));
  });
  h('db:suggestAnalyses', async (_e, databaseId: string) => {
    const vaultId = getActiveVault().id;
    return withVaultDatabase(vaultId, () => suggestDatabaseAnalyses(databaseId));
  });
  h('db:runAnalysis', async (_e, databaseId: string, request: AnalysisRequest) => runDatabaseAnalysis(databaseId, request));
  h('db:narrateAnalysis', async (_e, result: AnalysisResult) => {
    const vaultId = getActiveVault().id;
    return withVaultDatabase(vaultId, () => narrateAnalysisResult(result));
  });
  h('db:chatStream', async (e, requestId: string, request: DatabaseChatRequest) => {
    const controller = new AbortController();
    chatAborters.set(requestId, controller);
    try {
      return await streamDatabaseChat(request, (delta) => e.sender.send('db:chatStream:delta', requestId, delta), controller.signal);
    } finally {
      chatAborters.delete(requestId);
    }
  });
  h('db:chatStream:cancel', async (_e, requestId: string) => {
    chatAborters.get(requestId)?.abort();
  });
  h('db:chatHistory:list', async () => databaseChatHistory.listDatabaseChatConversations());
  h('db:chatHistory:get', async (_e, id: string) => databaseChatHistory.getDatabaseChatConversation(id));
  h('db:chatHistory:create', async (_e, input: { title: string; databaseIds: string[] }) => databaseChatHistory.createDatabaseChatConversation(input));
  h('db:chatHistory:save', async (_e, id: string, messages: import('@shared/types').DbChatTurn[], databaseIds: string[]) => databaseChatHistory.saveDatabaseChatConversation(id, messages, databaseIds));
  h('db:chatHistory:delete', async (_e, id: string) => databaseChatHistory.deleteDatabaseChatConversation(id));
  h('db:listViews', async (_e, databaseId: string) => dbMode.listViews(databaseId));
  h('db:createView', async (_e, databaseId: string, input: SavedViewInput) => dbMode.createView(databaseId, input));
  h('db:updateView', async (_e, id: string, patch: Partial<SavedViewInput>) => dbMode.updateView(id, patch));
  h('db:deleteView', async (_e, id: string) => {
    dbMode.deleteView(id);
  });
  h('db:listRelations', async (_e, rowId: string, columnId: string) => dbMode.listRelations(rowId, columnId));
  h('db:addRelation', async (_e, rowId: string, columnId: string, targetKind: RelationTargetKind, targetId: string, targetVaultId?: string | null) =>
    dbMode.addRelation(rowId, columnId, targetKind, targetId, targetVaultId ?? null)
  );
  h('db:removeRelation', async (_e, id: string) => {
    dbMode.removeRelation(id);
  });
  h('db:searchRelationTargets', async (_e, kind: RelationTargetKind, query: string, databaseId?: string) =>
    dbMode.searchRelationTargets(kind, query, { databaseId })
  );
  h('db:pickAndAttach', async (_e, rowId: string, columnId: string) => {
    const win = getWindow();
    const picked = await showImportOpenDialog(win ?? undefined!, {
      title: 'Adjuntar archivos',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Todos los archivos', extensions: ['*'] },
        { name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'gif', 'tif', 'tiff', 'webp', 'bmp'] },
        { name: 'Documentos y datos', extensions: ['pdf', 'epub', 'txt', 'md', 'csv', 'xlsx', 'docx'] },
      ],
    });
    if (picked.canceled || picked.filePaths.length === 0) return { added: 0, attachments: dbMode.listAttachments(rowId, columnId) };
    const settings = getSettings();
    const ocr = { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages };
    let added = 0;
    for (const filePath of picked.filePaths) {
      const buf = fs.readFileSync(filePath);
      const contentHash = crypto.createHash('sha256').update(buf).digest('hex');
      if (dbMode.attachmentExists(rowId, columnId, contentHash)) continue;
      let extractedText: string | null = null;
      try {
        const doc = await extractFromPath(filePath, { ocr });
        extractedText = doc.text && doc.text.trim() ? doc.text : null;
      } catch {
        /* non-extractable file (e.g. an image with OCR off) — keep the blob anyway */
      }
      dbMode.addAttachment({
        rowId,
        columnId,
        fileName: path.basename(filePath),
        mimeType: dbGuessMime(path.extname(filePath)),
        bytes: buf.length,
        blob: buf,
        contentHash,
        extractedText,
      });
      added++;
    }
    return { added, attachments: dbMode.listAttachments(rowId, columnId) };
  });
}
