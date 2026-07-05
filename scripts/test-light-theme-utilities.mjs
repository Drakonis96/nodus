import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = await readFile(path.join(repoRoot, 'src/index.css'), 'utf8');

const requiredLightOverrides = [
  '.light .bg-neutral-950\\/70',
  '.light .bg-indigo-950\\/40',
  '.light .hover\\:bg-neutral-900\\/80:hover',
  '.light .ring-indigo-700\\/60',
  '.light .border-neutral-900',
  '.light .bg-cyan-950\\/30',
  '.light .border-cyan-900',
  '.light .text-cyan-200',
];

for (const selector of requiredLightOverrides) {
  assert.ok(css.includes(selector), `missing light-mode override for ${selector}`);
}

console.log('light theme utility overrides test passed');
