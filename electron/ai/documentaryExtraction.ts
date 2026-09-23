import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { LibrarySourceMap } from '@shared/libraryTypes';
import { LibraryDiskStore } from '../library/libraryStorage';
import { extractLibraryItemInWorker, libraryExtractionWorkerAvailable } from '../library/libraryExtractionWorkerHost';
import { itemChildren, attachmentFilePath, itemAsAttachment } from '../zotero/zoteroClient';

/** Preserve physical anchors only when the extraction map matches these bytes. */
export function documentarySourceText(markdown: string, map: LibrarySourceMap | null, marker: string): string {
  if (!map || map.reader.sha256 !== createHash('sha256').update(markdown).digest('hex')) return `[[src:${marker}]]\n${markdown}`;
  let position = 0;
  const parts: string[] = [];
  for (const block of [...map.blocks].sort((a, b) => a.markdown.start - b.markdown.start)) {
    const start = block.markdown.start;
    if (!Number.isInteger(start) || start < position || start > markdown.length) continue;
    const page = block.anchors[0]?.page;
    parts.push(markdown.slice(position, start), `\n[[src:${marker}${Number.isInteger(page) && page > 0 ? ` p. ${page}` : ''}]]\n`);
    position = start;
  }
  parts.push(markdown.slice(position));
  return parts.join('');
}

export function readDocumentarySourceMap(folder: string, relativePath = 'source-map.json'): LibrarySourceMap | null {
  try {
    const root = fs.realpathSync(folder);
    const target = fs.realpathSync(path.resolve(folder, relativePath));
    if (!target.startsWith(`${root}${path.sep}`)) return null;
    const result = JSON.parse(fs.readFileSync(target, 'utf8')) as LibrarySourceMap;
    return result.version === 1 && Array.isArray(result.blocks) && result.reader?.sha256 ? result : null;
  } catch { return null; }
}

async function fileHash(filename: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const data of fs.createReadStream(filename)) hash.update(data);
  return hash.digest('hex');
}

/** Use the existing clean-document worker in a disposable staging store. This
 * creates no Global Library item or vault migration and never discovers storage
 * directories: every input path comes from an authorized Zotero attachment. */
export async function extractTraditionalResearchWork(userId: string, key: string, itemType: string, signal?: AbortSignal): Promise<{ text: string; sourceMap: Record<string, string> }> {
  if (!libraryExtractionWorkerAvailable()) throw new Error('documentary_extraction_worker_unavailable');
  signal?.throwIfAborted();
  const attachments = itemType === 'attachment' ? [await itemAsAttachment(userId, key)].filter(item => item != null) : await itemChildren(userId, key, signal);
  const stagingParent = path.join(app.getPath('userData'), 'documentary', 'staging');
  await fs.promises.mkdir(stagingParent, { recursive: true });
  const root = await fs.promises.mkdtemp(path.join(stagingParent, 'extract-'));
  const store = new LibraryDiskStore(root, 'documentary-extraction');
  const texts: string[] = [];
  const sourceMap: Record<string, string> = {};
  try {
    for (const attachment of attachments) {
      signal?.throwIfAborted();
      if (!attachment || !attachment.contentType || !/^(application\/(pdf|epub\+zip|vnd.openxmlformats-officedocument.wordprocessingml.document)|text\/)/.test(attachment.contentType)) continue;
      const source = await attachmentFilePath(userId, attachment.key, attachment.library, signal);
      if (!source) continue;
      const stat = await fs.promises.stat(source);
      if (stat.size > 256 * 1024 * 1024) throw new Error('documentary_attachment_too_large');
      const id = randomUUID();
      const folder = store.itemFolder(id);
      await fs.promises.mkdir(folder, { recursive: true });
      const relativePath = `source${path.extname(source)}`;
      const staged = path.join(folder, relativePath);
      const before = await fileHash(source);
      await fs.promises.copyFile(source, staged, fs.constants.COPYFILE_EXCL);
      if (before !== await fileHash(staged)) throw new Error('research_source_revision_changed');
      const item = store.upsertItem({ id, storageId: id, source: 'nodus', metadata: { title: attachment.title, itemType: 'document', creators: [] }, collectionIds: [],
        attachments: [{ id: attachment.key, title: attachment.title, fileName: relativePath, relativePath, mimeType: attachment.contentType,
          byteSize: stat.size, sha256: before, role: 'original', sourceKey: attachment.key, sourceVersion: attachment.version }] });
      const result = await extractLibraryItemInWorker({ item, store, signal, extractionOptions: { ocrMode: 'off', maxOcrPages: 0 } });
      if (before !== await fileHash(source)) throw new Error('research_source_revision_changed');
      const markdown = await fs.promises.readFile(path.join(folder, result.item.files?.reader ?? 'reader.md'), 'utf8');
      const marker = `attachment-${texts.length}`;
      sourceMap[marker] = `zotero:${attachment.library.type}:${attachment.library.id}:${attachment.key}`;
      texts.push(documentarySourceText(markdown, result.sourceMap, marker));
    }
    return { text: texts.join('\n\n'), sourceMap };
  } finally { await fs.promises.rm(root, { recursive: true, force: true }); }
}
