const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
function buildPresenterNative(architecture = process.arch) {
  if (process.platform !== 'darwin') return;
  const arch = { arm64: 'arm64', x64: 'x86_64' }[architecture];
  if (!arch) throw new Error('Unsupported presenter helper architecture');
  const root = path.resolve(__dirname, '..');
  const dir = path.join(root, 'build/presenter-native');
  const output = path.join(dir, architecture, 'nodus-presenter-native');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  execFileSync('xcrun', ['swiftc', '-swift-version', '5', '-O', '-target', `${arch}-apple-macosx11.0`, '-framework', 'Network', '-framework', 'PDFKit', '-framework', 'AppKit', ...['Protocol.swift', 'Transport.swift', 'main.swift'].map(f => path.join(dir, f)), '-o', output], { stdio: 'inherit' });
  execFileSync('codesign', ['--force', '--sign', '-', output], { stdio: 'inherit' });
}
exports.buildPresenterNative = buildPresenterNative;
if (require.main === module) buildPresenterNative();
