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

// Mock Settings Database
const settingsDbFile = fs.readFileSync(path.join(repoRoot, 'scripts/stub-electron.mjs'), 'utf8');

try {
  const { getSettings, updateSettings } = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  updateSettings({ copilotToken: 'test-token', copilotEnabled: true, copilotPort: 4320 });

  const serverModulePath = path.join(repoRoot, 'electron/copilot/server.ts');
  const server = require(serverModulePath);
  
  // Test 1: Update text endpoint (/api/editor/update-text)
  {
    const req = mockRequest('POST', '/api/editor/update-text', {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json'
    }, {
      paragraphText: 'Este es el texto del parrafo en LibreOffice.',
      selectionText: 'LibreOffice'
    });
    
    const res = mockResponse();
    await server.handleRequest(req, res, 4320);

    const responseBody = JSON.parse(res.getBody());
    assert.equal(res.statusCode, 200);
    assert.equal(responseBody.ok, true);
  }

  // Test 2: Get state endpoint (/api/editor/state)
  {
    const req = mockRequest('GET', '/api/editor/state', {
      Authorization: 'Bearer test-token'
    });
    
    const res = mockResponse();
    await server.handleRequest(req, res, 4320);

    const responseBody = JSON.parse(res.getBody());
    assert.equal(res.statusCode, 200);
    assert.equal(responseBody.paragraphText, 'Este es el texto del parrafo en LibreOffice.');
    assert.equal(responseBody.selectionText, 'LibreOffice');
  }

  // Test 3: Long polling (/api/editor/poll-insertion) and insertion (/api/editor/insert)
  {
    const pollReq = mockRequest('GET', '/api/editor/poll-insertion', {
      Authorization: 'Bearer test-token'
    });
    const pollRes = mockResponse();

    // Start poll in background/promise
    const pollPromise = server.handleRequest(pollReq, pollRes, 4320);

    // Call insertion endpoint
    const insertReq = mockRequest('POST', '/api/editor/insert', {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json'
    }, {
      text: 'Texto de cita generada por la IA'
    });
    const insertRes = mockResponse();
    await server.handleRequest(insertReq, insertRes, 4320);

    assert.equal(insertRes.statusCode, 200);
    assert.equal(JSON.parse(insertRes.getBody()).ok, true);

    // Wait for poll to resolve
    await pollPromise;
    assert.equal(pollRes.statusCode, 200);
    assert.equal(JSON.parse(pollRes.getBody()).text, 'Texto de cita generada por la IA');
  }

  console.log('LibreOffice Copilot integration test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

// Helpers
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
  const res = {
    statusCode: 200,
    headers: {},
    bodyChunks: [],
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      Object.assign(this.headers, headers);
    },
    end(data) {
      if (data) {
        this.bodyChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'));
      }
      if (this.resolvePromise) this.resolvePromise();
    },
    getBody() {
      return Buffer.concat(this.bodyChunks).toString('utf8');
    },
    wait() {
      return new Promise((resolve) => {
        this.resolvePromise = resolve;
      });
    }
  };
  return res;
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;

  // Mock SQLite DB
  const Database = require('better-sqlite3');
  const testDb = new Database(':memory:');
  testDb.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');

  const electronStub = {
    app: {
      getPath() {
        return userDataPath;
      },
      getVersion() {
        return '0.8.13';
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
        }
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
