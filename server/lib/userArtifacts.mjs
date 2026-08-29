import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { redactStructured, redactText } from './ai/redact.mjs';

const VERSION = 1;
const MAX_ITEMS = 10_000;
const MAX_USER_BYTES = 64 * 1024 * 1024;
const KINDS = new Set([
  'workspace-note', 'nodi-note', 'author-synthesis', 'dictionary-entry', 'deep-research',
]);

function safeId(value, label = 'id') {
  const text = String(value ?? '');
  if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(text)) throw new Error(`Invalid ${label}`);
  return text;
}

function cleanKind(value) {
  const kind = String(value ?? '');
  if (!KINDS.has(kind)) throw new Error('Invalid artifact kind');
  return kind;
}

function cleanText(value, limit) {
  return redactText(String(value ?? '')).slice(0, limit);
}

function empty(userId) {
  return { version: VERSION, ownerUserId: userId, artifacts: [] };
}

/**
 * Private drafts and notes are physically partitioned from vault publications and from
 * provider credentials. No method accepts an owner supplied by a caller: ownership always
 * comes from the authenticated user passed by the route.
 */
export class UserArtifactStore {
  constructor(root) {
    this.root = path.resolve(root, 'users');
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(this.root).isSymbolicLink()) throw new Error('Private artifact root must not be a symlink');
    try { fs.chmodSync(this.root, 0o700); } catch { /* Windows */ }
  }

  file(userIdValue) {
    const userId = safeId(userIdValue, 'user id');
    const dir = path.join(this.root, userId);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('Private artifact directory must not be a symlink');
    try { fs.chmodSync(dir, 0o700); } catch { /* Windows */ }
    const file = path.join(dir, 'artifacts.json');
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error('Private artifact file must not be a symlink');
    return file;
  }

  read(userIdValue) {
    const userId = safeId(userIdValue, 'user id');
    const file = this.file(userId);
    if (!fs.existsSync(file)) return empty(userId);
    const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    let value;
    try { value = JSON.parse(fs.readFileSync(descriptor, 'utf8')); } finally { fs.closeSync(descriptor); }
    if (value?.version !== VERSION || value?.ownerUserId !== userId || !Array.isArray(value?.artifacts)) {
      throw new Error('Private-artifact ownership or schema mismatch');
    }
    if (value.artifacts.some((entry) => !entry || entry.ownerUserId !== userId)) {
      throw new Error('Private-artifact entry ownership mismatch');
    }
    return value;
  }

  write(userIdValue, value) {
    const userId = safeId(userIdValue, 'user id');
    if (value?.ownerUserId !== userId) throw new Error('Private-artifact ownership mismatch');
    const file = this.file(userId);
    const serialized = JSON.stringify(value, null, 2);
    if (Buffer.byteLength(serialized) > MAX_USER_BYTES) throw new Error('Private artifact storage quota exceeded');
    const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
    fs.writeFileSync(temporary, serialized, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
    try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
  }

  list(userId, filters = {}) {
    const vaultId = filters.vaultId == null ? null : safeId(filters.vaultId, 'vault id');
    const kind = filters.kind == null || filters.kind === '' ? null : cleanKind(filters.kind);
    return this.read(userId).artifacts
      .filter((entry) => (!vaultId || entry.vaultId === vaultId) && (!kind || entry.kind === kind))
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .map((entry) => ({ ...entry }));
  }

  get(userId, artifactId) {
    const id = safeId(artifactId, 'artifact id');
    const ownerUserId = String(userId);
    const found = this.read(ownerUserId).artifacts.find((entry) => entry.id === id && entry.ownerUserId === ownerUserId);
    return found ? { ...found } : null;
  }

  create(userIdValue, input = {}) {
    const ownerUserId = safeId(userIdValue, 'user id');
    const state = this.read(ownerUserId);
    if (state.artifacts.length >= MAX_ITEMS) throw new Error('Private artifact quota exceeded');
    const now = new Date().toISOString();
    const artifact = {
      id: `artifact_${randomUUID()}`,
      ownerUserId,
      vaultId: safeId(input.vaultId, 'vault id'),
      kind: cleanKind(input.kind),
      title: cleanText(input.title, 240),
      content: cleanText(input.content, 2_000_000),
      metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
        ? redactStructured(input.metadata) : {},
      sourceJobId: input.sourceJobId == null ? null : safeId(input.sourceJobId, 'job id'),
      publication: null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    state.artifacts.push(artifact);
    this.write(ownerUserId, state);
    return { ...artifact };
  }

  update(userIdValue, artifactId, patch = {}) {
    const ownerUserId = safeId(userIdValue, 'user id');
    const id = safeId(artifactId, 'artifact id');
    const state = this.read(ownerUserId);
    const artifact = state.artifacts.find((entry) => entry.id === id && entry.ownerUserId === ownerUserId);
    if (!artifact) return null;
    if (patch.title !== undefined) artifact.title = cleanText(patch.title, 240);
    if (patch.content !== undefined) artifact.content = cleanText(patch.content, 2_000_000);
    if (patch.metadata !== undefined) artifact.metadata = patch.metadata && typeof patch.metadata === 'object' && !Array.isArray(patch.metadata)
      ? redactStructured(patch.metadata) : {};
    artifact.revision = Number(artifact.revision || 0) + 1;
    artifact.updatedAt = new Date().toISOString();
    this.write(ownerUserId, state);
    return { ...artifact };
  }

  markPublished(userIdValue, artifactId, publication) {
    const ownerUserId = safeId(userIdValue, 'user id');
    const id = safeId(artifactId, 'artifact id');
    const state = this.read(ownerUserId);
    const artifact = state.artifacts.find((entry) => entry.id === id && entry.ownerUserId === ownerUserId);
    if (!artifact) return null;
    artifact.publication = {
      actionId: safeId(publication.actionId, 'action id'),
      status: String(publication.status || 'queued').slice(0, 40),
      requestedAt: new Date().toISOString(),
    };
    artifact.updatedAt = artifact.publication.requestedAt;
    artifact.revision = Number(artifact.revision || 0) + 1;
    this.write(ownerUserId, state);
    return { ...artifact };
  }

  remove(userIdValue, artifactId) {
    const ownerUserId = safeId(userIdValue, 'user id');
    const id = safeId(artifactId, 'artifact id');
    const state = this.read(ownerUserId);
    const before = state.artifacts.length;
    state.artifacts = state.artifacts.filter((entry) => entry.id !== id || entry.ownerUserId !== ownerUserId);
    if (state.artifacts.length === before) return false;
    this.write(ownerUserId, state);
    return true;
  }
}

export const USER_ARTIFACT_KINDS = Object.freeze([...KINDS]);
