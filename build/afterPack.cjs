// electron-builder afterPack hook: ad-hoc sign the macOS .app so Gatekeeper does
// not report it as "damaged" on Apple Silicon. Ad-hoc signing (codesign --sign -)
// needs no certificate; it produces a valid (though un-notarized) signature, which
// downgrades the block to the normal "unidentified developer" prompt.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename; // "Nodus"
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  // --force replaces any existing signature; --deep covers nested frameworks/helpers.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  console.log(`[afterPack] Ad-hoc signed ${appPath}`);
};
