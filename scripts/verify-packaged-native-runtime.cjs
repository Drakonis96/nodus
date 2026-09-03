const { execFileSync } = require('node:child_process');
const { existsSync, readdirSync } = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

// macOS ships as two single-architecture products, one per runner: npm resolves
// the native optional dependencies from the host architecture, so a build can
// only ever contain the slice of the machine that produced it. That is exactly
// what makes a mixed tree dangerous — an Intel dependency inside the Apple
// silicon app (or the reverse) does not fail at packaging time, it fails on a
// user's machine at first launch. Everything below exists to make that
// impossible before the artifact is signed.
const SUPPORTED_ARCHITECTURES = ['arm64', 'x64'];

// `lipo -archs` names the Intel slice x86_64; electron-builder names it x64.
const LIPO_ARCHITECTURES = { arm64: 'arm64', x64: 'x86_64' };

const REQUIRED_BINARIES = {
  arm64: [
    ['Canvas', '@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node'],
    ['Koffi', '@koromix/koffi-darwin-arm64/darwin_arm64/koffi.node'],
    ['Codex', '@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex'],
    ['Copilot', '@github/copilot-darwin-arm64/copilot'],
    ['Copilot native runtime', '@github/copilot-darwin-arm64/prebuilds/darwin-arm64/runtime.node'],
  ],
  x64: [
    ['Canvas', '@napi-rs/canvas-darwin-x64/skia.darwin-x64.node'],
    ['Koffi', '@koromix/koffi-darwin-x64/darwin_x64/koffi.node'],
    ['Codex', '@openai/codex-darwin-x64/vendor/x86_64-apple-darwin/bin/codex'],
    ['Copilot', '@github/copilot-darwin-x64/copilot'],
    ['Copilot native runtime', '@github/copilot-darwin-x64/prebuilds/darwin-x64/runtime.node'],
  ],
};

const REQUIRED_BINARY_PATTERNS = {
  arm64: [
    ['Sharp', '@img/sharp-darwin-arm64/lib', /^sharp-darwin-arm64(?:-[0-9.]+)?\.node$/],
    ['libvips', '@img/sharp-libvips-darwin-arm64/lib', /^libvips-cpp\.[0-9.]+\.dylib$/],
  ],
  x64: [
    ['Sharp', '@img/sharp-darwin-x64/lib', /^sharp-darwin-x64(?:-[0-9.]+)?\.node$/],
    ['libvips', '@img/sharp-libvips-darwin-x64/lib', /^libvips-cpp\.[0-9.]+\.dylib$/],
  ],
};

// The markers of the OTHER macOS architecture. These are matched against the
// asar listing only: some vendored packages legitimately carry every platform's
// prebuild (@github/copilot bundles a clipboard addon for all six targets), and
// those live in app.asar.unpacked, outside this listing.
const FOREIGN_PACKAGE_MARKERS = {
  arm64: [/darwin-x64/i, /darwin_x64/i, /x86_64-apple-darwin/i],
  x64: [/darwin-arm64/i, /darwin_arm64/i, /aarch64-apple-darwin/i],
};

function assertSupportedArchitecture(architecture) {
  if (!SUPPORTED_ARCHITECTURES.includes(architecture)) {
    throw new Error(
      `Unsupported macOS architecture: ${architecture} (expected ${SUPPORTED_ARCHITECTURES.join(' or ')})`,
    );
  }
}

function findForeignRuntimePaths(architecture, entries) {
  assertSupportedArchitecture(architecture);
  const markers = FOREIGN_PACKAGE_MARKERS[architecture];
  return entries.filter((entry) => markers.some((marker) => marker.test(entry)));
}

function getArchitectures(filename) {
  return execFileSync('lipo', ['-archs', filename], { encoding: 'utf8' }).trim().split(/\s+/);
}

function assertBinaryArchitecture(label, filename, architecture, architectureReader = getArchitectures) {
  assertSupportedArchitecture(architecture);
  const expected = LIPO_ARCHITECTURES[architecture];
  if (!existsSync(filename)) throw new Error(`Missing packaged ${architecture} ${label}: ${filename}`);
  const architectures = architectureReader(filename);
  if (!architectures.includes(expected)) {
    throw new Error(`Packaged ${label} is not ${expected} (${architectures.join(', ')}): ${filename}`);
  }
}

function findUniquePackagedBinary(label, directory, pattern, directoryReader = readdirSync) {
  let entries;
  try {
    entries = directoryReader(directory);
  } catch {
    throw new Error(`Missing packaged ${label} directory: ${directory}`);
  }
  const matches = entries.filter((entry) => pattern.test(entry)).sort();
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one packaged ${label} binary in ${directory}; found ${matches.length}`,
    );
  }
  return path.join(directory, matches[0]);
}

function verifyPackagedNativeRuntime(appPath, architecture, options = {}) {
  assertSupportedArchitecture(architecture);
  const resourcesPath = path.join(appPath, 'Contents', 'Resources');
  const asarPath = path.join(resourcesPath, 'app.asar');
  const unpackedModules = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules');
  if (!existsSync(asarPath)) throw new Error(`Missing packaged application archive: ${asarPath}`);

  const archiveEntries = (options.listPackage || asar.listPackage)(asarPath);
  const foreignEntries = findForeignRuntimePaths(architecture, archiveEntries);
  if (foreignEntries.length > 0) {
    throw new Error(
      `macOS runtime packages for the other architecture were bundled into the ${architecture} app:\n${foreignEntries.slice(0, 20).join('\n')}`,
    );
  }

  const appName = path.basename(appPath, '.app');
  assertBinaryArchitecture(
    'Electron executable',
    path.join(appPath, 'Contents', 'MacOS', appName),
    architecture,
    options.getArchitectures,
  );
  for (const [label, relativePath] of REQUIRED_BINARIES[architecture]) {
    assertBinaryArchitecture(label, path.join(unpackedModules, relativePath), architecture, options.getArchitectures);
  }
  for (const [label, relativeDirectory, pattern] of REQUIRED_BINARY_PATTERNS[architecture]) {
    const filename = findUniquePackagedBinary(
      label,
      path.join(unpackedModules, relativeDirectory),
      pattern,
      options.readDirectory,
    );
    assertBinaryArchitecture(label, filename, architecture, options.getArchitectures);
  }
  console.log(
    `[native-runtime] Verified ${architecture} Electron, Canvas, Sharp, Koffi, Codex and Copilot in ${appPath}`,
  );
}

module.exports = {
  SUPPORTED_ARCHITECTURES,
  REQUIRED_BINARIES,
  REQUIRED_BINARY_PATTERNS,
  assertBinaryArchitecture,
  findUniquePackagedBinary,
  findForeignRuntimePaths,
  verifyPackagedNativeRuntime,
};
