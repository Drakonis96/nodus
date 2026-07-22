// Headless verification of the "Nodus for Zotero" local server.
//
// Runs the real server module under Electron-as-Node (so better-sqlite3's native
// binary loads) against a COPY of the real academic vault, then curls every
// endpoint. Never touches the live vault files.
//
//   node scripts/verify-zotero-server.mjs
//
// It re-execs itself under Electron-as-Node with a throwaway NODUS_USERDATA.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const electronBin = path.join(repoRoot, 'node_modules/.bin/electron');
const SERVE = process.argv.includes('--serve'); // stay up so the installed plugin can connect
const PORT = SERVE ? 4321 : 4399;
const TOKEN = 'verify-token-abc';

if (!process.argv.includes('--seed')) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-ztest-'));
  try {
    execFileSync(electronBin, [fileURLToPath(import.meta.url), '--seed', ...(SERVE ? ['--serve'] : [])], {
      cwd: repoRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODUS_USERDATA: profileDir, NODUS_ZTEST_PORT: String(PORT), NODUS_ZTEST_TOKEN: TOKEN, NODUS_ZTEST_SERVE: SERVE ? '1' : '' },
      stdio: 'inherit',
    });
  } finally {
    fs.rmSync(profileDir, { recursive: true, force: true });
    try { fs.rmSync(path.join(os.homedir(), '.nodus', 'zotero-bridge.json')); } catch (e) {}
  }
  process.exit(0);
}

// ─────────────────────────────────────────── seed pass (Electron-as-Node)
installRuntimeHooks(process.env.NODUS_USERDATA);
const Database = require('better-sqlite3');
const database = require(path.join(repoRoot, 'electron/db/database.ts'));
const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`); };

// 1) Find the best academic vault (works with deep_status='done' + zotero_key + most ideas).
const vaultsBase = path.join(process.env.HOME, 'Library/Application Support/Nodus/vaults');
let best = null;
for (const id of fs.existsSync(vaultsBase) ? fs.readdirSync(vaultsBase) : []) {
  const p = path.join(vaultsBase, id, 'nodus.sqlite');
  if (!fs.existsSync(p)) continue;
  let ro;
  try { ro = new Database(p, { readonly: true, fileMustExist: true }); } catch (e) { continue; }
  try {
    const hasWorks = ro.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='works'").get();
    if (!hasWorks) { ro.close(); continue; }
    const sample = ro.prepare(
      `SELECT w.nodus_id, w.zotero_key, w.title,
              (SELECT COUNT(*) FROM idea_occurrences io WHERE io.nodus_id=w.nodus_id) AS ideas
         FROM works w
        WHERE w.deep_status='done' AND w.zotero_key IS NOT NULL AND w.zotero_key<>''
        ORDER BY ideas DESC LIMIT 1`
    ).get();
    if (sample && sample.ideas > 0 && (!best || sample.ideas > best.ideas)) best = { path: p, ...sample };
  } catch (e) { /* not academic */ }
  ro.close();
}
if (!best) { console.error('No academic vault with analyzed works found — cannot verify.'); process.exit(2); }
console.log(`Using vault ${path.basename(path.dirname(best.path))} · sample "${(best.title || '').slice(0, 40)}" (${best.ideas} ideas, key ${best.zotero_key})`);

// 2) Copy that vault into the throwaway profile's active-vault slot.
database.getDb();                        // initialise the default vault + registry
const target = database.openDbPath();
database.closeDb();
for (const suffix of ['', '-wal', '-shm']) {
  const src = best.path + suffix;
  if (fs.existsSync(src)) fs.copyFileSync(src, target + suffix);
}
database.getDb();                        // reopen on the copied data

// 3) Seed settings: enable the server, set token/port, and seed featured models.
const FEATURED = [
  { provider: 'anthropic', model: 'claude-sonnet-5' },
  { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
];
settingsRepo.updateSettings({
  zoteroPluginEnabled: true,
  zoteroPluginPort: Number(process.env.NODUS_ZTEST_PORT),
  zoteroPluginToken: process.env.NODUS_ZTEST_TOKEN,
  favorites: FEATURED,
  synthesisModel: FEATURED[0],
});

// 4) Start the server and curl every endpoint.
const server = require(path.join(repoRoot, 'electron/zotero-plugin/server.ts'));
const base = `http://127.0.0.1:${process.env.NODUS_ZTEST_PORT}`;
const auth = { Authorization: `Bearer ${process.env.NODUS_ZTEST_TOKEN}`, 'Content-Type': 'application/json' };

await server.startZoteroPluginServer();

if (process.env.NODUS_ZTEST_SERVE === '1') {
  console.log(`\n[serve] Live Nodus test server on ${base}, serving a COPY of your academic vault.`);
  console.log('[serve] Bridge written to ~/.nodus/zotero-bridge.json — click the Nodus button in Zotero to connect. Ctrl-C to stop.\n');
  setInterval(() => {}, 1 << 30);
} else {
try {
  // health (tokenless)
  const health = await (await fetch(`${base}/api/z/health`)).json();
  check('health', health.ok === true && !!health.vault, `vault="${health.vault?.name}" type=${health.vault?.type} corpus=${health.corpusSize} embeddings=${health.embeddingsConfigured}`);

  // 401 without token
  const noAuth = await fetch(`${base}/api/z/models`);
  check('auth required', noAuth.status === 401, `status ${noAuth.status}`);

  // featured models
  const models = await (await fetch(`${base}/api/z/models`, { headers: auth })).json();
  const gotFeatured = FEATURED.every((f) => models.models?.some((m) => m.provider === f.provider && m.model === f.model));
  check('featured models', gotFeatured, `returned ${models.models?.length} (${models.models?.map((m) => m.model).join(', ')}); default=${models.default?.model}`);

  // resolve by zotero_key
  const resolved = await (await fetch(`${base}/api/z/resolve`, { method: 'POST', headers: auth, body: JSON.stringify({ zoteroKey: best.zotero_key }) })).json();
  check('resolve zotero_key → work', resolved.matched === true && resolved.hasAnalysis === true, `nodusId=${resolved.nodusId?.slice(0, 8)} ideaCount=${resolved.ideaCount}`);

  // ideas
  const ideas = await (await fetch(`${base}/api/z/ideas`, { method: 'POST', headers: auth, body: JSON.stringify({ zoteroKey: best.zotero_key }) })).json();
  check('ideas of work', Array.isArray(ideas.ideas) && ideas.ideas.length > 0, `${ideas.ideas?.length} ideas; e.g. "${ideas.ideas?.[0]?.label?.slice(0, 50)}"`);

  // connections
  const conns = await (await fetch(`${base}/api/z/connections`, { method: 'POST', headers: auth, body: JSON.stringify({ zoteroKey: best.zotero_key }) })).json();
  check('connections across library', conns.matched === true, `${conns.works?.length ?? 0} connected works (top shares ${conns.works?.[0]?.sharedIdeas ?? 0} ideas)`);

  // chat stream (plumbing: expect a meta line, then deltas OR a clean error since no model key is available headlessly)
  const chatRes = await fetch(`${base}/api/z/chat/stream`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ model: FEATURED[0], messages: [{ role: 'user', content: 'Summarize this document in one line.' }], context: { zoteroKey: best.zotero_key, useCorpus: false } }),
  });
  let sawMeta = false, sawDelta = false, sawError = false, metaIdeas = 0;
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of chatRes.body) {
    buf += dec.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
      if (!line) continue;
      let o; try { o = JSON.parse(line); } catch (e) { continue; }
      if (o.type === 'meta') { sawMeta = true; metaIdeas = (o.ideas || []).length; }
      else if (o.type === 'delta') sawDelta = true;
      else if (o.type === 'error') sawError = true;
    }
  }
  check('chat stream (NDJSON + meta)', sawMeta, `meta.ideas=${metaIdeas}, delta=${sawDelta}, error=${sawError} (delta OR error expected without a live model key)`);
} finally {
  await server.stopZoteroPluginServer();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed.`);
process.exit(passed === results.length ? 0 : 1);
}

// ─────────────────────────────────────────── electron stub + TS require hook
function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-ztest', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (v) => Buffer.from(String(v), 'utf8'),
      decryptString: (v) => Buffer.from(v).toString('utf8'),
    },
    dialog: {},
    shell: { openExternal: async () => {} },
    BrowserWindow: class {},
    ipcMain: { on: () => {}, handle: () => {} },
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
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
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
