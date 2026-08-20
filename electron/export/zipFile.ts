import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw, inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_COMMENT_BYTES = 0xffff;
const MAX_CENTRAL_DIRECTORY_BYTES = 64 * 1024 * 1024;

export interface ZipFileEntry {
  name: string;
  method: 0 | 8;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  isDirectory: boolean;
}

async function readExactly(file: fs.promises.FileHandle, length: number, position: number): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await file.read(buffer, offset, length - offset, position + offset);
    if (bytesRead === 0) throw new Error('ZIP truncado.');
    offset += bytesRead;
  }
  return buffer;
}

function readExactlySync(fd: number, length: number, position: number): Buffer {
  const buffer = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const bytesRead = fs.readSync(fd, buffer, offset, length - offset, position + offset);
    if (bytesRead === 0) throw new Error('ZIP truncado.');
    offset += bytesRead;
  }
  return buffer;
}

/**
 * Read one deliberately small entry without loading the archive around it. Recovery
 * folder inspection is synchronous, and used to instantiate AdmZip for every
 * snapshot merely to read manifest.json. With multi-gigabyte snapshots that alone
 * could exhaust memory before restore had even started.
 */
export function readZipEntrySync(
  filePath: string,
  entryName: string,
  maxBytes = 16 * 1024 * 1024,
): Buffer | null {
  const fd = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const tailLength = Math.min(stat.size, MAX_COMMENT_BYTES + 22);
    if (tailLength < 22) throw new Error('ZIP truncado.');
    const tail = readExactlySync(fd, tailLength, stat.size - tailLength);
    let eocd = -1;
    for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
      if (tail.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
      const commentLength = tail.readUInt16LE(offset + 20);
      if (offset + 22 + commentLength === tail.length) { eocd = offset; break; }
    }
    if (eocd < 0) throw new Error('No se encontró el directorio ZIP.');
    const disk = tail.readUInt16LE(eocd + 4);
    const centralDisk = tail.readUInt16LE(eocd + 6);
    const entriesOnDisk = tail.readUInt16LE(eocd + 8);
    const entryCount = tail.readUInt16LE(eocd + 10);
    const centralSize = tail.readUInt32LE(eocd + 12);
    const centralOffset = tail.readUInt32LE(eocd + 16);
    if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
      throw new Error('Los ZIP multidisco no están soportados.');
    }
    if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw new Error('El formato ZIP64 no está soportado por esta versión de Nodus.');
    }
    if (centralSize > MAX_CENTRAL_DIRECTORY_BYTES || centralOffset + centralSize > stat.size) {
      throw new Error('Directorio ZIP inválido.');
    }

    const central = readExactlySync(fd, centralSize, centralOffset);
    let cursor = 0;
    let selected: ZipFileEntry | null = null;
    const names = new Set<string>();
    for (let index = 0; index < entryCount; index += 1) {
      if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
        throw new Error('Directorio ZIP dañado.');
      }
      const flags = central.readUInt16LE(cursor + 8);
      const method = central.readUInt16LE(cursor + 10);
      const compressedSize = central.readUInt32LE(cursor + 20);
      const uncompressedSize = central.readUInt32LE(cursor + 24);
      const nameLength = central.readUInt16LE(cursor + 28);
      const extraLength = central.readUInt16LE(cursor + 30);
      const commentLength = central.readUInt16LE(cursor + 32);
      const localHeaderOffset = central.readUInt32LE(cursor + 42);
      const next = cursor + 46 + nameLength + extraLength + commentLength;
      if (next > central.length) throw new Error('Directorio ZIP truncado.');
      if ((flags & 0x1) !== 0) throw new Error('Las entradas ZIP cifradas externamente no están soportadas.');
      if (method !== 0 && method !== 8) throw new Error(`Método ZIP no soportado: ${method}.`);
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
        throw new Error('El formato ZIP64 no está soportado por esta versión de Nodus.');
      }
      const name = central.subarray(cursor + 46, cursor + 46 + nameLength)
        .toString((flags & 0x800) !== 0 ? 'utf8' : 'latin1');
      if (!name || names.has(name)) throw new Error('El ZIP contiene nombres vacíos o duplicados.');
      names.add(name);
      if (name === entryName) {
        if (compressedSize > maxBytes || uncompressedSize > maxBytes) {
          throw new Error(`La entrada ${name} supera el límite seguro de lectura.`);
        }
        selected = {
          name,
          method: method as 0 | 8,
          compressedSize,
          uncompressedSize,
          localHeaderOffset,
          isDirectory: name.endsWith('/'),
        };
      }
      cursor = next;
    }
    if (cursor !== central.length) throw new Error('El directorio ZIP contiene datos inesperados.');
    if (!selected) return null;
    if (selected.isDirectory) return Buffer.alloc(0);

    const header = readExactlySync(fd, 30, selected.localHeaderOffset);
    if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) {
      throw new Error(`Cabecera ZIP inválida: ${selected.name}.`);
    }
    const localFlags = header.readUInt16LE(6);
    const localMethod = header.readUInt16LE(8);
    if ((localFlags & 0x1) !== 0 || localMethod !== selected.method) {
      throw new Error(`Cabecera ZIP incoherente: ${selected.name}.`);
    }
    const dataOffset = selected.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    if (dataOffset + selected.compressedSize > stat.size) {
      throw new Error(`Entrada ZIP truncada: ${selected.name}.`);
    }
    const compressed = readExactlySync(fd, selected.compressedSize, dataOffset);
    const result = selected.method === 0
      ? compressed
      : inflateRawSync(compressed, { maxOutputLength: maxBytes });
    if (result.byteLength !== selected.uncompressedSize) {
      throw new Error(`La entrada ZIP ${selected.name} tiene un tamaño incoherente.`);
    }
    return result;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * A deliberately small ZIP32 reader for Nodus backups. Unlike AdmZip it never
 * materialises an entry in memory unless the caller explicitly asks for a
 * bounded small entry (the two JSON manifests and the wrapped recovery key).
 */
export class ZipFileReader {
  private constructor(
    readonly path: string,
    readonly entries: ZipFileEntry[],
    private readonly byName: Map<string, ZipFileEntry>,
  ) {}

  static async open(filePath: string): Promise<ZipFileReader> {
    const handle = await fs.promises.open(filePath, 'r');
    try {
      const stat = await handle.stat();
      const tailLength = Math.min(stat.size, MAX_COMMENT_BYTES + 22);
      if (tailLength < 22) throw new Error('ZIP truncado.');
      const tail = await readExactly(handle, tailLength, stat.size - tailLength);
      let eocd = -1;
      for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
        if (tail.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
        const commentLength = tail.readUInt16LE(offset + 20);
        if (offset + 22 + commentLength === tail.length) { eocd = offset; break; }
      }
      if (eocd < 0) throw new Error('No se encontró el directorio ZIP.');
      const disk = tail.readUInt16LE(eocd + 4);
      const centralDisk = tail.readUInt16LE(eocd + 6);
      const entriesOnDisk = tail.readUInt16LE(eocd + 8);
      const entryCount = tail.readUInt16LE(eocd + 10);
      const centralSize = tail.readUInt32LE(eocd + 12);
      const centralOffset = tail.readUInt32LE(eocd + 16);
      if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) throw new Error('Los ZIP multidisco no están soportados.');
      if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
        throw new Error('El formato ZIP64 no está soportado por esta versión de Nodus.');
      }
      if (centralSize > MAX_CENTRAL_DIRECTORY_BYTES || centralOffset + centralSize > stat.size) {
        throw new Error('Directorio ZIP inválido.');
      }
      const central = await readExactly(handle, centralSize, centralOffset);
      const entries: ZipFileEntry[] = [];
      const byName = new Map<string, ZipFileEntry>();
      let cursor = 0;
      for (let index = 0; index < entryCount; index += 1) {
        if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
          throw new Error('Directorio ZIP dañado.');
        }
        const flags = central.readUInt16LE(cursor + 8);
        const method = central.readUInt16LE(cursor + 10);
        const compressedSize = central.readUInt32LE(cursor + 20);
        const uncompressedSize = central.readUInt32LE(cursor + 24);
        const nameLength = central.readUInt16LE(cursor + 28);
        const extraLength = central.readUInt16LE(cursor + 30);
        const commentLength = central.readUInt16LE(cursor + 32);
        const localHeaderOffset = central.readUInt32LE(cursor + 42);
        const next = cursor + 46 + nameLength + extraLength + commentLength;
        if (next > central.length) throw new Error('Directorio ZIP truncado.');
        if ((flags & 0x1) !== 0) throw new Error('Las entradas ZIP cifradas externamente no están soportadas.');
        if (method !== 0 && method !== 8) throw new Error(`Método ZIP no soportado: ${method}.`);
        if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
          throw new Error('El formato ZIP64 no está soportado por esta versión de Nodus.');
        }
        const name = central.subarray(cursor + 46, cursor + 46 + nameLength).toString((flags & 0x800) !== 0 ? 'utf8' : 'latin1');
        if (!name || byName.has(name)) throw new Error('El ZIP contiene nombres vacíos o duplicados.');
        const entry: ZipFileEntry = {
          name,
          method: method as 0 | 8,
          compressedSize,
          uncompressedSize,
          localHeaderOffset,
          isDirectory: name.endsWith('/'),
        };
        entries.push(entry);
        byName.set(name, entry);
        cursor = next;
      }
      if (cursor !== central.length) throw new Error('El directorio ZIP contiene datos inesperados.');
      return new ZipFileReader(filePath, entries, byName);
    } finally {
      await handle.close();
    }
  }

  entry(name: string): ZipFileEntry | undefined { return this.byName.get(name); }

  private async dataOffset(entry: ZipFileEntry): Promise<number> {
    const handle = await fs.promises.open(this.path, 'r');
    try {
      const header = await readExactly(handle, 30, entry.localHeaderOffset);
      if (header.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new Error(`Cabecera ZIP inválida: ${entry.name}.`);
      const localFlags = header.readUInt16LE(6);
      const localMethod = header.readUInt16LE(8);
      if ((localFlags & 0x1) !== 0 || localMethod !== entry.method) {
        throw new Error(`Cabecera ZIP incoherente: ${entry.name}.`);
      }
      const offset = entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
      const size = (await handle.stat()).size;
      if (offset + entry.compressedSize > size) throw new Error(`Entrada ZIP truncada: ${entry.name}.`);
      return offset;
    } finally {
      await handle.close();
    }
  }

  async stream(entry: ZipFileEntry): Promise<Readable> {
    if (entry.isDirectory || entry.compressedSize === 0) return Readable.from([]);
    const start = await this.dataOffset(entry);
    const raw = fs.createReadStream(this.path, { start, end: start + entry.compressedSize - 1 });
    return entry.method === 0 ? raw : raw.pipe(createInflateRaw());
  }

  async read(entry: ZipFileEntry, maxBytes = 16 * 1024 * 1024): Promise<Buffer> {
    if (entry.uncompressedSize > maxBytes) throw new Error(`La entrada ${entry.name} supera el límite seguro de lectura.`);
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const raw of await this.stream(entry)) {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      bytes += chunk.byteLength;
      if (bytes > maxBytes) throw new Error(`La entrada ${entry.name} supera el límite seguro de lectura.`);
      chunks.push(chunk);
    }
    if (bytes !== entry.uncompressedSize) throw new Error(`La entrada ZIP ${entry.name} tiene un tamaño incoherente.`);
    return Buffer.concat(chunks, bytes);
  }

  async extract(entry: ZipFileEntry, target: string, onProgress?: (chunkBytes: number) => void): Promise<void> {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    let bytes = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        const chunkBytes = Buffer.byteLength(chunk);
        bytes += chunkBytes;
        onProgress?.(chunkBytes);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(await this.stream(entry), meter, fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }));
      if (bytes !== entry.uncompressedSize) {
        throw new Error(`La entrada ZIP ${entry.name} tiene un tamaño incoherente.`);
      }
    } catch (error) {
      await fs.promises.rm(target, { force: true });
      throw error;
    }
  }
}
