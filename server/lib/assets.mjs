// Content-addressed image storage.
//
// The hard product rule is that heavy documents never reach the server: no PDFs, no audio.
// Images do travel, but only three kinds — the illustration attached to a Deep Research
// report, a person's portrait, and the pictures in a database's attachment columns. Three
// independent layers enforce that, and each one would be sufficient on its own:
//
//   1. Origin.  `ASSET_SOURCES` in electron/serverSync/serverSnapshot.ts is the only code
//      path that produces an asset, and it names exactly three tables. TTS audio is a loose
//      .wav under <vault>/audio/ with only metadata in SQLite, and a work's PDF lives in
//      Zotero's storage/ directory outside the vault entirely: there is nothing to read.
//      The database one is the only source whose rows are not images by construction, which
//      is why layer 3 below is what actually decides for it — an attachment column takes
//      whatever the user dropped on it, and only four image formats get past the sniffer.
//   2. Wire.    `safeValue()` in that same file discards every Buffer, so no binary can
//      ride inside the snapshot JSON regardless of which tables are selected.
//   3. Server.  This file. Bytes are sniffed, and anything that is not one of four image
//      formats is refused with 415 — whatever the uploader declared.
//
// Layer 3 exists because layers 1 and 2 live in the client. A server must not trust a
// client it does not control.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const ASSET_HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Bytes → mime, or null when the bytes are not an image we accept.
 *
 * Ported from electron/imageStorage.ts:18 with one deliberate difference: that function
 * falls back to the caller's declared type, which is right for a local file the user just
 * picked and wrong for anything arriving over the network. Here an unrecognised header is
 * simply a rejection.
 *
 * The subtle case is RIFF. Both WAV and WEBP open with the same four bytes, so a naive
 * sniffer that stopped there would happily store audio. The format name lives at bytes
 * 8..12 and that is what distinguishes them.
 */
export function sniffImageMime(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  return null;
}

export function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function isValidAssetHash(value) {
  return ASSET_HASH_PATTERN.test(String(value ?? ''));
}

export function assetExists(store, spaceId, hash) {
  return isValidAssetHash(hash) && fs.existsSync(store.assetPath(spaceId, hash));
}

export function readAsset(store, spaceId, hash) {
  if (!isValidAssetHash(hash)) return null;
  const target = store.assetPath(spaceId, hash);
  if (!fs.existsSync(target)) return null;
  const bytes = fs.readFileSync(target);
  // Sniff on the way out too. The stored bytes were verified on the way in, but serving a
  // content-type we re-derive from the file itself means a corrupted or hand-placed file
  // can never be echoed back as a type it is not.
  const mime = sniffImageMime(bytes);
  return mime ? { bytes, mime } : null;
}

/** Atomic like every other write in the store, and 0600 for the same reason. */
export function writeAsset(store, spaceId, hash, bytes) {
  const target = store.assetPath(spaceId, hash);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, bytes, { mode: 0o600 });
  fs.renameSync(temporary, target);
  return target;
}

export function listAssetHashes(store, spaceId) {
  const root = store.assetsDir(spaceId);
  if (!fs.existsSync(root)) return [];
  const found = [];
  for (const first of fs.readdirSync(root)) {
    const firstDir = path.join(root, first);
    if (!fs.statSync(firstDir).isDirectory()) continue;
    for (const second of fs.readdirSync(firstDir)) {
      const secondDir = path.join(firstDir, second);
      if (!fs.statSync(secondDir).isDirectory()) continue;
      for (const name of fs.readdirSync(secondDir)) {
        if (isValidAssetHash(name)) found.push({ hash: name, file: path.join(secondDir, name) });
      }
    }
  }
  return found;
}

export function spaceAssetBytes(store, spaceId) {
  return listAssetHashes(store, spaceId).reduce((sum, entry) => {
    try { return sum + fs.statSync(entry.file).size; } catch { return sum; }
  }, 0);
}

/**
 * Delete assets nothing points at any more.
 *
 * The grace period is not politeness, it closes a race. A writer uploads an image and then
 * sends the mutation that references it; if the owner republishes in between, the new
 * snapshot legitimately does not mention that hash yet and an eager sweep would delete the
 * bytes out from under a mutation that is still in flight.
 */
export function collectAssetGarbage(store, spaceId, referenced, graceMs, now = Date.now()) {
  const keep = referenced instanceof Set ? referenced : new Set(referenced);
  const removed = [];
  for (const entry of listAssetHashes(store, spaceId)) {
    if (keep.has(entry.hash)) continue;
    let stat;
    try { stat = fs.statSync(entry.file); } catch { continue; }
    if (now - stat.mtimeMs < graceMs) continue;
    try { fs.rmSync(entry.file, { force: true }); removed.push(entry.hash); } catch { /* another sweep will retry */ }
  }
  return removed;
}

/** Every asset hash a stored snapshot points at, original and thumbnail alike. */
export function snapshotAssetHashes(snapshot) {
  const hashes = new Set();
  for (const asset of Array.isArray(snapshot?.assets) ? snapshot.assets : []) {
    if (isValidAssetHash(asset?.hash)) hashes.add(asset.hash);
    if (isValidAssetHash(asset?.thumbHash)) hashes.add(asset.thumbHash);
  }
  return hashes;
}
