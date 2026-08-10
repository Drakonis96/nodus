// Integration test for the MCP session idle-TTL sweep. Boots the REAL Streamable
// HTTP server, opens a genuine MCP session with the SDK client over HTTP, and
// verifies the sweep leaves fresh sessions alone but evicts idle ones (the leak a
// client that dies without DELETE would otherwise cause).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-mcp-ttl-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-mcp-session-ttl.mjs'), '--electron-mcp-ttl-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-mcp-ttl-'));
installRuntimeHooks(root);

let stopServer = null;
try {
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const db = getDb(); // migrate the throwaway profile before touching settings
  // Reproduce the catalogue that exposed the bug: Docencia used to advertise only
  // 23 tools. If a client cached that list and the user switched to an academic vault,
  // capabilities could count thousands of ideas while no idea reader existed.
  const { getActiveVault, setVaultType } = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  setVaultType(getActiveVault().id, 'docencia');
  db.prepare('INSERT INTO ideas (global_id, type, label, statement, created_at) VALUES (?, ?, ?, ?, ?)').run(
    'idea-visible-after-switch',
    'claim',
    'Spain is different',
    'The MCP must retrieve a generated idea even when its cached catalogue originated in another vault type.',
    new Date().toISOString(),
  );
  const savedReportId = 'deep-report-visible-over-http';
  const savedReportBrief = {
    kind: 'deep_research',
    objective: 'Audit persistent Deep Research access over MCP',
    language: 'en',
  };
  const savedReportSelection = {
    ideaIds: [], themeIds: [], gapIds: [], contradictionIds: [], workIds: [], passageIds: [], tutorRouteIds: [],
  };
  const savedReportDraft = {
    generatedAt: new Date().toISOString(),
    brief: savedReportBrief,
    selection: savedReportSelection,
    title: 'Persistent MCP report',
    abstract: 'A saved report must remain visible even when the generation lane is empty.',
    outline: [],
    draftMarkdown: '# Persistent MCP report\n\nFull report body.',
    matrix: [],
    bibliography: [],
    nextSteps: [],
    limitations: [],
    stats: {
      selectedIdeas: 0, selectedThemes: 0, selectedGaps: 0, selectedContradictions: 0,
      selectedWorks: 0, selectedPassages: 0, selectedTutorRoutes: 0, contextChars: 0, truncated: false,
    },
  };
  db.prepare(
    `INSERT INTO writing_saved_drafts
       (id, title, brief_json, selection_json, model_json, draft_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`
  ).run(
    savedReportId,
    savedReportDraft.title,
    JSON.stringify(savedReportBrief),
    JSON.stringify(savedReportSelection),
    JSON.stringify(savedReportDraft),
    savedReportDraft.generatedAt,
    savedReportDraft.generatedAt,
  );
  const { updateSettings } = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const port = await findFreeLoopbackPort();
  const token = 'ttl-test-token';
  updateSettings({ mcpEnabled: true, mcpPort: port, mcpToken: token });

  const server = require(path.join(repoRoot, 'electron/mcp/server.ts'));
  stopServer = server.stopMcpServer;
  await server.startMcpServer();
  assert.equal(server.getMcpStatus().running, true, 'server should be listening');

  // A real MCP client session over HTTP.
  const { Client } = await import(
    path.join(repoRoot, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')
  );
  const { StreamableHTTPClientTransport } = await import(
    path.join(repoRoot, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js')
  );
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'ttl-test', version: '0.0.0' });
  await client.connect(transport);

  const tools = await client.listTools();
  const toolNames = new Set(tools.tools.map((tool) => tool.name));
  assert.ok(toolNames.has('nodus_get_capabilities'), 'tools/list works over HTTP');
  for (const name of [
    'nodus_list_ideas',
    'nodus_get_idea',
    'nodus_search_ideas',
    'nodus_list_works',
    'nodus_read_author_synthesis',
    'nodus_list_writing_drafts',
    'nodus_get_writing_draft',
    'nodus_list_deep_research_reports',
    'nodus_get_deep_research_report',
    'nodus_get_passage',
    'nodus_search_notes',
    'nodus_list_persons',
    'nodus_list_databases',
    'nodus_study_get_document',
    'nodus_teaching_get_gradebook',
    'nodus_world_search',
    'nodus_prosop_search',
  ]) assert.ok(toolNames.has(name), `${name} remains readable in the Docencia catalogue`);
  assert.ok(!toolNames.has('nodus_create_database_row'), 'an incompatible database write stays hidden');
  assert.ok(!toolNames.has('nodus_world_create_character'), 'an incompatible worldbuilding write stays hidden');
  assert.equal(server.__sessionCountForTest(), 1, 'one live session after connect');

  // The real McpServer must forward structuredContent end-to-end (not just the
  // FakeServer used by the contract test).
  const caps = await client.callTool({ name: 'nodus_get_capabilities', arguments: {} });
  assert.ok(caps.structuredContent, 'structuredContent reaches the client over HTTP');
  assert.equal(typeof caps.structuredContent.version, 'string', 'structured capabilities carry the version');
  assert.equal(caps.structuredContent.vault.active.type, 'docencia', 'the protocol test really uses the formerly narrow Docencia surface');
  assert.match(caps.structuredContent.access.read, /stay available across vault switches/);
  assert.equal(caps.structuredContent.counts.ideas, 1, 'capabilities reports the deliberately cross-layer idea');
  assert.equal(caps.structuredContent.counts.deepResearchReports, 1, 'capabilities reports the persistent report gallery');

  const ideas = await client.callTool({ name: 'nodus_list_ideas', arguments: { query: 'Spain is different', limit: 10, offset: 0 } });
  assert.notEqual(ideas.isError, true, 'a cross-layer read is callable over the real protocol');
  assert.equal(ideas.structuredContent.total, 1, 'the idea counted by capabilities is retrievable through the same session');
  assert.equal(ideas.structuredContent.ideas[0].global_id, 'idea-visible-after-switch');

  const jobs = await client.callTool({ name: 'nodus_list_deep_research_jobs', arguments: { status: 'all' } });
  assert.equal(jobs.structuredContent.jobs.length, 0, 'the protocol fixture deliberately has an empty generation lane');
  const reports = await client.callTool({
    name: 'nodus_list_deep_research_reports',
    arguments: { query: 'Persistent', sort: 'newest', limit: 10, offset: 0 },
  });
  assert.notEqual(reports.isError, true, 'the saved-report catalogue is callable over the real protocol');
  assert.equal(reports.structuredContent.total, 1, 'a saved report is visible independently of the empty generation lane');
  assert.equal(reports.structuredContent.reports[0].id, savedReportId);
  assert.equal('draft' in reports.structuredContent.reports[0], false, 'the catalogue response is compact');
  const report = await client.callTool({
    name: 'nodus_get_deep_research_report',
    arguments: { reportId: savedReportId },
  });
  assert.notEqual(report.isError, true, 'saved-report detail is callable over the real protocol');
  assert.equal(report.structuredContent.report.draft.draftMarkdown, savedReportDraft.draftMarkdown);

  // A fresh session is under the default TTL, so the sweep must not touch it.
  server.sweepIdleSessions();
  assert.equal(server.__sessionCountForTest(), 1, 'fresh session survives the sweep');

  // With the TTL collapsed to zero the same session is now "idle" and evicted.
  server.__setSessionIdleTtlForTest(0);
  server.sweepIdleSessions();
  assert.equal(server.__sessionCountForTest(), 0, 'idle session is swept');

  await client.close().catch(() => {});
  closeDb();
  console.log('mcp session ttl test passed');
} finally {
  if (stopServer) await stopServer().catch(() => {});
  await rm(root, { recursive: true, force: true });
}

async function findFreeLoopbackPort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  assert.ok(port > 0, 'the operating system allocated an MCP test port');
  return port;
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath: () => userDataPath,
      getVersion: () => '0.0.0-test',
      getAppPath: () => repoRoot,
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(String(value), 'utf8'),
      decryptString: (value) => Buffer.from(value).toString('utf8'),
    },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  };

  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      // A shared entry is either a file (shared/x.ts) or a directory barrel
      // (shared/x/index.ts) — fall back to the index so a package-style import resolves.
      const base = path.join(repoRoot, request.replace('@shared/', 'shared/'));
      const asFile = `${base}.ts`;
      return fs.existsSync(asFile) ? asFile : path.join(base, 'index.ts');
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
