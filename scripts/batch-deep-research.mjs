// Generates N Deep Research reports across several objectives against one frozen
// corpus snapshot, so the engine's behaviour can be judged on its distribution
// rather than on a single lucky run.
//
//   electron scripts/with-nodus-keys.cjs --providers gemini,openrouter -- \
//     node scripts/batch-deep-research.mjs --runs 5 --out DIR --snapshot DIR
//
// Each report is written as <topic>-<n>.json/.md. Failures are recorded and the
// batch continues: one bad run must not cost the other fourteen.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const FLAG = '--electron-batch-deep-research';
const argOf = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};

const RUNS = Number(argOf('--runs', '5'));
const outDir = path.resolve(argOf('--out', path.join(os.tmpdir(), 'nodus-dr-batch')));
const snapshotDir = path.resolve(argOf('--snapshot', path.join(os.tmpdir(), 'nodus-dr-userdata')));
const sourceDb = argOf('--source-db', path.join(os.homedir(), 'Library/Application Support/nodus/nodus.sqlite'));

// Three objectives that stress different parts of the corpus: a broad synthesis,
// a narrow visual-culture question, and one aimed squarely at disagreement.
const TOPICS = [
  {
    key: 'identidad',
    objective:
      'Analiza cómo el turismo y la literatura de viajes contribuyeron a construir la identidad nacional y regional española durante el franquismo, atendiendo a la cultura visual, la fotografía y los usos propagandísticos del patrimonio.',
  },
  {
    key: 'fotografia',
    objective:
      'Examina el papel de la fotografía y la cultura visual en la representación del paisaje y el patrimonio españoles, discutiendo qué convierte una imagen en documento histórico y qué la convierte en propaganda.',
  },
  {
    key: 'genero',
    objective:
      'Discute cómo se han estudiado el género y la mirada colonial en el turismo y la literatura de viajes sobre España, contrastando las posiciones historiográficas en disputa y señalando qué preguntas siguen abiertas.',
  },
];

if (!process.argv.includes(FLAG)) {
  if (!process.env.GEMINI_API_KEY?.trim()) throw new Error('Set GEMINI_API_KEY for this isolated run.');
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [...process.argv.slice(1), FLAG], {
    cwd: repoRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    maxBuffer: 256 * 1024 * 1024,
  });
  process.exit(0);
}

const apiKey = process.env.GEMINI_API_KEY?.trim();
const openRouterKey = process.env.OPENROUTER_API_KEY?.trim() || null;
assert.ok(apiKey, 'Gemini key reaches only the isolated child process.');

fs.mkdirSync(snapshotDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });
const snapshotDb = path.join(snapshotDir, 'nodus.sqlite');
if (!fs.existsSync(snapshotDb)) {
  const Database = require('better-sqlite3');
  const source = new Database(sourceDb, { readonly: true, fileMustExist: true });
  source.prepare('VACUUM INTO ?').run(snapshotDb);
  source.close();
  console.log(`[snapshot] built → ${snapshotDb}`);
}

installRuntimeHooks(snapshotDir);

let closeDb = () => undefined;
try {
  const vaults = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  assert.equal(vaults.getActiveVault().type, 'academic', 'the batch must run the academic pipeline');
  const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const providers = require(path.join(repoRoot, 'electron/ai/providers.ts'));
  ({ closeDb } = require(path.join(repoRoot, 'electron/db/database.ts')));

  secrets.setApiKey('gemini', apiKey);
  if (openRouterKey) secrets.setApiKey('openrouter', openRouterKey);
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;

  // Codex is a managed subscription: its models come from the CLI runtime, not from
  // a keyed /models endpoint, and its credentials are bound to this profile's
  // codexHome — a copied profile reports itself disconnected.
  const provider = argOf('--provider', 'gemini');
  let modelName;
  if (provider === 'codex') {
    const codex = require(path.join(repoRoot, 'electron/ai/codexSubscription.ts'));
    const status = await codex.getChatGptSubscriptionStatus(true);
    assert.ok(status?.connected, 'Connect a ChatGPT subscription in this profile before running with --provider codex');
    const wanted = argOf('--model', 'gpt-5.6-luna');
    const available = await codex.listChatGptSubscriptionModels();
    modelName = available.some((m) => (m.id ?? m) === wanted) ? wanted : (available[0]?.id ?? available[0]);
    assert.ok(modelName, 'no Codex model available');
  } else {
    const wanted = argOf('--model', 'gemini-3.1-flash-lite');
    const available = await providers.listModels('gemini', secrets.getApiKey('gemini'));
    modelName = available.some((m) => m.id === wanted) ? wanted : available.find((m) => /flash-lite/.test(m.id))?.id;
    assert.ok(modelName, 'no flash-lite model available');
  }
  settingsRepo.updateSettings({ deepResearchModel: { provider, model: modelName }, promptLanguage: 'es' });
  console.log(`[model] ${provider}/${modelName} · ${TOPICS.length} temas × ${RUNS} ejecuciones = ${TOPICS.length * RUNS} informes\n`);

  const workshop = require(path.join(repoRoot, 'electron/ai/writingWorkshop.ts'));
  const { generateDeepResearchReport } = require(path.join(repoRoot, 'electron/ai/deepResearch.ts'));

  const failures = [];
  for (const topic of TOPICS) {
    for (let run = 1; run <= RUNS; run++) {
      const label = `${topic.key}-${run}`;
      const target = path.join(outDir, `${label}.json`);
      if (fs.existsSync(target)) {
        console.log(`· ${label} ya existe, se omite`);
        continue;
      }
      // Instrument from outside: the product code never knows it is measured.
      const probe = { retrievals: 0, expansions: 0 };
      const originalRetrieve = workshop.retrieveSectionMaterial;
      workshop.retrieveSectionMaterial = async (input) => {
        probe.retrievals += 1;
        return originalRetrieve(input);
      };
      const startedAt = Date.now();
      const phases = [];
      try {
        const report = await generateDeepResearchReport(
          { objective: topic.objective, language: 'es', targetLength: 'standard', audience: 'comunidad académica' },
          (p) => phases.push(p.phase)
        );
        fs.writeFileSync(
          target,
          JSON.stringify(
            {
              metrics: {
                label,
                topic: topic.key,
                run,
                model: modelName,
                objective: topic.objective,
                elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
                phases,
                probe,
              },
              report,
            },
            null,
            2
          )
        );
        fs.writeFileSync(path.join(outDir, `${label}.md`), `# ${report.draft.title}\n\n${report.draft.draftMarkdown}\n`);
        console.log(
          `✓ ${label.padEnd(14)} ${String(report.meta.pages).padStart(2)} pág · ${String(report.meta.words).padStart(5)} pal · ` +
            `${String(report.meta.ideasCovered).padStart(3)} ideas · ${String(report.meta.worksCited).padStart(3)} obras · ` +
            `${Math.round((Date.now() - startedAt) / 1000)}s`
        );
      } catch (error) {
        failures.push({ label, message: error instanceof Error ? error.message : String(error) });
        console.log(`✗ ${label}: ${error instanceof Error ? error.message : error}`);
      } finally {
        workshop.retrieveSectionMaterial = originalRetrieve;
      }
    }
  }
  console.log(`\n[batch] fallos: ${failures.length}`);
  for (const f of failures) console.log(`  ${f.label}: ${f.message}`);
} finally {
  try {
    closeDb();
  } catch {
    /* best effort */
  }
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-dr-batch', getAppPath: () => repoRoot, isPackaged: false, getName: () => 'Nodus' },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (v) => Buffer.from(String(v)),
      decryptString: (v) => Buffer.from(v).toString(),
    },
    dialog: { showMessageBoxSync: () => 1 },
    shell: {},
    BrowserWindow: class {},
    ipcMain: { handle: () => undefined, on: () => undefined },
    net: {},
  };
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function (module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
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
