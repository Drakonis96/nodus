import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('restarting a completed immersion clears answers and all prior progress', async () => {
  const [repo, ipc, preload, types, view] = await Promise.all([
    read('electron/db/immersionRepo.ts'),
    read('electron/ipc.ts'),
    read('electron/preload.ts'),
    read('shared/types.ts'),
    read('src/views/ImmersionView.tsx'),
  ]);
  assert.match(repo, /export function restartImmersionSession[\s\S]*setImmersionProgress\(id, emptyImmersionProgress\(\)\)/);
  assert.match(ipc, /h\('immersion:restart'/);
  assert.match(preload, /restartImmersionSession: \(id\) => ipcRenderer\.invoke\('immersion:restart', id\)/);
  assert.match(types, /restartImmersionSession\(id: string\): Promise<ImmersionSession \| null>/);
  assert.match(view, /restart\s*\?\s*await window\.nodus\.restartImmersionSession\(id\)/);
  assert.match(view, /onOpenSession\(s\.id, s\.finished\)/);
  assert.match(view, /s\.finished \? t\('Reiniciar'\)/);
  assert.match(view, /Reiniciar borra las respuestas anteriores/);
});
