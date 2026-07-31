// Blind pairwise comparison of two Deep Research variants.
//
// Without this, every claim that a change "improved the argument" is my opinion.
// Reports are stripped of anything identifying their variant, shown to a judge as
// "Informe 1" and "Informe 2", and every pair is judged TWICE with the order
// swapped. A win counts only when both orderings agree; disagreement is a tie, which
// is the honest reading of a judge that just prefers whichever came first.
//
//   electron scripts/with-nodus-keys.cjs --providers gemini -- \
//     node scripts/judge-deep-research.mjs --a DIR_A --b DIR_B [--label-a antes --label-b después]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const FLAG = '--electron-judge-dr';
const argOf = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const dirA = path.resolve(argOf('--a', ''));
const dirB = path.resolve(argOf('--b', ''));
const labelA = argOf('--label-a', 'A');
const labelB = argOf('--label-b', 'B');
const snapshotDir = path.resolve(argOf('--snapshot', path.join(os.tmpdir(), 'nodus-dr-userdata')));
const MAX_WORDS = Number(argOf('--max-words', '5200'));

const DIMENSIONS = [
  { key: 'continuidad', question: 'Continuidad argumental: ¿cuál se lee como un razonamiento que progresa, donde cada sección se apoya en la anterior, en lugar de como una lista de temas yuxtapuestos?' },
  { key: 'respaldo', question: 'Respaldo de las afirmaciones: ¿en cuál las afirmaciones sustantivas van acompañadas de una fuente concreta y pertinente, en lugar de afirmarse sin apoyo o con apoyo genérico?' },
  { key: 'riqueza', question: 'Riqueza de fuentes: ¿cuál se apoya en una variedad real de autores y obras, en lugar de descansar una y otra vez en los mismos?' },
  { key: 'debate', question: 'Tratamiento del desacuerdo: ¿cuál expone debates y huecos de investigación explicando su contenido, en lugar de mencionarlos de pasada o ignorarlos?' },
  { key: 'utilidad', question: 'Utilidad para un investigador: ¿cuál usarías antes como punto de partida para escribir un capítulo académico?' },
];

if (!process.argv.includes(FLAG)) {
  if (!process.env.GEMINI_API_KEY?.trim()) throw new Error('Set GEMINI_API_KEY for this isolated run.');
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [...process.argv.slice(1), FLAG], {
    cwd: repoRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    maxBuffer: 128 * 1024 * 1024,
  });
  process.exit(0);
}

assert.ok(dirA && dirB, 'Usage: --a DIR_A --b DIR_B');
const apiKey = process.env.GEMINI_API_KEY?.trim();
assert.ok(apiKey, 'Gemini key reaches only the isolated child process.');
installRuntimeHooks(snapshotDir);

let closeDb = () => undefined;
try {
  const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const { completeJson } = require(path.join(repoRoot, 'electron/ai/aiClient.ts'));
  ({ closeDb } = require(path.join(repoRoot, 'electron/db/database.ts')));
  secrets.setApiKey('gemini', apiKey);
  delete process.env.GEMINI_API_KEY;
  const modelName = argOf('--model', 'gemini-3.1-flash-lite');
  settingsRepo.updateSettings({ deepResearchModel: { provider: 'gemini', model: modelName }, promptLanguage: 'es' });
  const model = { provider: 'gemini', model: modelName };

  const pairs = buildPairs(dirA, dirB);
  assert.ok(pairs.length > 0, 'no comparable reports (topics must match between the two directories)');
  console.log(`[juez] ${pairs.length} pares comparables · ${DIMENSIONS.length} dimensiones · 2 órdenes cada uno\n`);

  const system = [
    'Eres un investigador académico experimentado que compara dos informes sobre el mismo tema.',
    'No sabes quién los ha escrito ni con qué herramienta. Júzgalos solo por lo que dicen.',
    'Para cada criterio elige 1 o 2. Si de verdad son equivalentes puedes responder 0, pero evita el empate cómodo: si uno es mejor, dilo.',
    'Ignora la longitud como mérito en sí: un informe más largo no es mejor por serlo.',
    'Devuelve SOLO JSON válido: {"criterios":[{"clave":"continuidad","ganador":1,"motivo":"..."}]} con una entrada por criterio.',
  ].join('\n');

  const tally = new Map(DIMENSIONS.map((d) => [d.key, { a: 0, b: 0, tie: 0 }]));
  const notes = [];

  for (const pair of pairs) {
    // Same pair, both orders. Only an agreement between the two counts as a win.
    const forward = await ask(completeJson, system, model, pair.textA, pair.textB);
    const reverse = await ask(completeJson, system, model, pair.textB, pair.textA);
    for (const dimension of DIMENSIONS) {
      const first = forward.get(dimension.key);
      const second = reverse.get(dimension.key);
      const row = tally.get(dimension.key);
      // In the reverse run, "1" means B.
      const winnerForward = first === 1 ? 'a' : first === 2 ? 'b' : null;
      const winnerReverse = second === 1 ? 'b' : second === 2 ? 'a' : null;
      if (winnerForward && winnerForward === winnerReverse) row[winnerForward] += 1;
      else row.tie += 1;
    }
    const reason = forward.reasons.get('utilidad');
    if (reason) notes.push(`${pair.topic}: ${reason}`);
    console.log(`· ${pair.topic} juzgado`);
  }

  console.log(`\n═══ Juicio ciego · ${labelA} vs ${labelB} ═══`);
  console.log('criterio'.padEnd(16) + labelA.padEnd(10) + labelB.padEnd(10) + 'empate');
  console.log('─'.repeat(46));
  for (const dimension of DIMENSIONS) {
    const row = tally.get(dimension.key);
    console.log(dimension.key.padEnd(16) + String(row.a).padEnd(10) + String(row.b).padEnd(10) + row.tie);
  }
  console.log(`\n(un criterio solo se anota cuando el juez coincide en los dos órdenes; si no, cuenta como empate)`);
  if (notes.length) {
    console.log('\nMotivos citados en "utilidad":');
    for (const note of notes.slice(0, 5)) console.log(`  · ${note.slice(0, 220)}`);
  }
} finally {
  try {
    closeDb();
  } catch {
    /* best effort */
  }
}

async function ask(completeJson, system, model, first, second) {
  const user = [
    '### Informe 1', first, '', '### Informe 2', second, '',
    'Criterios:',
    ...DIMENSIONS.map((d) => `- ${d.key}: ${d.question}`),
  ].join('\n');
  const chosen = new Map();
  const reasons = new Map();
  try {
    const ai = await completeJson(
      { system, user, temperature: 0, maxTokens: 1600 },
      (v) => typeof v === 'object' && v !== null && Array.isArray(v.criterios),
      model
    );
    for (const entry of ai.criterios ?? []) {
      if (typeof entry?.clave !== 'string') continue;
      chosen.set(entry.clave, Number(entry.ganador));
      if (typeof entry.motivo === 'string') reasons.set(entry.clave, entry.motivo);
    }
  } catch {
    /* an unreadable judgement counts as a tie */
  }
  chosen.reasons = reasons;
  return Object.assign(chosen, { reasons });
}

/** Pair reports by topic, anonymised and trimmed so neither side is identifiable. */
function buildPairs(a, b) {
  const load = (dir) => {
    const map = new Map();
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const { metrics, report } = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      const topic = metrics.topic ?? metrics.label;
      if (!map.has(topic)) map.set(topic, anonymise(report));
    }
    return map;
  };
  const left = load(a);
  const right = load(b);
  const pairs = [];
  for (const [topic, textA] of left) {
    const textB = right.get(topic);
    if (textB) pairs.push({ topic, textA, textB });
  }
  return pairs;
}

/**
 * Strip everything that could identify which engine wrote a report: the `nodus://`
 * link syntax (kept as plain author-year so the judge can still see whether a claim
 * is sourced), the limitations block, and any trailing reference list.
 */
function anonymise(report) {
  const body = (report.draft.draftMarkdown ?? '')
    .split(/^##\s+(?:Referencias|References)\s*$/mu)[0]
    .replace(/^##\s+(?:Limitaciones|Limitations)[\s\S]*$/mu, '')
    .replace(/\[([^\]]*)\]\(nodus:\/\/[^)]*\)/g, '$1');
  const words = body.split(/\s+/);
  return words.length > MAX_WORDS ? `${words.slice(0, MAX_WORDS).join(' ')}\n\n[…]` : body;
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-dr-judge', getAppPath: () => repoRoot, isPackaged: false, getName: () => 'Nodus' },
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
