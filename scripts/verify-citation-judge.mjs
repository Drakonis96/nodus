// Measures whether the citation judge actually judges.
//
// A verifier that answers "supports" to everything looks perfect from the outside:
// nothing is removed, no report is damaged, and the pass appears to work. So this
// takes REAL claims from generated reports and poisons half of them by swapping in
// the content of an unrelated source. A useful judge rejects the poisoned pairs and
// keeps the genuine ones; a lazy one keeps everything and is caught here.
//
//   electron scripts/with-nodus-keys.cjs --providers gemini -- \
//     node scripts/verify-citation-judge.mjs --batch DIR --snapshot DIR [--sample 40]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const FLAG = '--electron-verify-judge';
const argOf = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const batchDir = path.resolve(argOf('--batch', path.join(os.tmpdir(), 'nodus-dr-batch')));
const snapshotDir = path.resolve(argOf('--snapshot', path.join(os.tmpdir(), 'nodus-dr-userdata')));
const SAMPLE = Number(argOf('--sample', '40'));

if (!process.argv.includes(FLAG)) {
  if (!process.env.GEMINI_API_KEY?.trim()) throw new Error('Set GEMINI_API_KEY for this isolated run.');
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [...process.argv.slice(1), FLAG], {
    cwd: repoRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  });
  process.exit(0);
}

const apiKey = process.env.GEMINI_API_KEY?.trim();
assert.ok(apiKey, 'Gemini key reaches only the isolated child process.');
installRuntimeHooks(snapshotDir);

let closeDb = () => undefined;
try {
  const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const workshop = require(path.join(repoRoot, 'electron/ai/writingWorkshop.ts'));
  const core = require(path.join(repoRoot, 'electron/ai/deepResearchCore.ts'));
  ({ closeDb } = require(path.join(repoRoot, 'electron/db/database.ts')));
  secrets.setApiKey('gemini', apiKey);
  delete process.env.GEMINI_API_KEY;

  const modelName = argOf('--model', 'gemini-3.1-flash-lite');
  settingsRepo.updateSettings({ deepResearchModel: { provider: 'gemini', model: modelName }, promptLanguage: 'es' });
  // The judge is not exported; reach it through the module that owns it.
  const deepResearch = require(path.join(repoRoot, 'electron/ai/deepResearch.ts'));
  const verify = deepResearch.__verifyCitationsForTesting;
  assert.ok(typeof verify === 'function', 'deepResearch must expose the judge for this control');

  // Rebuild claims from the saved reports against a fresh snapshot of the corpus.
  const files = fs.readdirSync(batchDir).filter((f) => f.endsWith('.json')).sort();
  assert.ok(files.length > 0, `no reports in ${batchDir}`);
  const genuine = [];
  for (const file of files) {
    const { report } = JSON.parse(fs.readFileSync(path.join(batchDir, file), 'utf8'));
    const snapshot = await workshop.buildWritingWorkshopSnapshot(report.draft.brief);
    const maps = core.buildSnapshotMaps(snapshot);
    for (const claim of core.extractCitationClaims(report.draft.draftMarkdown, maps)) genuine.push(claim);
    if (genuine.length >= SAMPLE * 3) break;
  }
  assert.ok(genuine.length >= 4, `not enough claims to sample (${genuine.length})`);
  console.log(`[control] ${genuine.length} afirmaciones reales disponibles en ${files.length} informes`);

  // Audit mode: judge only GENUINE claims and break the verdicts down by source kind.
  // A pass that rejects one kind far more than the others is not detecting bad
  // citations, it is misreading that kind of source.
  if (process.argv.includes('--audit')) {
    const step = Math.max(1, Math.floor(genuine.length / SAMPLE));
    const sample = [];
    for (let i = 0; i < genuine.length && sample.length < SAMPLE; i += step) sample.push(genuine[i]);
    const verdicts = await verify(sample, { provider: 'gemini', model: modelName });
    const byKind = new Map();
    sample.forEach((claim, index) => {
      const row = byKind.get(claim.kind) ?? { supports: 0, partial: 0, unsupported: 0 };
      row[verdicts[index]] += 1;
      byKind.set(claim.kind, row);
    });
    console.log(`\n═══ Veredictos sobre citas REALES, por tipo de fuente (${sample.length}) ═══`);
    console.log('tipo'.padEnd(16) + 'sostiene'.padEnd(11) + 'parcial'.padEnd(10) + 'no sostiene');
    for (const [kind, row] of byKind) {
      const total = row.supports + row.partial + row.unsupported;
      console.log(
        kind.padEnd(16) + String(row.supports).padEnd(11) + String(row.partial).padEnd(10) +
          `${row.unsupported} (${Math.round((row.unsupported / total) * 100)}%)`
      );
    }
    for (const [kind, row] of byKind) {
      const total = row.supports + row.partial + row.unsupported;
      if (total >= 5 && row.unsupported / total > 0.15) {
        console.log(`\n⚠ "${kind}" se rechaza en el ${Math.round((row.unsupported / total) * 100)}% de los casos reales: el rubro no encaja con ese tipo de fuente.`);
      }
    }
    closeDb();
    process.exit(0);
  }

  // Deterministic spread over the pool without Math.random, so the control is repeatable.
  const step = Math.max(1, Math.floor(genuine.length / SAMPLE));
  const picked = [];
  for (let i = 0; i < genuine.length && picked.length < SAMPLE; i += step) picked.push(genuine[i]);

  // Poison every other one: keep the sentence, swap in content from a claim far away
  // in the pool, which is about something else entirely.
  const cases = picked.map((claim, index) => {
    const poisoned = index % 2 === 1;
    const donor = genuine[(index * 7 + Math.floor(genuine.length / 2)) % genuine.length];
    return {
      poisoned,
      claim: poisoned && donor.content !== claim.content ? { ...claim, content: donor.content } : claim,
      real: poisoned && donor.content === claim.content ? false : poisoned,
    };
  });

  const verdicts = await verify(cases.map((c) => c.claim), { provider: 'gemini', model: modelName });
  assert.equal(verdicts.length, cases.length, 'one verdict per case');

  let caught = 0;
  let poisonedTotal = 0;
  let falseAlarms = 0;
  let genuineTotal = 0;
  const misses = [];
  cases.forEach((entry, index) => {
    const rejected = verdicts[index] === 'unsupported';
    if (entry.real) {
      poisonedTotal += 1;
      if (rejected) caught += 1;
      else misses.push(entry.claim);
    } else {
      genuineTotal += 1;
      if (rejected) falseAlarms += 1;
    }
  });

  const pct = (a, b) => (b === 0 ? '—' : `${Math.round((a / b) * 100)}%`);
  console.log(`\n═══ Control del juez de citas (${modelName}) ═══`);
  console.log(`Citas envenenadas detectadas   ${caught}/${poisonedTotal}  (${pct(caught, poisonedTotal)})  ← recall`);
  console.log(`Citas buenas rechazadas        ${falseAlarms}/${genuineTotal}  (${pct(falseAlarms, genuineTotal)})  ← falsos positivos`);
  console.log(`Veredictos: ${verdicts.filter((v) => v === 'supports').length} sostiene · ${verdicts.filter((v) => v === 'partial').length} parcial · ${verdicts.filter((v) => v === 'unsupported').length} no sostiene`);
  if (misses.length) {
    console.log('\nEjemplos que se le escaparon:');
    for (const miss of misses.slice(0, 3)) {
      console.log(`  frase : ${miss.sentence.slice(0, 130)}`);
      console.log(`  fuente: ${miss.content.slice(0, 130)}\n`);
    }
  }
  // A judge that keeps everything is worse than useless: it certifies false claims.
  console.log(caught / Math.max(1, poisonedTotal) >= 0.7 ? '\nVEREDICTO: el juez discrimina.' : '\nVEREDICTO: el juez NO discrimina lo suficiente.');
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
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-judge-control', getAppPath: () => repoRoot, isPackaged: false, getName: () => 'Nodus' },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (v) => Buffer.from(String(v)), decryptString: (v) => Buffer.from(v).toString() },
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
