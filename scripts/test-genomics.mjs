import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { genomicsFixture, genomicsPlan, genomicsQuestion } from './lib/genomicsFixture.mjs';
const root = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-genomics-test-'));
const bundle = path.join(scratch, 'test.cjs');
let available = true;
const testKey = crypto.randomBytes(32);
globalThis.__genomicsSafeStorage = {
  isEncryptionAvailable: () => available,
  getSelectedStorageBackend: () => 'test',
  encryptString: value => { const iv = crypto.randomBytes(16), c = crypto.createCipheriv('aes-256-cbc', testKey, iv); return Buffer.concat([iv, c.update(value, 'utf8'), c.final()]); },
  decryptString: b => { const c = crypto.createDecipheriv('aes-256-cbc', testKey, b.subarray(0, 16)); return Buffer.concat([c.update(b.subarray(16)), c.final()]).toString(); },
};
await build({ stdin: { contents: `export * from './shared/genomics'; export * from './shared/chatSkills'; export * from './electron/genomics'; export * from './electron/chatSkills'; export * from './electron/chatAssets'; export * from './electron/ai/chatSkillExecution';`, resolveDir: root, loader: 'ts' }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'isolate', setup(api) {
  api.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'test' }));
  // Only the capability's own prediction host is mocked; the suite still exercises the
  // real electron/genomics module it re-exports for configuration and credentials.
  api.onResolve({ filter: /\/genomics$/ }, args => (args.path === '../genomics'
    || (args.path.endsWith('electron/genomics') && args.importer.includes(`${path.sep}skill-capabilities${path.sep}`)))
    ? { path: 'predict', namespace: 'test' } : undefined);
  for (const [filter, name] of [[/skillToolSandbox$/, 'tools'], [/sandbox\/runtime$/, 'capability'], [/chatSvgQuality$/, 'svg'], [/decorativeImages$/, 'image'], [/db\/settingsRepo$/, 'settings'], [/chemistryIdentity$/, 'chemistry'], [/chemistryValidationHost$/, 'validate'], [/chemistryRepair$/, 'repair'], [/capabilities\/runner$/, 'trusted-runner']]) api.onResolve({ filter }, () => ({ path: name, namespace: 'test' }));
  api.onLoad({ filter: /.*/, namespace: 'test' }, ({ path: name }) => ({ loader: 'js', contents: name === 'electron' ? `export const app = { getPath: () => ${JSON.stringify(scratch)}, getAppPath: () => ${JSON.stringify(root)}, isPackaged: false }; export const safeStorage = globalThis.__genomicsSafeStorage;`
    : name === 'predict' ? 'export const predictGenomics = (...args) => globalThis.__genomicsPredict(...args);'
    : name === 'tools' ? 'export const runSkillTool = () => { throw Error("Unexpected custom skill tool"); };'
    : name === 'capability' ? 'export const runCapabilitySandbox = () => { throw Error("Unexpected external capability"); };'
    : name === 'svg' ? 'export const refineChatSvg = async a => a; export const chemistrySvgFallback = async () => "";'
    : name === 'repair' ? 'export const repairChemistryIntent = async () => undefined;'
    : name === 'trusted-runner' ? 'export const createTrustedCapabilityRunner = () => { throw Error("Unexpected trusted runner"); }; export const createCapabilityAdapters = () => ({});'
    : name === 'image' ? 'export const callImageProvider = () => { throw Error("Unexpected image generation") }; export const prepareGeneratedImage = () => {};'
    : name === 'settings' ? 'export const getSettings = () => ({});'
    : name === 'chemistry' ? 'export const resolveChemistryIntent = () => { throw Error("Unexpected chemistry") };'
    : 'export const validateChemistryInUtility = () => {};'}));
  api.onResolve({ filter: /^@shared\// }, ({ path: specifier }) => ({ path: path.join(root, 'shared', `${specifier.slice(8)}.ts`) }));
} }] });
const lib = createRequire(import.meta.url)(bundle);
const fixture = () => genomicsFixture(lib);
const fence = (kind, content) => lib.serializeChatVisualPart({ kind, content, complete: true });
const owner = lib.chatAssetOwner('test', 'genomics');
const execution = () => ({ skills: lib.DEFAULT_CHAT_SKILLS.filter(s => s.builtin === 'genomics'), question: genomicsQuestion, owner, version: lib.chatAssetVersion(owner), isCurrent: () => true });

test('exact current-user grounding rejects guessed inputs, unsupported assemblies, alleles, extra fields and incomplete plans', () => {
  assert.deepEqual(lib.parseGenomicsPlan(JSON.stringify(genomicsPlan), genomicsQuestion), genomicsPlan);
  for (const p of [{ ...genomicsPlan, assembly: 'GRCh37' }, { ...genomicsPlan, variant: 'chr22:36201698:A:A' }, { ...genomicsPlan, tissue: 'liver' }, { ...genomicsPlan, apiKey: 'secret' }, { ...genomicsPlan, variant: 'chr22:36201698:A:AC' }, { ...genomicsPlan, version: 2 }]) assert.throws(() => lib.parseGenomicsPlan(JSON.stringify(p), genomicsQuestion));
  assert.throws(() => lib.parseGenomicsPlan(JSON.stringify(genomicsPlan), 'Predict BRCA1'));
  assert.throws(() => lib.parseGenomicsPlan(JSON.stringify(genomicsPlan), genomicsQuestion.replace('RNA_SEQ', 'RNA_SEQ_FAKE')));
});
test('personal credentials use secure storage, require terms, never round-trip, clear and fail closed', async () => {
  assert.equal(lib.getGenomicsStatus().hasKey, false);
  const key = 'TEST_ONLY_NOT_A_REAL_KEY_123456789';
  assert.throws(() => lib.configureGenomics({ apiKey: key, acceptTerms: false }));
  assert.equal(lib.configureGenomics({ apiKey: key, acceptTerms: true }).hasKey, true);
  const bytes = fs.readFileSync(path.join(scratch, 'genomics/credentials.bin'));
  assert.equal(bytes.includes(key), false);
  assert.equal(JSON.stringify(lib.getGenomicsStatus()).includes(key), false);
  available = false; assert.equal(lib.getGenomicsStatus().hasKey, false);
  assert.throws(() => lib.configureGenomics({ apiKey: key, acceptTerms: true }), /secure/);
  available = true; assert.equal(lib.getGenomicsStatus().hasKey, true);
  assert.equal(lib.clearGenomicsConfiguration().hasKey, false);
  await assert.rejects(lib.predictGenomics(genomicsPlan), /configure your personal API key/);
});
test('migration adds an opt-in skill once and preserves edits, deletions and per-chat activation', () => {
  const existing = [{ ...lib.DEFAULT_CHAT_SKILLS.find(s => s.builtin === 'svg'), instructions: 'Keep my edits' }];
  fs.writeFileSync(path.join(scratch, 'chat-skills.json'), JSON.stringify({ version: 9, skills: existing }));
  const migrated = lib.listChatSkills();
  assert.deepEqual(migrated[0], existing[0]);
  assert.deepEqual(migrated[1].enabled, { assistant: false, nodi: false });
  lib.saveChatSkill({ ...migrated[1], enabled: { assistant: false, nodi: true } });
  assert.equal(lib.enabledChatSkills('assistant').some(s => s.builtin === 'genomics'), false);
  assert.equal(lib.enabledChatSkills('nodi').some(s => s.builtin === 'genomics'), true);
  lib.deleteChatSkill(migrated[1].id); assert.equal(lib.listChatSkills().some(s => s.builtin === 'genomics'), false);
});
test('execution stores actual tool results locally and discards unsupported model claims', async () => {
  let calls = 0;
  globalThis.__genomicsPredict = async p => { calls++; assert.deepEqual(p, genomicsPlan); return fixture(); };
  const answer = await lib.executeChatSkills('Invented clinical claim\n' + fence('genomics-plan', JSON.stringify(genomicsPlan)), execution());
  assert.equal(calls, 1); assert.doesNotMatch(answer, /clinical claim|reference|alternate|SYNTHETIC/);
  const part = lib.splitChatVisuals(answer).find(p => p.kind === 'genomics-result'); assert.equal(part.kind, 'genomics-result');
  assert.deepEqual(lib.getGenomicsResult(part.content), fixture());
  assert.doesNotThrow(() => lib.reconcileChatAssets(owner, [{ content: answer }])); assert.ok(lib.getGenomicsResult(part.content));
  lib.reconcileChatAssets(owner, []); assert.equal(lib.getGenomicsResult(part.content), null);
  await lib.executeChatSkills(fence('genomics-plan', JSON.stringify(genomicsPlan)), { ...execution(), skills: [] }); assert.equal(calls, 1);
  await lib.executeChatSkills(fence('genomics-result', part.content), execution()); assert.equal(calls, 1);
  await lib.executeChatSkills(fence('genomics-plan', JSON.stringify(genomicsPlan)).repeat(2), execution()); assert.equal(calls, 1);
});
test('cancellation and chat deletion discard late results; malformed predictions cannot be persisted', async () => {
  const e = execution(); globalThis.__genomicsPredict = async () => { lib.deleteChatAssets(owner); return fixture(); };
  await assert.rejects(lib.executeChatSkills(fence('genomics-plan', JSON.stringify(genomicsPlan)), e), { name: 'AbortError' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(lib.executeChatSkills(fence('genomics-plan', JSON.stringify(genomicsPlan)), execution(), controller.signal), { name: 'AbortError' });
  const bad = fixture(); bad.tracks[0].reference[0] = Infinity; assert.throws(() => lib.storeGenomicsResult(owner, bad));
  assert.equal(lib.getGenomicsResult('../../secrets'), null);
});
test('JSON and SVG exports retain mandatory notice, provenance and modification labels; metadata is escaped', () => {
  const r = fixture(); r.tracks[0].name = '<script>alert(1)</script>';
  const svg = lib.genomicsTrackSvg(r, 0);
  assert.match(svg, /AlphaGenome Output Terms of Use/); assert.ok(svg.includes(lib.ALPHAGENOME_OUTPUT_TERMS));
  assert.match(svg, /Modified by Nodus/); assert.match(svg, /10.1038\/s41586-025-10014-0/);
  assert.doesNotMatch(svg, /<script>/); assert.match(svg, /&lt;script&gt;/);
  assert.ok(JSON.stringify(r).includes(lib.ALPHAGENOME_NOTICE));
});
test('result exclusion handles raw fences and nested JSON history without exposing predictions', () => {
  const raw = fence('genomics-result', JSON.stringify(fixture()));
  for (const value of [raw, JSON.stringify({ messages: [{ content: raw }] }), JSON.stringify(fixture())]) {
    assert.doesNotMatch(lib.excludeGenomicsResults(value), /SYNTHETIC|reference|alternate|genomics-result/);
  }
  assert.equal(lib.excludeGenomicsResults('Explain gene expression'), 'Explain gene expression');
});
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
