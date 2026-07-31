// Measures what a multi-probe snapshot reaches that a single probe does not.
//
// The report is built from whatever the semantic search returns, so the width of
// that search is a hard ceiling on the report. This compares the pool obtained from
// the objective alone against the pool obtained by also probing each sub-question,
// over the real corpus.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const FLAG = '--electron-breadth';
const argOf = (n, d) => { const at = process.argv.indexOf(n); return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : d; };
const snapshotDir = path.resolve(argOf('--snapshot', path.join(os.tmpdir(), 'nodus-dr-userdata')));

const OBJECTIVES = [
  'Analiza cómo el turismo y la literatura de viajes contribuyeron a construir la identidad nacional y regional española durante el franquismo, atendiendo a la cultura visual, la fotografía y los usos propagandísticos del patrimonio.',
  'Examina el papel de la fotografía y la cultura visual en la representación del paisaje y el patrimonio españoles, discutiendo qué convierte una imagen en documento histórico y qué la convierte en propaganda.',
  'Discute cómo se han estudiado el género y la mirada colonial en el turismo y la literatura de viajes sobre España, contrastando las posiciones historiográficas en disputa y señalando qué preguntas siguen abiertas.',
];

if (!process.argv.includes(FLAG)) {
  if (!process.env.GEMINI_API_KEY?.trim()) throw new Error('Set GEMINI_API_KEY for this isolated run.');
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [...process.argv.slice(1), FLAG], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', maxBuffer: 64 * 1024 * 1024,
  });
  process.exit(0);
}

const apiKey = process.env.GEMINI_API_KEY?.trim();
const openRouterKey = process.env.OPENROUTER_API_KEY?.trim() || null;
installRuntimeHooks(snapshotDir);
let closeDb = () => undefined;
try {
  const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const workshop = require(path.join(repoRoot, 'electron/ai/writingWorkshop.ts'));
  const deepResearch = require(path.join(repoRoot, 'electron/ai/deepResearch.ts'));
  ({ closeDb } = require(path.join(repoRoot, 'electron/db/database.ts')));
  secrets.setApiKey('gemini', apiKey);
  if (openRouterKey) secrets.setApiKey('openrouter', openRouterKey);
  delete process.env.GEMINI_API_KEY;
  const modelName = argOf('--model', 'gemini-3.1-flash-lite');
  settingsRepo.updateSettings({ deepResearchModel: { provider: 'gemini', model: modelName }, promptLanguage: 'es' });
  const model = { provider: 'gemini', model: modelName };

  const worksOf = (snapshot) => {
    const set = new Set();
    for (const idea of snapshot.ideas) for (const w of idea.works ?? []) set.add(w.nodus_id);
    return set;
  };

  const pad = (v, n) => String(v).padEnd(n);
  console.log(pad('objetivo', 14) + pad('sondas', 8) + pad('ideas 1', 9) + pad('ideas N', 9) + pad('nuevas', 8) + pad('obras 1', 9) + pad('obras N', 9) + pad('pasajes 1', 11) + 'pasajes N');
  console.log('─'.repeat(92));
  for (const [index, objective] of OBJECTIVES.entries()) {
    const brief = { kind: 'deep_research', objective, tone: 'academic', language: 'es' };
    const single = await workshop.buildWritingWorkshopSnapshot(brief);
    const probes = await deepResearch.__decomposeObjectiveForTesting(objective, 'es', model);
    const multi = await workshop.buildWritingWorkshopSnapshot(brief, probes);

    const singleIdeas = new Set(single.ideas.map((i) => i.id));
    const fresh = multi.ideas.filter((i) => !singleIdeas.has(i.id)).length;
    console.log(
      pad(`obj-${index + 1}`, 14) + pad(probes.length, 8) + pad(single.ideas.length, 9) + pad(multi.ideas.length, 9) +
        pad(`${fresh} (${Math.round((fresh / Math.max(1, multi.ideas.length)) * 100)}%)`, 8) +
        pad(worksOf(single).size, 9) + pad(worksOf(multi).size, 9) +
        pad(single.passages.length, 11) + multi.passages.length
    );
    if (index === 0) for (const p of probes) console.log(`      · ${p.slice(0, 110)}`);
  }
} finally {
  try { closeDb(); } catch { /* best effort */ }
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-breadth', getAppPath: () => repoRoot, isPackaged: false, getName: () => 'Nodus' },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (v) => Buffer.from(String(v)), decryptString: (v) => Buffer.from(v).toString() },
    dialog: { showMessageBoxSync: () => 1 }, shell: {}, BrowserWindow: class {}, ipcMain: { handle: () => undefined, on: () => undefined }, net: {},
  };
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function (request, parent, isMain) { if (request === 'electron') return electronStub; return originalLoad.call(this, request, parent, isMain); };
  require.extensions['.ts'] = function (module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true },
    }).outputText;
    module._compile(output, filename);
  };
}
