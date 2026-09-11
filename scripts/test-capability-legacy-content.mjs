// A conversation from 5.3.1 keeps its answers.
//
// Two separate claims are checked here, because they fail in different ways. A profile
// that predates the skills library must still be recognised as one after the defaults for
// this release have been written — otherwise either every clean install adopts chemistry,
// or no old profile ever does. And a result a discipline wrote before it became a package
// must render as the finished answer it is, never as "the generation was interrupted".
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-capability-legacy-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

const require_ = createRequire(import.meta.url);

/** Builds one module against a throwaway profile, with electron and the registry mocked. */
async function load(entry, profile, extra = '') {
  const outfile = path.join(scratch, `${path.basename(entry)}-${Math.random().toString(36).slice(2, 8)}.cjs`);
  await build({
    stdin: { contents: `export * from './${entry}';`, resolveDir: root, loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
    plugins: [{
      name: 'test-environment',
      setup(api) {
        api.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'mock' }));
        api.onResolve({ filter: /(?:^\.\/|capabilities\/)registry$/ }, () => ({ path: 'registry', namespace: 'mock' }));
        api.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path: name }) => ({
          contents: name === 'electron'
            ? `export const app = { getPath: () => ${JSON.stringify(profile)}, getVersion: () => '5.3.2', isPackaged: false, getAppPath: () => ${JSON.stringify(scratch)} };
               export const safeStorage = { isEncryptionAvailable: () => false };
               ${extra}`
            : `export const capabilityRegistry = () => globalThis.__registry();
               export const capabilityIsAvailable = (id) => globalThis.__registry().providers.has(id);
               export const capabilityProvider = (id) => globalThis.__registry().providers.get(id);
               export const rebuildCapabilityRegistry = () => globalThis.__registry();
               export const onCapabilityRegistryChanged = () => () => {};
               export const pinCapabilitiesForTurn = () => ({ revision: 0, pins: new Map() });
               export const CORE_CAPABILITY_ID_LIST = ['nodus:svg', 'nodus:image'];`,
          loader: 'js',
        }));
        api.onResolve({ filter: /^@shared\// }, ({ path: value }) => ({ path: path.join(root, 'shared', `${value.slice(8)}.ts`) }));
      },
    }],
  });
  return require_(outfile);
}

const profileFor = (name, seed = {}) => {
  const dir = path.join(scratch, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, contents] of Object.entries(seed)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), contents);
  }
  return dir;
};

// ------------------------------------------------ which profile this actually is

test('a clean 5.3.2 install is never mistaken for a profile that predates the library', async () => {
  const profile = profileFor('clean');
  const skills = await load('electron/chatSkills.ts', profile);
  skills.initializeChatSkillDefaults();

  assert.ok(fs.existsSync(path.join(profile, 'chat-skills.json')), 'the defaults were written');
  assert.equal(skills.profilePredatesSkillLibrary(), false, 'nothing here is a prior state to honour');
});

test('a profile from before the library is still recognised after the defaults are written', async () => {
  // The order this reproduces is the one that made the bug: the application creates the
  // library for this release first, and only then asks what the profile used to be.
  const profile = profileFor('legacy', { 'app-prefs.json': '{"uiLanguage":"es"}', 'nodus.sqlite': 'not really a database' });
  const skills = await load('electron/chatSkills.ts', profile);
  skills.initializeChatSkillDefaults();

  assert.ok(fs.existsSync(path.join(profile, 'chat-skills.json')));
  assert.equal(skills.profilePredatesSkillLibrary(), true, 'the fact was recorded before the defaults hid it');
});

test('a profile that already had a library carries no implicit activation', async () => {
  const profile = profileFor('with-library', {
    'app-prefs.json': '{}',
    'chat-skills.json': JSON.stringify({ version: 16, skills: [] }),
  });
  const skills = await load('electron/chatSkills.ts', profile);
  skills.initializeChatSkillDefaults();
  assert.equal(skills.profilePredatesSkillLibrary(), false);
});

test('the answer does not change when it is asked again', async () => {
  const profile = profileFor('stable', { 'vaults.json': '[]' });
  const skills = await load('electron/chatSkills.ts', profile);
  assert.equal(skills.profilePredatesSkillLibrary(), true);
  skills.initializeChatSkillDefaults();
  assert.equal(skills.profilePredatesSkillLibrary(), true, 'a recorded fact is not re-derived from the files it changed');
});

// ------------------------------------------------ results written before v2

const OWNER = 'a'.repeat(64);
const ASSET_ID = '3f8a1c0e-9b2d-4e77-8a10-5c6d7e8f9a0b';

const provider = (overrides = {}) => ({
  id: 'nodus:genomics', version: '2.0.0', description: 'Predictions.', source: 'plugin',
  plugin: { id: 'alphagenome', version: '2.0.0', digest: 'b'.repeat(64) },
  tools: [],
  artifacts: [{ type: 'genomics-result', version: 1, label: { en: 'Prediction' }, modelVisibility: 'none', decodes: ['genomics'] }],
  chat: {
    priority: 200, requestProtocols: [{ fence: 'genomics-plan', toolId: 'predict', maxPerReply: 1, answerMode: 'replace-answer' }],
    legacyResults: [{ fence: 'genomics-result', artifactType: 'genomics-result', artifactVersion: 1 }],
    hooks: {}, pendingLabel: { en: 'Working…' },
  },
  hasSettings: false,
  ...overrides,
});

const registryWith = (entry) => () => ({
  providers: new Map(entry ? [[entry.id, entry]] : []),
  fences: new Map(entry ? (entry.chat?.legacyResults ?? []).map(legacy => [legacy.fence, { provider: entry, kind: 'legacy' }]) : []),
  chatOrder: [], problems: [], revision: 1,
});

test('a legacy block resolves to the package that claims its fence, with the file it pointed at', async () => {
  const profile = profileFor('history');
  fs.mkdirSync(path.join(profile, 'chat-assets', OWNER), { recursive: true });
  fs.writeFileSync(path.join(profile, 'chat-assets', OWNER, `${ASSET_ID}.genomics`), '{"version":1,"tracks":[]}');
  const legacy = await load('electron/capabilities/legacyResults.ts', profile);
  globalThis.__registry = registryWith(provider());

  const request = legacy.legacyResultRequest('genomics-result', `nodus-genomics://chat/${OWNER}/${ASSET_ID}`);
  assert.equal(request.provider.plugin.id, 'alphagenome');
  assert.equal(request.artifactType, 'genomics-result');
  assert.equal(request.asset, '{"version":1,"tracks":[]}', 'the file beside the chat is read and handed over');
});

test('a package only opens the formats its own artifact type says it decodes', async () => {
  const profile = profileFor('decodes');
  fs.mkdirSync(path.join(profile, 'chat-assets', OWNER), { recursive: true });
  fs.writeFileSync(path.join(profile, 'chat-assets', OWNER, `${ASSET_ID}.secrets`), 'not yours to read');
  const legacy = await load('electron/capabilities/legacyResults.ts', profile);
  globalThis.__registry = registryWith(provider());

  const request = legacy.legacyResultRequest('genomics-result', `nodus-secrets://chat/${OWNER}/${ASSET_ID}`);
  assert.equal(request.asset, undefined, 'an undeclared format is not opened at all');
});

test('a fence nobody claims resolves to nothing rather than to somebody else', async () => {
  const profile = profileFor('unclaimed');
  const legacy = await load('electron/capabilities/legacyResults.ts', profile);
  globalThis.__registry = registryWith(provider());
  assert.equal(legacy.legacyResultRequest('chemistry-document', '{"status":"verified"}'), null);

  globalThis.__registry = registryWith(null);
  assert.equal(legacy.legacyResultRequest('genomics-result', '{}'), null, 'with the package uninstalled there is no provider to ask');
});

test('an oversized saved block is refused instead of being read into memory', async () => {
  const profile = profileFor('oversized');
  const legacy = await load('electron/capabilities/legacyResults.ts', profile);
  globalThis.__registry = registryWith(provider());
  assert.throws(() => legacy.legacyResultRequest('genomics-result', 'x'.repeat(300_000)), /too large/);
});

// ------------------------------------------------ how the reply is split and rewritten

test('a finished legacy block is a result, and a claimed request fence is still pending', async () => {
  const outfile = path.join(scratch, 'chat-skills.cjs');
  await build({ entryPoints: [path.join(root, 'shared/chatSkills.ts')], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const { splitChatVisuals, serializeChatVisualPart, transformChatProse } = require_(outfile);

  const reply = 'Here it is.\n\n```genomics-result\nnodus-genomics://chat/x/y\n```\n\nAnd a request:\n\n```genomics-plan\n{"variant":"chr1:1:A:T"}\n```\n';
  const parts = splitChatVisuals(reply, new Set(['genomics-plan', 'genomics-result']), new Set(['genomics-result']));

  const legacy = parts.find(part => part.kind === 'capability-legacy');
  assert.ok(legacy, 'the saved result is not read as work in progress');
  assert.equal(legacy.complete, true);
  assert.equal(legacy.fence, 'genomics-result');
  assert.ok(parts.some(part => part.kind === 'capability-pending' && part.fence === 'genomics-plan'));

  // Rewriting a reply must not rename what it holds: the fence a package claimed is the
  // fence it is written back under.
  assert.match(serializeChatVisualPart(legacy), /```genomics-result\n/);
  const roundTripped = transformChatProse(reply, prose => prose.replace('Here it is.', 'Here it was.'));
  assert.match(roundTripped, /```genomics-result\nnodus-genomics:\/\/chat\/x\/y\n```/);
  assert.match(roundTripped, /```genomics-plan\n/);
});
