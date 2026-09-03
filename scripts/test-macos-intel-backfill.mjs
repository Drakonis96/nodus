import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');
const release = read('.github/workflows/release-build.yml');
const backfill = read('.github/workflows/backfill-macos-intel.yml');

/** The text of one named step, from its `- name:` line to the next one. */
function step(workflow, name) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `${name} step is missing`);
  const end = workflow.indexOf('\n      - name: ', start + 1);
  return workflow.slice(start, end === -1 ? undefined : end + 1);
}

/**
 * Normalises the two incidental differences: conditions (one workflow has a
 * matrix, the other does not) and trailing blank lines (the cleanup step is
 * last in one file and mid-file in the other). Everything else must match.
 */
function comparable(text) {
  return text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('if:'))
    .join('\n')
    .trimEnd();
}

test('the backfill signs and notarizes exactly the way a release does', () => {
  // The two workflows keep their own copy of the signing block so that editing
  // the one-shot backfill can never touch the release path. This is what stops
  // the copies drifting: an unsigned or differently signed Intel build would be
  // refused by Gatekeeper on the machines that need it most.
  for (const name of ['Prepare temporary macOS signing keychain', 'Remove temporary macOS credentials']) {
    assert.equal(
      comparable(step(backfill, name)),
      comparable(step(release, name)),
      `${name} has drifted between the release and backfill workflows`,
    );
  }
  assert.match(backfill, /NODUS_REQUIRE_MACOS_SIGNING: true/);
  assert.match(backfill, /verify-macos-release\.cjs release x64/, 'the Intel artifacts are verified as signed and notarized');
  assert.match(backfill, /--config build\/electron-builder\.release\.cjs/, 'the backfill uses the strict release config');
});

test('the backfill only ever adds the Intel half', () => {
  assert.match(backfill, /runs-on: macos-15-intel/);
  assert.match(backfill, /electron-builder --mac --x64/);
  assert.doesNotMatch(backfill, /--arm64/, 'the published arm64 artifacts are never rebuilt');
  assert.doesNotMatch(backfill, /upload-release-assets\.mjs mac-arm64/, 'the published arm64 artifacts are never re-uploaded');
  assert.match(backfill, /already carries an Intel build/, 'a release that already has one is refused');
});

test('the backfill refuses to build a tree that is not the released application', () => {
  assert.match(backfill, /verify-release-channel\.mjs latest "\$RELEASE_TAG"/);
  assert.match(backfill, /verify-backfill-parity\.mjs "\$RELEASE_TAG"/);
  assert.match(backfill, /fetch-depth: 0/, 'the parity check needs history back to the tag');
});

test('the published manifest is merged with the new one, never replaced', () => {
  // The failure this prevents: uploading only the freshly built Intel manifest
  // would drop every arm64 entry, and the installs that exist today would stop
  // finding a file they can update from. Argument order is not load bearing —
  // the merger takes the pointer and release date from the arm64 ZIP wherever
  // it appears, which test-mac-update-manifest.mjs pins directly.
  const merge = step(backfill, 'Add the Intel entries to the published update manifest');
  const command = merge.slice(merge.indexOf('merge-mac-update-manifest.mjs'));
  assert.match(command, /"\$work\/published-mac\.yml"/, 'the published manifest is an input');
  assert.match(command, /release\/latest-mac\.yml/, 'the freshly built manifest is an input');
  assert.match(merge, /gh release download[\s\S]*--pattern latest-mac\.yml/, 'the published manifest is fetched first');
  assert.match(backfill, /grep -qx "path: Nodus-mac-arm64\.zip"/, 'the compatibility pointer is verified after the merge');
});
