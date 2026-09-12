import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import { LIMITS } from '../../packages/capability-api/src/limits';

/** Opens a signed `.nodus-plugin` archive into a staging directory.
 *
 *  The signature already says the bytes are the ones NodusResearch published, so this is
 *  not about distrusting the publisher. It is about the archive format itself: a zip can
 *  describe a path outside its own root, a symlink pointing anywhere, a device node, or
 *  an expansion far larger than the download. Each of those is refused before a single
 *  byte is written, and the whole extraction is refused as a unit. */

const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;

export interface ExtractionReport {
  entries: number;
  compressedBytes: number;
  expandedBytes: number;
}

const unsafeSegment = (part: string) => !part || part === '.' || part === '..';

/** The one path check. A name is accepted only if it is relative, has no traversal and
 *  no drive letter, and resolves back inside the destination. */
export function safeEntryPath(destination: string, entryName: string): string {
  if (!entryName || entryName.length > 512) throw new Error('Unsafe plugin archive entry.');
  const normalized = entryName.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || normalized.split('/').some(unsafeSegment)) throw new Error(`Unsafe plugin archive entry: ${entryName}`);
  const target = path.resolve(destination, ...normalized.split('/'));
  const root = path.resolve(destination);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`Unsafe plugin archive entry: ${entryName}`);
  return target;
}

export function extractPluginArchive(archive: Buffer, destination: string): ExtractionReport {
  if (archive.byteLength > LIMITS.packageCompressedBytes) throw new Error('The plugin package is larger than the format allows.');

  let zip: AdmZip;
  try { zip = new AdmZip(archive); } catch { throw new Error('The plugin package is not a readable archive.'); }
  const entries = zip.getEntries();
  if (entries.length > LIMITS.packageEntries) throw new Error('The plugin package contains too many entries.');

  // Everything is inspected before anything is written, so a package that turns out to be
  // hostile halfway through never leaves a partially extracted tree behind.
  let expandedBytes = 0;
  const planned: Array<{ entry: AdmZip.IZipEntry; target: string }> = [];
  for (const entry of entries) {
    const mode = (entry.attr >>> 16) & S_IFMT;
    // A zero mode is what a Windows-written archive reports; anything else that is
    // neither a regular file nor a directory is a symlink, a device or a socket.
    if (mode !== 0 && mode !== S_IFREG && mode !== S_IFDIR) throw new Error(`The plugin package contains a non-regular entry: ${entry.entryName}`);
    const target = safeEntryPath(destination, entry.entryName);
    if (entry.isDirectory) { planned.push({ entry, target }); continue; }
    expandedBytes += entry.header.size;
    if (expandedBytes > LIMITS.packageExpandedBytes) throw new Error('The plugin package expands to more than the format allows.');
    planned.push({ entry, target });
  }

  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const { entry, target } of planned) {
    if (entry.isDirectory) { fs.mkdirSync(target, { recursive: true, mode: 0o700 }); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    let data: Buffer;
    try { data = entry.getData(); }
    catch { throw new Error(`The plugin package could not be decompressed: ${entry.entryName}`); }
    // The central directory is a claim, not a fact: check the size actually produced.
    if (data.length !== entry.header.size) throw new Error(`The plugin package misreports the size of ${entry.entryName}.`);
    fs.writeFileSync(target, data, { mode: 0o600 });
  }

  return { entries: entries.length, compressedBytes: archive.byteLength, expandedBytes };
}
