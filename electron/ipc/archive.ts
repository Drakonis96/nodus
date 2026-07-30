// archive channels, moved verbatim out of the monolithic registerIpc.
// The channel names are unchanged; scripts/test-ipc-contract.mjs is what proves it.
import type { IpcContext } from './context';
import type { ArchiveItemInput, ArchiveEntryCreateInput, ArchiveIngestSummary, ArchiveListOptions, ZoteroArchiveEntryImportInput } from '@shared/types';
import { createFolder, listFolders, renameFolder, deleteFolder, listItemFolders, setItemFolders, createItem, getItemBlob, listItems, updateItem, deleteItem, addTag, removeTag, listTags, archiveCounts, linkItemPerson, unlinkItemPerson, listItemsForPerson } from '../db/archiveRepo';
import { ingestArchiveFile, replaceArchiveFile } from '../archive/archiveIngest';
import { scanArchiveTextRecords } from '../ai/recordsScan';
import { analyzeImageBytes } from '../ai/imageAnalysis';
import { isVisionMime } from '@shared/imageAnalysis';
import { embedArchiveItem, embedArchiveBacklog, archiveIndexStatus, suggestPersonsForItem, suggestDocumentsForPerson } from '../archive/archiveDiscovery';
import fs from 'node:fs';
import { showImportOpenDialog } from '../privacy';
import { getSettings } from '../db/settingsRepo';
import * as zotero from '../zotero/zoteroClient';
import { getItem } from '../db/archiveRepo';

export function registerArchiveIpc({ h, getWindow }: IpcContext): void {
  // Archive → person link discovery (proposals only)
  h('archive:suggestPersonsForItem', async (_e, itemId: string) => suggestPersonsForItem(itemId));
  h('archive:suggestDocumentsForPerson', async (_e, personId: string) => suggestDocumentsForPerson(personId));
  h('archive:index', async () => embedArchiveBacklog());
  h('archive:indexStatus', async () => archiveIndexStatus());
  // ── Evidence archive ───────────────────────────────────────────────────────
  const createArchiveEntries = async (
    input: ArchiveEntryCreateInput,
    filePaths: string[] = input.paths ?? []
  ): Promise<ArchiveIngestSummary> => {
    const paths = [...new Set(filePaths.filter((filePath) => typeof filePath === 'string' && filePath.trim()))];
    const settings = getSettings();
    const ocr = { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages };
    const visionModel = settings.visionModel ?? settings.extractionModel ?? settings.synthesisModel ?? null;
    let added = 0;
    let duplicates = 0;
    const items = [];

    if (paths.length === 0) {
      const item = createItem({
        title: input.title.trim() || 'Entrada sin título',
        kind: 'text',
        folderId: input.folderIds?.[0] ?? null,
        description: input.description?.trim() || null,
        source: input.source?.trim() || null,
        extractedText: input.extractedText?.trim() || null,
        docType: input.docType ?? null,
        metadata: input.metadata ?? null,
        tags: input.tags,
      });
      setItemFolders(item.itemId, input.folderIds ?? []);
      for (const personId of input.personIds ?? []) linkItemPerson(item.itemId, personId);
      items.push(getItem(item.itemId) ?? item);
      added = 1;
    } else {
      for (const filePath of paths) {
        const result = await ingestArchiveFile(filePath, {
          folderId: input.folderIds?.[0] ?? null,
          title: paths.length === 1 ? input.title.trim() || undefined : undefined,
          tags: input.tags,
          ocr,
          visionModel,
          docType: input.docType ?? null,
        });
        if (result.duplicate) {
          duplicates += 1;
          items.push(result.item);
          continue;
        }
        added += 1;
        const updated = updateItem(result.item.itemId, {
          description: input.description?.trim() || result.item.description,
          source: input.source?.trim() || null,
          extractedText: input.extractedText?.trim() || result.item.extractedText,
          docType: input.docType ?? null,
          metadata: input.metadata ?? null,
        }) ?? result.item;
        setItemFolders(updated.itemId, input.folderIds ?? []);
        for (const personId of input.personIds ?? []) linkItemPerson(updated.itemId, personId);
        items.push(getItem(updated.itemId) ?? updated);
      }
    }
    void embedArchiveBacklog().catch(() => undefined);
    return { added, duplicates, items };
  };

  h('archive:counts', async () => archiveCounts());
  h('archive:listFolders', async () => listFolders());
  h('archive:createFolder', async (_e, name: string, parentId?: string | null) => createFolder(name, parentId ?? null));
  h('archive:renameFolder', async (_e, id: string, name: string) => renameFolder(id, name));
  h('archive:deleteFolder', async (_e, id: string) => {
    deleteFolder(id);
  });
  h('archive:listItemFolders', async (_e, itemId: string) => listItemFolders(itemId));
  h('archive:setItemFolders', async (_e, itemId: string, folderIds: string[]) => setItemFolders(itemId, folderIds));
  h('archive:listItems', async (_e, opts?: ArchiveListOptions) => listItems(opts ?? {}));
  h('archive:getItem', async (_e, id: string) => getItem(id));
  h('archive:getItemBlob', async (_e, id: string) => getItemBlob(id));
  h('archive:createItem', async (_e, input: ArchiveItemInput) => createItem(input));
  h('archive:updateItem', async (_e, id: string, patch: Partial<ArchiveItemInput>) => updateItem(id, patch));
  h('archive:deleteItem', async (_e, id: string) => {
    deleteItem(id);
  });
  h('archive:addTag', async (_e, id: string, tag: string) => {
    addTag(id, tag);
  });
  h('archive:removeTag', async (_e, id: string, tag: string) => {
    removeTag(id, tag);
  });
  h('archive:listTags', async () => listTags());
  h('archive:linkPerson', async (_e, itemId: string, personId: string) => {
    linkItemPerson(itemId, personId);
  });
  h('archive:unlinkPerson', async (_e, itemId: string, personId: string) => {
    unlinkItemPerson(itemId, personId);
  });
  h('archive:listItemsForPerson', async (_e, personId: string) => listItemsForPerson(personId));
  h('archive:scanItem', async (_e, itemId: string) => {
    const item = getItem(itemId);
    if (!item) throw new Error('Elemento no encontrado.');
    if (!item.extractedText || !item.extractedText.trim()) {
      return { persons: 0, places: 0, events: 0, evidence: 0, noText: true };
    }
    const settings = getSettings();
    const model = settings.extractionModel ?? settings.synthesisModel ?? undefined;
    const result = await scanArchiveTextRecords(itemId, item.extractedText, model);
    // Index the item so it can be discovered semantically (best-effort).
    await embedArchiveItem(itemId).catch(() => false);
    return { ...result, noText: false };
  });
  h('archive:pickAndIngest', async (_e, folderId?: string | null, docType?: string | null) => {
    const win = getWindow();
    const picked = await showImportOpenDialog(win ?? undefined!, {
      title: 'Añadir al archivo de evidencias',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Documentos y datos', extensions: ['pdf', 'epub', 'txt', 'md', 'csv', 'xlsx'] },
        { name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'webp', 'bmp'] },
        { name: 'Todos los archivos', extensions: ['*'] },
      ],
    });
    if (picked.canceled || picked.filePaths.length === 0) return { added: 0, duplicates: 0, items: [] };
    const settings = getSettings();
    const ocr = { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages };
    const visionModel = settings.visionModel ?? settings.extractionModel ?? settings.synthesisModel ?? null;
    let added = 0;
    let duplicates = 0;
    const items = [];
    for (const filePath of picked.filePaths) {
      const result = await ingestArchiveFile(filePath, { folderId: folderId ?? null, ocr, visionModel, docType: docType ?? null });
      if (result.duplicate) duplicates++;
      else added++;
      items.push(result.item);
    }
    // Index the freshly ingested text for semantic discovery, in the background.
    void embedArchiveBacklog().catch(() => undefined);
    return { added, duplicates, items };
  });
  h('archive:chooseEntryFiles', async () => {
    const picked = await showImportOpenDialog(getWindow() ?? undefined!, {
      title: 'Adjuntar archivos a la entrada genealógica',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Todos los archivos', extensions: ['*'] }],
    });
    return picked.canceled ? [] : picked.filePaths;
  });
  h('archive:createEntry', async (_e, input: ArchiveEntryCreateInput) => createArchiveEntries(input));
  h('archive:importZoteroEntry', async (_e, input: ZoteroArchiveEntryImportInput) => {
    const { zoteroUserId } = getSettings();
    const canonicalItemKey = input.library.type === 'group' ? `groups:${input.library.id}:${input.itemKey}` : input.itemKey;
    const item = await zotero.getItem(zoteroUserId, canonicalItemKey, input.library);
    if (!item) throw new Error('El elemento ya no está disponible en Zotero.');
    const attachments = await zotero.itemAttachments(zoteroUserId, canonicalItemKey, input.library);
    const attachment = attachments.find((candidate) => candidate.itemKey === input.attachmentKey || candidate.key === input.attachmentKey);
    if (!attachment) throw new Error('Elige un adjunto para importarlo a Nodus.');
    const filePath = await zotero.attachmentFilePath(zoteroUserId, attachment.key);
    if (!filePath || !fs.existsSync(filePath)) throw new Error('El adjunto no está descargado en este equipo. Ábrelo o descárgalo primero desde Zotero.');
    return createArchiveEntries({
      ...input,
      title: input.title.trim() || item.title,
      source: input.source?.trim() || item.url || `Zotero · ${item.title}`,
      tags: input.tags?.length ? input.tags : item.tags,
    }, [filePath]);
  });
  // A typed text entry (diary page, note, memoir) with no file to upload.
  h('archive:createTextEntry', async (
    _e,
    input: { title: string; content: string; folderId?: string | null; docType?: string | null; metadata?: Record<string, string> | null; source?: string | null; tags?: string[] }
  ) =>
    createItem({
      title: input.title,
      kind: 'text',
      folderId: input.folderId ?? null,
      extractedText: input.content?.trim() ? input.content : null,
      docType: input.docType ?? null,
      metadata: input.metadata ?? null,
      source: input.source ?? null,
      tags: input.tags,
    })
  );
  h('archive:replaceFile', async (_e, itemId: string) => {
    const item = getItem(itemId);
    if (!item) throw new Error('Elemento no encontrado.');
    const win = getWindow();
    const picked = await showImportOpenDialog(win ?? undefined!, {
      title: 'Reemplazar el archivo adjunto',
      properties: ['openFile'],
      filters: [
        { name: 'Documentos y datos', extensions: ['pdf', 'epub', 'txt', 'md', 'csv', 'xlsx'] },
        { name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'webp', 'bmp'] },
        { name: 'Todos los archivos', extensions: ['*'] },
      ],
    });
    if (picked.canceled || picked.filePaths.length === 0) return { replaced: false, item };
    const settings = getSettings();
    const ocr = { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages };
    const visionModel = settings.visionModel ?? settings.extractionModel ?? settings.synthesisModel ?? null;
    const updated = await replaceArchiveFile(itemId, picked.filePaths[0], { ocr, visionModel });
    if (updated) await embedArchiveItem(itemId).catch(() => false);
    return { replaced: Boolean(updated), item: updated ?? item };
  });
  h('archive:analyzeItem', async (_e, itemId: string) => {
    const item = getItem(itemId);
    if (!item) throw new Error('Elemento no encontrado.');
    if (item.kind !== 'image' || !isVisionMime(item.mimeType)) return { unsupported: true, description: null };
    const blob = getItemBlob(itemId);
    if (!blob) return { unsupported: true, description: null };
    const settings = getSettings();
    const model = settings.visionModel ?? settings.extractionModel ?? settings.synthesisModel ?? null;
    if (!model) throw new Error('No hay un modelo de visión configurado. Elígelo en Ajustes.');
    const analysis = await analyzeImageBytes(blob, item.mimeType!, model);
    if (!analysis) return { unsupported: true, description: null };
    updateItem(itemId, {
      description: analysis.description || null,
      extractedText: analysis.text.trim() ? analysis.text : item.extractedText,
    });
    await embedArchiveItem(itemId).catch(() => false);
    return { unsupported: false, description: analysis.description || null };
  });
}
