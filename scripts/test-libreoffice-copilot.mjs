import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-libreoffice-copilot-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-libreoffice-copilot.mjs'), '--electron-libreoffice-copilot-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(fs.realpathSync(os.tmpdir()) + '/nodus-libreoffice-copilot-test-');
installRuntimeHooks(root);

try {
  const { updateSettings } = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  updateSettings({ copilotToken: 'test-token', copilotEnabled: true, copilotPort: 4320 });

  const server = require(path.join(repoRoot, 'electron/copilot/server.ts'));

  // Editor state round-trip: update-text → state.
  {
    const req = mockRequest('POST', '/api/editor/update-text', authHeaders(), {
      paragraphText: 'Este es el texto del parrafo en LibreOffice.',
      selectionText: 'LibreOffice',
    });
    const res = mockResponse();
    await server.handleRequest(req, res, 4320);
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.getBody()).ok, true);

    const stateRes = mockResponse();
    await server.handleRequest(mockRequest('GET', '/api/editor/state', authHeaders()), stateRes, 4320);
    const state = JSON.parse(stateRes.getBody());
    assert.equal(stateRes.statusCode, 200);
    assert.equal(state.paragraphText, 'Este es el texto del parrafo en LibreOffice.');
    assert.equal(state.selectionText, 'LibreOffice');
  }

  // The editor endpoints stay behind the bearer token.
  {
    const res = mockResponse();
    await server.handleRequest(mockRequest('GET', '/api/editor/state', {}), res, 4320);
    assert.equal(res.statusCode, 401, 'editor endpoints must require the token');
  }

  // Insert with no macro long-polling → accepted but delivered:false.
  {
    const res = mockResponse();
    await server.handleRequest(
      mockRequest('POST', '/api/editor/insert', authHeaders(), { text: 'sin oyente' }),
      res,
      4320
    );
    const body = JSON.parse(res.getBody());
    assert.equal(res.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(body.delivered, false, 'no poller connected → delivered must be false');
  }

  // Long-poll + insert: the queued poller receives the text and delivered:true.
  {
    const pollRes = mockResponse();
    const pollPromise = server.handleRequest(
      mockRequest('GET', '/api/editor/poll-insertion', authHeaders()),
      pollRes,
      4320
    );
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the poller enqueue

    const insertRes = mockResponse();
    await server.handleRequest(
      mockRequest('POST', '/api/editor/insert', authHeaders(), { text: 'Texto de cita generada por la IA' }),
      insertRes,
      4320
    );
    assert.equal(insertRes.statusCode, 200);
    assert.equal(JSON.parse(insertRes.getBody()).delivered, true);

    await pollPromise;
    assert.equal(pollRes.statusCode, 200);
    assert.equal(JSON.parse(pollRes.getBody()).text, 'Texto de cita generada por la IA');
  }

  // A poller whose connection died must leave the queue: a later insert reports
  // delivered:false instead of handing the text to a dead response.
  {
    const pollRes = mockResponse();
    const pollPromise = server.handleRequest(
      mockRequest('GET', '/api/editor/poll-insertion', authHeaders()),
      pollRes,
      4320
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    pollRes.emit('close'); // client gone (premature termination)
    await pollPromise; // must settle without a response write

    const insertRes = mockResponse();
    await server.handleRequest(
      mockRequest('POST', '/api/editor/insert', authHeaders(), { text: 'huérfano' }),
      insertRes,
      4320
    );
    assert.equal(
      JSON.parse(insertRes.getBody()).delivered,
      false,
      'a disconnected poller must not swallow later insertions'
    );
  }

  // Insert options (footnote / replace) travel through the bridge to the poller.
  {
    const pollRes = mockResponse();
    const pollPromise = server.handleRequest(
      mockRequest('GET', '/api/editor/poll-insertion', authHeaders()),
      pollRes,
      4320
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    const insertRes = mockResponse();
    await server.handleRequest(
      mockRequest('POST', '/api/editor/insert', authHeaders(), {
        text: 'Cita en nota al pie',
        asFootnote: true,
        replace: true,
      }),
      insertRes,
      4320
    );
    assert.equal(JSON.parse(insertRes.getBody()).delivered, true);

    await pollPromise;
    const delivered = JSON.parse(pollRes.getBody());
    assert.equal(delivered.text, 'Cita en nota al pie');
    assert.equal(delivered.asFootnote, true, 'footnote flag must reach the poller');
    assert.equal(delivered.replace, true, 'replace flag must reach the poller');
  }

  // Passage search with no embedding provider configured: available:false, no crash.
  {
    const res = mockResponse();
    await server.handleRequest(
      mockRequest('POST', '/api/passages', authHeaders(), { query: 'pobreza en el relato de viajes' }),
      res,
      4320
    );
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.getBody());
    assert.equal(body.available, false, 'no embeddings → passages unavailable');
    assert.deepEqual(body.passages, [], 'no passages without embeddings');
  }

  // Compose over a selection with no embeddings: graceful available:false, no throw.
  {
    const res = mockResponse();
    await server.handleRequest(
      mockRequest('POST', '/api/compose', authHeaders(), {
        mode: 'counter',
        selectionText: 'El turismo documenta fielmente la realidad del país.',
        paragraphText: 'El turismo documenta fielmente la realidad del país.',
      }),
      res,
      4320
    );
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.getBody());
    assert.equal(body.available, false, 'no embeddings → compose unavailable');
    assert.equal(body.mode, 'counter', 'compose echoes the requested mode');
    assert.equal(body.text, '', 'no draft without embeddings');
  }

  // An unknown compose mode falls back to a valid default instead of erroring.
  {
    const res = mockResponse();
    await server.handleRequest(
      mockRequest('POST', '/api/compose', authHeaders(), {
        mode: 'bogus',
        selectionText: 'Una frase suficientemente larga para analizar.',
        paragraphText: 'Una frase suficientemente larga para analizar.',
      }),
      res,
      4320
    );
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.getBody()).mode, 'expand', 'unknown mode defaults to expand');
  }

  // Bridge discovery file: port + token for the LibreOffice macro.
  {
    const bridgeDir = path.join(root, 'bridge-state');
    const bridgePath = await server.writeCopilotBridgeFile(4320, bridgeDir);
    const bridge = JSON.parse(fs.readFileSync(bridgePath, 'utf8'));
    assert.equal(bridge.port, 4320);
    assert.equal(bridge.token, 'test-token');
    assert.ok('caCert' in bridge, 'bridge must carry the caCert field (may be null without certs)');
    if (process.platform !== 'win32') {
      const mode = fs.statSync(bridgePath).mode & 0o777;
      assert.equal(mode, 0o600, 'bridge file must be owner-only');
    }
  }

  console.log('LibreOffice Copilot integration test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

// Helpers
function authHeaders() {
  return { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
}

function mockRequest(method, url, headers = {}, body = null) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = {};
  for (const [k, v] of Object.entries(headers)) {
    req.headers[k.toLowerCase()] = v;
  }

  if (body) {
    const rawBody = JSON.stringify(body);
    req[Symbol.asyncIterator] = async function* () {
      yield Buffer.from(rawBody, 'utf8');
    };
  } else {
    req[Symbol.asyncIterator] = async function* () {};
  }
  return req;
}

function mockResponse() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.bodyChunks = [];
  res.writableEnded = false;
  res.destroyed = false;
  res.setHeader = function (name, value) {
    this.headers[name.toLowerCase()] = value;
  };
  res.writeHead = function (statusCode, headers = {}) {
    this.statusCode = statusCode;
    Object.assign(this.headers, headers);
    return this;
  };
  res.end = function (data) {
    if (data) {
      this.bodyChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'));
    }
    this.writableEnded = true;
  };
  res.getBody = function () {
    return Buffer.concat(this.bodyChunks).toString('utf8');
  };
  return res;
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;

  const Database = require('better-sqlite3');
  const testDb = new Database(':memory:');
  testDb.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');

  const electronStub = {
    app: {
      getPath() {
        return userDataPath;
      },
      getVersion() {
        return '0.0.0-test';
      },
      getAppPath() {
        return repoRoot;
      },
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable() {
        return false;
      },
      encryptString(value) {
        return Buffer.from(String(value), 'utf8');
      },
      decryptString(value) {
        return Buffer.from(value).toString('utf8');
      },
    },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  };

  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };

  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    if (request === './database' || request === '../database') {
      return {
        getDb() {
          return testDb;
        },
      };
    }
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
        jsx: ts.JsxEmit.ReactJSX,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
