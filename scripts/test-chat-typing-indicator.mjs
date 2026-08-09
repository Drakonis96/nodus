import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('Nodi and the research assistant share the Zotero-style waiting indicator', async () => {
  const [indicator, styles, nodi, assistant] = await Promise.all([
    read('src/components/ChatTypingIndicator.tsx'),
    read('src/components/chatTypingIndicator.css'),
    read('src/components/nodi/NodiCompanion.tsx'),
    read('src/views/ResearchAssistantModal.tsx'),
  ]);

  assert.equal((indicator.match(/className="chat-typing-dot"/g) ?? []).length, 3);
  assert.match(styles, /animation: chat-typing-dot 1\.2s infinite ease-in-out/);
  assert.match(styles, /transform: translateY\(-4px\)/);
  assert.match(styles, /\.chat-typing-dot:nth-child\(2\)/);
  assert.match(styles, /\.chat-typing-dot:nth-child\(3\)/);

  assert.match(nodi, /streaming && i === messages\.length - 1 \? <ChatTypingIndicator/);
  assert.match(assistant, /message\.id === streamingId \? \(\s*<ChatTypingIndicator/);
  assert.doesNotMatch(nodi, /escribiendo…<\/span>/);
});
