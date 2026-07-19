import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ShareMenu, type BrowserWindow } from 'electron';
import type {
  ProtectArtifact,
  ProtectArtifactFormat,
  ProtectFilePayload,
  ProtectListSourcesRequest,
  ProtectShareResult,
  ProtectSourceRef,
  ProtectSourceSummary,
} from '@shared/types';
import { PROTECT_INPUT_EXTENSIONS } from '@shared/protectTypes';
import { getDb } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import * as archive from '../db/archiveRepo';
import * as study from '../db/studyMaterialsRepo';
import * as databases from '../db/databasesRepo';
import * as protectCopies from '../db/protectCopiesRepo';
import * as zotero from '../zotero/zoteroClient';
import { getActiveVault } from '../vaults/vaultRegistry';

const allowedDiskPaths = new Set<string>();
const allowedVaultRefs = new Set<string>();
const allowedZoteroPaths = new Map<string, string>();
const SUPPORTED = new Set<string>(PROTECT_INPUT_EXTENSIONS);
const SUPPORTED_MIMES = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'image/bmp', 'image/heic', 'image/heif',
]);

function extension(fileName: string): string {
  return path.extname(fileName).slice(1).toLowerCase();
}

function compatible(name: string, mimeType = ''): boolean {
  const normalized = mimeType.toLowerCase().split(';')[0].trim();
  return SUPPORTED.has(extension(name)) && (!normalized || normalized === 'application/octet-stream' || SUPPORTED_MIMES.has(normalized));
}

function signatureMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-') return 'application/pdf';
  if (bytes.length >= 8 && bytes[0] === 0x89 && String.fromCharCode(...bytes.slice(1, 4)) === 'PNG') return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(String.fromCharCode(...bytes.slice(0, 6)))) return 'image/gif';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  if (isHeic(bytes)) return 'image/heic';
  return null;
}

function detectMime(bytes: Uint8Array, fileName: string, declared = ''): string | null {
  const signature = signatureMime(bytes);
  if (signature) return signature;
  const ext = extension(fileName);
  const fallback: Record<string, string> = {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', heic: 'image/heic', heif: 'image/heif',
  };
  return fallback[ext] ?? (SUPPORTED_MIMES.has(declared.toLowerCase()) ? declared.toLowerCase() : null);
}

function equivalentMime(a: string, b: string): boolean {
  if (a === b) return true;
  return (a === 'image/heic' || a === 'image/heif') && (b === 'image/heic' || b === 'image/heif');
}

function expectedMimesForExtension(ext: string): string[] {
  if (ext === 'jpg' || ext === 'jpeg') return ['image/jpeg'];
  if (ext === 'heic' || ext === 'heif') return ['image/heic', 'image/heif'];
  return [{ pdf: 'application/pdf', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }[ext] ?? ''];
}

function validateFileIdentity(bytes: Uint8Array, fileName: string, declared = ''): string {
  const ext = extension(fileName);
  if (!SUPPORTED.has(ext)) throw new Error(`La extensión de ${path.basename(fileName)} no es compatible.`);
  const actual = signatureMime(bytes);
  if (!actual) throw new Error(`La firma real de ${path.basename(fileName)} no corresponde a un formato compatible.`);
  if (!expectedMimesForExtension(ext).some((mime) => equivalentMime(mime, actual))) {
    throw new Error(`La extensión y el contenido real de ${path.basename(fileName)} no coinciden.`);
  }
  const normalizedDeclared = declared.toLowerCase().split(';')[0].trim();
  if (SUPPORTED_MIMES.has(normalizedDeclared) && !equivalentMime(normalizedDeclared, actual)) {
    throw new Error(`El tipo MIME declarado y el contenido real de ${path.basename(fileName)} no coinciden.`);
  }
  return actual;
}

function isHeic(bytes: Uint8Array): boolean {
  if (bytes.length < 12 || String.fromCharCode(...bytes.slice(4, 8)) !== 'ftyp') return false;
  return ['heic', 'heix', 'heif', 'hevc', 'mif1', 'msf1', 'heim', 'heis', 'hevm', 'hevs']
    .includes(String.fromCharCode(...bytes.slice(8, 12)));
}

async function normalizeHeic(bytes: Buffer): Promise<{ bytes: Uint8Array; mimeType: string }> {
  let decode: any;
  try {
    const module: any = await import('heic-decode');
    decode = module.default ?? module;
  } catch {
    throw new Error('El decodificador HEIC no está disponible.');
  }
  const decoded = await decode({ buffer: bytes });
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(decoded.width, decoded.height);
  const context = canvas.getContext('2d');
  const imageData = context.createImageData(decoded.width, decoded.height);
  imageData.data.set(new Uint8Array(decoded.data.buffer ?? decoded.data));
  context.putImageData(imageData, 0, 0);
  return { bytes: new Uint8Array(canvas.toBuffer('image/png')), mimeType: 'image/png' };
}

function ensureActiveVault(ref: Exclude<ProtectSourceRef, { kind: 'disk' }>): void {
  if (ref.vaultId !== getActiveVault().id) throw new Error('La fuente pertenece a otra bóveda. Vuelve a seleccionarla.');
}

function requiredId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error(`${label} no válido.`);
  return value;
}

function validateSourceRef(value: unknown): ProtectSourceRef {
  if (!value || typeof value !== 'object') throw new Error('Referencia de fuente no válida.');
  const ref = value as Record<string, unknown>;
  const kind = ref.kind;
  if (kind === 'disk') return { kind, path: requiredId(ref.path, 'Ruta') };
  const vaultId = requiredId(ref.vaultId, 'Bóveda');
  if (kind === 'zotero-attachment') return { kind, vaultId, attachmentKey: requiredId(ref.attachmentKey, 'Adjunto'), itemKey: requiredId(ref.itemKey, 'Elemento') };
  if (kind === 'archive-item') return { kind, vaultId, itemId: requiredId(ref.itemId, 'Documento') };
  if (kind === 'study-material') return { kind, vaultId, materialId: requiredId(ref.materialId, 'Material') };
  if (kind === 'database-attachment') return { kind, vaultId, attachmentId: requiredId(ref.attachmentId, 'Adjunto') };
  if (kind === 'protect-copy') return { kind, vaultId, copyId: requiredId(ref.copyId, 'Copia') };
  throw new Error('Tipo de fuente no válido.');
}

function sourceRefKey(ref: ProtectSourceRef): string {
  return JSON.stringify(ref);
}

/** Drop every renderer capability tied to the previous active vault. */
export function invalidateProtectVaultReferences(): void {
  allowedVaultRefs.clear();
  allowedZoteroPaths.clear();
}

function diskSummary(filePath: string): ProtectSourceSummary {
  const resolved = path.resolve(filePath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error('La ruta seleccionada no es un archivo.');
  const sample = fs.readFileSync(resolved).subarray(0, 32);
  const mimeType = validateFileIdentity(sample, resolved);
  allowedDiskPaths.add(resolved);
  return {
    ref: { kind: 'disk', path: resolved },
    name: path.basename(resolved),
    title: path.basename(resolved),
    mimeType,
    bytes: stat.size,
    originLabel: 'Disco',
    available: true,
    unavailableReason: null,
  };
}

export function registerProtectDiskSources(paths: string[]): ProtectSourceSummary[] {
  const summaries: ProtectSourceSummary[] = [];
  for (const value of [...new Set(paths)]) {
    if (typeof value !== 'string' || !value.trim()) continue;
    summaries.push(diskSummary(value));
  }
  return summaries;
}

interface RawSourceRow {
  id: string;
  name: string;
  title: string;
  mime: string | null;
  bytes: number;
  origin: string;
}

function likeQuery(query: string): string {
  return `%${query.replace(/[\\%_]/g, '\\$&')}%`;
}

async function listZoteroSources(query: string, limit: number, vaultId: string): Promise<ProtectSourceSummary[]> {
  const rows = getDb().prepare(
    `SELECT zotero_key AS item_key, title FROM works
     WHERE archived = 0 AND zotero_key IS NOT NULL AND (? = '' OR title LIKE ? ESCAPE '\\')
     ORDER BY title LIMIT ?`,
  ).all(query, likeQuery(query), Math.min(limit, 40)) as Array<{ item_key: string; title: string }>;
  const userId = getSettings().zoteroUserId;
  const nested = await Promise.all(rows.map(async (row) => {
    const attachments = await zotero.itemAttachments(userId, row.item_key).catch(() => []);
    return Promise.all(attachments.filter((attachment) => compatible(attachment.filename ?? attachment.title, attachment.contentType ?? '')).map(async (attachment) => {
      const filePath = await zotero.attachmentFilePath(userId, attachment.key).catch(() => null);
      const available = Boolean(filePath && fs.existsSync(filePath));
      const size = available ? fs.statSync(filePath!).size : 0;
      const ref = { kind: 'zotero-attachment', vaultId, attachmentKey: attachment.key, itemKey: row.item_key } as const;
      if (available) allowedZoteroPaths.set(sourceRefKey(ref), filePath!);
      return {
        ref,
        name: attachment.filename ?? attachment.title,
        title: row.title,
        mimeType: attachment.contentType ?? detectMime(new Uint8Array(), attachment.filename ?? '') ?? 'application/octet-stream',
        bytes: size,
        originLabel: 'Zotero',
        available,
        unavailableReason: available ? null : 'El adjunto no está descargado en este equipo.',
      } satisfies ProtectSourceSummary;
    }));
  }));
  return nested.flat().slice(0, limit);
}

export async function listProtectVaultSources(request: ProtectListSourcesRequest = {}): Promise<ProtectSourceSummary[]> {
  if (!request || typeof request !== 'object') throw new Error('Consulta de fuentes no válida.');
  if (request.query != null && (typeof request.query !== 'string' || request.query.length > 300)) throw new Error('Consulta de fuentes no válida.');
  if (request.limit != null && (!Number.isInteger(request.limit) || request.limit < 1)) throw new Error('Límite de fuentes no válido.');
  const query = request.query?.trim() ?? '';
  const limit = Math.min(200, Math.max(1, request.limit ?? 100));
  const vaultId = getActiveVault().id;
  const output: ProtectSourceSummary[] = [];

  for (const copy of protectCopies.listProtectCopies(query)) {
    const available = compatible(copy.fileName, copy.mimeType);
    output.push({
      ref: { kind: 'protect-copy', vaultId, copyId: copy.id }, name: copy.fileName, title: copy.fileName,
      mimeType: copy.mimeType, bytes: copy.bytes, originLabel: 'Nodus Protect', available,
      unavailableReason: available ? null : 'Esta copia puede descargarse, pero su formato no se puede reutilizar como documento de entrada.',
    });
  }

  const archiveRows = getDb().prepare(
    `SELECT item_id AS id, COALESCE(file_name, title) AS name, title, mime_type AS mime,
      bytes, 'Archivo' AS origin FROM archive_items
     WHERE blob IS NOT NULL AND (? = '' OR title LIKE ? ESCAPE '\\' OR file_name LIKE ? ESCAPE '\\')
     ORDER BY updated_at DESC LIMIT ?`,
  ).all(query, likeQuery(query), likeQuery(query), limit) as RawSourceRow[];
  for (const row of archiveRows.filter((entry) => compatible(entry.name, entry.mime ?? ''))) {
    output.push({
      ref: { kind: 'archive-item', vaultId, itemId: row.id }, name: row.name, title: row.title,
      mimeType: row.mime ?? detectMime(new Uint8Array(), row.name) ?? 'application/octet-stream', bytes: row.bytes,
      originLabel: row.origin, available: true, unavailableReason: null,
    });
  }

  const studyRows = getDb().prepare(
    `SELECT id, COALESCE(file_name, title) AS name, title, mime_type AS mime,
      size_bytes AS bytes, 'Materiales' AS origin FROM study_materials
     WHERE content_blob IS NOT NULL AND deleted_at IS NULL
       AND (? = '' OR title LIKE ? ESCAPE '\\' OR file_name LIKE ? ESCAPE '\\')
     ORDER BY updated_at DESC LIMIT ?`,
  ).all(query, likeQuery(query), likeQuery(query), limit) as RawSourceRow[];
  for (const row of studyRows.filter((entry) => compatible(entry.name, entry.mime ?? ''))) {
    output.push({
      ref: { kind: 'study-material', vaultId, materialId: row.id }, name: row.name, title: row.title,
      mimeType: row.mime ?? detectMime(new Uint8Array(), row.name) ?? 'application/octet-stream', bytes: row.bytes,
      originLabel: row.origin, available: true, unavailableReason: null,
    });
  }

  const databaseRows = getDb().prepare(
    `SELECT a.id, COALESCE(a.file_name, 'Adjunto') AS name,
      d.name || ' · fila ' || substr(r.id, 1, 8) || ' · ' || COALESCE(c.name, 'Adjunto') AS title, a.mime_type AS mime,
      a.bytes, 'Bases de datos' AS origin
     FROM db_attachments a
     JOIN db_rows r ON r.id = a.row_id
     JOIN db_databases d ON d.id = r.database_id
     LEFT JOIN db_columns c ON c.id = a.column_id
     WHERE a.blob IS NOT NULL AND (? = '' OR a.file_name LIKE ? ESCAPE '\\' OR d.name LIKE ? ESCAPE '\\')
     ORDER BY a.created_at DESC LIMIT ?`,
  ).all(query, likeQuery(query), likeQuery(query), limit) as RawSourceRow[];
  for (const row of databaseRows.filter((entry) => compatible(entry.name, entry.mime ?? ''))) {
    output.push({
      ref: { kind: 'database-attachment', vaultId, attachmentId: row.id }, name: row.name, title: row.title,
      mimeType: row.mime ?? detectMime(new Uint8Array(), row.name) ?? 'application/octet-stream', bytes: row.bytes,
      originLabel: row.origin, available: true, unavailableReason: null,
    });
  }

  if (getActiveVault().type === 'academic') {
    output.push(...await listZoteroSources(query, limit, vaultId));
  }
  const result = output.slice(0, limit);
  for (const source of result) allowedVaultRefs.add(sourceRefKey(source.ref));
  return result;
}

async function payload(name: string, declaredMime: string, bytes: Buffer, ref: ProtectSourceRef): Promise<ProtectFilePayload> {
  const mimeType = validateFileIdentity(bytes.subarray(0, 32), name, declaredMime);
  if (mimeType === 'image/heic' || mimeType === 'image/heif' || isHeic(bytes)) {
    const normalized = await normalizeHeic(bytes);
    return { ref, name: name.replace(/\.(?:heic|heif)$/i, '.png'), mimeType: normalized.mimeType, bytes: normalized.bytes };
  }
  return { ref, name, mimeType, bytes: new Uint8Array(bytes) };
}

export async function readProtectSource(ref: ProtectSourceRef): Promise<ProtectFilePayload> {
  ref = validateSourceRef(ref);
  if (ref.kind === 'disk') {
    const resolved = path.resolve(ref.path);
    if (!allowedDiskPaths.has(resolved)) throw new Error('Vuelve a seleccionar el archivo desde Nodus Protect.');
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error('El archivo ya no está disponible.');
    return payload(path.basename(resolved), '', fs.readFileSync(resolved), { kind: 'disk', path: resolved });
  }
  ensureActiveVault(ref);
  if (!allowedVaultRefs.has(sourceRefKey(ref))) throw new Error('Vuelve a seleccionar la fuente desde la bóveda activa.');
  if (ref.kind === 'archive-item') {
    const item = archive.getItem(ref.itemId);
    const bytes = archive.getItemBlob(ref.itemId);
    if (!item || !bytes) throw new Error('El documento del Archivo ya no está disponible.');
    return payload(item.fileName ?? item.title, item.mimeType ?? '', bytes, ref);
  }
  if (ref.kind === 'study-material') {
    const content = study.getStudyMaterialContent(ref.materialId);
    return payload(content.fileName, content.mimeType, Buffer.from(content.bytes), ref);
  }
  if (ref.kind === 'database-attachment') {
    const attachment = databases.getAttachment(ref.attachmentId);
    const bytes = databases.getAttachmentBlob(ref.attachmentId);
    if (!attachment || !bytes) throw new Error('El adjunto ya no está disponible.');
    return payload(attachment.fileName ?? 'adjunto', attachment.mimeType ?? '', bytes, ref);
  }
  if (ref.kind === 'protect-copy') {
    const copy = protectCopies.getProtectCopy(ref.copyId);
    const bytes = protectCopies.getProtectCopyBlob(ref.copyId);
    if (!copy || !bytes) throw new Error('La copia protegida ya no está disponible.');
    return payload(copy.fileName, copy.mimeType, bytes, ref);
  }
  const filePath = allowedZoteroPaths.get(sourceRefKey(ref));
  if (!filePath || !fs.existsSync(filePath)) throw new Error('El adjunto no está descargado en este equipo. Ábrelo o descárgalo primero desde Zotero.');
  return payload(path.basename(filePath), '', fs.readFileSync(filePath), ref);
}

const ARTIFACT_TYPES: Record<ProtectArtifactFormat, { mime: string; extension: string }> = {
  pdf: { mime: 'application/pdf', extension: 'pdf' },
  png: { mime: 'image/png', extension: 'png' },
  zip: { mime: 'application/zip', extension: 'zip' },
  csv: { mime: 'text/csv', extension: 'csv' },
};

export function validateProtectArtifact(artifact: ProtectArtifact): ProtectArtifact {
  if (!artifact || !(artifact.bytes instanceof Uint8Array) || !artifact.bytes.length) throw new Error('El archivo generado está vacío.');
  const fileName = path.basename(String(artifact.fileName || 'documento-protegido'));
  if (!fileName || fileName === '.' || fileName === '..') throw new Error('Nombre de archivo no válido.');
  const type = ARTIFACT_TYPES[artifact.format];
  if (!type || artifact.mimeType !== type.mime || extension(fileName) !== type.extension) throw new Error('El formato, MIME y extensión del resultado no coinciden.');
  const validPageCount = artifact.format === 'csv'
    ? artifact.pageCount === 0
    : Number.isInteger(artifact.pageCount) && artifact.pageCount >= 1 && artifact.pageCount <= 1_000_000;
  if (!validPageCount) throw new Error('Número de páginas no válido.');
  const header = artifact.bytes.subarray(0, 8);
  if (artifact.format === 'pdf' && String.fromCharCode(...header.slice(0, 5)) !== '%PDF-') throw new Error('El resultado no contiene un PDF válido.');
  if (artifact.format === 'png' && !(header[0] === 0x89 && String.fromCharCode(...header.slice(1, 4)) === 'PNG')) throw new Error('El resultado no contiene un PNG válido.');
  if (artifact.format === 'zip' && !(header[0] === 0x50 && header[1] === 0x4b)) throw new Error('El resultado no contiene un ZIP válido.');
  return { ...artifact, fileName, bytes: new Uint8Array(artifact.bytes) };
}

export function writeArtifactAtomically(targetPath: string, bytes: Uint8Array): void {
  const directory = path.dirname(targetPath);
  const temp = path.join(directory, `.${path.basename(targetPath)}.nodus-${crypto.randomBytes(6).toString('hex')}.tmp`);
  const backup = path.join(directory, `.${path.basename(targetPath)}.nodus-${crypto.randomBytes(6).toString('hex')}.bak`);
  const descriptor = fs.openSync(temp, 'wx');
  try {
    fs.writeFileSync(descriptor, Buffer.from(bytes));
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }

  try {
    fs.renameSync(temp, targetPath);
    return;
  } catch (initialError) {
    // POSIX replaces an existing target atomically. Windows does not, so retain
    // the previous file as a rollback point instead of copying partial bytes
    // over it. Both renames remain on the same filesystem.
    if (!fs.existsSync(targetPath)) {
      try { fs.unlinkSync(temp); } catch { /* best-effort cleanup */ }
      throw initialError;
    }
  }

  try {
    fs.renameSync(targetPath, backup);
    try {
      fs.renameSync(temp, targetPath);
    } catch (replaceError) {
      try { fs.renameSync(backup, targetPath); } catch { /* preserve the backup below */ }
      throw replaceError;
    }
    try { fs.unlinkSync(backup); } catch { /* the completed result is already durable */ }
  } catch (error) {
    try { fs.unlinkSync(temp); } catch { /* best-effort cleanup */ }
    throw error;
  }
}

export function saveProtectCopy(artifact: ProtectArtifact) {
  return protectCopies.saveProtectCopy(validateProtectArtifact(artifact));
}

export function listProtectCopies(query = '') {
  return protectCopies.listProtectCopies(query);
}

export function deleteProtectCopy(id: string): void {
  protectCopies.deleteProtectCopy(requiredId(id, 'Copia'));
}

export function getProtectCopyArtifact(id: string): ProtectArtifact {
  const copyId = requiredId(id, 'Copia');
  const copy = protectCopies.getProtectCopy(copyId);
  const bytes = protectCopies.getProtectCopyBlob(copyId);
  if (!copy || !bytes) throw new Error('La copia protegida ya no está disponible.');
  const format: ProtectArtifactFormat = copy.mimeType === 'application/pdf' ? 'pdf'
    : copy.mimeType === 'application/zip' ? 'zip'
      : copy.mimeType === 'text/csv' ? 'csv' : 'png';
  return validateProtectArtifact({ fileName: copy.fileName, mimeType: copy.mimeType, format, pageCount: format === 'csv' ? 0 : 1, bytes: new Uint8Array(bytes) });
}

export async function shareProtectArtifact(artifactInput: ProtectArtifact, window: BrowserWindow | null): Promise<ProtectShareResult> {
  const artifact = validateProtectArtifact(artifactInput);
  if (process.platform !== 'darwin' || !window) {
    return { shared: false, canceled: false, fallbackRequired: true, message: null };
  }
  try {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-protect-share-'));
    const filePath = path.join(directory, artifact.fileName);
    fs.writeFileSync(filePath, Buffer.from(artifact.bytes));
    new ShareMenu({ filePaths: [filePath] }).popup({ window });
    return { shared: true, canceled: false, fallbackRequired: false, message: null };
  } catch (error) {
    return {
      shared: false, canceled: false, fallbackRequired: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
