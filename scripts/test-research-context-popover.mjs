// The assistant's context picker ("Síntesis" and friends) used to open as a
// centered modal that covered the conversation. It now behaves like the Skills
// menu: a balloon anchored to its header trigger. This guards the regression.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('the assistant context picker opens as an anchored balloon, not a modal', async () => {
  const [assistant, balloon, styles] = await Promise.all([
    read('src/views/ResearchAssistantModal.tsx'),
    read('src/components/HeaderBalloon.tsx'),
    read('src/views/researchAssistant.css'),
  ]);

  // Since the header's balloons were unified, the picker is the shared HeaderBalloon.
  assert.match(assistant, /<HeaderBalloon[\s\S]*?anchor=\{contextTriggerRef\}[\s\S]*?testId="research-context-panel"[\s\S]*?className="research-context-panel"/, 'the picker is a balloon anchored to its trigger');
  assert.match(assistant, /setShowContext\(\(value\) => !value\)/, 'the trigger toggles the picker');
  assert.match(balloon, /import \{ createPortal \} from 'react-dom'/, 'the balloon renders through a portal');
  assert.match(balloon, /addEventListener\('mousedown', pointer\)/, 'a click outside dismisses it');
  assert.doesNotMatch(balloon, /aria-modal/, 'the balloon is not a modal');

  // The old centered dialog is gone: no full-screen backdrop. Only the outer
  // research-assistant window remains a modal; the picker is not one.
  assert.doesNotMatch(assistant, /fixed inset-0 z-\[60\]/, 'the modal backdrop was removed');
  assert.match(assistant, /aria-modal=\{embedded \? undefined : true\}/, 'only the standalone assistant window is a modal');

  assert.match(styles, /\.research-context-panel\s*\{/, 'the balloon class is styled');
});
