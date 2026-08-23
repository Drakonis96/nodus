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
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

test('previous/next are commands, not guessed capability flags in the state', () => {
  reset();
  media.noteMediaPlaying('tab-1', describe());
  const [state] = media.browserMediaStates();
  // Chromium routes the standard media commands, but does not reveal whether a
  // page registered handlers for them. The UI therefore sends commands without
  // inventing capability flags.
  assert.equal('canPrevious' in state, false);
  assert.equal('canNext' in state, false);
});

test('media controls do not restart the popover effect or blink the volume slider', () => {
  const source = readFileSync(path.join(repoRoot, 'src/components/browser/BrowserMedia.tsx'), 'utf8');
  const popover = source.slice(source.indexOf('export function BrowserMediaPopover'), source.indexOf('function MediaRow'));
  assert.match(popover, /const onCloseRef = useRef\(onClose\)/,
    'the changing close callback must be read through a stable ref');
  assert.match(popover, /onCloseRef\.current\(\)/);
  assert.match(popover, /}, \[anchorEl\]\);/,
    'only opening or closing the popover may restart its volume/overlay effect');
  assert.doesNotMatch(popover, /setDeviceVolumeReady\(false\);[\s\S]{0,120}getBrowserDeviceVolume/,
    'an ordinary media update must not disable the already-ready slider');
});

test('mute keeps normal contrast and replaces volume with a crossed-out icon', () => {
  const source = readFileSync(path.join(repoRoot, 'src/components/browser/BrowserMedia.tsx'), 'utf8');
  const row = source.slice(source.indexOf('function MediaRow'));
  assert.match(row, /aria-pressed=\{state\.muted\}/);
  assert.match(row, /state\.muted \? 'volumeOff' : 'volume'/);
  assert.doesNotMatch(row, /state\.muted \? 'text-neutral-600'/,
    'mute must not be represented only by dimming the same icon');
  const icons = readFileSync(path.join(repoRoot, 'src/components/ui.tsx'), 'utf8');
  assert.match(icons, /volumeOff:[^\n]*<line x1="3" y1="3" x2="21" y2="21"\/>/);
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
  media.noteMediaPlaying('tab-1', describe());
  media.noteMediaPlaying('tab-1', describe());
  assert.equal(calls, 1, 'three players in one tab are still one playing tab');
  // Three players started, so three must stop before the tab is paused.
  media.noteMediaPaused('tab-1');
  media.noteMediaPaused('tab-1');
  assert.equal(calls, 1, 'a tab with something still playing must not repaint as paused');
  media.noteMediaPaused('tab-1');
  assert.equal(calls, 2);
  media.noteMediaPaused('tab-1');
  assert.equal(calls, 2, 'a duplicate pause report must not repaint the header');
  // A no-op must not notify: repeated identical reports are common from
  // Chromium and each one would re-render the header.
  media.noteAudioState('tab-1', true);
  media.noteAudioState('tab-1', true);
  assert.equal(calls, 2, 'an unchanged audio state must not notify');
  media.noteMuted('tab-1', false);
  assert.equal(calls, 2, 'an unchanged mute state must not notify');
  media.setMediaNotifier(null);
});

/**
 * The regression that made the header's Play button inert.
 *
 * `media-started-playing` and `media-paused` fire once per PLAYER. A player UI
 * that keeps spare <audio> elements around pauses them constantly while the real
 * track runs — elevenreader.io ships eight <audio> tags and gives seven of them
 * no source. Every one of those pauses used to flip the whole session to
 * "paused", so the header offered Play for audio that was already playing, and
 * pressing it did nothing at all.
 */
test('a spare element pausing must not claim the tab is paused', () => {
  reset();
  media.noteMediaPlaying('tab-1', describe('Censura visual'), 'audio');
  // The page's six other placeholder <audio> elements settle down.
  media.noteMediaPlaying('tab-1', describe('Censura visual'), 'audio');
  media.noteMediaPaused('tab-1');
  const [state] = media.browserMediaStates();
  assert.equal(state.playing, true, 'the track is still running, so the header must offer Pause');
});

test('the page can correct the session outright, because it can see the whole document', () => {
  reset();
  media.noteMediaPlaying('tab-1', describe(), 'audio');
  media.noteMediaPlaying('tab-1', describe(), 'audio');
  // One aggregate "nothing is playing" beats any number of stale player counts.
  media.noteMediaPlaybackState('tab-1', false, describe(), 'audio');
  assert.equal(media.browserMediaStates()[0].playing, false);
  media.noteMediaPlaybackState('tab-1', true, describe(), 'audio');
  assert.equal(media.browserMediaStates()[0].playing, true);
  // And a single pause after that report must still pause the tab, rather than
  // decrementing a count the report already settled.
  media.noteMediaPaused('tab-1');
  assert.equal(media.browserMediaStates()[0].playing, false);
});

test('a page reporting silence with no session does not invent one', () => {
  reset();
  media.noteMediaPlaybackState('tab-1', false, describe(), 'audio');
  assert.deepEqual(media.browserMediaStates(), [], 'silence is not a reason to show media controls');
});

test('a page reporting playback with no session opens one', () => {
  reset();
  media.noteMediaPlaybackState('tab-1', true, describe('Lecture 9'), 'audio');
  const [state] = media.browserMediaStates();
  assert.equal(state.title, 'Lecture 9');
  assert.equal(state.playing, true);
  assert.equal(state.kind, 'audio');
});

test('the internal player count never crosses the IPC boundary', () => {
  reset();
  media.noteMediaPlaying('tab-1', describe());
  const [state] = media.browserMediaStates();
  assert.equal('activePlayers' in state, false, 'the header has no business knowing the count');
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
