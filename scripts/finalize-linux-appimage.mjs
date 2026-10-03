import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { dump, load } from 'js-yaml';

export const APPIMAGE_NAME = 'Nodus-x86_64.AppImage';
export const LEGACY_APPIMAGE_NAME = 'Nodus-linux-x86_64.AppImage';
const require = createRequire(import.meta.url);

export function updateInformation(channel) {
  if (channel !== 'latest' && channel !== 'beta') throw new Error(`Unsupported release channel: ${channel}`);
  // Beta users also receive a newer stable release, just like electron-updater.
  const selector = channel === 'latest' ? 'latest' : 'latest-all';
  return `gh-releases-zsync|jorgepb96|nodus|${selector}|${APPIMAGE_NAME}.zsync`;
}

async function readAt(file, offset, length) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 || length > 16 * 1024 * 1024) {
    throw new Error('Invalid AppImage metadata bounds');
  }
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await file.read(buffer, 0, length, offset);
  if (bytesRead !== length) throw new Error('Truncated AppImage metadata');
  return buffer;
}

// Update the runtime's reserved ELF section in place. objcopy/repacking can
// discard the appended squashfs or alter the launcher; neither is needed here.
export async function updateInfoSection(file) {
  const header = await readAt(file, 0, 64);
  if (!header.subarray(0, 6).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1])) ||
      !header.subarray(8, 11).equals(Buffer.from([0x41, 0x49, 2])) || header.readUInt16LE(18) !== 62) {
    throw new Error('Expected an x86_64 ELF64 little-endian type-2 AppImage');
  }
  const tableOffset = Number(header.readBigUInt64LE(40));
  const entrySize = header.readUInt16LE(58);
  const count = header.readUInt16LE(60);
  const namesIndex = header.readUInt16LE(62);
  if (entrySize !== 64 || count === 0 || namesIndex >= count) throw new Error('Invalid AppImage ELF section table');
  const table = await readAt(file, tableOffset, count * entrySize);
  const namesEntry = table.subarray(namesIndex * entrySize);
  const names = await readAt(file, Number(namesEntry.readBigUInt64LE(24)), Number(namesEntry.readBigUInt64LE(32)));
  for (let index = 0; index < count; index++) {
    const entry = table.subarray(index * entrySize, (index + 1) * entrySize);
    const start = entry.readUInt32LE(0);
    const end = names.indexOf(0, start);
    if (start >= names.length || end < start) throw new Error('Invalid AppImage ELF section name');
    if (names.toString('utf8', start, end) !== '.upd_info') continue;
    const offset = Number(entry.readBigUInt64LE(24));
    const size = Number(entry.readBigUInt64LE(32));
    if (entry.readUInt32LE(4) !== 1 || offset < 64 || size < 1 || size > 65536 || offset + size > tableOffset) {
      throw new Error('Invalid reserved AppImage update information section');
    }
    return { offset, size };
  }
  throw new Error('AppImage runtime has no reserved .upd_info section');
}

export async function readEmbeddedBlockmap(file) {
  const { size } = await file.stat();
  const footer = await readAt(file, size - 4, 4);
  const blockMapSize = footer.readUInt32BE();
  const offset = size - blockMapSize - 4;
  const map = JSON.parse(inflateRawSync(await readAt(file, offset, blockMapSize), { maxOutputLength: 64 * 1024 * 1024 }).toString());
  if (map.version !== '2' || !Array.isArray(map.files) || map.files.length !== 1) throw new Error('Invalid Electron AppImage blockmap');
  const entry = map.files[0];
  if (entry.offset !== 0 || entry.sizes?.length !== entry.checksums?.length ||
      !entry.sizes?.every((length) => Number.isSafeInteger(length) && length > 0) ||
      entry.sizes.reduce((sum, length) => sum + length, 0) !== offset) {
    throw new Error('Electron blockmap does not cover the AppImage payload');
  }
  return { offset, blockMapSize, map };
}

async function hashes(file) {
  const sha1 = createHash('sha1');
  const sha512 = createHash('sha512');
  for await (const chunk of createReadStream(file)) { sha1.update(chunk); sha512.update(chunk); }
  return { sha1: sha1.digest('hex'), sha512: sha512.digest('base64') };
}

export async function verifyAppImage(filePath, manifest, channel) {
  const file = await open(filePath, 'r');
  try {
    const section = await updateInfoSection(file);
    const embedded = (await readAt(file, section.offset, section.size)).toString().replace(/\0+$/, '');
    if (embedded !== updateInformation(channel)) throw new Error('AppImage update information does not match its release channel');
    const { blockMapSize } = await readEmbeddedBlockmap(file);
    const { size } = await file.stat();
    const digest = await hashes(filePath);
    const entry = manifest.files?.find((item) => item.url === APPIMAGE_NAME);
    if (!entry || entry.size !== size || entry.blockMapSize !== blockMapSize || entry.sha512 !== digest.sha512 ||
        manifest.path !== APPIMAGE_NAME || manifest.sha512 !== digest.sha512) {
      throw new Error('Electron update manifest does not match the finalized AppImage');
    }
    const zsync = (await readFile(`${filePath}.zsync`)).toString('latin1').split('\n\n', 1)[0];
    const fields = Object.fromEntries(zsync.split('\n').map((line) => { const colon = line.indexOf(': '); return [line.slice(0, colon), line.slice(colon + 2)]; }));
    if (fields.Filename !== APPIMAGE_NAME || Number(fields.Length) !== size || fields['SHA-1'] !== digest.sha1 ||
        fields.URL !== `https://github.com/jorgepb96/nodus/releases/download/v${manifest.version}/${APPIMAGE_NAME}`) {
      throw new Error('zsync metadata does not match the finalized AppImage');
    }
    return { size, blockMapSize, ...digest, updateInformation: embedded };
  } finally { await file.close(); }
}

export async function finalizeLinuxAppImage(releaseDir, channel) {
  const information = updateInformation(channel);
  const manifestPath = path.join(releaseDir, `${channel}-linux.yml`);
  const manifest = load(await readFile(manifestPath, 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(manifest?.version ?? '') ||
      (channel === 'beta') !== manifest.version.includes('-beta.') ||
      manifest.files?.filter((entry) => entry.url.endsWith('.AppImage')).length !== 1 ||
      !manifest.files.some((entry) => entry.url === APPIMAGE_NAME)) {
    throw new Error('Expected a matching release version and exactly one canonical AppImage in the Electron manifest');
  }
  const work = await mkdtemp(path.join(releaseDir, '.appimage-updates-'));
  const image = path.join(work, APPIMAGE_NAME);
  try {
    await copyFile(path.join(releaseDir, APPIMAGE_NAME), image);
    const file = await open(image, 'r+');
    try {
      const section = await updateInfoSection(file);
      const { offset } = await readEmbeddedBlockmap(file);
      if (Buffer.byteLength(information) >= section.size) throw new Error('AppImage update information exceeds its reserved section');
      const data = Buffer.alloc(section.size);
      data.write(information);
      await file.write(data, 0, data.length, section.offset);
      // The previous blockmap described the bytes before .upd_info changed.
      await file.truncate(offset);
    } finally { await file.close(); }
    const { appendBlockmap } = require('app-builder-lib/out/targets/differentialUpdateInfoBuilder.js');
    const info = await appendBlockmap(image);
    manifest.files = manifest.files.map((entry) => entry.url === APPIMAGE_NAME ? { ...entry, ...info } : entry);
    manifest.path = APPIMAGE_NAME;
    manifest.sha512 = info.sha512;
    // zsync must describe the FINAL file, including Electron's new blockmap.
    execFileSync('zsyncmake', ['-u', `https://github.com/jorgepb96/nodus/releases/download/v${manifest.version}/${APPIMAGE_NAME}`, '-o', `${APPIMAGE_NAME}.zsync`, APPIMAGE_NAME], { cwd: work, stdio: 'inherit' });
    await chmod(image, 0o755);
    const verification = await verifyAppImage(image, manifest, channel);
    await copyFile(image, path.join(work, LEGACY_APPIMAGE_NAME));
    await writeFile(path.join(work, path.basename(manifestPath)), dump(manifest, { lineWidth: 8000 }));
    for (const name of [APPIMAGE_NAME, `${APPIMAGE_NAME}.zsync`, LEGACY_APPIMAGE_NAME, path.basename(manifestPath)]) {
      await rename(path.join(work, name), path.join(releaseDir, name));
    }
    return verification;
  } finally { await rm(work, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await finalizeLinuxAppImage(path.resolve(process.argv[2] ?? 'release'), process.env.NODUS_RELEASE_CHANNEL);
  console.log(`[appimage] Verified ${APPIMAGE_NAME}: ${result.size} bytes, blockmap ${result.blockMapSize} bytes`);
  console.log(`[appimage] ${result.updateInformation}`);
}
