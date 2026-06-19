// electron-builder afterPack hook. CI uses a Developer ID certificate when one
// is configured; never overwrite that signature with an ad-hoc one. The latter
// is retained only for local/dev artifacts, where it is useful for opening the
// app manually but is not sufficient for macOS auto-update.
const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename; // "Nodus"
  const appPath = path.join(context.appOutDir, `${appName}.app`);

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
