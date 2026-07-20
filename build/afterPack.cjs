// electron-builder afterPack hook. CI uses a Developer ID certificate when one
// is configured; never overwrite that signature with an ad-hoc one. The latter
// is retained only for local/dev artifacts, where it is useful for opening the
// app manually but is not sufficient for macOS auto-update.
const { execFileSync, spawnSync } = require('node:child_process');
const { copyFileSync, existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');

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

  const signature = spawnSync('codesign', ['-dv', '--verbose=4', appPath], { encoding: 'utf8' });
  const signatureInfo = `${signature.stdout || ''}\n${signature.stderr || ''}`;
  if (signature.status === 0 && /Authority=Developer ID Application:/.test(signatureInfo)) {
    console.log(`[afterPack] Preserved Developer ID signature for ${appPath}`);
    return;
  }

  // --force replaces an unsigned/default signature; --deep covers nested
  // frameworks/helpers. Production releases must use the branch above.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  console.log(`[afterPack] Ad-hoc signed ${appPath} (local/dev fallback)`);
};
