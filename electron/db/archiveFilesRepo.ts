import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuid } from 'uuid';
import type { ArchiveFileRole, ArchiveItemFile } from '@shared/archiveTypes';
import { validateArchiveFile } from '@shared/archiveTypes';
import type {
  PrimarySourceFileImportInput,
  PrimarySourceFileMetadataPatch,
} from '@shared/primarySourcesTypes';
import { recordArchiveAudit } from './archiveAuditRepo';
import { makeThumbnail } from './attachmentThumb';
import { getDb } from './database';

const now = () => new Date().toISOString();
const id = () => `aif_${uuid()}`;
const json = (value: Record<string, unknown> | null | undefined) => value ? JSON.stringify(value) : null;
const parseObject = (value: string | null): Record<string, unknown> | null => {
  try {
    const parsed = value ? JSON.parse(value) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

export function archiveMimeForPath(filePath: string): string {
  return MIME_BY_EXTENSION[path.extname(filePath).slice(1).toLocaleLowerCase()]
    ?? 'application/octet-stream';
}

type FileRow = {
  file_id: string; item_id: string; parent_file_id: string | null; role: ArchiveFileRole;
  version_no: number; sequence_no: number; page_label: string | null; original_file_name: string | null;
  mime_type: string | null; byte_size: number; has_content: number; external_path: string | null;
  content_hash: string | null; hash_algorithm: 'sha256' | null; transformation_json: string | null;
  capture_metadata_json: string | null; created_by: string | null; created_at: string;
  verified_at: string | null; verification_status: ArchiveItemFile['verificationStatus']; superseded_at: string | null;
};

const FILE_COLUMNS = `file_id, item_id, parent_file_id, role, version_no, sequence_no,
  page_label, original_file_name, mime_type, byte_size, (content_blob IS NOT NULL) AS has_content,
  external_path, content_hash, hash_algorithm, transformation_json, capture_metadata_json,
  created_by, created_at, verified_at, verification_status, superseded_at`;

function fileFromRow(row: FileRow): ArchiveItemFile {
  return {
    fileId: row.file_id, itemId: row.item_id, parentFileId: row.parent_file_id, role: row.role,
    versionNo: row.version_no, sequenceNo: row.sequence_no, pageLabel: row.page_label,
    originalFileName: row.original_file_name, mimeType: row.mime_type, byteSize: row.byte_size,
    hasContent: Boolean(row.has_content), externalPath: row.external_path, contentHash: row.content_hash,
    hashAlgorithm: row.hash_algorithm, transformation: parseObject(row.transformation_json),
    captureMetadata: parseObject(row.capture_metadata_json), createdBy: row.created_by,
    createdAt: row.created_at, verifiedAt: row.verified_at,
    verificationStatus: row.verification_status, supersededAt: row.superseded_at,
  };
}

export interface ArchiveFileCreateInput {
  itemId: string;
  role: ArchiveFileRole;
  parentFileId?: string | null;
  versionNo?: number;
  sequenceNo?: number;
  pageLabel?: string | null;
  originalFileName?: string | null;
  mimeType?: string | null;
  content?: Uint8Array | null;
  externalPath?: string | null;
  transformation?: Record<string, unknown> | null;
  captureMetadata?: Record<string, unknown> | null;
  createdBy?: string | null;
}

export function createArchiveFile(input: ArchiveFileCreateInput): ArchiveItemFile {
  const db = getDb();
  const content = input.content ? Buffer.from(input.content) : null;
  const parent = input.parentFileId ? getArchiveFile(input.parentFileId) : null;
  if (input.parentFileId && (!parent || parent.itemId !== input.itemId)) {
    throw new Error('El archivo padre no pertenece a la misma fuente.');
  }
  const versionNo = input.versionNo ?? (
    (db.prepare(
      'SELECT COALESCE(MAX(version_no), 0) AS value FROM archive_item_files WHERE item_id=? AND role=? AND sequence_no=?'
    ).get(input.itemId, input.role, input.sequenceNo ?? 0) as { value: number }).value + 1
  );
  const contentHash = content ? createHash('sha256').update(content).digest('hex') : null;
  const ts = now();
  const candidate: ArchiveItemFile = {
    fileId: id(), itemId: input.itemId, parentFileId: input.parentFileId ?? null,
    role: input.role, versionNo, sequenceNo: input.sequenceNo ?? 0,
    pageLabel: input.pageLabel ?? null, originalFileName: input.originalFileName ?? null,
    mimeType: input.mimeType ?? null, byteSize: content?.byteLength ?? 0, hasContent: Boolean(content),
    externalPath: input.externalPath ?? null, contentHash, hashAlgorithm: content ? 'sha256' : null,
    transformation: input.transformation ?? null, captureMetadata: input.captureMetadata ?? null,
    createdBy: input.createdBy ?? null, createdAt: ts, verifiedAt: content ? ts : null,
    verificationStatus: content ? 'verified' : input.externalPath ? 'pending' : 'missing', supersededAt: null,
  };
  const issues = validateArchiveFile(candidate);
  if (issues.length) throw new Error(`Archivo no válido: ${issues[0].code}`);
  return db.transaction(() => {
    db.prepare(
      `INSERT INTO archive_item_files (
        file_id, item_id, parent_file_id, role, version_no, sequence_no, page_label,
        original_file_name, mime_type, byte_size, content_blob, external_path, content_hash,
        hash_algorithm, transformation_json, capture_metadata_json, created_by, created_at,
        verified_at, verification_status, superseded_at
      ) VALUES (${Array.from({ length: 21 }, () => '?').join(',')})`
    ).run(
      candidate.fileId, candidate.itemId, candidate.parentFileId, candidate.role,
      candidate.versionNo, candidate.sequenceNo, candidate.pageLabel, candidate.originalFileName,
      candidate.mimeType, candidate.byteSize, content, candidate.externalPath,
      candidate.contentHash, candidate.hashAlgorithm, json(candidate.transformation),
      json(candidate.captureMetadata), candidate.createdBy, candidate.createdAt,
      candidate.verifiedAt, candidate.verificationStatus, candidate.supersededAt
    );
    recordArchiveAudit({
      itemId: candidate.itemId,
      fileId: candidate.fileId,
      action: 'file_created',
      createdBy: candidate.createdBy,
      createdAt: candidate.createdAt,
      details: {
        role: candidate.role,
        versionNo: candidate.versionNo,
        sequenceNo: candidate.sequenceNo,
        parentFileId: candidate.parentFileId,
        originalFileName: candidate.originalFileName,
        mimeType: candidate.mimeType,
        byteSize: candidate.byteSize,
        contentHash: candidate.contentHash,
        transformation: candidate.transformation,
      },
    });
    return getArchiveFile(candidate.fileId)!;
  })();
}

export function getArchiveFile(fileId: string): ArchiveItemFile | null {
  const row = getDb().prepare(`SELECT ${FILE_COLUMNS} FROM archive_item_files WHERE file_id=?`).get(fileId) as FileRow | undefined;
  return row ? fileFromRow(row) : null;
}

export function listArchiveFiles(itemId: string): ArchiveItemFile[] {
  return (getDb().prepare(
    `SELECT ${FILE_COLUMNS} FROM archive_item_files WHERE item_id=? ORDER BY sequence_no, role, version_no`
  ).all(itemId) as FileRow[]).map(fileFromRow);
}

/**
 * Return one browser-renderable representation per item without loading BLOBs
 * into JavaScript. Thumbnails win, followed by access copies and image masters.
 */
export function listArchivePreviewFilesByItemIds(itemIds: string[]): ArchiveItemFile[] {
  const uniqueIds = [...new Set(itemIds.filter(Boolean))];
  if (uniqueIds.length === 0) return [];
  const placeholders = uniqueIds.map(() => '?').join(',');
  const candidates = (getDb().prepare(
    `SELECT ${FILE_COLUMNS} FROM archive_item_files
     WHERE item_id IN (${placeholders})
       AND content_blob IS NOT NULL
       AND superseded_at IS NULL
       AND mime_type LIKE 'image/%'
       AND mime_type NOT IN ('image/tiff', 'image/x-tiff')
     ORDER BY item_id,
       CASE role WHEN 'thumbnail' THEN 0 WHEN 'access' THEN 1 WHEN 'master' THEN 2 ELSE 3 END,
       sequence_no,
       version_no DESC,
       created_at DESC`
  ).all(...uniqueIds) as FileRow[]).map(fileFromRow);
  const seen = new Set<string>();
  return candidates.filter((file) => {
    if (seen.has(file.itemId)) return false;
    seen.add(file.itemId);
    return true;
  });
}

export function getArchiveFileBlob(fileId: string): Buffer | null {
  return (getDb().prepare('SELECT content_blob AS blob FROM archive_item_files WHERE file_id=?').get(fileId) as { blob: Buffer | null } | undefined)?.blob ?? null;
}

export interface ArchiveFilePayloadInfo {
  fileId: string;
  itemId: string;
  fileName: string | null;
  mimeType: string;
  byteSize: number;
  contentHash: string | null;
  hasContent: boolean;
}

export function getArchiveFilePayloadInfo(fileId: string): ArchiveFilePayloadInfo | null {
  const row = getDb().prepare(
    `SELECT file_id, item_id, original_file_name, mime_type, byte_size,
      content_hash, content_blob IS NOT NULL AS has_content
     FROM archive_item_files WHERE file_id=?`
  ).get(fileId) as {
    file_id: string;
    item_id: string;
    original_file_name: string | null;
    mime_type: string | null;
    byte_size: number;
    content_hash: string | null;
    has_content: number;
  } | undefined;
  return row ? {
    fileId: row.file_id,
    itemId: row.item_id,
    fileName: row.original_file_name,
    mimeType: row.mime_type || 'application/octet-stream',
    byteSize: row.byte_size,
    contentHash: row.content_hash,
    hasContent: Boolean(row.has_content),
  } : null;
}

/**
 * Read only the requested SQLite BLOB slice. Protocol range requests use this instead
 * of copying an entire large audio/video/PDF object through IPC or into renderer RAM.
 */
export function getArchiveFileBlobSlice(
  fileId: string,
  start: number,
  endExclusive: number
): Buffer | null {
  const safeStart = Math.max(0, Math.trunc(start));
  const safeEnd = Math.max(safeStart, Math.trunc(endExclusive));
  if (safeEnd === safeStart) return Buffer.alloc(0);
  const row = getDb().prepare(
    `SELECT substr(content_blob, ?, ?) AS blob
     FROM archive_item_files
     WHERE file_id=? AND content_blob IS NOT NULL`
  ).get(safeStart + 1, safeEnd - safeStart, fileId) as { blob: Buffer | null } | undefined;
  return row?.blob ?? null;
}

export function createArchiveDerivative(
  parentFileId: string,
  input: Omit<ArchiveFileCreateInput, 'itemId' | 'role' | 'parentFileId'> & { transformation: Record<string, unknown> }
): ArchiveItemFile {
  const parent = getArchiveFile(parentFileId);
  if (!parent) throw new Error('Archivo padre no encontrado.');
  return createArchiveFile({
    ...input, itemId: parent.itemId, role: 'derivative', parentFileId,
    sequenceNo: input.sequenceNo ?? parent.sequenceNo,
  });
}

/** "Replace" means a new master version; the previous row and bytes remain unchanged. */
export function addArchiveMasterVersion(
  itemId: string,
  input: Omit<ArchiveFileCreateInput, 'itemId' | 'role' | 'parentFileId'>,
  supersedesFileId?: string | null
): ArchiveItemFile {
  const db = getDb();
  return db.transaction(() => {
    const superseded = supersedesFileId ? getArchiveFile(supersedesFileId) : null;
    if (supersedesFileId && (!superseded || superseded.itemId !== itemId || superseded.role !== 'master')) {
      throw new Error('La versión anterior no es un máster de esta fuente.');
    }
    const sequenceNo = input.sequenceNo ?? superseded?.sequenceNo ?? 0;
    const created = createArchiveFile({
      ...input,
      itemId,
      role: 'master',
      parentFileId: null,
      sequenceNo,
    });
    recordArchiveAudit({
      itemId,
      fileId: created.fileId,
      action: 'master_version_added',
      createdBy: input.createdBy,
      details: {
        versionNo: created.versionNo,
        sequenceNo,
        supersedesFileId: superseded?.fileId ?? null,
        contentHash: created.contentHash,
      },
    });
    if (superseded) {
      const ts = now();
      db.prepare(
        'UPDATE archive_item_files SET superseded_at=? WHERE file_id=? AND superseded_at IS NULL'
      ).run(ts, superseded.fileId);
      recordArchiveAudit({
        itemId,
        fileId: superseded.fileId,
        action: 'file_superseded',
        createdBy: input.createdBy,
        createdAt: ts,
        details: { supersededByFileId: created.fileId },
      });
    }
    return created;
  })();
}

export function updateArchiveFileMetadata(
  fileId: string,
  patch: PrimarySourceFileMetadataPatch
): ArchiveItemFile {
  const db = getDb();
  const current = getArchiveFile(fileId);
  if (!current) throw new Error('Archivo no encontrado.');
  const sequenceNo = patch.sequenceNo === undefined
    ? current.sequenceNo
    : Math.max(0, Math.trunc(patch.sequenceNo));
  const pageLabel = patch.pageLabel === undefined ? current.pageLabel : patch.pageLabel;
  const beforeAlternativeText = typeof current.captureMetadata?.alternativeText === 'string'
    ? current.captureMetadata.alternativeText
    : null;
  const captureMetadata = { ...(current.captureMetadata ?? {}) };
  if (patch.alternativeText !== undefined) {
    const value = patch.alternativeText?.trim() || null;
    if (value) captureMetadata.alternativeText = value;
    else delete captureMetadata.alternativeText;
  }
  return db.transaction(() => {
    db.prepare(
      `UPDATE archive_item_files
       SET sequence_no=?, page_label=?, capture_metadata_json=?
       WHERE file_id=?`
    ).run(sequenceNo, pageLabel, json(captureMetadata), fileId);
    recordArchiveAudit({
      itemId: current.itemId,
      fileId,
      action: 'file_metadata_updated',
      details: {
        before: {
          sequenceNo: current.sequenceNo,
          pageLabel: current.pageLabel,
          hasAlternativeText: Boolean(beforeAlternativeText),
          alternativeTextLength: beforeAlternativeText?.length ?? 0,
        },
        after: {
          sequenceNo,
          pageLabel,
          hasAlternativeText: Boolean(captureMetadata.alternativeText),
          alternativeTextLength: typeof captureMetadata.alternativeText === 'string'
            ? captureMetadata.alternativeText.length
            : 0,
        },
      },
    });
    return getArchiveFile(fileId)!;
  })();
}

/**
 * Reorder top-level representation groups atomically. Children follow their preserved
 * parent, and a temporary negative range avoids UNIQUE collisions during swaps.
 */
export function reorderArchiveFileGroups(itemId: string, rootFileIds: string[]): ArchiveItemFile[] {
  const db = getDb();
  const all = listArchiveFiles(itemId);
  const byId = new Map(all.map((file) => [file.fileId, file]));
  const roots = all.filter((file) => file.parentFileId === null && !file.supersededAt);
  const unique = [...new Set(rootFileIds)];
  if (
    unique.length !== roots.length
    || unique.some((fileId) => !byId.has(fileId) || byId.get(fileId)?.parentFileId !== null)
  ) {
    throw new Error('La secuencia debe incluir cada archivo raíz exactamente una vez.');
  }
  const rootFor = (file: ArchiveItemFile): ArchiveItemFile => {
    let current = file;
    const seen = new Set<string>();
    while (current.parentFileId) {
      if (seen.has(current.fileId)) throw new Error('El árbol de representaciones contiene un ciclo.');
      seen.add(current.fileId);
      const parent = byId.get(current.parentFileId);
      if (!parent) throw new Error('La representación tiene un archivo padre ausente.');
      current = parent;
    }
    if (current.supersededAt) {
      return roots.find((candidate) =>
        candidate.sequenceNo === current.sequenceNo && candidate.role === current.role
      ) ?? current;
    }
    return current;
  };
  return db.transaction(() => {
    const temporary = db.prepare('UPDATE archive_item_files SET sequence_no=? WHERE file_id=?');
    all.forEach((file, index) => temporary.run(-1_000_000 - index, file.fileId));
    const final = db.prepare('UPDATE archive_item_files SET sequence_no=? WHERE file_id=?');
    const positionByRoot = new Map(unique.map((fileId, index) => [fileId, index]));
    for (const file of all) {
      const sequenceNo = positionByRoot.get(rootFor(file).fileId)!;
      final.run(sequenceNo, file.fileId);
      if (file.sequenceNo !== sequenceNo) {
        recordArchiveAudit({
          itemId,
          fileId: file.fileId,
          action: 'file_metadata_updated',
          details: {
            before: { sequenceNo: file.sequenceNo, pageLabel: file.pageLabel },
            after: { sequenceNo, pageLabel: file.pageLabel },
            reason: 'sequence_reorder',
          },
        });
      }
    }
    return listArchiveFiles(itemId);
  })();
}

export function verifyArchiveFile(fileId: string): ArchiveItemFile | null {
  const db = getDb();
  const current = getArchiveFile(fileId);
  if (!current) return null;
  const blob = getArchiveFileBlob(fileId);
  const observed = blob ? createHash('sha256').update(blob).digest('hex') : null;
  const status = !blob ? 'missing' : observed === current.contentHash ? 'verified' : 'mismatch';
  const ts = now();
  const tx = db.transaction(() => {
    db.prepare('UPDATE archive_item_files SET verified_at=?, verification_status=? WHERE file_id=?').run(ts, status, fileId);
    db.prepare(
      `INSERT INTO archive_integrity_checks (
        check_id, file_id, algorithm, expected_hash, observed_hash, status, checked_at, details
      ) VALUES (?, ?, 'sha256', ?, ?, ?, ?, NULL)`
    ).run(`aic_${uuid()}`, fileId, current.contentHash, observed, status, ts);
    recordArchiveAudit({
      itemId: current.itemId,
      fileId,
      action: 'integrity_checked',
      createdAt: ts,
      details: {
        status,
        expectedHash: current.contentHash,
        observedHash: observed,
      },
    });
  });
  tx();
  return getArchiveFile(fileId);
}

export function verifyArchiveItemFiles(itemId: string): ArchiveItemFile[] {
  const files = listArchiveFiles(itemId);
  for (const file of files) verifyArchiveFile(file.fileId);
  return listArchiveFiles(itemId);
}

export function createArchiveFilesFromPaths(input: PrimarySourceFileImportInput): ArchiveItemFile[] {
  const paths = [...new Set(input.paths.map((candidate) => candidate.trim()).filter(Boolean))];
  if (paths.length === 0) throw new Error('Selecciona al menos un archivo.');
  const parent = input.parentFileId ? getArchiveFile(input.parentFileId) : null;
  if (input.role !== 'master' && input.role !== 'supplement' && !parent) {
    throw new Error('Las copias y derivados deben indicar el archivo del que proceden.');
  }
  if (parent && parent.itemId !== input.itemId) {
    throw new Error('El archivo padre no pertenece a esta fuente.');
  }
  if (input.role === 'derivative' && !input.transformation) {
    throw new Error('Describe la transformación que produjo el derivado.');
  }
  if (input.role === 'master' && paths.length > 1 && input.supersedesFileId) {
    throw new Error('Una sustitución versionada solo puede añadir un máster cada vez.');
  }
  const db = getDb();
  return db.transaction(() => paths.map((filePath, index) => {
    const content = fs.readFileSync(filePath);
    const sequenceNo = (input.sequenceNo ?? parent?.sequenceNo ?? 0) + index;
    const common = {
      sequenceNo,
      pageLabel: paths.length === 1 ? input.pageLabel ?? null : input.pageLabel ?? String(sequenceNo + 1),
      originalFileName: path.basename(filePath),
      mimeType: archiveMimeForPath(filePath),
      content,
      transformation: input.transformation ?? (
        input.role === 'access'
          ? { operation: 'access_copy_import', source: 'user_supplied' }
          : input.role === 'thumbnail'
            ? { operation: 'thumbnail_import', source: 'user_supplied' }
            : null
      ),
      captureMetadata: input.captureMetadata ?? null,
      createdBy: 'primary_sources_user',
    };
    if (input.role === 'master') {
      return addArchiveMasterVersion(input.itemId, common, input.supersedesFileId);
    }
    return createArchiveFile({
      ...common,
      itemId: input.itemId,
      role: input.role,
      parentFileId: input.parentFileId ?? null,
    });
  }))();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function placeholderThumbnail(label: string, mimeType: string): Buffer {
  const short = escapeXml(label.slice(0, 54));
  const mime = escapeXml(mimeType);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
      <rect width="480" height="320" rx="20" fill="#e7e5e4"/>
      <rect x="154" y="48" width="172" height="190" rx="14" fill="#fff" stroke="#a8a29e" stroke-width="4"/>
      <path d="M274 48v52h52" fill="#d6d3d1" stroke="#a8a29e" stroke-width="4"/>
      <text x="240" y="274" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#44403c">${short}</text>
      <text x="240" y="300" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#78716c">${mime}</text>
    </svg>`,
    'utf8'
  );
}

export async function regenerateArchiveThumbnail(parentFileId: string): Promise<ArchiveItemFile> {
  const parent = getArchiveFile(parentFileId);
  if (!parent) throw new Error('Archivo de origen no encontrado.');
  const source = getArchiveFileBlob(parentFileId);
  if (!source) throw new Error('El archivo de origen no está disponible.');
  let content: Buffer;
  let mimeType: string;
  let outputFormat: string;
  const imageThumbnail = makeThumbnail(source, parent.mimeType);
  if (imageThumbnail) {
    content = imageThumbnail;
    mimeType = 'image/jpeg';
    outputFormat = 'jpg';
  } else {
    content = placeholderThumbnail(parent.originalFileName || 'Archivo', parent.mimeType || 'application/octet-stream');
    mimeType = 'image/svg+xml';
    outputFormat = 'svg';
  }
  const db = getDb();
  return db.transaction(() => {
    const ts = now();
    db.prepare(
      `UPDATE archive_item_files
       SET superseded_at=?
       WHERE item_id=? AND role='thumbnail' AND parent_file_id=? AND superseded_at IS NULL`
    ).run(ts, parent.itemId, parent.fileId);
    const thumbnail = createArchiveFile({
      itemId: parent.itemId,
      role: 'thumbnail',
      parentFileId: parent.fileId,
      sequenceNo: parent.sequenceNo,
      pageLabel: parent.pageLabel,
      originalFileName: `${path.parse(parent.originalFileName || 'archivo').name}.thumbnail.${outputFormat}`,
      mimeType,
      content,
      transformation: {
        operation: 'thumbnail',
        engine: 'electron-native-image-or-safe-placeholder',
        maxPixels: 400,
        outputFormat,
        parentHash: parent.contentHash,
        regenerable: true,
      },
      createdBy: 'primary_sources_thumbnail',
    });
    recordArchiveAudit({
      itemId: parent.itemId,
      fileId: thumbnail.fileId,
      action: 'thumbnail_regenerated',
      createdBy: 'primary_sources_thumbnail',
      details: { parentFileId, outputFormat, contentHash: thumbnail.contentHash },
    });
    return thumbnail;
  })();
}
