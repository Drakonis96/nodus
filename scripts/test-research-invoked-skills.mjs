// Skills invoked with @ in the Research chat: resolved even when switched off for the chat,
// named to the model as a rule for that turn, and stored with the message.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-invoked-skills')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-invoked-skills-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
try {
  load('electron/db/database.ts').getDb();
  const skills = load('electron/chatSkills.ts');
  skills.initializeChatSkillDefaults();
  const svg = skills.listChatSkills().find(skill => skill.builtin === 'svg');
  assert.ok(svg, 'the SVG skill ships by default');
  skills.saveChatSkill({ ...svg, enabled: { assistant: false, nodi: false } });
  assert.ok(!skills.enabledChatSkills('assistant').some(skill => skill.id === svg.id), 'switched off for the chat');
  assert.deepEqual(skills.invokedChatSkills([svg.id, 'missing', 42]).map(skill => skill.id), [svg.id], 'named with @, it applies anyway; unknown ids are dropped');
  assert.deepEqual(skills.invokedChatSkills(undefined), []);
  assert.equal(skills.invokedChatSkills(Array.from({ length: 20 }, () => svg.id)).length, 1);

  const { invokedSkillsRule } = load('electron/ai/researchAssistant.ts');
  assert.match(invokedSkillsRule([svg.id], [svg]), new RegExp(`INVOKED SKILLS: The user explicitly invoked "${svg.name}" with @`));
  assert.equal(invokedSkillsRule(undefined, [svg]), '', 'no rule without an invocation');
  assert.equal(invokedSkillsRule(['other'], [svg]), '', 'no rule for a skill that did not resolve');

  const chat = load('electron/db/chatRepo.ts');
  const conversation = chat.createConversation({ title: 'Skills' });
  chat.saveMessages(conversation.id, [
    { id: 'u1', role: 'user', content: 'Dibuja el ciclo', skills: [{ id: svg.id, name: svg.name }] },
    { id: 'a1', role: 'assistant', content: 'Hecho' },
  ]);
  const stored = chat.getConversation(conversation.id).messages;
  assert.deepEqual(stored[0].skills, [{ id: svg.id, name: svg.name }], 'the invocation is kept with its message');
  assert.equal(stored[1].skills, undefined);
  console.log('Invoked skills resolve past the per-chat switch, reach the prompt as a rule and persist with their message.');
} finally {
  load('electron/db/database.ts').closeDb();
  fs.rmSync(scratch, { recursive: true, force: true });
}
