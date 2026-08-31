import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import plist from 'plist';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');

function releaseConfig(channel = 'latest') {
  const configPath = require.resolve(path.join(repoRoot, 'build/electron-builder.release.cjs'));
  const previous = process.env.NODUS_RELEASE_CHANNEL;
  process.env.NODUS_RELEASE_CHANNEL = channel;
  delete require.cache[configPath];
  const config = require(configPath);
  if (previous === undefined) delete process.env.NODUS_RELEASE_CHANNEL;
  else process.env.NODUS_RELEASE_CHANNEL = previous;
  delete require.cache[configPath];
  return config;
}

test('release-only macOS config is fail-closed and notarizes with explicit hardening', () => {
  for (const channel of ['latest', 'beta']) {
    const config = releaseConfig(channel);
    assert.equal(config.mac.forceCodeSigning, true);
    assert.equal(config.mac.hardenedRuntime, true);
    assert.equal(config.mac.strictVerify, true);
    assert.equal(config.mac.preAutoEntitlements, false);
    assert.equal(config.mac.notarize, true);
    assert.equal(config.mac.sign, 'build/macSign.cjs');
    assert.equal(config.mac.entitlements, 'build/entitlements.mac.plist');
    assert.equal(config.mac.entitlementsInherit, 'build/entitlements.mac.inherit.plist');
    assert.equal(config.afterSign, 'build/afterSign.cjs');
  }

  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.build.mac.forceCodeSigning, undefined, 'local/dev packaging remains usable without release credentials');
  assert.equal(pkg.build.mac.notarize, undefined, 'notarization is mandatory only in the release configuration');
});

test('macOS entitlements are an exact minimum set with no dangerous exceptions', () => {
  const root = plist.parse(read('build/entitlements.mac.plist'));
  const inherited = plist.parse(read('build/entitlements.mac.inherit.plist'));
  const empty = plist.parse(read('build/entitlements.mac.empty.plist'));

  assert.deepEqual(Object.keys(root).sort(), [
    'com.apple.security.automation.apple-events',
    'com.apple.security.cs.allow-jit',
    'com.apple.security.device.audio-input',
    'com.apple.security.device.camera',
  ]);
  assert.ok(Object.values(root).every((value) => value === true));
  assert.deepEqual(inherited, { 'com.apple.security.cs.allow-jit': true });
  assert.deepEqual(empty, {});

  const allKeys = [...Object.keys(root), ...Object.keys(inherited), ...Object.keys(empty)];
  for (const forbidden of [
    'com.apple.security.app-sandbox',
    'com.apple.security.cs.allow-unsigned-executable-memory',
    'com.apple.security.cs.disable-library-validation',
    'com.apple.security.get-task-allow',
  ]) {
    assert.equal(allKeys.includes(forbidden), false, `${forbidden} must not enter release entitlements`);
  }

  const info = JSON.parse(read('package.json')).build.mac.extendInfo;
  for (const key of ['NSAppleEventsUsageDescription', 'NSCameraUsageDescription', 'NSMicrophoneUsageDescription']) {
    assert.equal(typeof info[key], 'string');
    assert.ok(info[key].trim().length > 0, `${key} has a user-facing explanation`);
  }
});

test('the custom signer covers the DockTile and every enclosed native code bundle', () => {
  const signer = read('build/macSign.cjs');
  assert.match(signer, /NodusDockTile\.docktileplugin/);
  assert.match(signer, /NodusDockTilePlugin/);
  assert.match(signer, /additionalBundleExtensions/);
  assert.match(signer, /signAsync/);
  assert.match(signer, /entitlements\.mac\.empty\.plist/);
  assert.match(signer, /isElectronHelperRuntime/);
  assert.match(signer, /security.*find-identity/s);
  assert.match(signer, /identity: signingIdentity/);
  assert.doesNotMatch(signer, /optionsForFile:\s*async/, 'osx-sign silently ignores async per-file options');
  assert.doesNotMatch(signer, /--deep/);

  const afterPack = read('build/afterPack.cjs');
  assert.match(afterPack, /NODUS_REQUIRE_MACOS_SIGNING === 'true'/);
  assert.match(afterPack, /Deferred .* mandatory Developer ID signer/);
});

test('the custom signer resolves electron-builder certificate hashes to full Developer ID names', () => {
  const signer = require(path.join(repoRoot, 'build/macSign.cjs'));
  const identities = signer.parseDeveloperIdIdentities([
    '  1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Developer ID Application: Release Owner (TEAMID1234)"',
    '  2) ABCDEF0123456789ABCDEF0123456789ABCDEF01 "Apple Development: Local Developer (TEAMID1234)"',
    '     2 valid identities found',
  ].join('\n'));

  assert.deepEqual(identities, [{
    hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    name: 'Developer ID Application: Release Owner (TEAMID1234)',
  }]);
});

test('GitHub release workflow requires API-key notarization and verifies before upload', () => {
  const workflow = read('.github/workflows/release-build.yml');
  for (const secret of [
    'MACOS_CERTIFICATE_BASE64',
    'MACOS_CERTIFICATE_PASSWORD',
    'APPLE_API_KEY_BASE64',
    'APPLE_API_KEY_ID',
    'APPLE_API_ISSUER',
  ]) {
    assert.match(workflow, new RegExp(`secrets\\.${secret}`), `${secret} is read from GitHub Actions Secrets`);
  }
  for (const obsolete of ['HAS_MACOS_SIGNING', 'APPLE_ID:', 'APPLE_APP_SPECIFIC_PASSWORD:', 'Build ad-hoc macOS installer']) {
    assert.doesNotMatch(workflow, new RegExp(obsolete), `${obsolete} must not remain in the release path`);
  }
  assert.match(workflow, /RUNNER_TEMP\/nodus-signing-certificate\.p12/);
  assert.match(workflow, /RUNNER_TEMP\/nodus-notary-api-key\.p8/);
  assert.match(workflow, /security create-keychain/);
  assert.match(workflow, /security set-key-partition-list/);
  assert.match(workflow, /security delete-keychain/);
  assert.match(workflow, /rm -f "\$certificate_path" "\$api_key_path" "\$keychain_path"/);
  assert.match(workflow, /NODUS_REQUIRE_MACOS_SIGNING: true/);
  assert.match(workflow, /verify-macos-release\.cjs release/);

  const build = workflow.indexOf('Build, sign and notarize macOS artifacts');
  const verify = workflow.indexOf('Verify signed and notarized macOS release artifacts');
  const cleanup = workflow.indexOf('Remove temporary macOS credentials');
  const upload = workflow.indexOf('Upload platform assets to the single draft');
  assert.ok(build >= 0 && build < verify && verify < cleanup && cleanup < upload);
});

test('official verification gates cover signing, Hardened Runtime, stapling and Gatekeeper', () => {
  const verifier = read('scripts/verify-macos-code-signing.cjs');
  const artifacts = read('scripts/verify-macos-release.cjs');
  for (const required of [
    /codesign/,
    /--verify/,
    /--deep/,
    /--strict/,
    /Developer ID Application:/,
    /TeamIdentifier/,
    /runtime/,
    /Timestamp/,
    /stapler/,
    /spctl/,
  ]) assert.match(verifier, required);
  assert.match(artifacts, /ditto/);
  assert.match(artifacts, /hdiutil/);
  assert.match(artifacts, /assertSameApp/);
});
