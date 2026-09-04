// electron-builder afterPack hook. Release builds are signed later by the
// release-only custom signer; ad-hoc signing remains available solely for local
// development artifacts.
const { execFileSync } = require('node:child_process');
const { copyFileSync, existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { Arch } = require('electron-builder');
const { verifyPackagedNativeRuntime } = require('../scripts/verify-packaged-native-runtime.cjs');

exports.default = async function afterPack(context) {
  const appName = context.packager.appInfo.productFilename; // "Nodus"
  const appPath = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${appName}.app`)
    : context.appOutDir;
  const resourcesPath = context.electronPlatformName === 'darwin'
    ? path.join(appPath, 'Contents', 'Resources')
    : path.join(appPath, 'resources');
  const generatedLegalPath = path.join(resourcesPath, 'legal', 'generated');

  // Electron's own MIT text and Chromium's third-party notices must survive on
  // every platform. electron-builder already keeps them on Windows/Linux, but
  // copying the verified bundle here also covers the macOS .app.
  const electronLicense = path.join(generatedLegalPath, 'ELECTRON_LICENSE.txt');
  const chromiumLicenses = path.join(generatedLegalPath, 'ELECTRON_CHROMIUM_LICENSES.html');
  if (!existsSync(electronLicense) || !existsSync(chromiumLicenses)) {
    throw new Error(`Missing generated Electron legal files in ${generatedLegalPath}`);
  }
  mkdirSync(resourcesPath, { recursive: true });
  copyFileSync(electronLicense, path.join(resourcesPath, 'LICENSE.electron.txt'));
  copyFileSync(chromiumLicenses, path.join(resourcesPath, 'LICENSES.chromium.html'));

  if (context.electronPlatformName !== 'darwin') return;

  // npm optional native packages follow the runner architecture, so each macOS
  // product must be packed on a host of its own architecture. Fail before
  // signing if the dependency tree does not match the slice being packed —
  // a mixed bundle installs fine and only breaks on the user's machine.
  verifyPackagedNativeRuntime(appPath, Arch[context.arch]);

  if (process.env.NODUS_REQUIRE_MACOS_SIGNING === 'true') {
    console.log(`[afterPack] Deferred ${appPath} to the mandatory Developer ID signer`);
    return;
  }

  // This branch is never reachable from the GitHub release workflow. It makes
  // local/dev bundles launchable while remaining recognisably non-production.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  console.log(`[afterPack] Ad-hoc signed ${appPath} (local/dev fallback)`);
};
