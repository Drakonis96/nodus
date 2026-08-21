// Google sign-in inside Nodus Browser: recognised, refused early, explained.
//
// Google blocks sign-in from every Chromium EMBEDDER (CEF, Electron) and has
// never published a way back in. Nodus does not fight that; it recognises the
// destination before Google's wall loads and offers the system browser instead.
//
// What must not regress: the recognition itself (too narrow and the user hits
// Google's dead end, too wide and ordinary Google pages stop working), the fact
// that EVERY way into a navigation is covered, and the fact that the pane
// offers a way out rather than a Retry that cannot succeed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(repoRoot, file), 'utf8');

// The classifier is TypeScript in shared/, so it is bundled the same way the
// navigation-policy test does it: the test must exercise the REAL function, not
// a copy of the rule that can drift from the one that ships.
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-google-signin-'));
const bundle = path.join(dir, 'browser.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/browser.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' },
);
const { isGoogleSignInUrl } = createRequire(import.meta.url)(bundle);
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

/** Source with comments removed, so prose about a pattern never satisfies a scan. */
function code(file) {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('every route into Google sign-in is recognised', () => {
  // Plain web sign-in, which is what a user typing gmail.com ends up at.
  assert.equal(isGoogleSignInUrl('https://accounts.google.com/ServiceLogin?service=mail'), true);
  assert.equal(isGoogleSignInUrl('https://accounts.google.com/v3/signin/identifier?flowName=GlifWebSignIn'), true);

  // The OAuth authorization endpoint, which is where a third-party site's
  // "Continue with Google" button sends the browser. Same host, and the reason
  // the whole host is matched rather than a list of sign-in paths.
  assert.equal(
    isGoogleSignInUrl('https://accounts.google.com/o/oauth2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.example%2Fcb'),
    true,
  );
  assert.equal(isGoogleSignInUrl('https://accounts.google.com/gsi/select'), true);
});

test('recognition does not spill onto the rest of Google', () => {
  // Nodus is a research browser. Scholar, Books and Drive documents must keep
  // loading; only the sign-in host is a dead end.
  for (const url of [
    'https://scholar.google.com/citations?user=abc',
    'https://www.google.com/search?q=weber',
    'https://drive.google.com/file/d/abc/view',
    'https://docs.google.com/document/d/abc/edit',
    'https://books.google.com/books?id=abc',
    'https://www.google.com/recaptcha/api2/anchor',
  ]) {
    assert.equal(isGoogleSignInUrl(url), false, `${url} must still load`);
  }
});

test('lookalike hosts do not match', () => {
  // A hostname check that used includes() or endsWith() would hand an attacker
  // a way to have Nodus vouch for their page — or, more likely here, would
  // wrongly divert a legitimate site.
  for (const url of [
    'https://accounts.google.com.evil.example/signin',
    'https://notaccounts.google.com/signin',
    'https://accounts.google.co/signin',
    'https://evil.example/?next=https://accounts.google.com/signin',
  ]) {
    assert.equal(isGoogleSignInUrl(url), false, `${url} must not be treated as Google sign-in`);
  }
  // Plain http is not Google; only the real, secure host counts.
  assert.equal(isGoogleSignInUrl('http://accounts.google.com/signin'), false);
  assert.equal(isGoogleSignInUrl('not a url'), false);
  assert.equal(isGoogleSignInUrl(''), false);
});

test('all five ways a navigation can start are intercepted', () => {
  // Missing one leaves a hole the user finds by landing on Google's wall. The
  // popup route matters most: a "Continue with Google" button usually opens a
  // window rather than redirecting.
  const tabs = code('electron/browser/tabs.ts');
  const at = (needle, span = 600) => {
    const index = tabs.indexOf(needle);
    assert.ok(index >= 0, `${needle} must exist`);
    return tabs.slice(index, index + span);
  };

  assert.match(at('setWindowOpenHandler'), /interceptGoogleSignIn/, 'popups must be intercepted');
  assert.match(at("'will-navigate'"), /interceptGoogleSignIn/, 'top-level navigation must be intercepted');
  assert.match(at("'will-redirect'"), /interceptGoogleSignIn/, 'server redirects must be intercepted');
  // A wider window: navigate() handles the internal start pages first, so the
  // web branch where the interception lives sits well past the 600 above.
  assert.match(at('export function navigate', 1800), /interceptGoogleSignIn/, 'the omnibox must be intercepted');
  // Wider again: createTab spells out the whole hardened webPreferences block
  // before it gets anywhere near a navigation.
  assert.match(at('export async function createTab', 2500), /interceptGoogleSignIn/, 'a new tab must be intercepted');

  // And the interception must actually stop the navigation, not merely note it.
  const helper = at('function interceptGoogleSignIn');
  assert.match(helper, /kind:\s*'google-sign-in'/, 'the tab must carry the dedicated error kind');
  assert.match(helper, /loading:\s*false/, 'the tab must stop showing a spinner');
});

test('subframes are left alone', () => {
  // will-frame-navigate fires for iframes. Diverting those would replace the
  // whole tab because of a widget in a corner of someone else's page, and
  // Google refuses embedded sign-in in an iframe on its own anyway.
  const tabs = code('electron/browser/tabs.ts');
  const frame = tabs.slice(tabs.indexOf("'will-frame-navigate'"));
  assert.doesNotMatch(frame.slice(0, frame.indexOf('as never);')), /interceptGoogleSignIn/,
    'a subframe must not divert the whole tab');

  // The redirect guard covers subframes too, so it must check the main frame first.
  const redirect = tabs.slice(tabs.indexOf("'will-redirect'"), tabs.indexOf("'will-redirect'") + 600);
  assert.match(redirect, /details\.isMainFrame\s*&&\s*interceptGoogleSignIn/,
    'only a main-frame redirect may raise the notice');
});

test('the notice offers a way out, never a Retry', () => {
  // Retry is the wrong affordance here: nothing failed, and the second attempt
  // is refused exactly like the first. The pane exists to say so.
  const view = read('src/views/NodusBrowserView.tsx');
  const at = view.indexOf('function GoogleSignInNotice');
  assert.ok(at >= 0, 'the notice component must exist');
  const body = view.slice(at, view.indexOf('\n}', at));

  assert.match(body, /openExternal/, 'the notice must hand the address to the system browser');
  assert.doesNotMatch(body, /browserReload/, 'a Retry here would promise something that cannot happen');

  // The way back is DISMISS, not goBack. The notice is raised without a
  // navigation — the popup is denied, will-navigate is preventDefault()ed — so
  // the site's page is still loaded and merely hidden. goBack() therefore landed
  // on whatever preceded the login page, and on a tab with no history it did
  // nothing whatsoever, which is how it reached the user: a dead button.
  assert.match(body, /browserDismissError/, 'the way back must reveal the page that is still loaded');
  assert.doesNotMatch(body, /browserGoBack/,
    'goBack is wrong here: nothing navigated, and with no history it is a no-op');

  // It must be routed to. A component nobody renders is the same as no component.
  assert.match(code('src/views/NodusBrowserView.tsx'), /error\.kind === 'google-sign-in'[\s\S]{0,120}GoogleSignInNotice/,
    'the google-sign-in kind must render the notice');
});

test('the hand-off offers the SITE, not the half-finished Google URL', () => {
  // The bug this replaced: handing the system browser the accounts.google.com
  // URL splits one federated login across two browsers. A site built on Firebase
  // keeps the flow's opening state in its own sessionStorage back in Nodus, so
  // the second half lands with nothing and dies on auth/missing-initial-state.
  const tabs = code('electron/browser/tabs.ts');
  const view = read('src/views/NodusBrowserView.tsx');

  // Main saves where the sign-in came from, for the three page-driven routes.
  for (const hook of ['setWindowOpenHandler', "'will-navigate'", "'will-redirect'"]) {
    const at = tabs.indexOf(hook);
    assert.match(tabs.slice(at, at + 600), /interceptGoogleSignIn\([^)]*contents\.getURL\(\)/,
      `${hook} must record the page the sign-in started from`);
  }

  // And the pane spends it, rather than reopening Google's own URL.
  const body = view.slice(view.indexOf('function GoogleSignInNotice'));
  const pane = body.slice(0, body.indexOf('\n}\n'));
  assert.match(pane, /error\.siteUrl/, 'the pane must read the originating site');
  assert.match(pane, /openExternal\(site\)/, 'the hand-off must open the site');

  // The Google URL stays only as the fallback for "user typed it themselves",
  // where there is no site to return to.
  assert.match(pane, /openExternal\(error\.url\)/, 'a direct request for Google must still open Google');
});

test('a hand-off target is only ever an ordinary web page', () => {
  // about:blank on a brand-new tab, an internal start page, or Google itself
  // would each send the system browser somewhere useless.
  const tabs = code('electron/browser/tabs.ts');
  const at = tabs.indexOf('function handoffTarget');
  assert.ok(at >= 0, 'the guard must exist');
  const guard = tabs.slice(at, at + 500);
  assert.match(guard, /protocol !== 'https:' && .*protocol !== 'http:'/, 'only http(s) may be handed over');
  assert.match(guard, /isGoogleSignInUrl\(siteUrl\)/, 'Google itself is not a site to return to');
});

test('the copy blames Google, not Nodus, and says cookies do not travel', () => {
  // The two things a user must take away, or they conclude the browser is
  // broken and that finishing the login in Chrome will carry over to here.
  const view = read('src/views/NodusBrowserView.tsx');
  const body = view.slice(view.indexOf('function GoogleSignInNotice'));
  assert.match(body, /No es un fallo de Nodus/, 'the notice must say this is not a Nodus defect');

  // The consequence must be stated, and stated BEFORE the buttons. Buried under
  // them it reads as a formality: the user goes to their browser expecting to
  // come back signed in, and only discovers otherwise after the trip is wasted.
  const pane = body.slice(0, body.indexOf('\n}\n'));
  const warning = pane.indexOf('la sesión se queda allí');
  assert.ok(warning >= 0, 'the notice must say the session stays in the other browser');
  assert.ok(pane.indexOf('<button') > warning,
    'the warning must come before the buttons, not as a footnote under them');

  // And it must not be styled as a quiet aside.
  assert.doesNotMatch(pane.slice(warning - 400, warning), /text-xs text-neutral-500/,
    'the warning must not be small grey print');
  assert.match(body, /las cookies no se comparten entre navegadores/,
    'the notice must warn that the outside session does not come back');
});

test('dismissing an error resyncs the tab from the live page', () => {
  // The omnibox path patches the tab's url to the Google address BEFORE raising
  // the notice. Clearing the error without resyncing would leave that address
  // showing over a completely different page.
  const tabs = code('electron/browser/tabs.ts');
  const at = tabs.indexOf('export function dismissError');
  assert.ok(at >= 0, 'dismissError must exist');
  const body = tabs.slice(at, at + 900);
  assert.match(body, /error:\s*null/, 'the error must be cleared');
  assert.match(body, /contents\.getURL\(\)/, 'the address must come from the live page');
  assert.match(body, /applyVisibility\(\)/, 'the native view must be shown again');
  // Via canGoBackFrom, not Chromium's raw history: a tab that reached the site
  // from a Nodus start page can go back to it even with no history entry.
  assert.match(body, /canGoBack:\s*canGoBackFrom\(tab\)/,
    'the back/forward state must be resynced, including the remembered start page');
});

test('the dismiss channel validates its sender like every other browser channel', () => {
  const ipc = code('electron/ipc/browser.ts');
  const at = ipc.indexOf("h('browser:dismissError'");
  assert.ok(at >= 0, 'the channel must be registered');
  assert.match(ipc.slice(at, at + 200), /assertUiSender/,
    'a Browser-partition sender must never be able to drive Nodus chrome');
});

test('the dedicated kind is part of the shared contract', () => {
  const contract = code('shared/browser.ts');
  assert.match(contract, /\|\s*'google-sign-in'/, 'the error kind must be declared');
  assert.match(contract, /export function isGoogleSignInUrl/,
    'the classifier must be shared, so main and renderer cannot disagree');
});
