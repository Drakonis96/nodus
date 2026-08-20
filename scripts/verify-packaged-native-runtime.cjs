const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

const REQUIRED_ARM64_BINARIES = [
  ['Canvas', '@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node'],
  ['Sharp', '@img/sharp-darwin-arm64/lib/sharp-darwin-arm64.node'],
  ['libvips', '@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.17.3.dylib'],
  ['Koffi', '@koromix/koffi-darwin-arm64/darwin_arm64/koffi.node'],
  ['Codex', '@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex'],
  ['Copilot', '@github/copilot-darwin-arm64/copilot'],
  ['Copilot native runtime', '@github/copilot-darwin-arm64/prebuilds/darwin-arm64/runtime.node'],
];

const INTEL_PACKAGE_MARKERS = [
  /darwin-x64/i,
  /darwin_x64/i,
  /x86_64-apple-darwin/i,
];

function findIntelRuntimePaths(entries) {
  return entries.filter((entry) => INTEL_PACKAGE_MARKERS.some((marker) => marker.test(entry)));
}

function getArchitectures(filename) {
  return execFileSync('lipo', ['-archs', filename], { encoding: 'utf8' }).trim().split(/\s+/);
}

function assertArm64Binary(label, filename, architectureReader = getArchitectures) {
  if (!existsSync(filename)) throw new Error(`Missing packaged ARM64 ${label}: ${filename}`);
  const architectures = architectureReader(filename);
  if (!architectures.includes('arm64')) {
    throw new Error(`Packaged ${label} is not ARM64 (${architectures.join(', ')}): ${filename}`);
  }
}

function verifyPackagedNativeRuntime(appPath, options = {}) {
  const resourcesPath = path.join(appPath, 'Contents', 'Resources');
  const asarPath = path.join(resourcesPath, 'app.asar');
  const unpackedModules = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules');
  if (!existsSync(asarPath)) throw new Error(`Missing packaged application archive: ${asarPath}`);

  const archiveEntries = (options.listPackage || asar.listPackage)(asarPath);
  const intelEntries = findIntelRuntimePaths(archiveEntries);
  if (intelEntries.length > 0) {
    throw new Error(`Intel-only macOS runtime packages were bundled:\n${intelEntries.slice(0, 20).join('\n')}`);
  }

  const appName = path.basename(appPath, '.app');
  assertArm64Binary(
    'Electron executable',
    path.join(appPath, 'Contents', 'MacOS', appName),
    options.getArchitectures,
  );
  for (const [label, relativePath] of REQUIRED_ARM64_BINARIES) {
    assertArm64Binary(label, path.join(unpackedModules, relativePath), options.getArchitectures);
  }
  console.log(`[native-runtime] Verified ARM64 Electron, Canvas, Sharp, Koffi, Codex and Copilot in ${appPath}`);
}

module.exports = {
  REQUIRED_ARM64_BINARIES,
  assertArm64Binary,
  findIntelRuntimePaths,
  verifyPackagedNativeRuntime,
};
