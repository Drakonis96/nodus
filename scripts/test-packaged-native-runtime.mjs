import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { selectReleaseAssets } from './upload-release-assets.mjs';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  REQUIRED_BINARIES,
  assertBinaryArchitecture,
  findForeignRuntimePaths,
  findUniquePackagedBinary,
  topLevelPackage,
} = require(path.join(repoRoot, 'scripts/verify-packaged-native-runtime.cjs'));

test('packaged runtime audit rejects the other architecture, whichever is being packed', () => {
  const paths = [
    '/node_modules/@napi-rs/canvas-darwin-x64/skia.darwin-x64.node',
    '/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex',
    '/node_modules/@img/sharp-libvips-darwin-x64/lib/libvips-cpp.8.18.6.dylib',
    '/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  ];
  assert.deepEqual(findForeignRuntimePaths('arm64', paths), [
    '@img/sharp-libvips-darwin-x64',
    '@napi-rs/canvas-darwin-x64',
  ]);
  assert.deepEqual(findForeignRuntimePaths('x64', paths), ['@openai/codex-darwin-arm64']);
});

test('THE REGRESSION: a vendor shipping every platform inside the right package is not foreign', () => {
  // These four paths failed the first Intel build ever attempted. They are
  // helper binaries vendored by @github/copilot-darwin-x64 — the CORRECT
  // package for that build — whose paths merely contain the other architecture.
  // The arm64 package does not vendor them, so a substring match over the path
  // passed on Apple silicon for months and then failed on Intel.
  const vendored = [
    '/node_modules/@github/copilot-darwin-x64/ripgrep/bin/darwin-arm64',
    '/node_modules/@github/copilot-darwin-x64/ripgrep/bin/darwin-arm64/rg',
    '/node_modules/@github/copilot-darwin-x64/tgrep/bin/darwin-arm64',
    '/node_modules/@github/copilot-darwin-x64/tgrep/bin/darwin-arm64/tgrep',
  ];
  assert.deepEqual(findForeignRuntimePaths('x64', vendored), []);

  // Same shape on Apple silicon: a nested per-architecture dependency inside
  // the correct package is the vendor's business, not a mixed tree.
  assert.deepEqual(findForeignRuntimePaths('arm64', [
    '/node_modules/@github/copilot-darwin-arm64/clipboard/node_modules/@teddyzhu/clipboard/clipboard.darwin-x64.node',
    '/node_modules/@github/copilot-darwin-arm64/clipboard/node_modules/@teddyzhu/clipboard-darwin-x64/clipboard.darwin-x64.node',
  ]), []);

  // But the package that would actually break at launch is still caught.
  assert.deepEqual(
    findForeignRuntimePaths('x64', ['/node_modules/@github/copilot-darwin-arm64/copilot']),
    ['@github/copilot-darwin-arm64'],
  );
});

test('the top-level package is read, and only the top level', () => {
  assert.equal(topLevelPackage('/node_modules/@img/sharp-darwin-x64/lib/x.node'), '@img/sharp-darwin-x64');
  assert.equal(topLevelPackage('node_modules/better-sqlite3/build/x.node'), 'better-sqlite3');
  assert.equal(topLevelPackage('/node_modules/a/node_modules/b-darwin-arm64/x'), null);
  assert.equal(topLevelPackage('/dist/renderer-darwin-arm64.js'), null);
});

test('packaged runtime audit requires the slice being packed', () => {
  // lipo reports the Intel slice as x86_64, so the two vocabularies must not
  // be confused: an x64 build whose binaries report arm64 has to fail.
  assert.doesNotThrow(() => assertBinaryArchitecture('fixture', import.meta.filename, 'arm64', () => ['arm64']));
  assert.doesNotThrow(() => assertBinaryArchitecture('fixture', import.meta.filename, 'x64', () => ['x86_64']));
  assert.throws(
    () => assertBinaryArchitecture('fixture', import.meta.filename, 'arm64', () => ['x86_64']),
    /is not arm64/,
  );
  assert.throws(
    () => assertBinaryArchitecture('fixture', import.meta.filename, 'x64', () => ['arm64']),
    /is not x86_64/,
  );
});

test('an unknown architecture is never waved through', () => {
  assert.throws(() => findForeignRuntimePaths('universal', []), /Unsupported macOS architecture/);
  assert.throws(
    () => assertBinaryArchitecture('fixture', import.meta.filename, 'ia32', () => ['i386']),
    /Unsupported macOS architecture/,
  );
});

test('both architectures require the same set of native runtimes', () => {
  const labels = (architecture) => REQUIRED_BINARIES[architecture].map(([label]) => label);
  assert.deepEqual(labels('x64'), labels('arm64'));
  for (const [, relativePath] of REQUIRED_BINARIES.x64) {
    assert.doesNotMatch(relativePath, /arm64|aarch64/, `${relativePath} is not an Intel path`);
  }
  for (const [, relativePath] of REQUIRED_BINARIES.arm64) {
    assert.doesNotMatch(relativePath, /x64|x86_64/, `${relativePath} is not an Apple silicon path`);
  }
});

test('packaged runtime audit accepts versioned Sharp and libvips binary names', () => {
  const readDirectory = () => [
    'index.js',
    'libvips-cpp.8.18.6.dylib',
    'sharp-darwin-arm64-0.35.4.node',
  ];
  assert.equal(
    findUniquePackagedBinary('Sharp', '/sharp/lib', /^sharp-darwin-arm64(?:-[0-9.]+)?\.node$/, readDirectory),
    path.join('/sharp/lib', 'sharp-darwin-arm64-0.35.4.node'),
  );
  assert.equal(
    findUniquePackagedBinary('libvips', '/libvips/lib', /^libvips-cpp\.[0-9.]+\.dylib$/, readDirectory),
    path.join('/libvips/lib', 'libvips-cpp.8.18.6.dylib'),
  );
  assert.throws(
    () => findUniquePackagedBinary('Sharp', '/sharp/lib', /^sharp-.*\.node$/, () => []),
    /found 0/,
  );
});

test('each macOS runner uploads only its own architecture, and never the manifest', () => {
  // Both runners write a <channel>-mac.yml naming only their own files. If
  // either uploaded it, the last job to finish would decide which architecture
  // can still update. The merge job publishes the combined manifest instead.
  const entries = [
    'Nodus-mac-arm64.dmg',
    'Nodus-mac-arm64.dmg.blockmap',
    'Nodus-mac-arm64.zip',
    'Nodus-mac-x64.dmg',
    'Nodus-mac-x64.zip',
    'latest-mac.yml',
    'beta-mac.yml',
    'builder-debug.yml',
  ];
  assert.deepEqual(selectReleaseAssets('mac-arm64', 'latest', entries), [
    'Nodus-mac-arm64.dmg',
    'Nodus-mac-arm64.dmg.blockmap',
    'Nodus-mac-arm64.zip',
  ]);
  assert.deepEqual(selectReleaseAssets('mac-x64', 'latest', entries), [
    'Nodus-mac-x64.dmg',
    'Nodus-mac-x64.zip',
  ]);
  assert.throws(() => selectReleaseAssets('win', 'latest', entries), /Missing win release asset/);
  assert.throws(() => selectReleaseAssets('mac', 'latest', entries), /Unsupported release platform/);
});

test('a macOS build with no update metadata never reaches the release', () => {
  const entries = ['Nodus-mac-x64.dmg', 'Nodus-mac-x64.zip'];
  assert.throws(() => selectReleaseAssets('mac-x64', 'latest', entries), /Missing mac-x64 release asset: latest-mac\.yml/);
});

test('the other platforms still publish their own manifest', () => {
  const entries = ['Nodus-win-x64.exe', 'Nodus-win-x64.exe.blockmap', 'latest.yml', 'builder-debug.yml'];
  assert.deepEqual(selectReleaseAssets('win', 'latest', entries), [
    'Nodus-win-x64.exe',
    'Nodus-win-x64.exe.blockmap',
    'latest.yml',
  ]);
});
