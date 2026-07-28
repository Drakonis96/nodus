import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('world chat has the same conversation, model, context and streaming controls as study chat', async () => {
  const [view, types, preload, ipc] = await Promise.all([
    read('src/views/WorldChatView.tsx'),
    read('shared/types.ts'),
    read('electron/preload.ts'),
    read('electron/ipc.ts'),
  ]);
  for (const contract of [
    'listWorldChatConversations',
    'getWorldChatConversation',
    'createWorldChatConversation',
    'saveWorldChatConversation',
    'deleteWorldChatConversation',
  ]) {
    for (const source of [view, types, preload, ipc]) assert.match(source, new RegExp(contract));
  }
  assert.match(view, /world-chat-history-sidebar/);
  assert.match(view, /world-chat-context-sidebar/);
  assert.match(view, /<ModelPicker/);
  assert.match(view, /useFeatureModel\(settings, 'chatModel'\)/);
  assert.match(view, /<ConfirmModal/);
  assert.match(view, /selection\.scope === 'manual'/);
  assert.match(view, /entrySearch/);
  assert.match(view, /selection\.keepFocus/);
  assert.match(view, /cancelWorldChat/);
  assert.match(view, /event\.key === 'Enter' && !event\.shiftKey/);
  assert.match(view, /<textarea/);
});

test('the global assistant action is mode-aware in worldbuilding', async () => {
  const app = await read('src/App.tsx');
  assert.match(app, /if \(isWorldbuilding\)[\s\S]{0,160}setView\('worldChat'\)/);
  assert.match(app, /isWorldbuilding \? 'Chat del mundo' : 'Asistente de investigación'/);
  assert.match(app, /isWorldbuilding \? 'Abrir chat del mundo' : 'Abrir asistente de investigación'/);
  assert.match(app, /<WorldChatView settings=\{settings\}/);
});
