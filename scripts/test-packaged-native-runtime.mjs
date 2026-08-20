import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { selectReleaseAssets } from './upload-release-assets.mjs';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  assertArm64Binary,
  findIntelRuntimePaths,
} = require(path.join(repoRoot, 'scripts/verify-packaged-native-runtime.cjs'));

test('packaged runtime audit detects Intel-only optional dependencies', () => {
  const paths = [
    '/node_modules/@napi-rs/canvas-darwin-x64/skia.darwin-x64.node',
    '/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex',
    '/node_modules/@koromix/koffi-darwin_x64/darwin_x64/koffi.node',
  ];
  assert.deepEqual(findIntelRuntimePaths(paths), [paths[0], paths[2]]);
});

test('packaged runtime audit requires an ARM64 slice', () => {
  assert.doesNotThrow(() => assertArm64Binary('fixture', import.meta.filename, () => ['arm64']));
  assert.throws(
    () => assertArm64Binary('fixture', import.meta.filename, () => ['x86_64']),
    /is not ARM64/,
  );
});

test('release uploader selects only one platform and its current channel manifest', () => {
  const entries = [
    'Nodus-mac-arm64.dmg',
    'Nodus-mac-arm64.dmg.blockmap',
    'Nodus-mac-arm64.zip',
    'latest-mac.yml',
    'beta-mac.yml',
    'builder-debug.yml',
  ];
  assert.deepEqual(selectReleaseAssets('mac', 'latest', entries), [
    'Nodus-mac-arm64.dmg',
    'Nodus-mac-arm64.dmg.blockmap',
    'Nodus-mac-arm64.zip',
    'latest-mac.yml',
  ]);
  assert.throws(() => selectReleaseAssets('win', 'latest', entries), /Missing win release asset/);
});
