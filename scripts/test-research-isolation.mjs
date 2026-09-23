import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createResearchTestRoot, researchTestEnvironment, verifyResearchSandbox } from './research-isolation.mjs';

const root = createResearchTestRoot();
const outfile = path.join(root, 'paths.mjs');
await build({ entryPoints: ['electron/qa/isolatedProfile.ts'], outfile, bundle: true, platform: 'node', format: 'esm' });
const { isolatedPath, validateIsolatedRoot } = await import(pathToFileURL(outfile).href);
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('requires a matching manifest and forbids traversal and symlinks before writes', () => {
  assert.equal(validateIsolatedRoot(root), root);
  assert.throws(() => validateIsolatedRoot('.'), /absolute/);
  assert.throws(() => validateIsolatedRoot(path.join(root, 'tmp')));
  assert.throws(() => isolatedPath(root, '../outside'), /leaves/);
  fs.symlinkSync(path.dirname(root), path.join(root, 'escape'));
  assert.throws(() => isolatedPath(root, 'escape/new'), /Symlinks/);
  assert.equal(isolatedPath(root, 'profile/nested'), path.join(root, 'profile/nested'));
});

test('environment does not inherit credentials or execution injection', () => {
  const original = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = '--require=untrusted';
  try {
    const env = researchTestEnvironment(root);
    assert.equal(env.NODE_OPTIONS, undefined);
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.NODUS_USERDATA, path.join(root, 'profile'));
  } finally {
    if (original === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = original;
  }
});

test('macOS denies an actual child-process write outside the test root', { skip: process.platform !== 'darwin' }, () => {
  assert.deepEqual(verifyResearchSandbox(root), { writeInsideAllowed: true, writeOutsideDenied: true });
});
