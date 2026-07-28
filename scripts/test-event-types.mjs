import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-event-types-'));
const bundle = path.join(outDir, 'eventTypes.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [path.join(repoRoot, 'shared/eventTypes.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
  { cwd: repoRoot, stdio: 'inherit' }
);
const eventTypes = createRequire(import.meta.url)(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

test('custom fact types round-trip accents, punctuation and normalized whitespace', () => {
  const value = eventTypes.createCustomEventType('  Coronación   ritual: alba  ');
  assert.equal(value, 'custom:Coronaci%C3%B3n%20ritual%3A%20alba');
  assert.equal(eventTypes.customEventTypeLabel(value), 'Coronación ritual: alba');
  assert.equal(eventTypes.eventTypeLabel(value, {}), 'Coronación ritual: alba');
});

test('the persisted vocabulary rejects malformed entries, duplicates and excessive rows', () => {
  const valid = eventTypes.createCustomEventType('Coronación');
  const many = Array.from({ length: 120 }, (_, index) => eventTypes.createCustomEventType(`Tipo ${index}`));
  const result = eventTypes.sanitizeCustomEventTypes({
    records: [valid, valid, 'birth', 'custom:%E0%A4%A'],
    worldbuilding: many,
  });
  assert.deepEqual(result.records, [valid]);
  assert.equal(result.worldbuilding.length, 100);
});

test('built-in labels remain unchanged', () => {
  assert.equal(eventTypes.eventTypeLabel('birth', { birth: 'Nacimiento' }), 'Nacimiento');
});
