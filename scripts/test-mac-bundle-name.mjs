// The .app bundle name is a FORWARD contract: old versions read it, not new ones.
//
// Nodus ships unsigned on macOS, so it does not hand off to Squirrel.Mac. It
// replaces its own bundle with a helper script it writes at update time — and the
// helper that runs belongs to the version being REPLACED, never to the one being
// installed. v4.2.3's helper is literally:
//
//   NEW_APP="$(/usr/bin/find "$STAGING" -type d -name Nodus.app -print -quit)"
//   [ -n "$NEW_APP" ] && [ -d "$NEW_APP/Contents" ] || fail
//
// 4.2.4 renamed `build.productName` to "Nodus Research", so its zip contained
// `Nodus Research.app`. That find matched nothing, the helper failed after the app
// had already quit, and Nodus never reopened — still on 4.2.3, with no error. The
// same commit taught the CURRENT helper both names, which cannot help: that code
// only runs on machines already past the version that broke.
//
// So the bundle name cannot change while any client that hardcodes it is still in
// the field. Every installed copy of Nodus is such a client. Renaming the product
// for display is fine; renaming the bundle is not.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');
const pkg = JSON.parse(read('package.json'));

/** The bundle electron-builder writes is named after productName. */
const BUNDLE = `${pkg.build.productName}.app`;

test('THE REGRESSION: the packaged bundle is Nodus.app', () => {
  assert.equal(pkg.build.productName, 'Nodus',
    'every already-installed Nodus looks for a bundle named exactly "Nodus.app" when it updates itself');
  assert.equal(BUNDLE, 'Nodus.app');
});

test('the bundle name contains no space, which a shell helper would have to quote', () => {
  assert.doesNotMatch(BUNDLE, /\s/, BUNDLE);
});

test('the current helper locates a bundle by shape, not by a name it hardcodes', () => {
  // The root-cause fix for the whole class. A named search can only ever know the
  // names that existed when it shipped, and it is always the OLD version's helper
  // that runs. Matching any single top-level .app survives a rename; matching
  // "Nodus.app" did not.
  const find = read('electron/main.ts').match(/NEW_APP="\$\(\/usr\/bin\/find[^\n]*/)?.[0];
  assert.ok(find, 'the update helper must still locate the new bundle');
  assert.match(find, /-maxdepth 2/,
    'bound the depth, or the nested helper apps in Contents/Frameworks become candidates');
  assert.match(find, /\*\.app/, 'match any bundle rather than a hardcoded name');
});

test('app.setName pins userData, so a product rename cannot orphan a vault', () => {
  // The other half of the same hazard, and the reason 4.2.4 did not lose data:
  // on macOS app.getName() would otherwise follow CFBundleName, moving userData
  // from ~/Library/Application Support/Nodus to .../Nodus Research and opening
  // an empty profile.
  const main = read('electron/main.ts');
  assert.match(main, /app\.setName\('Nodus'\)/,
    'userData must not depend on the packaged product name');
  const setNameAt = main.indexOf("app.setName('Nodus')");
  const firstUserData = main.indexOf("getPath('userData')");
  assert.ok(setNameAt >= 0 && (firstUserData === -1 || setNameAt < firstUserData),
    'app.setName must run before anything resolves userData');
});

// ── The reproduction, end to end, against the REAL v4.2.3 helper ─────────────
// A string assertion cannot prove a shell script finds a directory. This runs the
// helper that shipped in the version everyone is updating FROM, against a zip
// shaped like the one we are about to publish.

function helperFromRelease(tag) {
  let source;
  try {
    source = execFileSync('git', ['show', `${tag}:electron/main.ts`], { cwd: repoRoot, encoding: 'utf8' });
  } catch {
    return null; // Tag not fetched (shallow clone): skip rather than fail.
  }
  const body = source.match(/function unsignedMacUpdateHelperScript\(\): string \{[\s\S]*?\n\}/)?.[0];
  if (!body) return null;
  const lines = [...body.matchAll(/^\s{4}(['"])((?:\\.|(?!\1).)*)\1,$/gm)]
    .map((m) => JSON.parse(m[1] === "'" ? `"${m[2].replace(/\\'/g, "'").replace(/"/g, '\\"')}"` : `"${m[2]}"`));
  return lines.length > 10 ? lines.join('\n') : null;
}

/** The helper as the CURRENT source emits it, for the forward direction. */
function helperFromSource() {
  const body = read('electron/main.ts').match(/function unsignedMacUpdateHelperScript\(\): string \{[\s\S]*?\n\}/)?.[0];
  if (!body) return null;
  const lines = [...body.matchAll(/^\s{4}(['"])((?:\\.|(?!\1).)*)\1,$/gm)]
    .map((m) => JSON.parse(m[1] === "'" ? `"${m[2].replace(/\\'/g, "'").replace(/"/g, '\\"')}"` : `"${m[2]}"`));
  return lines.length > 10 ? lines.join('\n') : null;
}

/**
 * Run a helper against a zip shaped like the release and report what it did.
 *
 * The assertion that matters and that no string check can make: a shell script
 * actually found the directory and swapped the bundle.
 */
function install(script, bundleName) {
  const root = mkdtempSync(path.join(tmpdir(), 'nodus-bundle-name-'));
  try {
    const scriptPath = path.join(root, 'helper.sh');
    writeFileSync(scriptPath, script, { mode: 0o700 });

    const stage = path.join(root, 'stage', bundleName, 'Contents', 'MacOS');
    mkdirSync(stage, { recursive: true });
    writeFileSync(path.join(stage, 'nodus'), 'payload');
    // A nested helper app, exactly as a real Electron bundle carries: nothing may
    // ever select one of these instead of the application itself.
    const nested = path.join(root, 'stage', bundleName, 'Contents', 'Frameworks', `${bundleName.replace('.app', '')} Helper.app`, 'Contents');
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, 'marker'), 'nested');
    const zip = path.join(root, 'update.zip');
    execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', path.join(root, 'stage', bundleName), zip]);

    const target = path.join(root, 'Nodus.app');
    mkdirSync(path.join(target, 'Contents'), { recursive: true });
    writeFileSync(path.join(target, 'Contents', 'marker'), 'old');

    const state = path.join(root, 'state.json');
    const dead = execFileSync('/bin/sh', ['-c', '(exec /usr/bin/true) & echo $!'], { encoding: 'utf8' }).trim();
    try { execFileSync('/bin/sh', [scriptPath, dead, zip, target, state], { stdio: 'ignore' }); } catch { /* the helper reports through state */ }

    const status = existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')).status : 'no-state';
    return {
      status,
      replaced: !existsSync(path.join(target, 'Contents', 'marker')),
      isApplication: existsSync(path.join(target, 'Contents', 'MacOS', 'nodus')),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('THE USER-VISIBLE BUG: the released helper cannot install a renamed bundle', { skip: process.platform !== 'darwin' }, () => {
  // What 4.2.4 actually shipped, against what everyone actually runs. The app
  // quits, this fails, nothing reopens, and the version never changes.
  const script = helperFromRelease('v4.2.3');
  if (!script) return;
  const result = install(script, 'Nodus Research.app');
  assert.equal(result.status, 'failed');
  assert.equal(result.replaced, false, 'the old bundle is left in place, so the user stays on the old version');
});

test('the current helper installs a renamed bundle, so this cannot recur after 4.2.4', { skip: process.platform !== 'darwin' }, () => {
  const script = helperFromSource();
  assert.ok(script, 'unsignedMacUpdateHelperScript() not found');
  const result = install(script, 'Some Future Name.app');
  assert.equal(result.status, 'installed');
  assert.equal(result.isApplication, true, 'it must install the application, not a nested helper app');
});

test('a released helper installs the bundle name we are about to ship', { skip: process.platform !== 'darwin' }, () => {
  const script = helperFromRelease('v4.2.3');
  if (!script) return; // history unavailable here
  const result = install(script, BUNDLE);
  assert.equal(result.status, 'installed', `the v4.2.3 helper could not install a zip containing ${BUNDLE}`);
  assert.equal(result.replaced, true, 'the old bundle must have been replaced, not left in place');
  assert.equal(result.isApplication, true);
});

// ── What the update LEAVES BEHIND ───────────────────────────────────────────
// 4.2.4 updated correctly and still put two Nodus icons in the Dock. The helper
// moves the running bundle to "<target>.previous" and never removes it, and that
// suffix is on the DIRECTORY name only: inside is a complete application bundle
// with the same CFBundleIdentifier. LaunchServices registers it as a second copy
// of the app — confirmed on a real machine after the 4.2.4 update:
//
//   path: /Applications/Nodus.app            (0x17b74)
//   path: /Applications/Nodus.app.previous   (0x17b38)
//
// It is also ~1.8 GB, kept forever, by every update.

test('the update does not leave a second application behind', { skip: process.platform !== 'darwin' }, () => {
  const script = helperFromSource();
  assert.ok(script, 'unsignedMacUpdateHelperScript() not found');

  const root = mkdtempSync(path.join(tmpdir(), 'nodus-leftover-'));
  try {
    const scriptPath = path.join(root, 'helper.sh');
    writeFileSync(scriptPath, script, { mode: 0o700 });

    const stage = path.join(root, 'stage', BUNDLE, 'Contents', 'MacOS');
    mkdirSync(stage, { recursive: true });
    writeFileSync(path.join(stage, 'nodus'), 'new');
    const zip = path.join(root, 'update.zip');
    execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', path.join(root, 'stage', BUNDLE), zip]);

    const target = path.join(root, 'Nodus.app');
    mkdirSync(path.join(target, 'Contents'), { recursive: true });
    writeFileSync(path.join(target, 'Contents', 'marker'), 'old');

    const state = path.join(root, 'state.json');
    const dead = execFileSync('/bin/sh', ['-c', '(exec /usr/bin/true) & echo $!'], { encoding: 'utf8' }).trim();
    try { execFileSync('/bin/sh', [scriptPath, dead, zip, target, state], { stdio: 'ignore' }); } catch { /* reported through state */ }

    assert.equal(JSON.parse(readFileSync(state, 'utf8')).status, 'installed');
    assert.ok(!existsSync(`${target}.previous`),
      'the displaced bundle must be removed: it is a second registered application, not a backup');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the relaunch activates rather than forcing a duplicate process', () => {
  // `open -n` forces a NEW instance even when one is running. The app is known
  // dead by this point, so -n bought nothing and could only ever add a second
  // process for the single-instance lock to have to kill.
  const helper = read('electron/main.ts');
  const open = helper.match(/'\/usr\/bin\/open[^\n]*/)?.[0];
  assert.ok(open, 'the helper must relaunch the app');
  assert.doesNotMatch(open, /open -n/, 'plain `open` activates an existing instance instead of duplicating it');
});
