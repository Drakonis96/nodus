import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = async (name) => readFile(path.join(root, 'src/components', name), 'utf8');

test('finished lower bars use semantic SVG status icons instead of destructive trash/stop actions', async () => {
  const [queue, embeddings, passages, zotero] = await Promise.all([
    source('QueueBar.tsx'),
    source('EmbeddingProgressBar.tsx'),
    source('PassageProgressBar.tsx'),
    source('ZoteroImportProgressBar.tsx'),
  ]);
  const terminalQueue = queue.slice(queue.indexOf('{terminal && ('), queue.indexOf('{workActive && (', queue.indexOf('{terminal && (')));
  assert.match(terminalQueue, /'check'/);
  assert.doesNotMatch(terminalQueue, /trash|stop/);
  for (const component of [embeddings, passages, zotero]) {
    assert.match(component, /cancelled \? 'x' : 'check'/);
    assert.doesNotMatch(component, /<Icon name="trash"/);
  }
});

test('every persistent processing rail exposes total time and its current item time where applicable', async () => {
  const names = [
    'QueueBar.tsx',
    'EmbeddingProgressBar.tsx',
    'PassageProgressBar.tsx',
    'DocumentIndexProgressBar.tsx',
    'DeepResearchQueueStrip.tsx',
    'ZoteroImportProgressBar.tsx',
  ];
  const components = await Promise.all(names.map(source));
  for (let index = 0; index < components.length; index += 1) {
    assert.match(components[index], /elapsedTimeLabel/, `${names[index]} formats an elapsed duration`);
    assert.match(components[index], /useElapsedClock/, `${names[index]} refreshes a live duration`);
    assert.match(components[index], /t\('Total'\)/, `${names[index]} labels the task-wide duration`);
  }
  for (const index of [0, 1, 2, 3, 4, 5]) {
    assert.ok((components[index].match(/elapsedTimeLabel/g) ?? []).length >= 2, `${names[index]} includes per-item time`);
  }
});

test('the renderer clock is dismantled as soon as work is terminal', async () => {
  const hook = await readFile(path.join(root, 'src/useElapsedClock.ts'), 'utf8');
  assert.match(hook, /if \(!running\) return/);
  assert.match(hook, /return \(\) => window\.clearInterval\(timer\)/);
});
