import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-chat-skills-test-'));
const bundle = path.join(temporary, 'test.cjs');
await build({
  stdin: { contents: `export * from './shared/chatSkills'; export * from './electron/chatSkills'; export * from './electron/chatAssets'; export * from './electron/ai/chatSkillExecution';`, resolveDir: root, loader: 'ts' },
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{ name: 'isolated-test', setup(api) {
    api.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'mock' }));
    api.onResolve({ filter: /^\.\/chatSvgQuality$/ }, () => ({ path: 'svg-quality', namespace: 'mock' }));
    api.onResolve({ filter: /^\.\/decorativeImages$/ }, () => ({ path: 'images', namespace: 'mock' }));
    api.onResolve({ filter: /db\/settingsRepo$/ }, () => ({ path: 'settings', namespace: 'mock' }));
    api.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path: name }) => ({ contents: name === 'electron'
      ? `export const app = { getPath: () => ${JSON.stringify(temporary)} };`
      : name === 'svg-quality' ? `export const refineChatSvg = async answer => answer;`
      : name === 'settings' ? `export const getSettings = () => ({ imageProvider: 'google', imageModel: 'user-selected-image-model' });`
      : `export const callImageProvider = (...args) => globalThis.__skillImageProvider(...args); export const prepareGeneratedImage = (image) => ({ image: image.bytes, mimeType: image.mimeType });`, loader: 'js' }));
    api.onResolve({ filter: /^@shared\// }, ({ path: specifier }) => ({ path: path.join(root, 'shared', `${specifier.slice(8)}.ts`) }));
  } }],
});
const lib = require(bundle);
process.on('exit', () => fs.rmSync(temporary, { recursive: true, force: true }));

test('visual parser recognizes raw, SVG, XML and tilde fences, preserving ordinary code and text', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><title>Diagram</title><path d="M0 0L1 1"/></svg>';
  for (const text of [svg, `\`\`\`svg\n${svg}\n\`\`\``, `~~~xml\n${svg}\n~~~`, `~~~xml\n<?xml version="1.0"?>\n${svg}\n~~~`]) {
    const parts = lib.splitChatVisuals(`Before\n\n${text}\n\nAfter`);
    assert.equal(parts[1].kind, 'svg'); assert.equal(parts[1].complete, true);
    assert.equal(parts[1].content, svg);
    assert.match(parts[0].content, /Before/); assert.match(parts[2].content, /After/);
  }
  const code = `\`\`\`js\nconst markup = '${svg}';\n\`\`\``;
  assert.deepEqual(lib.splitChatVisuals(code), [{ kind: 'markdown', content: code, complete: true }]);
  assert.equal(lib.splitChatVisuals('```svg\n<svg><path')[0].complete, false);
  assert.equal(lib.splitChatVisuals('```nodus-image\n{"prompt":')[0].kind, 'image-request');
});

test('skills support independent activation, CRUD and explicit built-in restoration', () => {
  assert.equal(lib.listChatSkills().length, 11);
  const built = lib.listChatSkills()[0];
  lib.saveChatSkill({ ...built, enabled: { assistant: false, nodi: true } });
  assert.equal(lib.enabledChatSkills('assistant').length, 1);
  assert.equal(lib.enabledChatSkills('nodi').length, 2);
  lib.saveChatSkill({ id: 'untrusted-id', builtin: 'image', name: 'A custom skill', description: 'For reviews', instructions: 'Give two recommendations.', enabled: { assistant: true, nodi: false } });
  const custom = lib.listChatSkills().find(item => !item.builtin);
  assert.ok(custom); assert.notEqual(custom.id, 'untrusted-id');
  lib.deleteChatSkill(built.id);
  assert.equal(lib.listChatSkills().some(item => item.id === built.id), false);
  assert.equal(lib.restoreChatSkills().length, 12);
  lib.deleteChatSkill(custom.id);
  assert.throws(() => lib.saveChatSkill({ name: '' }), /name, description/);
});

test('Socratic Tutor is opt-in, can be activated independently, edited and deleted', () => {
  const tutor = lib.listChatSkills().find(skill => skill.builtin === 'socratic');
  assert.ok(tutor);
  assert.deepEqual(tutor.enabled, { assistant: false, nodi: false });
  for (const surface of ['assistant', 'nodi']) assert.doesNotMatch(lib.buildChatSkillsPrompt(lib.enabledChatSkills(surface)), /Socratic Tutor/);
  lib.saveChatSkill({ ...tutor, instructions: 'Ask one focused question at a time.', enabled: { assistant: true, nodi: false } });
  assert.match(lib.buildChatSkillsPrompt(lib.enabledChatSkills('assistant')), /Socratic Tutor/);
  assert.doesNotMatch(lib.buildChatSkillsPrompt(lib.enabledChatSkills('nodi')), /Socratic Tutor/);
  assert.equal(lib.listChatSkills().find(skill => skill.id === tutor.id).instructions, 'Ask one focused question at a time.');
  lib.deleteChatSkill(tutor.id);
  assert.equal(lib.listChatSkills().some(skill => skill.id === tutor.id), false);
  const restored = lib.restoreChatSkills().find(skill => skill.id === tutor.id);
  assert.deepEqual(restored.enabled, { assistant: false, nodi: false });
});

test('existing libraries receive the disabled tutor once without overwriting user choices', () => {
  const location = path.join(temporary, 'chat-skills.json');
  const original = fs.readFileSync(location);
  try {
    const edited = { ...lib.DEFAULT_CHAT_SKILLS[0], instructions: 'Keep my edited SVG instructions.', enabled: { assistant: false, nodi: true } };
    const personal = { id: 'personal', name: 'My skill', description: 'For writing', instructions: 'Use short sentences.', enabled: { assistant: true, nodi: false } };
    fs.writeFileSync(location, JSON.stringify({ version: 1, skills: [edited, personal] }));
    const migrated = lib.listChatSkills();
    assert.deepEqual(migrated.slice(0, 2), [edited, personal]);
    assert.equal(migrated.some(skill => skill.builtin === 'image'), false, 'deleted image skill stays deleted');
    const tutor = migrated.find(skill => skill.builtin === 'socratic');
    assert.deepEqual(tutor.enabled, { assistant: false, nodi: false });
    assert.equal(JSON.parse(fs.readFileSync(location)).version, 3);
    assert.equal(lib.listChatSkills().length, 11, 'migration is idempotent');
    lib.deleteChatSkill(tutor.id);
    assert.equal(lib.listChatSkills().some(skill => skill.builtin === 'socratic'), false, 'deleted tutor does not reappear');
  } finally { fs.writeFileSync(location, original); }
});

test('all eight general skills are opt-in, independently configurable and restorable', () => {
  const general = lib.listChatSkills().filter(skill => skill.builtin === 'general');
  assert.deepEqual(general.map(skill => skill.name), ['Thought Partner', 'Brainstorm Studio', 'Make It Simple', 'Action Planner', 'Compare & Choose', 'Constructive Critic', 'Writing Partner', 'Perspective Switcher']);
  for (const skill of general) {
    assert.deepEqual(skill.enabled, { assistant: false, nodi: false });
    for (const surface of ['assistant', 'nodi']) assert.equal(lib.buildChatSkillsPrompt(lib.enabledChatSkills(surface)).includes(`<skill id=${JSON.stringify(skill.id)}`), false);
    lib.saveChatSkill({ ...skill, instructions: 'My edited instructions.', enabled: { assistant: false, nodi: true } });
    assert.equal(lib.enabledChatSkills('assistant').some(item => item.id === skill.id), false);
    assert.equal(lib.enabledChatSkills('nodi').find(item => item.id === skill.id).instructions, 'My edited instructions.');
    lib.deleteChatSkill(skill.id);
    assert.equal(lib.listChatSkills().some(item => item.id === skill.id), false);
  }
  const restored = lib.restoreChatSkills().filter(skill => skill.builtin === 'general');
  assert.deepEqual(restored, general);
});

test('version 2 migration adds general skills once and preserves edited or deleted earlier defaults', () => {
  const location = path.join(temporary, 'chat-skills.json');
  const original = fs.readFileSync(location);
  try {
    const tutor = { ...lib.DEFAULT_CHAT_SKILLS.find(skill => skill.builtin === 'socratic'), instructions: 'Keep my tutor.', enabled: { assistant: true, nodi: false } };
    const edited = { ...lib.DEFAULT_CHAT_SKILLS.find(skill => skill.builtin === 'general'), instructions: 'Keep my imported method.', enabled: { assistant: false, nodi: true } };
    fs.writeFileSync(location, JSON.stringify({ version: 2, skills: [tutor, edited] }));
    const migrated = lib.listChatSkills();
    assert.equal(migrated.length, 9);
    assert.deepEqual(migrated.slice(0, 2), [tutor, edited]);
    assert.equal(migrated.some(skill => ['svg', 'image'].includes(skill.builtin)), false);
    for (const skill of migrated.slice(2)) assert.deepEqual(skill.enabled, { assistant: false, nodi: false });
    lib.deleteChatSkill(edited.id);
    assert.equal(lib.listChatSkills().some(skill => skill.id === edited.id), false);
    fs.writeFileSync(location, JSON.stringify({ version: 2, skills: [] }));
    const fromEmpty = lib.listChatSkills();
    assert.equal(fromEmpty.length, 8);
    assert.ok(fromEmpty.every(skill => skill.builtin === 'general'), 'a previously deleted tutor stays deleted');
    assert.deepEqual(lib.listChatSkills(), fromEmpty, 'migration does not duplicate defaults');
  } finally { fs.writeFileSync(location, original); }
});

test('image requests use the exact model and prompt, persist metadata, and return real local URLs', async () => {
  const owner = lib.chatAssetOwner('assistant', 'conversation-one', 'vault-one');
  const brief = { title: 'Test image', alt: 'Two blue shapes', prompt: 'Create two blue shapes on white with generous negative space.' };
  let calls = 0;
  globalThis.__skillImageProvider = async (provider, model, prompt) => {
    assert.equal(provider, 'google'); assert.equal(model, 'user-selected-image-model'); assert.equal(prompt, brief.prompt);
    calls++; return { bytes: Buffer.from('image-bytes'), mimeType: 'image/png' };
  };
  const answer = await lib.executeChatSkills(`Before\n\`\`\`nodus-image\n${JSON.stringify(brief)}\n\`\`\`\nAfter`, { owner, version: 0, skills: lib.DEFAULT_CHAT_SKILLS, isCurrent: () => true });
  assert.equal(calls, 1); assert.doesNotMatch(answer, /```nodus-image/);
  const source = answer.match(/\((nodus-image:[^)]+)\)/)[1];
  assert.equal(lib.getChatImageMetadata(source).prompt, brief.prompt);
  assert.equal(lib.getChatImage(source.replace('nodus-image://chat/', '')).blob.toString(), 'image-bytes');
  lib.reconcileChatAssets(owner, [{ content: answer }]);
  assert.ok(lib.getChatImageMetadata(source));
  lib.reconcileChatAssets(owner, []);
  assert.equal(lib.getChatImageMetadata(source), null);
});

test('disabled, malformed and incomplete requests never invoke a provider', async () => {
  let calls = 0; globalThis.__skillImageProvider = () => { calls++; throw new Error('unexpected'); };
  const owner = lib.chatAssetOwner('nodi', 'disabled');
  for (const [body, skills] of [
    ['```nodus-image\n{"prompt":"An image that must never be created."}\n```', []],
    ['```nodus-image\n{"prompt":1}\n```', lib.DEFAULT_CHAT_SKILLS],
    ['```nodus-image\n{"prompt":"Unfinished image request', lib.DEFAULT_CHAT_SKILLS],
  ]) {
    const result = await lib.executeChatSkills(body, { owner, version: 0, skills, isCurrent: () => true });
    assert.equal(lib.splitChatVisuals(result).find(part => part.kind === 'image-error')?.complete, true);
  }
  assert.equal(calls, 0);
});

test('deletion during a generation invalidates the result and leaves no image files', async () => {
  const owner = lib.chatAssetOwner('nodi', 'deleted-while-generating');
  let finish;
  globalThis.__skillImageProvider = () => new Promise(resolve => { finish = resolve; });
  const promise = lib.executeChatSkills('```nodus-image\n{"prompt":"Create a quiet library in soft light."}\n```', { owner, version: lib.chatAssetVersion(owner), skills: lib.DEFAULT_CHAT_SKILLS, isCurrent: () => true });
  await new Promise(resolve => setImmediate(resolve));
  lib.deleteChatAssets(owner);
  finish({ bytes: Buffer.from('image'), mimeType: 'image/png' });
  await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(fs.existsSync(path.join(temporary, 'chat-assets', owner)), false);
});

test('cancellation and vault switches discard generated results', async () => {
  for (const abort of [true, false]) {
    const owner = lib.chatAssetOwner('assistant', String(abort), 'vault');
    const controller = new AbortController(); let current = true;
    globalThis.__skillImageProvider = async () => {
      if (abort) controller.abort(); else current = false;
      return { bytes: Buffer.from('image'), mimeType: 'image/png' };
    };
    await assert.rejects(lib.executeChatSkills('```nodus-image\n{"prompt":"Create a blue architectural illustration."}\n```', { owner, version: 0, skills: lib.DEFAULT_CHAT_SKILLS, isCurrent: () => current }, controller.signal), { name: 'AbortError' });
    assert.equal(fs.existsSync(path.join(temporary, 'chat-assets', owner)), false);
  }
});

test('asset paths reject traversal and different vaults have different owners', () => {
  assert.notEqual(lib.chatAssetOwner('assistant', 'same', 'a'), lib.chatAssetOwner('assistant', 'same', 'b'));
  assert.equal(lib.getChatImage('../../secrets'), null);
  assert.equal(lib.getChatImageMetadata('file:///etc/passwd'), null);
  assert.throws(() => lib.deleteChatAssets('../escape'), /Invalid/);
});

test('raw image briefs retain optional composition format and ordinary JSON remains text', async () => {
  const brief = { title: 'Portrait', alt: 'A tall scene', prompt: 'Create a detailed portrait composition of an observatory.', aspectRatio: '9:16' };
  assert.equal(lib.splitChatVisuals(JSON.stringify(brief))[0].kind, 'image-request');
  assert.equal(lib.splitChatVisuals('{"prompt":"ordinary JSON"}')[0].kind, 'markdown');
  assert.equal(lib.splitChatVisuals(JSON.stringify({ ...brief, unrelated: true }))[0].kind, 'markdown');
  const owner = lib.chatAssetOwner('assistant', 'portrait');
  globalThis.__skillImageProvider = async (_provider, _model, _prompt, _signal, format) => {
    assert.equal(format, '9:16');
    return { bytes: Buffer.from('portrait'), mimeType: 'image/png' };
  };
  const answer = await lib.executeChatSkills(JSON.stringify(brief), { owner, version: 0, skills: lib.DEFAULT_CHAT_SKILLS, isCurrent: () => true });
  const source = answer.match(/\((nodus-image:[^)]+)\)/)[1];
  assert.equal(lib.getChatImageMetadata(source).aspectRatio, '9:16');
  lib.deleteChatAssets(owner);
});
