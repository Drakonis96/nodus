import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const root = path.resolve(import.meta.dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-marketplace-test-'));
const bundle = path.join(temporary, 'test.cjs');
await build({ stdin: { contents: `export * from './shared/skillMarketplace'; export * from './electron/skillMarketplace'; export * from './electron/chatSkills';`, resolveDir: root, loader: 'ts' }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'isolated-profile', setup(api) {
  api.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'mock' }));
  api.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `export const app = { getPath: () => ${JSON.stringify(temporary)}, getVersion: () => '5.3.0' }; export const safeStorage = { isEncryptionAvailable: () => false };` }));
  api.onResolve({ filter: /^@shared\// }, ({ path: specifier }) => ({ path: path.join(root, 'shared', `${specifier.slice(8)}.ts`) }));
} }] });
const lib = createRequire(import.meta.url)(bundle);
process.on('exit', () => fs.rmSync(temporary, { recursive: true, force: true }));
const manifest = { schemaVersion: 1, id: 'sample-skill', name: 'Sample Skill', description: 'Summarize a sample', category: 'Data analysis', author: 'researcher', license: 'MIT', version: '1.0.0', instructions: 'SKILL.md', capabilities: ['svg'], tools: [{ id: 'sum', entry: 'tools/sum.js', description: 'Input { values: number[] }. Sum numbers.', runtime: 'javascript-sandbox' }] };
const pkg = { manifest, files: { 'SKILL.md': 'Use the sum tool with numbers supplied by the user.', 'tools/sum.js': '(input) => input.values.reduce((a,b) => a+b, 0)' } };
const commit = 'a'.repeat(40);
function mockFetch(overrides = {}) {
  return async url => {
    let value;
    if (String(url).includes('raw.githubusercontent.com')) {
      const file = String(url).split(`${commit}/`)[1];
      value = file === 'sample-skill/skill.json' ? JSON.stringify(manifest) : pkg.files[file.replace('sample-skill/', '')];
    } else if (String(url).includes('/git/trees/')) value = { tree: ['sample-skill/skill.json', ...Object.keys(pkg.files).map(f => 'sample-skill/' + f)].map(p => ({ path: p, mode: '100644', type: 'blob', size: 100 })), ...overrides };
    else if (String(url).includes('/commits/')) value = { sha: commit };
    else value = { default_branch: 'main' };
    return new Response(typeof value === 'string' ? value : JSON.stringify(value), { status: 200 });
  };
}
test('package validation rejects traversal, unsupported tools, duplicate capabilities and oversized instructions', () => {
  assert.deepEqual(lib.validateSkillPackage(pkg), pkg);
  for (const patch of [{ instructions: '../secret' }, { capabilities: ['shell'] }, { capabilities: ['svg','svg'] }, { id: '../x' }, { tools: [{ ...manifest.tools[0], entry: '../secret' }] }, { tools: [{ ...manifest.tools[0], runtime: 'node' }] }, { tools: [manifest.tools[0], manifest.tools[0]] }, { surprise: true }]) assert.throws(() => lib.validateManifest({ ...manifest, ...patch }));
  assert.throws(() => lib.validateSkillPackage({ ...pkg, files: { ...pkg.files, 'SKILL.md': 'a'.repeat(16001) } }));
  assert.throws(() => lib.validateSkillPackage({ ...pkg, files: { ...pkg.files, 'secret.txt': 'secret' } }));
});
test('sources are normalized, unrestricted in count and cannot redirect to other hosts', () => {
  assert.equal(lib.getSkillMarketplace().sources[0].url, lib.DEFAULT_SKILL_SOURCE);
  for (let i = 0; i < 45; i++) lib.addSkillSource(`https://github.com/Research/repo-${i}.git`);
  assert.equal(lib.getSkillMarketplace().sources.length, 46);
  assert.throws(() => lib.addSkillSource('https://github.com/research/REPO-1/'), /already added/);
  for (const url of ['http://github.com/a/b','https://github.com/a/b/tree/main','https://evil.test/a/b','https://github.com@evil.test/a/b','https://github.com/a/b?token=x']) assert.throws(() => lib.normalizeSkillSource(url));
});
test('scanner pins every file, skips broken packages, refuses incomplete trees', async () => {
  const source = lib.getSkillMarketplace().sources[0];
  const scanned = await lib.scanSkillSource(source, mockFetch());
  assert.equal(scanned.commit, commit); assert.equal(scanned.entries.length, 1); assert.deepEqual(scanned.entries[0].package, pkg);
  const invalid = await lib.scanSkillSource(source, mockFetch({ tree: [{ path: 'sample-skill/skill.json', mode: '120000', type: 'blob', size: 10 }] }));
  assert.equal(invalid.entries.length, 0); assert.match(invalid.errors[0], /non-regular/);
  await assert.rejects(lib.scanSkillSource(source, mockFetch({ truncated: true })), /incomplete/);
  await assert.rejects(lib.scanSkillSource(source, async () => new Response('blocked', { status: 429 })), /Rate limit/);
});
test('complete lifecycle: refresh, install, activate, edit, export, import, replace, remove, delete and reload', async () => {
  const source = lib.getSkillMarketplace().sources[0];
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = mockFetch();
    await lib.updateSkillSource(source.id);
    let skills = lib.installMarketplaceSkill(source.id, manifest.id, commit);
    let installed = skills.find(s => s.origin?.packageId === manifest.id);
    assert.deepEqual(installed.enabled, { assistant: false, nodi: false });
    assert.equal(installed.tools[0].source, pkg.files['tools/sum.js']);
    assert.equal(fs.existsSync(path.join(temporary, 'skills', installed.id, 'tools/sum.js')), true);
    installed = lib.saveChatSkill({ ...installed, enabled: { assistant: true, nodi: false }, instructions: 'My local edit' }).find(s => s.id === installed.id);
    assert.ok(lib.enabledChatSkills('assistant').some(s => s.id === installed.id));
    assert.ok(!lib.enabledChatSkills('nodi').some(s => s.id === installed.id));
    await lib.updateSkillSource(source.id);
    assert.equal(lib.listChatSkills().find(s => s.id === installed.id).instructions, 'My local edit');
    const exports = path.join(temporary, 'exports'); fs.mkdirSync(exports);
    const directory = lib.exportSkillDirectory(installed.id, exports);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'skill.json'))).id, manifest.id);
    assert.throws(() => lib.exportSkillDirectory(installed.id, exports), /EEXIST/);
    const imported = lib.importSkillDirectory(directory).find(s => !s.builtin && !s.origin);
    assert.equal(imported.instructions, 'My local edit'); assert.deepEqual(imported.enabled, { assistant: false, nodi: false });
    assert.throws(() => lib.installMarketplaceSkill(source.id, manifest.id, 'b'.repeat(40)), /catalog changed/);
    const replaced = lib.installMarketplaceSkill(source.id, manifest.id, commit).find(s => s.id === installed.id);
    assert.equal(replaced.instructions, pkg.files['SKILL.md']); assert.deepEqual(replaced.enabled, { assistant: false, nodi: false });
    globalThis.fetch = async url => String(url).includes('raw.githubusercontent.com') ? new Response('rate limit', { status: 429 }) : mockFetch()(url);
    await assert.rejects(lib.updateSkillSource(source.id), /Rate limit/);
    assert.equal(lib.getSkillMarketplace().sources[0].entries.length, 1, 'a package download failure preserves the entire previous catalog');
    globalThis.fetch = async url => String(url).includes('raw.githubusercontent.com') ? new Response(new ReadableStream({ start(controller) { controller.error(new Error('Disconnected')); } })) : mockFetch()(url);
    await assert.rejects(lib.updateSkillSource(source.id), /interrupted/);
    assert.equal(lib.getSkillMarketplace().sources[0].entries.length, 1, 'an interrupted body preserves the previous catalog');
    globalThis.fetch = async () => new Response('error', { status: 500 });
    await assert.rejects(lib.updateSkillSource(source.id));
    assert.equal(lib.getSkillMarketplace().sources[0].entries.length, 1);
    lib.removeSkillSource(source.id); assert.ok(lib.listChatSkills().some(s => s.id === installed.id));
    lib.deleteChatSkill(installed.id); assert.equal(fs.existsSync(path.join(temporary, 'skills', installed.id)), false);
    const importedDirectory = path.join(temporary, 'skills', imported.id);
    fs.rmSync(importedDirectory, { recursive: true });
    assert.ok(lib.listChatSkills().some(s => s.id === imported.id)); assert.ok(fs.existsSync(importedDirectory));
  } finally { globalThis.fetch = originalFetch; }
});
test('local imports reject symlink escapes', () => {
  const dir = path.join(temporary, 'malicious'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'skill.json'), JSON.stringify({ ...manifest, tools: [] }));
  fs.writeFileSync(path.join(temporary, 'private.txt'), 'private');
  fs.symlinkSync(path.join(temporary, 'private.txt'), path.join(dir, 'SKILL.md'));
  assert.throws(() => lib.importSkillDirectory(dir), /Invalid package file/);
});

test('AlphaGenome and Legalize are registered capabilities available to compatible external skills', async () => {
  for (const capability of ['genomics', 'legal']) {
    const nativeManifest = { ...manifest, capabilities: [capability], tools: [] };
    const nativePackage = { manifest: nativeManifest, files: { 'SKILL.md': 'Use the required native integration.' } };
    assert.deepEqual(lib.validateSkillPackage(nativePackage), nativePackage);
    const scanned = await lib.scanSkillSource(lib.getSkillMarketplace().sources[0], async url => String(url).endsWith('/skill.json')
      ? new Response(JSON.stringify(nativeManifest)) : mockFetch()(url));
    assert.equal(scanned.entries[0].package.manifest.capabilities[0], capability);
    const installed = lib.installChatSkillPackage(nativePackage).find(skill => !skill.builtin && skill.capabilities?.includes(capability));
    assert.ok(installed); assert.deepEqual(installed.enabled, { assistant: false, nodi: false });
    const directory = path.join(temporary, `unsupported-${capability}`);
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'skill.json'), JSON.stringify(nativeManifest));
    fs.writeFileSync(path.join(directory, 'SKILL.md'), nativePackage.files['SKILL.md']);
    assert.ok(lib.importSkillDirectory(directory).some(skill => !skill.builtin && skill.capabilities?.includes(capability)));
    const personal = lib.saveChatSkill({ name: `External ${capability}`, description: 'Requires native integration', instructions: 'Execute native plan', capabilities: [capability], enabled: { assistant: true, nodi: true } }).find(skill => skill.name === `External ${capability}`);
    assert.ok(personal); assert.ok(lib.enabledChatSkills('assistant').some(skill => skill.id === personal.id));
    for (const skill of lib.listChatSkills().filter(skill => !skill.builtin)) lib.deleteChatSkill(skill.id);
  }
});
