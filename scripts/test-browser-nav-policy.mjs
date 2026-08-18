// Which URLs a Nodus Browser tab may navigate to.
//
// This runs on every will-navigate and will-frame-navigate, so unlike the
// address-bar test it covers what a PAGE does on its own: redirects, script
// navigations, meta refreshes. The matrix is asserted rather than sampled
// because the failure mode is silent — a scheme that slips through does not
// throw, it just loads.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-navpolicy-'));
const bundle = path.join(dir, 'nav.cjs');

execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/browserNavigation.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

const require = createRequire(import.meta.url);
const { decideNavigation, isNavigationAllowed } = require(bundle);

test('ordinary web navigation is allowed in both frame kinds', () => {
  for (const url of ['https://www.jstor.org/stable/1', 'http://example.org/a?b=c']) {
    assert.equal(isNavigationAllowed(url, true), true, url);
    assert.equal(isNavigationAllowed(url, false), true, url);
  }
});

test('the Nodus vault schemes can never be navigated to, in any frame', () => {
  // These three are served from the DEFAULT session and hand out vault bytes.
  // A page reaching one would be reading the user's library.
  for (const url of ['nodus-image://v/x.png', 'nodus-archive://v/box/1', 'nodus-library://item/42']) {
    for (const isMainFrame of [true, false]) {
      const decision = decideNavigation(url, { isMainFrame });
      assert.equal(decision.allowed, false, `${url} mainFrame=${isMainFrame}`);
      assert.equal(decision.reason, 'blocked-scheme');
    }
  }
});

test('file: is refused in subframes too, which is where it would actually be tried', () => {
  assert.equal(isNavigationAllowed('file:///etc/passwd', true), false);
  assert.equal(isNavigationAllowed('file:///Users/x/.ssh/id_rsa', false), false);
});

test('javascript: is refused in both frames', () => {
  assert.equal(isNavigationAllowed('javascript:alert(1)', true), false);
  assert.equal(isNavigationAllowed('javascript:fetch("//evil")', false), false);
});

test('blob: and data: are refused at top level and allowed inside a frame', () => {
  // Refused at top level: a navigation to one runs in the current page's stead.
  // Allowed in a frame: PDF viewers and embedded players rely on them, and the
  // frame is already inside a page that passed this same check.
  for (const url of ['blob:https://example.org/abc', 'data:text/html,<p>hi']) {
    assert.equal(isNavigationAllowed(url, true), false, `${url} top-level`);
    assert.equal(isNavigationAllowed(url, false), true, `${url} subframe`);
  }
});

test('about:blank is allowed and every other about: target is refused', () => {
  assert.equal(isNavigationAllowed('about:blank', true), true);
  assert.equal(isNavigationAllowed('ABOUT:BLANK', true), true);
  for (const url of ['about:config', 'about:gpu', 'about:tracing']) {
    assert.equal(isNavigationAllowed(url, true), false, url);
  }
});

test('chrome:, devtools: and view-source: are refused', () => {
  for (const url of ['chrome://settings', 'devtools://devtools/x.html', 'view-source:https://example.org']) {
    assert.equal(isNavigationAllowed(url, true), false, url);
  }
});

test('an unrecognised scheme fails closed rather than open', () => {
  // The load-bearing property: new Chromium versions add schemes, and anything
  // this policy has never heard of must be refused, not followed.
  for (const url of ['weirdapp://do-something', 'ftp://ftp.example.org', 'ws://example.org']) {
    const decision = decideNavigation(url, { isMainFrame: true });
    assert.equal(decision.allowed, false, url);
    assert.equal(decision.reason, 'unsupported-scheme');
  }
});

test('a malformed target is refused and says so', () => {
  for (const url of ['', '   ', 'not a url', '://missing-scheme']) {
    const decision = decideNavigation(url, { isMainFrame: true });
    assert.equal(decision.allowed, false, JSON.stringify(url));
    assert.equal(decision.reason, 'malformed');
  }
});

test('the frame default is the strict one', () => {
  // Calling decideNavigation with no options must behave as a main frame, so a
  // caller that forgets the flag gets the tighter policy rather than the looser.
  assert.equal(decideNavigation('data:text/html,<p>hi').allowed, false);
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
