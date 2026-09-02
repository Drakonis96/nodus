const pkg = require('../package.json');

const channel = process.env.NODUS_RELEASE_CHANNEL;
if (channel !== 'latest' && channel !== 'beta') {
  throw new Error(`NODUS_RELEASE_CHANNEL must be "latest" or "beta"; received ${JSON.stringify(channel)}`);
}

// Keep one packaging definition. The release workflow only overrides the feed
// channel, which GitHub publishing cannot infer reliably from a prerelease tag.
//
// Two things about `pkg.build` that are easy to get wrong, and that this file is
// the only sensible place to write down, because package.json is JSON and cannot
// hold a comment:
//
//  1. `artifactName` is the literal `Nodus-`, NOT `${productName}`. The installer
//     filenames are a public contract: the site's download buttons, the README
//     and every electron-updater manifest resolve
//     releases/latest/download/Nodus-<os>-<arch>.<ext>, so an install from a year
//     ago updates through them. Renaming the product to "Nodus Research" once
//     went through that template and renamed every artifact, which failed the
//     v4.2.4 upload on all three platforms. The displayed name may change freely;
//     these filenames may not. Held by scripts/test-release-artifact-names.mjs.
//
//  2. electron-builder validates this object against a STRICT schema that rejects
//     unknown properties outright, so `pkg.build` cannot carry a documentation
//     key either — a `_comment` there aborts every packaging run with "Invalid
//     configuration object". That is why this note lives here. Held by
//     scripts/test-electron-builder-config.mjs, which validates against
//     app-builder-lib's own scheme.json rather than waiting for a release.
module.exports = {
  ...pkg.build,
  // Release builds are intentionally stricter than local `npm run dist:mac`:
  // no identity, notarization credential, staple or verification means no
  // artifact. electron-builder 26 keeps these keys directly under `mac`.
  mac: {
    ...pkg.build.mac,
    forceCodeSigning: true,
    hardenedRuntime: true,
    strictVerify: true,
    preAutoEntitlements: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    sign: 'build/macSign.cjs',
    notarize: true,
  },
  afterSign: 'build/afterSign.cjs',
  publish: pkg.build.publish.map((target) => ({ ...target, channel })),
};
