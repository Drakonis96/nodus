import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('character chat exposes persistent history, image opt-in and destructive confirmation', async () => {
  const [modal, preload, ipc, api] = await Promise.all([
    read('src/components/CharacterInterviewModal.tsx'),
    read('electron/preload.ts'),
    read('electron/ipc.ts'),
    read('shared/types.ts'),
  ]);

  assert.match(modal, /data-testid="character-chat-history-toggle"/);
  assert.match(modal, /data-testid="character-chat-image-toggle"/);
  assert.match(modal, /role="switch"/);
  assert.match(modal, /absolute left-0\.5 top-0\.5/, 'the switch thumb is anchored inside its track');
  assert.match(modal, /PersonPortrait/);
  assert.match(modal, /data-testid="character-chat-character-avatar"/);
  assert.match(modal, /listCharacterChatConversations/);
  assert.match(modal, /getCharacterChatConversation/);
  assert.match(modal, /deleteCharacterChatConversation/);
  assert.match(modal, /ConfirmModal/);
  assert.match(modal, /todos sus mensajes e imágenes/);
  assert.match(modal, /characterChatImageUrl/);
  assert.match(modal, /ImageLightbox/);

  for (const method of [
    'listCharacterChatConversations',
    'getCharacterChatConversation',
    'createCharacterChatConversation',
    'setCharacterChatImagesEnabled',
    'sendCharacterChatMessage',
    'deleteCharacterChatConversation',
  ]) {
    assert.match(preload, new RegExp(method), `${method} is exposed by the preload bridge`);
    assert.match(api, new RegExp(method), `${method} is part of the typed renderer API`);
  }
  assert.match(ipc, /characters:sendChatMessage/);
  assert.match(ipc, /characters:deleteChatConversation/);
});

test('character chat images use the database-backed image protocol', async () => {
  const [protocol, urls] = await Promise.all([
    read('electron/imageProtocol.ts'),
    read('src/lib/imageUrl.ts'),
  ]);
  assert.match(protocol, /host === 'character-chat'/);
  assert.match(protocol, /host === 'character-chat-thumbnail'/);
  assert.match(protocol, /getCharacterChatImageBlob/);
  assert.match(urls, /'character-chat'/);
  assert.match(urls, /characterChatImageUrl/);
  assert.match(urls, /characterChatThumbnailUrl/);
});
