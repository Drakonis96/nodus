const { execFileSync } = require('node:child_process');
const { cpSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');

exports.default = async function beforePack(context) {
  const root = path.join(__dirname, '..');
  execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-third-party-licenses.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
  console.log('[beforePack] Generated and verified third-party legal bundle');

  if (context.electronPlatformName !== 'darwin') return;
  const source = path.join(__dirname, 'docktile');
  const output = path.join(__dirname, 'NodusDockTile.docktileplugin');
  const contents = path.join(output, 'Contents');
  const executable = path.join(contents, 'MacOS', 'NodusDockTilePlugin');

  rmSync(output, { recursive: true, force: true });
  mkdirSync(path.dirname(executable), { recursive: true });
  cpSync(path.join(source, 'Info.plist'), path.join(contents, 'Info.plist'));
  execFileSync('xcrun', [
    'clang', '-fobjc-arc', '-fmodules', '-bundle', '-arch', 'arm64',
    '-mmacosx-version-min=11.0', '-framework', 'Cocoa',
    path.join(source, 'NodusDockTilePlugin.m'), '-o', executable,
  ], { stdio: 'inherit' });
  console.log(`[beforePack] Built ${output}`);
};
