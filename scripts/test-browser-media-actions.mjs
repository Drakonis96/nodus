// The page's own Media Session handlers, used as the header's remote control.
//
// The bug this file exists to prevent: Previous and Next used to be sent as
// Chromium media keys, and those never reach a page. A key event injected with
// `sendInputEvent` is dispatched in the RENDERER, where it is an ordinary
// keydown, while media keys are handled in the BROWSER process. A player that
// keeps its whole playlist inside one <audio>/<video> — Spotify, YouTube — was
// therefore left with no working channel at all: the injected key did nothing,
// and the DOM fallback could only restart the track it was already on or move to
// an unrelated element, which is why the buttons appeared to "just pause".
//
// The fix captures `navigator.mediaSession.setActionHandler` in the page's own
// world before any page script runs, so the page's own handler can be called.
// The hook source is a string because the preload cannot be imported outside
// Electron — so this file runs it here, against a fake window and navigator.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-media-actions-'));
const bundle = path.join(dir, 'media-session.cjs');

execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/preload/browserPageMediaSession.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

const require = createRequire(import.meta.url);
const actions = require(bundle);

/**
 * Run the hook exactly as the renderer would: the source is an IIFE that reads
 * `window` and `navigator` as globals, so handing it fakes is the whole test.
 */
function installHook(bridge, mediaSession) {
  const window = {};
  const run = new Function('window', 'navigator', `return ${actions.mediaSessionHookSource(bridge)}`);
  return { window, outcome: run(window, { mediaSession }) };
}

/** A MediaSession that records what a page registers, as Chromium's does. */
function fakeSession() {
  const registered = new Map();
  const receivers = [];
  return {
    registered,
    receivers,
    mediaSession: {
      calls: [],
      setActionHandler(action, handler) {
        receivers.push(this);
        this.calls.push(action);
        if (typeof handler === 'function') registered.set(action, handler);
        else registered.delete(action);
      },
    },
  };
}

/** Run an invoke expression against a window, as the preload does. */
function invokeExpression(bridge, action, window) {
  return new Function('window', `return ${actions.mediaSessionInvokeSource(bridge, action)}`)(window);
}

// ---------------------------------------------------------------------------
// Which channel each command goes through.
// ---------------------------------------------------------------------------

test('every command maps to the Media Session action of the same intent', () => {
  assert.equal(actions.planMediaCommand('previous').action, 'previoustrack');
  assert.equal(actions.planMediaCommand('next').action, 'nexttrack');
  assert.equal(actions.planMediaCommand('play').action, 'play');
  assert.equal(actions.planMediaCommand('pause').action, 'pause');
  assert.equal(actions.planMediaCommand('stop').action, 'stop');
});

test('PREVIOUS AND NEXT LEAD WITH THE PAGE — the regression this file guards', () => {
  // A page that owns its playlist exposes one element for every track, so the
  // page's own handler is the only thing that can actually skip a track.
  assert.equal(actions.planMediaCommand('previous').sessionFirst, true);
  assert.equal(actions.planMediaCommand('next').sessionFirst, true);
});

test('play/pause/stop keep acting on the element first, with the handler as the last resort', () => {
  // Acting on the element already works on every page Nodus has been tried on,
  // so the page's handler must not take that path over.
  for (const command of ['play', 'pause', 'stop']) {
    assert.equal(actions.planMediaCommand(command).sessionFirst, false, command);
    assert.equal(actions.planMediaCommand(command).action, command);
  }
});

test('a command states the playback state only where it really means one', () => {
  assert.equal(actions.playbackAfterCommand('play'), true);
  assert.equal(actions.playbackAfterCommand('pause'), false);
  assert.equal(actions.playbackAfterCommand('stop'), false);
  assert.equal(actions.playbackAfterCommand('next'), null, 'skipping a track says nothing about playback');
  assert.equal(actions.playbackAfterCommand('previous'), null);
});

test('EACH CHANNEL RUNS ONCE: a handler called twice would skip two tracks', () => {
  // Found the hard way: the first version of this fix asked the page's handler
  // and then fell through to it a second time, so one press of Next skipped two
  // tracks on a real player.
  for (const command of ['previous', 'next', 'play', 'pause', 'stop']) {
    const channels = actions.mediaChannels(actions.planMediaCommand(command));
    assert.equal(new Set(channels).size, channels.length, `${command} must not repeat a channel`);
    assert.deepEqual([...channels].sort(), ['elements', 'session'], `${command} must try both channels`);
  }
  assert.deepEqual(actions.mediaChannels(actions.planMediaCommand('next')), ['session', 'elements']);
  assert.deepEqual(actions.mediaChannels(actions.planMediaCommand('play')), ['elements', 'session']);
});

// ---------------------------------------------------------------------------
// The hook itself.
// ---------------------------------------------------------------------------

test('the hook installs into the page world and reports it', () => {
  const { outcome } = installHook('__bridge', fakeSession().mediaSession);
  assert.equal(outcome, 'installed');
});

test('a document without a Media Session is left alone, not broken', () => {
  assert.equal(installHook('__bridge', undefined).outcome, 'unavailable');
  assert.equal(installHook('__bridge', {}).outcome, 'unavailable');
});

test('THE FIX: a handler the page registers is remembered and can be called', () => {
  const bridge = '__bridge';
  const session = fakeSession();
  const { window, outcome } = installHook(bridge, session.mediaSession);
  assert.equal(outcome, 'installed');

  // The page's own script, running after the preload.
  const calls = [];
  session.mediaSession.setActionHandler('nexttrack', () => calls.push('nexttrack'));

  assert.equal(invokeExpression(bridge, 'nexttrack', window), 'called');
  assert.deepEqual(calls, ['nexttrack'], 'the page\'s own handler must be the thing that runs');

  // And an action the page never registered is reported as such, so the caller
  // can fall through to the DOM instead of believing it worked.
  assert.equal(invokeExpression(bridge, 'previoustrack', window), 'no-handler');
  assert.deepEqual(calls, ['nexttrack']);
});

test('the page keeps a real Media Session: registration still reaches Chromium', () => {
  const session = fakeSession();
  installHook('__bridge', session.mediaSession);
  const handler = () => {};
  session.mediaSession.setActionHandler('nexttrack', handler);
  assert.deepEqual(session.mediaSession.calls, ['nexttrack'], 'the wrapper must forward the call');
  assert.equal(session.registered.get('nexttrack'), handler);
  // `this` must be the session, or Chromium's own implementation would be
  // invoked with the wrong receiver.
  assert.equal(session.receivers[0], session.mediaSession);
});

test('disabling an action with null is remembered as "nothing to call"', () => {
  const bridge = '__bridge';
  const session = fakeSession();
  const { window } = installHook(bridge, session.mediaSession);
  session.mediaSession.setActionHandler('previoustrack', () => {});
  assert.equal(invokeExpression(bridge, 'previoustrack', window), 'called');
  // Spotify and YouTube both disable an action this way at the ends of a list.
  session.mediaSession.setActionHandler('previoustrack', null);
  assert.equal(invokeExpression(bridge, 'previoustrack', window), 'no-handler');
  assert.equal(session.registered.has('previoustrack'), false, 'Chromium must be told too');
});

test('a handler that throws is contained instead of escaping into the page', () => {
  const bridge = '__bridge';
  const session = fakeSession();
  const { window } = installHook(bridge, session.mediaSession);
  session.mediaSession.setActionHandler('nexttrack', () => { throw new Error('site bug'); });
  assert.equal(invokeExpression(bridge, 'nexttrack', window), 'threw');
});

test('the bridge is hidden from the page\'s own global enumeration', () => {
  const bridge = '__nodusMediaSession_probe';
  const { window } = installHook(bridge, fakeSession().mediaSession);
  assert.deepEqual(Object.keys(window), [], 'the page must not see a Nodus-looking global');
  const descriptor = Object.getOwnPropertyDescriptor(window, bridge);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.writable, false);
  assert.equal(descriptor.configurable, false);
});

test('invoking in a document the hook never reached says so instead of throwing', () => {
  assert.equal(invokeExpression('__bridge', 'nexttrack', {}), 'no-bridge');
});

test('a bridge name is scoped to one document, so a page cannot guess another tab\'s', () => {
  const first = installHook('__nodus_aaa', fakeSession().mediaSession);
  const second = installHook('__nodus_bbb', fakeSession().mediaSession);
  assert.equal(invokeExpression('__nodus_aaa', 'nexttrack', second.window), 'no-bridge');
  assert.equal(invokeExpression('__nodus_aaa', 'nexttrack', first.window), 'no-handler');
});

// ---------------------------------------------------------------------------
// The wiring, as the preload and main actually ship it.
// ---------------------------------------------------------------------------

const preload = readFileSync(path.join(repoRoot, 'electron/preload/browserPage.ts'), 'utf8');
const mainTabs = readFileSync(path.join(repoRoot, 'electron/browser/tabs.ts'), 'utf8');

test('the preload installs the hook before the page can register anything', () => {
  const install = preload.indexOf('executeJavaScript(mediaSessionHookSource(');
  const command = preload.indexOf("ipcRenderer.on('nodus-browser:page:mediaCommand'");
  assert.ok(install > 0, 'the hook must be installed by the preload');
  assert.ok(install < command, 'the hook must be installed at module scope, not while serving a command');
});

test('main no longer presses media keys into a page, which could never reach it', () => {
  assert.doesNotMatch(mainTabs, /sendMediaKey|MediaPlayPause|MediaNextTrack|MediaPrevTrack|MediaPreviousTrack/,
    'injected keys are dispatched in the renderer and never become Media Session actions');
  assert.doesNotMatch(mainTabs, /mediaCommandResult/, 'the page no longer reports back for a media key fallback');
  assert.doesNotMatch(preload, /mediaCommandResult/);
});

test('previous and next are decided by planMediaCommand, not hardcoded in the handler', () => {
  assert.match(preload, /planMediaCommand\(command as MediaCommand\)/);
  assert.match(preload, /for \(const channel of mediaChannels\(plan\)\)/);
  assert.match(preload, /if \(handled\) break;/);
  assert.equal(preload.match(/await invokeMediaSessionAction\(/g).length, 1,
    'one call site, so a channel cannot fire twice by falling through');
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
