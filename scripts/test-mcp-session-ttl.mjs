// Integration test for the MCP session idle-TTL sweep. Boots the REAL Streamable
// HTTP server, opens a genuine MCP session with the SDK client over HTTP, and
// verifies the sweep leaves fresh sessions alone but evicts idle ones (the leak a
// client that dies without DELETE would otherwise cause).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import { createRequire } from 'node:module';
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
  getDb(); // migrate the throwaway profile before touching settings
  const { updateSettings } = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const port = 4319 + Math.floor(Math.random() * 200);
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
  assert.ok(tools.tools.some((t) => t.name === 'nodus_get_capabilities'), 'tools/list works over HTTP');
  assert.equal(server.__sessionCountForTest(), 1, 'one live session after connect');

  // The real McpServer must forward structuredContent end-to-end (not just the
  // FakeServer used by the contract test).
  const caps = await client.callTool({ name: 'nodus_get_capabilities', arguments: {} });
  assert.ok(caps.structuredContent, 'structuredContent reaches the client over HTTP');
  assert.equal(typeof caps.structuredContent.version, 'string', 'structured capabilities carry the version');

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
