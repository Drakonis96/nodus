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
await build({ stdin: { contents: `export * from './shared/skillMarketplace'; export * from './shared/chatSkills'; export * from './electron/skillMarketplace'; export * from './electron/chatSkills';`, resolveDir: root, loader: 'ts' }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'isolated-profile', setup(api) {
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

test('a skill can declare a capability no installed package provides yet', async () => {
  // The three disciplines became packages in 5.3.2, so `nodus:legal` is a real identifier
  // that nothing currently answers. A skill that needs one still installs and keeps the
  // activation the user chose; it simply does not run until its provider arrives, which
  // is what stops an uninstall from silently rewriting the user's library.
  for (const capability of ['genomics', 'legal']) {
    const nativeManifest = { ...manifest, capabilities: [capability], tools: [] };
    const nativePackage = { manifest: nativeManifest, files: { 'SKILL.md': 'Use the required native integration.' } };
    assert.deepEqual(lib.validateSkillPackage(nativePackage), nativePackage);
    const scanned = await lib.scanSkillSource(lib.getSkillMarketplace().sources[0], async url => String(url).endsWith('/skill.json')
      ? new Response(JSON.stringify(nativeManifest)) : mockFetch()(url));
    assert.equal(scanned.entries[0].package.manifest.capabilities[0], capability);

    const installed = lib.installChatSkillPackage(nativePackage).find(skill => !skill.builtin && skill.capabilities?.includes(capability));
    assert.ok(installed, 'the skill installs');
    assert.deepEqual(installed.enabled, { assistant: false, nodi: false });

    const personal = lib.saveChatSkill({ name: `External ${capability}`, description: 'Requires a capability package', instructions: 'Execute native plan', capabilities: [capability], enabled: { assistant: true, nodi: true } }).find(skill => skill.name === `External ${capability}`);
    assert.ok(personal, 'and so does one the user writes');
    assert.deepEqual(personal.enabled, { assistant: true, nodi: true }, 'keeping the activation they chose');
    assert.equal(lib.enabledChatSkills('assistant').some(skill => skill.id === personal.id), false, 'but it does not run without a provider');
    for (const skill of lib.listChatSkills().filter(skill => !skill.builtin)) lib.deleteChatSkill(skill.id);
  }
});

// The official catalog publishes this build's own built-ins (scripts/sync-skill-marketplace.mjs).
const builtinPackages = {
  'svg-studio': { manifest: { ...manifest, id: 'svg-studio', name: 'SVG Studio', capabilities: ['svg'], tools: [] }, files: { 'SKILL.md': 'Published catalog copy of the built-in.' } },
  alphagenome: { manifest: { ...manifest, id: 'alphagenome', name: 'AlphaGenome', capabilities: ['genomics'], tools: [] }, files: { 'SKILL.md': 'Published catalog copy of the native integration.' } },
};
const builtinFetch = async url => {
  const target = String(url);
  if (target.includes('raw.githubusercontent.com')) {
    const [directory, ...rest] = target.split(`${commit}/`)[1].split('/');
    const file = rest.join('/');
    return new Response(file === 'skill.json' ? JSON.stringify(builtinPackages[directory].manifest) : builtinPackages[directory].files[file]);
  }
  if (target.includes('/git/trees/')) return new Response(JSON.stringify({ tree: Object.entries(builtinPackages).flatMap(([id, pkg]) => ['skill.json', ...Object.keys(pkg.files)].map(file => ({ path: `${id}/${file}`, mode: '100644', type: 'blob', size: 100 }))) }));
  if (target.includes('/commits/')) return new Response(JSON.stringify({ sha: commit }));
  return new Response(JSON.stringify({ default_branch: 'main' }));
};

test('official listings of built-in skills reinstall the bundled skill instead of a second copy', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = builtinFetch;
  try {
    const official = lib.addSkillSource(lib.DEFAULT_SKILL_SOURCE).sources.find(source => lib.isOfficialSkillSource(source.url));
    await lib.updateSkillSource(official.id);
    lib.restoreChatSkills();
    const before = lib.listChatSkills().length;
    const installed = lib.installMarketplaceSkill(official.id, 'svg-studio', commit);
    const svg = installed.filter(skill => skill.name === 'SVG Studio');
    assert.equal(svg.length, 1, 'a listed built-in is never installed alongside itself');
    assert.equal(installed.length, before);
    assert.equal(svg[0].builtin, 'svg');
    assert.equal(svg[0].origin, undefined);
    assert.equal(svg[0].instructions, lib.DEFAULT_CHAT_SKILLS.find(skill => skill.builtin === 'svg').instructions, 'the bundled text is restored, never repository text');
    // Uninstalling removes the skill only: the native capability ships with the build and returns with it.
    lib.deleteChatSkill(svg[0].id);
    assert.equal(lib.listChatSkills().some(skill => skill.builtin === 'svg'), false);
    const reinstalled = lib.installMarketplaceSkill(official.id, 'svg-studio', commit);
    assert.deepEqual(reinstalled[0], lib.DEFAULT_CHAT_SKILLS[0]);
    // AlphaGenome is a capability package now, not a bundled skill, so the official
    // listing of its v1 skill is an ordinary download rather than a restore.
    assert.equal(reinstalled.some(skill => skill.builtin === 'genomics'), false);
    // A community source reusing an official identifier stays an ordinary, downloaded package.
    const community = lib.addSkillSource('https://github.com/community/nodus-skills').sources.at(-1);
    await lib.updateSkillSource(community.id);
    const shared = lib.installMarketplaceSkill(community.id, 'svg-studio', commit).filter(skill => skill.name === 'SVG Studio');
    assert.equal(shared.length, 2);
    assert.equal(shared.find(skill => skill.origin)?.instructions, builtinPackages['svg-studio'].files['SKILL.md']);
    // AlphaGenome is not a built-in any more, so a listing of it — official or community —
    // installs one ordinary downloaded skill. Its capability stays unavailable until the
    // package that provides it is installed.
    const communityGenomics = lib.installMarketplaceSkill(community.id, 'alphagenome', commit).filter(skill => skill.name === 'AlphaGenome');
    assert.equal(communityGenomics.length, 1);
    const downloaded = communityGenomics.find(skill => skill.origin);
    assert.ok(downloaded); assert.equal(downloaded.builtin, undefined);
    assert.deepEqual(downloaded.enabled, { assistant: false, nodi: false });
    lib.deleteChatSkill(downloaded.id);
    lib.deleteChatSkill(shared.find(skill => skill.origin).id);
    lib.removeSkillSource(community.id);
  } finally { globalThis.fetch = originalFetch; }
});

test('a duplicate installed by an earlier build is consolidated instead of surviving beside the built-in', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = builtinFetch;
  try {
    const official = lib.getSkillMarketplace().sources.find(source => lib.isOfficialSkillSource(source.url));
    lib.restoreChatSkills();
    // Exactly the library an earlier build produced: the built-in plus a downloaded copy of it.
    const legacy = lib.installChatSkillPackage(builtinPackages['svg-studio'],
      { sourceId: lib.officialSkillSourceId(), path: 'svg-studio', commit, packageId: 'svg-studio', version: '1.0.0', digest: lib.packageDigest(builtinPackages['svg-studio']) })
      .find(skill => skill.origin?.packageId === 'svg-studio');
    assert.equal(lib.listChatSkills().filter(skill => skill.name === 'SVG Studio').length, 2);
    const consolidated = lib.installMarketplaceSkill(official.id, 'svg-studio', commit);
    assert.deepEqual(consolidated.filter(skill => skill.name === 'SVG Studio'), [lib.DEFAULT_CHAT_SKILLS[0]], 'the downloaded duplicate is removed, leaving one built-in');
    assert.equal(fs.existsSync(path.join(temporary, 'skills', legacy.id)), false, 'its package directory goes with it');
    // A copy from another repository is a different skill and is never touched.
    const community = lib.addSkillSource('https://github.com/community/nodus-skills').sources.at(-1);
    await lib.updateSkillSource(community.id);
    const external = lib.installMarketplaceSkill(community.id, 'svg-studio', commit).find(skill => skill.origin?.sourceId === community.id);
    assert.equal(lib.installMarketplaceSkill(official.id, 'svg-studio', commit).some(skill => skill.id === external.id), true);
    lib.deleteChatSkill(external.id);
    lib.removeSkillSource(community.id);
  } finally { globalThis.fetch = originalFetch; }
});
