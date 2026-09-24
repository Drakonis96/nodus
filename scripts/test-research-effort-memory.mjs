// The thinking level the Research composer last used is remembered per provider+model, so
// reopening a model starts where the user left it instead of at Standard. These checks drive
// the real shared module and the real settings store: a level picked for one model must not
// leak into another provider or model, must survive a restart, must be shared by every vault,
// and must reach the request exactly as it was chosen.
//
// Section 1 (shared module + renderer wiring) runs in plain Node. Section 2 re-executes this
// file under Electron so `settingsRepo` can reach a real SQLite vault, as the preferences
// recovery tests do.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!process.argv.includes('--electron-research-effort')) {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-research-effort-'));
  const moduleFile = path.join(outDir, 'researchReasoning.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'shared/researchReasoning.ts')],
    outfile: moduleFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
  });
  const {
    researchEffortMemoryKey: memoryKey,
    withResearchEffort,
    researchEffortFor,
    researchReasoningBody,
  } = await import(pathToFileURL(moduleFile).href);

  // ---- 1. One selection, one key -------------------------------------------------------
  const deepseekFlash = { provider: 'deepseek', model: 'deepseek-flash' };
  const openCodeFlash = { provider: 'opencode-go', model: 'deepseek-flash' };
  const routedXiaomi = { provider: 'openrouter', model: 'xiaomi/mimo-v2.5' };
  assert.equal(memoryKey(deepseekFlash), 'deepseek:deepseek-flash');
  assert.equal(memoryKey(routedXiaomi), 'openrouter:xiaomi/mimo-v2.5', 'a routed model id keeps the slash the gateway uses');
  assert.equal(memoryKey(null), null);
  assert.equal(memoryKey(undefined), null);

  // ---- 2. Writing the memory -----------------------------------------------------------
  const empty = {};
  const withMax = withResearchEffort(empty, deepseekFlash, 'max');
  assert.deepEqual(withMax, { 'deepseek:deepseek-flash': 'max' });
  assert.deepEqual(empty, {}, 'writing never mutates the map it was given');
  // The same model id served by two routes is two selections: the DeepSeek id runs with
  // thinking on by default, the OpenCode Go one is a different request shape.
  const both = withResearchEffort(withMax, openCodeFlash, 'low');
  assert.deepEqual(both, { 'deepseek:deepseek-flash': 'max', 'opencode-go:deepseek-flash': 'low' });
  assert.deepEqual(withResearchEffort(both, deepseekFlash, 'high'), { 'deepseek:deepseek-flash': 'high', 'opencode-go:deepseek-flash': 'low' }, 'a second choice for one model replaces the first');
  assert.deepEqual(withResearchEffort(both, deepseekFlash, 'standard'), { 'opencode-go:deepseek-flash': 'low' }, 'Standard is remembered as the absence of a choice, not as a level');
  assert.deepEqual(withResearchEffort(both, null, 'max'), both, 'a selection with no model writes nothing');
  assert.deepEqual(withResearchEffort(undefined, deepseekFlash, 'max'), { 'deepseek:deepseek-flash': 'max' }, 'the first choice works with no map yet');

  // ---- 3. Reading it back --------------------------------------------------------------
  assert.equal(researchEffortFor(both, deepseekFlash), 'max');
  assert.equal(researchEffortFor(both, openCodeFlash), 'low', 'one provider\'s level never answers for another provider');
  assert.equal(researchEffortFor(both, { provider: 'deepseek', model: 'deepseek-pro' }), 'standard', 'nor for another model');
  assert.equal(researchEffortFor(both, null), 'standard');
  assert.equal(researchEffortFor(undefined, deepseekFlash), 'standard', 'a model never used opens on Standard');
  assert.equal(researchEffortFor({ 'deepseek:deepseek-flash': 'turbo' }, deepseekFlash), 'standard', 'a hand-edited file cannot inject a level this build does not know');
  assert.equal(researchEffortFor({ 'deepseek:deepseek-flash': 7 }, deepseekFlash), 'standard');
  assert.equal(researchEffortFor({ 'deepseek:deepseek-flash': 'standard' }, deepseekFlash), 'standard');

  // ---- 4. The remembered level is the level the request carries ------------------------
  const request = (ref, effort = researchEffortFor(both, ref)) => researchReasoningBody(ref, effort, 16000);
  assert.deepEqual(request(deepseekFlash), { thinking: { type: 'enabled' }, reasoning_effort: 'max' }, 'DeepSeek receives the remembered level, not Standard');
  assert.deepEqual(request(openCodeFlash), { reasoning_effort: 'low' });
  assert.deepEqual(request(routedXiaomi), { reasoning: { enabled: false } },
    'a model with no memory keeps running at Standard: MiMo is routed with thinking off, as before');
  assert.deepEqual(request({ provider: 'openai', model: 'gpt-5.4' }, 'max').reasoning_effort, 'none',
    'a level the model no longer publishes floors instead of reaching the provider (the picker drops it, the request cannot send it)');
  assert.deepEqual(
    researchReasoningBody({ provider: 'gemini', model: 'gemini-3-pro-preview' }, 'high', 16000),
    { extra_body: { google: { thinking_config: { thinking_level: 'high' } } } }
  );

  // ---- 5. The composer is wired to that memory ------------------------------------------
  const read = (file) => readFileSync(path.join(repoRoot, file), 'utf8');
  const modal = read('src/views/ResearchAssistantModal.tsx');
  const hook = read('src/hooks/useResearchEffort.ts');
  const control = read('src/components/ResearchEffortControl.tsx');
  assert.match(modal, /const \[thinkingEffort, setThinkingEffort\] = useResearchEffort\(settings, selectedModel\)/,
    'the composer reads its effort from the memory, keyed by the selected model');
  assert.equal(/useState<ResearchEffort>\(|setThinkingEffort\('standard'\)/.test(modal), false,
    'no code path resets the effort to Standard behind the user: opening a chat or a model must restore what was remembered');
  assert.match(hook, /updateSettings\(\{ researchEffortByModel: memory\.current \}\)/);
  assert.match(hook, /getSettings\(\)/, 'the memory is read from the store, not only from the settings prop');
  assert.match(hook, /session\.current\.reduce\(/, 'and a level picked while that read was in flight is replayed over it');
  assert.match(hook, /writes\.current\s*\.catch\(\(\) => undefined\)\s*\.then\(/, 'writes are serialised, so a fast drag cannot persist out of order');
  assert.match(control, /if \(choices\.includes\(value\)\) return;/, 'the picker drops a remembered level the model no longer publishes');
  assert.match(control, /researchReasoningNeedsCatalog\(model\) && info === undefined/, 'and waits for the catalogue before deciding a subscription model offers none');

  console.log('1. Research effort memory: keys, writes, restores and request payload passed');

  const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-research-effort-userdata-'));
  const entry = path.join(outDir, 'entry.ts');
  const bundle = path.join(outDir, 'entry.cjs');
  await writeFile(entry, [
    `export * as registry from ${JSON.stringify(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'))};`,
    `export * as database from ${JSON.stringify(path.join(repoRoot, 'electron/db/database.ts'))};`,
    `export * as settingsRepo from ${JSON.stringify(path.join(repoRoot, 'electron/db/settingsRepo.ts'))};`,
  ].join('\n'));
  try {
    execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
      entry,
      '--bundle',
      '--platform=node',
      '--format=cjs',
      '--target=es2022',
      `--outfile=${bundle}`,
      `--alias:electron=${path.join(repoRoot, 'scripts/stub-electron.mjs')}`,
      '--external:better-sqlite3',
    ], { cwd: repoRoot, stdio: 'inherit' });
    execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [
      fileURLToPath(import.meta.url),
      '--electron-research-effort',
      bundle,
      userData,
    ], {
      cwd: repoRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODUS_TEST_USERDATA: userData },
      stdio: 'inherit',
    });
  } finally {
    await rm(outDir, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
  process.exit(0);
}

// ---- 6. The store: what survives a restart and what every vault sees --------------------
const [, , , bundle, userData] = process.argv;
process.env.NODE_PATH = [path.join(repoRoot, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
Module._initPaths();
const require = createRequire(import.meta.url);
const { registry, database, settingsRepo } = require(bundle);

const primary = registry.getActiveVault();
let db = database.getDb();
// A preferences file written by an older build, or by hand: a level this build dropped, a key
// that is not a provider:model pair, a non-string level and Standard (which is stored as an
// absence). `ultra` is kept even though that model no longer offers it: a read has no model
// catalogue, so the picker is what normalises a level the model has outgrown. A custom
// endpoint's model half stays free-form, because its ids are whatever its gateway calls them.
db.prepare("INSERT INTO settings (key, value) VALUES ('app', ?)").run(JSON.stringify({
  researchEffortByModel: {
    'deepseek:deepseek-flash': 'max',
    'openai:gpt-5.4': 'ultra',
    'custom:my gateway/one': 'high',
    'gemini:gemini-3-pro-preview': 'standard',
    'not-a-model': 'high',
    'deepseek:': 'high',
    'deepseek:deepseek-pro': 5,
    'deepseek:deepseek-reasoner': 'turbo',
  },
}));
assert.deepEqual(settingsRepo.getSettings().researchEffortByModel,
  { 'deepseek:deepseek-flash': 'max', 'openai:gpt-5.4': 'ultra', 'custom:my gateway/one': 'high' },
  'only levels this build knows, under provider:model keys, survive a read; Standard and malformed keys are dropped');

settingsRepo.updateSettings({ researchEffortByModel: { 'deepseek:deepseek-flash': 'max', 'openai:gpt-5.6-sol': 'xhigh' } });
assert.deepEqual(settingsRepo.getSettings().researchEffortByModel, { 'deepseek:deepseek-flash': 'max', 'openai:gpt-5.6-sol': 'xhigh' });
settingsRepo.updateSettings({ researchEffortByModel: settingsRepo.getSettings().researchEffortByModel });
assert.deepEqual(JSON.parse(readFileSync(path.join(userData, 'app-prefs.json'), 'utf8')).researchEffortByModel,
  { 'deepseek:deepseek-flash': 'max', 'openai:gpt-5.6-sol': 'xhigh' },
  'the memory is an app-wide preference, written to the profile file beside the other model preferences');

// Picking Standard again is stored as a removal, so a level the user abandoned cannot come
// back the next time the model is opened.
settingsRepo.updateSettings({ researchEffortByModel: { 'openai:gpt-5.6-sol': 'xhigh', 'deepseek:deepseek-flash': 'standard' } });
assert.deepEqual(settingsRepo.getSettings().researchEffortByModel, { 'openai:gpt-5.6-sol': 'xhigh' },
  'Standard removes the entry instead of pinning the model to it');

const secondary = registry.createVault('Effort memory evidence');
database.closeDb();
registry.setActiveVault(secondary.id);
db = database.getDb();
assert.deepEqual(settingsRepo.getSettings().researchEffortByModel, { 'openai:gpt-5.6-sol': 'xhigh' },
  'a second vault opens with the level remembered in the first: the choice belongs to the model');
settingsRepo.updateSettings({ researchEffortByModel: { 'openai:gpt-5.6-sol': 'xhigh', 'gemini:gemini-3-pro-preview': 'high' } });
database.closeDb();
registry.setActiveVault(primary.id);
db = database.getDb();
assert.deepEqual(settingsRepo.getSettings().researchEffortByModel, { 'openai:gpt-5.6-sol': 'xhigh', 'gemini:gemini-3-pro-preview': 'high' },
  'and a level picked in the second vault is what the first vault opens with');

// Every launch recomputes the settings from the stores, so what a read returns now is what the
// next session shows. Each vault also keeps its own last write in its blob as a fallback.
const stored = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'app'").get().value);
assert.equal(stored.researchEffortByModel['openai:gpt-5.6-sol'], 'xhigh', 'the vault keeps its own fallback copy of the map');

database.closeDb();
console.log('2. Research effort memory: sanitising, persistence, restarts and every vault passed');
