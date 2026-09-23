import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ResolvedResearchScope } from '@shared/researchCorpus';
import { ManagedZoteroConnection, type ManagedZoteroScopeManifest, type ManagedZoteroTool } from './managedZotero';
import { resolveAcademicRunScope } from '../ai/researchCorpusRun';
import { registerNotebookRun } from '../ai/researchNotebookService';
import { researchCorpusInventory } from '../ai/researchCorpusInventory';
import { assertResearchDocument } from '../ai/researchCorpusScope';
import { itemChildren, ZOTERO_API_BASE } from '../zotero/zoteroClient';
import { getGlobalLibraryItem } from '../library/libraryService';
import { getWork } from '../db/worksRepo';

const connection = new ManagedZoteroConnection();
let scope: ResolvedResearchScope | null = null;
let release: (() => void) | null = null;
let ownedRoot: string | null = null;
let connecting = false;
let generation = 0;
export function getResearchZoteroStatus() {
  const runtime = app.isPackaged ? path.join(process.resourcesPath, 'zotero-mcp') : path.join(app.getAppPath(), 'build/zotero-mcp');
  return { ...connection.status, installed: fs.existsSync(path.join(runtime, 'runtime.json')), notebookId: scope?.notebookId ?? null, scopeId: scope?.id ?? null };
}
export async function closeResearchZotero(): Promise<void> {
  generation++;
  release?.(); release = null; scope = null;
  await connection.close();
  const root = ownedRoot; ownedRoot = null;
  if (root) await fs.promises.rm(root, { recursive: true, force: true });
}

async function metadata(endpoint: string, libraryType: 'user' | 'group', libraryId: string, key: string, serverId?: string) {
  if (!/^\d+$/.test(libraryId) || !/^[A-Z0-9]{8}$/.test(key)) throw new Error('research_invalid_zotero_identity');
  const response = await fetch(`${endpoint}/${libraryType === 'user' ? 'users' : 'groups'}/${libraryId}/items/${key}`, {
    redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Zotero-API-Version': '3', 'Zotero-Allowed-Request': '1', ...(serverId ? { 'Zotero-Server-ID': serverId } : {}) },
  });
  const identity = response.headers.get('Zotero-Server-ID');
  if (!response.ok || !identity || (serverId && serverId !== identity)) throw new Error('research_zotero_endpoint_identity_mismatch');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('research_zotero_metadata_invalid');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 8 * 1024 * 1024) throw new Error('research_zotero_metadata_too_large');
      chunks.push(next.value);
    }
  } finally { await reader.cancel(); }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { key: string; version: number; data?: { parentItem?: string } };
  if (value.key !== key || !Number.isSafeInteger(value.version)) throw new Error('research_zotero_metadata_invalid');
  return { ...value, serverId: identity };
}

/** The renderer chooses a mode; only the backend can construct source manifests,
 * runtime paths and tool identities. Never discovers another MCP installation. */
type ConnectionInput = { notebookId?: string | null; mode: 'managed' | 'external'; externalUrl?: string };
export async function connectResearchZotero(input: ConnectionInput) {
  if (connecting) throw new Error('research_mcp_connection_busy');
  connecting = true;
  try { return await connectResearchZoteroCore(input); } finally { connecting = false; }
}
async function connectResearchZoteroCore(input: ConnectionInput) {
  if (!input || !['managed', 'external'].includes(input.mode)) throw new Error('research_invalid_mcp_mode');
  await closeResearchZotero();
  const currentGeneration = generation;
  const checkGeneration = () => { if (generation !== currentGeneration) throw new Error('research_mcp_connection_cancelled'); };
  const resolved = resolveAcademicRunScope(input.notebookId);
  const endpoint = new URL(ZOTERO_API_BASE);
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(endpoint.hostname) || !endpoint.port || endpoint.pathname !== '/api') throw new Error('research_zotero_endpoint_invalid');
  const parent = path.join(app.getPath('userData'), 'mcp', 'zotero');
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (fs.realpathSync(parent) !== parent) throw new Error('research_mcp_profile_symlink');
  const root = path.join(parent, randomUUID());
  fs.mkdirSync(root, { mode: 0o700 });
  ownedRoot = root;
  const items: ManagedZoteroScopeManifest['items'] = [];
  let serverId = '';
  try {
    for (const document of resolved.documents) {
      if (document.origin.kind !== 'zotero') continue;
      const { libraryType, libraryId, itemKey } = document.origin;
      const current = await metadata(endpoint.href.replace(/\/$/, ''), libraryType, libraryId, itemKey, serverId || undefined);
      checkGeneration();
      serverId = current.serverId;
      const libraryItem = document.libraryItemId ? getGlobalLibraryItem(document.libraryItemId) : null;
      const work = document.workId ? getWork(document.workId) : null;
      const version = libraryItem?.sourceVersion ?? work?.zotero_version;
      if (version != null && version !== current.version) throw new Error('research_source_revision_changed');
      const canonicalKey = libraryType === 'group' ? `groups:${libraryId}:${itemKey}` : itemKey;
      const children = await itemChildren(libraryId, canonicalKey);
      const selectedKeys = libraryItem ? new Set(libraryItem.attachments.map(attachment => attachment.sourceKey).filter(Boolean)) : null;
      const attachments: ManagedZoteroScopeManifest['items'][number]['attachments'] = [];
      for (const child of children) {
        const key = child.key.replace(/^groups:[^:]+:/, '');
        if (selectedKeys && !selectedKeys.has(key)) continue;
        const attachment = await metadata(endpoint.href.replace(/\/$/, ''), libraryType, libraryId, key, serverId);
        if (attachment.data?.parentItem !== itemKey) throw new Error('research_attachment_not_authorized');
        attachments.push({ key, version: attachment.version });
      }
      items.push({ libraryType, libraryId, itemKey, revision: document.revision, version: current.version, attachments });
    }
    checkGeneration();
    if (!serverId) throw new Error('research_no_zotero_sources');
    const manifest: ManagedZoteroScopeManifest = { format: 'nodus.zotero-mcp-scope/1', root, endpoint: endpoint.href.replace(/\/$/, ''), serverId, items };
    scope = resolved;
    if (resolved.notebookId) {
      const controller = new AbortController();
      release = registerNotebookRun(resolved.notebookId, controller);
      controller.signal.addEventListener('abort', () => { void closeResearchZotero(); }, { once: true });
    }
    const runtime = app.isPackaged ? path.join(process.resourcesPath, 'zotero-mcp') : path.join(app.getAppPath(), 'build/zotero-mcp');
    await (input.mode === 'managed' ? connection.connectManaged(runtime, manifest)
      : connection.connectExternal(input.externalUrl ?? '', manifest));
    checkGeneration();
    validateScope(resolved);
    return getResearchZoteroStatus();
  } catch (error) { await closeResearchZotero(); throw error; }
}

function validateScope(expected: ResolvedResearchScope): void {
  const current = resolveAcademicRunScope(expected.notebookId);
  if (current.id !== expected.id) throw new Error('research_scope_changed');
  const inventory = researchCorpusInventory();
  for (const document of expected.documents) assertResearchDocument(expected, document.id, inventory.documents.find(item => item.id === document.id));
}
export async function readResearchZotero(input: { notebookId?: string | null; documentId: string; operation: 'metadata' | 'fulltext'; attachmentKey?: string }) {
  if (!scope || scope.notebookId !== (input.notebookId ?? null)) throw new Error('research_mcp_scope_mismatch');
  const expected = scope;
  validateScope(expected);
  const document = expected.documents.find(document => document.id === input.documentId);
  if (!document || document.origin.kind !== 'zotero') throw new Error('research_source_not_authorized');
  const tool: ManagedZoteroTool = input.operation === 'metadata' ? 'zotero_get_item_metadata' : input.operation === 'fulltext' ? 'zotero_get_item_fulltext' : (() => { throw new Error('research_invalid_mcp_operation'); })();
  const result = await connection.call(tool, { library_type: document.origin.libraryType, library_id: document.origin.libraryId,
    item_key: document.origin.itemKey, attachment_key: input.attachmentKey });
  validateScope(expected);
  return result;
}
