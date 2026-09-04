import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Backfilling an Intel build onto an already published release means packaging
// from a commit that is NOT the tag: the tag predates the packaging changes that
// make an Intel build possible at all. That is only defensible while the two
// trees produce the same application, so this refuses the backfill unless every
// difference is confined to files that never reach the app bundle.
//
// build.files ships dist/, dist-electron/, word-addin/, browser-extension/,
// zotero-plugin/, electron/assets/ and scripts/nodus_copilot.py, and the first
// two are compiled from src/, electron/ and shared/. Nothing below is in that
// set. package.json is the single exception: electron-builder always packs it,
// so it gets a stricter rule of its own.
const PACKAGING_ONLY_PREFIXES = ['.github/', 'build/', 'docs/', 'scripts/', 'site/'];
const PACKAGING_ONLY_FILES = ['README.md', 'CHANGELOG.md'];

// The one script that IS shipped, so a change to it is a change to the product.
const SHIPPED_SCRIPTS = ['scripts/nodus_copilot.py'];

export function findShippedChanges(paths) {
  return paths.filter((changed) => {
    if (SHIPPED_SCRIPTS.includes(changed)) return true;
    if (changed === 'package.json') return false;
    if (PACKAGING_ONLY_FILES.includes(changed)) return false;
    return !PACKAGING_ONLY_PREFIXES.some((prefix) => changed.startsWith(prefix));
  });
}

export function assertPackagingOnlyPackageJson(taggedText, currentText) {
  const tagged = JSON.parse(taggedText);
  const current = JSON.parse(currentText);
  if (tagged.version !== current.version) {
    throw new Error(
      `package.json version changed since the tag (${tagged.version} -> ${current.version}); this would build a different release`,
    );
  }
  // Only the packaging block may differ: everything else describes the product.
  const strip = ({ build, ...rest }) => rest;
  const taggedRest = JSON.stringify(strip(tagged));
  const currentRest = JSON.stringify(strip(current));
  if (taggedRest !== currentRest) {
    throw new Error('package.json changed outside its "build" section; the backfill would ship a different application');
  }
}

export function verifyBackfillParity(tag, { git = defaultGit } = {}) {
  const changed = git(['diff', '--name-only', `${tag}..HEAD`])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const shipped = findShippedChanges(changed);
  if (shipped.length > 0) {
    throw new Error(
      `Refusing to backfill ${tag}: these changes since the tag reach the application itself:\n${shipped.join('\n')}`,
    );
  }

  if (changed.includes('package.json')) {
    assertPackagingOnlyPackageJson(git(['show', `${tag}:package.json`]), git(['show', 'HEAD:package.json']));
  }

  console.log(
    `[backfill parity] ${changed.length} files changed since ${tag}, none of them reach the packaged application`,
  );
  return changed;
}

function defaultGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [tag] = process.argv.slice(2);
  if (!tag) throw new Error('Usage: verify-backfill-parity.mjs <tag>');
  verifyBackfillParity(tag);
}
