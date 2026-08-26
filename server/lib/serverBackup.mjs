import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import { redactStructured } from './ai/redact.mjs';

export const SERVER_BACKUP_FORMAT = 'nodus.server-backup';
export const SERVER_BACKUP_VERSION = 1;
const MANIFEST = 'nodus-server-backup.json';
const KEYRING_NAME = /(?:^|[-_.])(?:ai[-_.]?)?keyring(?:[-_.]|$)/i;

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function safeRelative(value) {
  const normalized = String(value || '').replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) throw new Error('Unsafe backup path');
  const clean = path.posix.normalize(normalized);
  if (clean === '..' || clean.startsWith('../') || clean !== normalized) throw new Error('Unsafe backup path');
  return clean;
}

function filesBelow(root, current = root, output = []) {
  for (const name of fs.readdirSync(current).sort()) {
    const absolute = path.join(current, name);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Server backups refuse symbolic links: ${absolute}`);
    if (stat.isDirectory()) { filesBelow(root, absolute, output); continue; }
    if (!stat.isFile() || /\.tmp(?:-|$)|\.lock$/i.test(name)) continue;
    output.push({ absolute, relative: safeRelative(path.relative(root, absolute).replaceAll(path.sep, '/')) });
  }
  return output;
}

function backupBytes(entry) {
  const bytes = fs.readFileSync(entry.absolute);
  // Prompts, notes and provider responses are useful backup material but can contain a key
  // pasted accidentally by a user. Redact recognizable credentials in private user JSON in
  // the archive without mutating the live store. The encrypted credential vault itself stays
  // encrypted and its external KEK remains excluded below.
  if (/^private\/users\/[^/]+\/(?:private|artifacts)\.json$/.test(entry.relative)
      || /^private-annotations\/[^/]+\/[^/]+\.json$/.test(entry.relative)) {
    try {
      return Buffer.from(JSON.stringify(redactStructured(JSON.parse(bytes.toString('utf8'))), null, 2));
    } catch {
      throw new Error(`Private backup data is not valid JSON: ${entry.relative}`);
    }
  }
  return bytes;
}

function looksLikeKeyringMaterial(entry) {
  let stat;
  try { stat = fs.statSync(entry.absolute); } catch { return false; }
  if (stat.size <= 0 || stat.size > 1024 * 1024) return false;
  try {
    const value = JSON.parse(fs.readFileSync(entry.absolute, 'utf8'));
    return value?.version === 1
      && typeof value.activeKeyId === 'string'
      && Array.isArray(value.keys)
      && value.keys.length > 0
      && value.keys.every((item) => item && typeof item.id === 'string' && typeof item.material === 'string' && Buffer.from(item.material, 'base64url').length === 32);
  } catch { return false; }
}

export function createServerBackup({ dataDir, outputFile, keyringFile = process.env.NODUS_AI_KEYRING_FILE || null }) {
  const root = path.resolve(dataDir);
  const target = path.resolve(outputFile);
  if (!fs.statSync(root).isDirectory()) throw new Error('Server data directory does not exist');
  if (target === root || target.startsWith(`${root}${path.sep}`)) throw new Error('Backup output must be outside the server data directory');
  const state = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
  const instanceId = String(state?.settings?.instanceId || '');
  if (!instanceId) throw new Error('Server state has no installation instanceId');
  const configuredKeyring = keyringFile ? path.resolve(keyringFile) : null;
  const configuredKeyringRelative = configuredKeyring && configuredKeyring.startsWith(`${root}${path.sep}`)
    ? safeRelative(path.relative(root, configuredKeyring).replaceAll(path.sep, '/'))
    : null;
  const zip = new AdmZip(); const files = []; const excluded = [];
  for (const entry of filesBelow(root)) {
    if (entry.relative === configuredKeyringRelative || KEYRING_NAME.test(path.posix.basename(entry.relative)) || looksLikeKeyringMaterial(entry)) {
      excluded.push({ path: entry.relative, reason: 'external-keyring-material' });
      continue;
    }
    const bytes = backupBytes(entry);
    zip.addFile(`data/${entry.relative}`, bytes);
    files.push({ path: entry.relative, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const manifest = {
    format: SERVER_BACKUP_FORMAT, formatVersion: SERVER_BACKUP_VERSION, backupId: randomUUID(),
    createdAt: new Date().toISOString(), instanceId, stateVersion: Number(state.version || 0), files, excluded,
    security: { includesPlaintextCredentials: false, includesKeyring: false, restorePolicy: 'empty-target-only' },
  };
  zip.addFile(MANIFEST, Buffer.from(JSON.stringify(manifest, null, 2)));
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  zip.writeZip(temporary); fs.chmodSync(temporary, 0o600); fs.renameSync(temporary, target);
  return manifest;
}

export function inspectServerBackup(archiveFile) {
  const zip = new AdmZip(path.resolve(archiveFile)); const entries = zip.getEntries(); const byName = new Map();
  for (const entry of entries) {
    const name = safeRelative(entry.entryName);
    if (byName.has(name)) throw new Error(`Duplicate backup entry: ${name}`);
    const unixType = (Number(entry.attr) >>> 16) & 0o170000;
    if (unixType === 0o120000) throw new Error(`Symbolic links are not accepted: ${name}`);
    byName.set(name, entry);
  }
  const manifestEntry = byName.get(MANIFEST); if (!manifestEntry) throw new Error('Backup manifest is missing');
  const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
  if (manifest?.format !== SERVER_BACKUP_FORMAT || manifest?.formatVersion !== SERVER_BACKUP_VERSION || !Array.isArray(manifest.files) || !manifest.instanceId) throw new Error('Unsupported server backup');
  const declared = new Set([MANIFEST]);
  for (const file of manifest.files) {
    const relative = safeRelative(file.path); const name = `data/${relative}`; declared.add(name);
    const entry = byName.get(name); if (!entry || entry.isDirectory) throw new Error(`Backup file is missing: ${relative}`);
    const bytes = entry.getData();
    if (bytes.length !== Number(file.bytes) || sha256(bytes) !== file.sha256) throw new Error(`Backup hash mismatch: ${relative}`);
    if (KEYRING_NAME.test(path.posix.basename(relative))) throw new Error('A server backup must never contain keyring material');
  }
  for (const [name, entry] of byName) if (!entry.isDirectory && !declared.has(name)) throw new Error(`Undeclared backup entry: ${name}`);
  const stateEntry = byName.get('data/state.json'); if (!stateEntry) throw new Error('Backup state.json is missing');
  const state = JSON.parse(stateEntry.getData().toString('utf8'));
  if (String(state?.settings?.instanceId || '') !== String(manifest.instanceId)) throw new Error('Backup instance provenance mismatch');
  return { manifest, zip };
}

export function restoreServerBackup({ archiveFile, targetDir }) {
  const target = path.resolve(targetDir);
  if (fs.existsSync(target)) throw new Error('Restore target must not exist; merge/overwrite restores are forbidden');
  const { manifest, zip } = inspectServerBackup(archiveFile); const stage = `${target}.restore-${randomUUID()}`;
  fs.mkdirSync(stage, { recursive: false, mode: 0o700 });
  try {
    for (const file of manifest.files) {
      const relative = safeRelative(file.path); const destination = path.join(stage, ...relative.split('/'));
      if (!destination.startsWith(`${stage}${path.sep}`)) throw new Error('Restore path escaped staging directory');
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.writeFileSync(destination, zip.getEntry(`data/${relative}`).getData(), { mode: 0o600, flag: 'wx' });
    }
    fs.renameSync(stage, target);
  } catch (error) { fs.rmSync(stage, { recursive: true, force: true }); throw error; }
  return manifest;
}
