import type { ArchiveItemFile } from '@shared/archiveTypes';

/** Stable URL for Chromium's range-aware, database-backed preservation protocol. */
export function archiveFileUrl(
  file: Pick<ArchiveItemFile, 'fileId' | 'contentHash' | 'createdAt'>
): string {
  const revision = file.contentHash || file.createdAt;
  return `nodus-archive://file/${encodeURIComponent(file.fileId)}?v=${encodeURIComponent(revision)}`;
}
