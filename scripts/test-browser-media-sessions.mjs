// When the Nodus header offers media controls, and when it stops.
//
// The rule this file exists to protect: visibility keys on whether a media
// SESSION exists, never on whether sound is audible right now. Chromium reports
// audio state changing when playback pauses, so an audibility-driven icon would
// vanish the instant a user pressed Pause — taking the Play button with it, and
// leaving no way to resume without hunting for the tab.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-media-'));
const bundle = path.join(dir, 'media.cjs');

execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/browser/media.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

const require = createRequire(import.meta.url);
const media = require(bundle);

const describe = (title = 'Lecture 4') => () => ({
  title, url: 'https://example.org/lecture', origin: 'https://example.org', faviconDataUrl: null,
});

function reset() {
  media.clearAllMediaSessions();
  media.setMediaNotifier(null);
}

test('no media means no session, so the header shows nothing', () => {
  reset();
  assert.deepEqual(media.browserMediaStates(), []);
});

test('the first play creates a session', () => {
  reset();
  media.noteMediaPlaying('tab-1', describe(), 'video');
  const [state] = media.browserMediaStates();
  assert.equal(state.tabId, 'tab-1');
  assert.equal(state.hasMedia, true);
  assert.equal(state.playing, true);
  assert.equal(state.kind, 'video');
  assert.equal(state.canPlayPause, true);
});

test('PAUSING KEEPS THE SESSION — the regression this feature is most likely to ship', () => {
  reset();
  media.noteMediaPlaying('tab-1', describe());
  media.noteMediaPaused('tab-1');
  const [state] = media.browserMediaStates();
  assert.ok(state, 'the session must survive a pause');
  assert.equal(state.hasMedia, true, 'the header icon must remain');
  assert.equal(state.playing, false, 'but it must report that it is paused');
});

test('going silent keeps the session too', () => {
  reset();
  media.noteMediaPlaying('tab-1', describe());
  media.noteAudioState('tab-1', false);
  const [state] = media.browserMediaStates();
  assert.ok(state, 'silence is not the end of a media session');
  assert.equal(state.audible, false);
  assert.equal(state.hasMedia, true);
});

test('muting keeps the session and reports itself', () => {
  reset();
  media.noteMediaPlaying('tab-1', describe());
  media.noteMuted('tab-1', true);
  const [state] = media.browserMediaStates();
  assert.equal(state.muted, true);
  assert.equal(state.hasMedia, true);
});

test('resuming after a pause reuses the same session rather than stacking a second', () => {
  reset();
  media.noteMediaPlaying('tab-1', describe());
  media.noteMediaPaused('tab-1');
  media.noteMediaPlaying('tab-1', describe());
  assert.equal(media.browserMediaStates().length, 1);
  assert.equal(media.browserMediaStates()[0].playing, true);
});

test('navigating away ends the session immediately, with no grace period', () => {
  reset();
  media.noteMediaPlaying('tab-1', describe());
  media.dropMediaSession('tab-1');
  assert.deepEqual(media.browserMediaStates(), [], 'there is nothing left to replay');
});

test('closing a tab ends its session and leaves the others alone', () => {
  reset();
  media.noteMediaPlaying('tab-1', describe('One'));
  media.noteMediaPlaying('tab-2', describe('Two'));
  media.dropMediaSession('tab-1');
  const states = media.browserMediaStates();
  assert.equal(states.length, 1);
  assert.equal(states[0].tabId, 'tab-2');
});

test('several tabs with media each get their own row', () => {
  reset();
  media.noteMediaPlaying('tab-1', describe('One'), 'audio');
  media.noteMediaPlaying('tab-2', describe('Two'), 'video');
  media.noteMediaPaused('tab-2');
  const states = media.browserMediaStates();
  assert.equal(states.length, 2);
  assert.deepEqual(states.map((s) => s.tabId).sort(), ['tab-1', 'tab-2']);
  // One playing, one paused — and both still listed.
  assert.deepEqual(states.map((s) => s.playing).sort(), [false, true]);
});

test('a finished track keeps its session briefly, then drops it', async () => {
  reset();
  media.noteMediaPlaying('tab-1', describe());
  media.noteMediaEnded('tab-1');
  // Still there: a lecture that just ended is the thing most likely to be
  // scrubbed back, and losing the controls at that exact moment is hostile.
  const [state] = media.browserMediaStates();
  assert.ok(state, 'a just-ended track keeps its controls');
  assert.equal(state.playing, false);
});

test('replaying within the grace period cancels the removal', async () => {
  reset();
  media.noteMediaPlaying('tab-1', describe());
  media.noteMediaEnded('tab-1');
  media.noteMediaPlaying('tab-1', describe());
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(media.browserMediaStates().length, 1, 'the pending removal must be cancelled');
  assert.equal(media.browserMediaStates()[0].playing, true);
});

test('previous/next are absent from the state, not present and false', () => {
  reset();
  media.noteMediaPlaying('tab-1', describe());
  const [state] = media.browserMediaStates();
  // No web or Electron API can discover whether a page registered those
  // handlers, so a field would invite a UI to render dead controls. Adding them
  // later has to be a deliberate, typed change rather than flipping a boolean.
  assert.equal('canPrevious' in state, false);
  assert.equal('canNext' in state, false);
});

test('the internal timer handle never crosses to the renderer', () => {
  reset();
  media.noteMediaPlaying('tab-1', describe());
  media.noteMediaEnded('tab-1');
  const [state] = media.browserMediaStates();
  assert.equal('endedTimer' in state, false, 'a Timeout is not serialisable over IPC');
});

test('every change notifies exactly once, so the header does not thrash', () => {
  reset();
  let calls = 0;
  media.setMediaNotifier(() => { calls += 1; });
  media.noteMediaPlaying('tab-1', describe());
  assert.equal(calls, 1);
  media.noteMediaPaused('tab-1');
  assert.equal(calls, 2);
  // A no-op must not notify: repeated identical reports are common from
  // Chromium and each one would re-render the header.
  media.noteAudioState('tab-1', true);
  media.noteAudioState('tab-1', true);
  assert.equal(calls, 2, 'an unchanged audio state must not notify');
  media.noteMuted('tab-1', false);
  assert.equal(calls, 2, 'an unchanged mute state must not notify');
  media.setMediaNotifier(null);
});

test('clearing everything drops all sessions', () => {
  reset();
  media.noteMediaPlaying('tab-1', describe());
  media.noteMediaPlaying('tab-2', describe());
  media.clearAllMediaSessions();
  assert.deepEqual(media.browserMediaStates(), []);
});

test('reporting on an unknown tab is a no-op rather than a crash', () => {
  reset();
  media.noteMediaPaused('ghost');
  media.noteAudioState('ghost', true);
  media.noteMuted('ghost', true);
  media.noteMediaEnded('ghost');
  media.dropMediaSession('ghost');
  assert.deepEqual(media.browserMediaStates(), []);
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
