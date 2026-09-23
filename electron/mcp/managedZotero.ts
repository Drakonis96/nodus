import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ZoteroMcpStatus } from '@shared/researchCorpus';

export interface ManagedZoteroScopeManifest {
  format: 'nodus.zotero-mcp-scope/1';
  root: string;
  endpoint: string;
  serverId: string;
  items: Array<{ libraryType: 'user' | 'group'; libraryId: string; itemKey: string; version: number; revision: string;
    attachments: Array<{ key: string; version: number; path?: string; sha256?: string }> }>;
}
const READ_TOOLS = ['zotero_get_item_children', 'zotero_get_item_fulltext', 'zotero_get_item_metadata', 'zotero_read_pdf_pages'] as const;
export type ManagedZoteroTool = typeof READ_TOOLS[number];
type ToolArguments = { library_type: string; library_id: string; item_key: string; attachment_key?: string; start_page?: number; end_page?: number };

/** Owns only the private child it starts. Never discovers PATH executables,
 * reads third-party MCP configuration, installs software or kills by name. */
export class ManagedZoteroConnection {
  private client: Client | null = null;
  private transport: StdioClientTransport | StreamableHTTPClientTransport | null = null;
  private restarts = 0;
  private scope: ManagedZoteroScopeManifest | null = null;
  private controllers = new Set<AbortController>();
  status: ZoteroMcpStatus = { installed: false, mode: 'managed', state: 'stopped', version: null, transport: 'stdio', error: null };

  async connectManaged(runtimeRoot: string, scope: ManagedZoteroScopeManifest): Promise<ZoteroMcpStatus> {
    await this.close();
    if (++this.restarts > 3) throw new Error('managed_zotero_restart_limit');
    const runtime = fs.realpathSync(runtimeRoot);
    const root = fs.realpathSync(scope.root);
    if (root === runtime || root.startsWith(`${runtime}${path.sep}`) || runtime.startsWith(`${root}${path.sep}`)) throw new Error('managed_zotero_paths_overlap');
    const manifest = JSON.parse(fs.readFileSync(path.join(runtime, 'runtime.json'), 'utf8')) as { upstreamCommit: string; platform: string };
    if (manifest.upstreamCommit !== '62335504262f4239961c4e782e342bd3bab4d5b2' || manifest.platform !== `${process.platform}-${process.arch}`) throw new Error('managed_zotero_runtime_incompatible');
    const endpoint = new URL(scope.endpoint);
    if (endpoint.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(endpoint.hostname) || !endpoint.port || endpoint.pathname !== '/api') throw new Error('managed_zotero_endpoint_invalid');
    for (const name of ['cache', 'config', 'tmp']) {
      const directory = path.join(root, name);
      if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) throw new Error('managed_zotero_symlink');
      fs.mkdirSync(directory, { recursive: true });
    }
    const scopeFile = path.join(root, 'scope.json');
    if (fs.existsSync(scopeFile) && fs.lstatSync(scopeFile).isSymbolicLink()) throw new Error('managed_zotero_symlink');
    fs.writeFileSync(scopeFile, JSON.stringify({ ...scope, root }), { mode: 0o600 });
    const environment: Record<string, string> = { HOME: root, XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'),
      TMPDIR: path.join(root, 'tmp'), TEMP: path.join(root, 'tmp'), TMP: path.join(root, 'tmp'), FASTMCP_CHECK_FOR_UPDATES: 'off' };
    for (const name of ['SystemRoot', 'WINDIR', 'LANG']) if (process.env[name]) environment[name] = process.env[name]!;
    const transport = new StdioClientTransport({ command: path.join(runtime, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3'),
      args: ['-I', '-B', path.join(runtime, 'serve.py'), scopeFile], cwd: root, env: environment, stderr: 'pipe' });
    // Drain diagnostics without copying library contents or paths into app logs.
    transport.stderr?.on('data', () => undefined);
    this.status = { installed: true, mode: 'managed', state: 'starting', version: null, transport: 'stdio', error: null };
    this.scope = structuredClone(scope);
    return this.handshake(transport);
  }
  async connectExternal(url: string, scope: ManagedZoteroScopeManifest): Promise<ZoteroMcpStatus> {
    await this.close();
    const endpoint = new URL(url);
    if (endpoint.username || endpoint.password || endpoint.hash || (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(endpoint.hostname)))) throw new Error('external_zotero_endpoint_invalid');
    this.status = { installed: false, mode: 'external', state: 'starting', version: null, transport: 'streamable-http', error: null };
    this.scope = structuredClone(scope);
    return this.handshake(new StreamableHTTPClientTransport(endpoint));
  }
  private async handshake(transport: StdioClientTransport | StreamableHTTPClientTransport): Promise<ZoteroMcpStatus> {
    this.transport = transport;
    const client = new Client({ name: 'nodus-research', version: '1' });
    this.client = client;
    client.onclose = () => { if (this.status.state === 'connected') this.status = { ...this.status, state: 'stopped', error: 'managed_zotero_connection_closed' }; };
    try {
      const pending = client.connect(transport, { timeout: 20000 });
      if (transport instanceof StdioClientTransport) transport.stderr?.on('data', () => undefined);
      await pending;
      const version = client.getServerVersion();
      const capabilities = await client.listTools({}, { timeout: 10000 });
      const names = capabilities.tools.map(tool => tool.name).sort();
      if (version?.name !== 'nodus-zotero-mcp' || version.version !== '0.13.0+nodus.1'
        || JSON.stringify(names) !== JSON.stringify(READ_TOOLS)) throw new Error('managed_zotero_capabilities_incompatible');
      const declared = await client.readResource({ uri: 'nodus://zotero/scope' }, { timeout: 10000 });
      const content = declared.contents[0];
      if (!content || !('text' in content) || typeof content.text !== 'string') throw new Error('managed_zotero_scope_unverifiable');
      const capabilitiesScope = JSON.parse(content.text);
      const items = this.scope!.items.map(item => [item.libraryType, String(item.libraryId), item.itemKey, item.version, item.revision,
        item.attachments.map(attachment => [attachment.key, attachment.version]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      const fingerprint = createHash('sha256').update(JSON.stringify([this.scope!.serverId, items])).digest('hex');
      if (capabilitiesScope.format !== 'nodus.zotero-scope-capabilities/1' || capabilitiesScope.readOnly !== true || capabilitiesScope.fingerprint !== fingerprint) throw new Error('managed_zotero_scope_mismatch');
      this.status = { ...this.status, state: 'connected', version: version.version };
      this.restarts = 0;
      return { ...this.status };
    } catch {
      await this.close();
      this.status = { ...this.status, state: 'incompatible', error: 'managed_zotero_handshake_failed' };
      throw new Error('managed_zotero_handshake_failed');
    }
  }
  async call(tool: ManagedZoteroTool, args: ToolArguments, signal?: AbortSignal): Promise<unknown> {
    if (!READ_TOOLS.includes(tool) || !this.scope || !this.client || this.status.state !== 'connected') throw new Error('managed_zotero_unavailable');
    const item = this.scope.items.find(item => item.libraryType === args.library_type && item.libraryId === args.library_id && item.itemKey === args.item_key);
    if (!item) throw new Error('research_source_not_authorized');
    if (args.attachment_key && !item.attachments.some(attachment => attachment.key === args.attachment_key)) throw new Error('research_attachment_not_authorized');
    if (tool === 'zotero_read_pdf_pages' && (!Number.isInteger(args.start_page) || !Number.isInteger(args.end_page)
      || args.start_page! < 1 || args.end_page! < args.start_page! || args.end_page! - args.start_page! >= 12)) throw new Error('research_invalid_page_range');
    signal?.throwIfAborted();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    this.controllers.add(controller);
    try {
      const result = await this.client.callTool({ name: tool, arguments: { ...args } }, undefined, { signal: controller.signal, timeout: 25000 });
      if (result.isError) throw new Error('managed_zotero_read_failed');
      return result;
    } finally { signal?.removeEventListener('abort', cancel); this.controllers.delete(controller); }
  }
  async close(): Promise<void> {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    const client = this.client;
    this.client = null;
    this.scope = null;
    try { await client?.close(); } finally { this.transport = null; this.status = { ...this.status, state: 'stopped' }; }
  }
}
