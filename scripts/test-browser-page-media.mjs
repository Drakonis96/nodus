// Which element the header's media controls actually act on.
//
// The bug this file exists to prevent: a flat `querySelectorAll('audio, video')`
// on the top document is not "the page's media". Real players do not oblige.
// elevenreader.io keeps EIGHT <audio> tags in its document and gives seven of
// them no source at all, so the old code played eight elements at once, and let
// Previous/Next land on a dead placeholder — pausing the track that was running.
// Others put their player in an open shadow root or a same-origin frame, where a
// flat query never looked.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-page-media-'));
const bundle = path.join(dir, 'page-media.cjs');

execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/preload/browserPageMedia.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

const require = createRequire(import.meta.url);
const media = require(bundle);

/** A media element that records what was done to it. */
function el(options = {}) {
  return {
    tagName: options.tagName ?? 'AUDIO',
    src: options.src ?? '',
    currentSrc: options.currentSrc ?? '',
    srcObject: options.srcObject ?? null,
    readyState: options.readyState ?? 0,
    duration: options.duration ?? Number.NaN,
    currentTime: options.currentTime ?? 0,
    ended: options.ended ?? false,
    paused: options.paused ?? true,
    played: 0,
    paused_calls: 0,
    play() { this.played += 1; this.paused = false; return Promise.resolve(); },
    pause() { this.paused_calls += 1; this.paused = true; },
  };
}

/** A placeholder <audio> with no source: exactly what elevenreader.io ships. */
const placeholder = () => el();
/** A real track, with a source and a duration. */
const track = (options = {}) => el({ currentSrc: 'https://cdn.example/track.mp3', readyState: 4, duration: 300, ...options });

/** A minimal document: a flat list, plus optional frames and shadow hosts. */
function doc(nodes, extras = {}) {
  const frames = extras.frames ?? [];
  const hosts = extras.hosts ?? [];
  return {
    querySelectorAll(selector) {
      if (selector === 'audio, video') return nodes;
      if (selector === 'iframe, frame') return frames;
      if (selector === '*') return [...nodes, ...frames, ...hosts];
      return [];
    },
  };
}

test('an empty or missing document yields nothing rather than throwing', () => {
  assert.deepEqual(media.collectMediaElements(null), []);
  assert.deepEqual(media.collectMediaElements(undefined), []);
  assert.deepEqual(media.collectMediaElements({}), []);
  assert.deepEqual(media.collectMediaElements(doc([])), []);
});

test('media inside a same-origin frame is found', () => {
  const inner = track();
  const frame = { contentDocument: doc([inner]) };
  const found = media.collectMediaElements(doc([], { frames: [frame] }));
  assert.deepEqual(found, [inner]);
});

test('a cross-origin frame is left alone, whether it answers null or throws', () => {
  const opaque = { get contentDocument() { throw new Error('cross-origin'); } };
  const empty = { contentDocument: null };
  const own = track();
  const found = media.collectMediaElements(doc([own], { frames: [opaque, empty] }));
  assert.deepEqual(found, [own], 'the page keeps working; the frame is simply out of reach');
});

test('media inside an open shadow root is found', () => {
  const inner = track();
  const host = { shadowRoot: doc([inner]) };
  const found = media.collectMediaElements(doc([], { hosts: [host] }));
  assert.deepEqual(found, [inner]);
});

test('a closed shadow root stays unreachable, by design', () => {
  const host = { shadowRoot: null };
  assert.deepEqual(media.collectMediaElements(doc([], { hosts: [host] })), []);
});

test('the same element reached twice is reported once', () => {
  const shared = track();
  const frame = { contentDocument: doc([shared]) };
  const found = media.collectMediaElements(doc([shared], { frames: [frame] }));
  assert.equal(found.length, 1);
});

test('a frame cycle terminates instead of hanging the page', () => {
  const outer = doc([], { frames: [] });
  const frame = { contentDocument: outer };
  outer.querySelectorAll = (selector) => (selector === 'iframe, frame' ? [frame] : []);
  assert.deepEqual(media.collectMediaElements(outer), []);
});

test('a sourceless <audio> is a placeholder, not media', () => {
  assert.equal(media.isPlayableMedia(placeholder()), false);
  assert.equal(media.isPlayableMedia(track()), true);
  assert.equal(media.isPlayableMedia(el({ src: 'https://cdn.example/a.mp3' })), true);
  assert.equal(media.isPlayableMedia(el({ srcObject: {} })), true, 'a MediaStream has no src');
  assert.equal(media.isPlayableMedia(el({ readyState: 2 })), true, 'buffered data counts');
});

test('"is anything playing" is about the page, not about one element', () => {
  const running = track({ paused: false });
  assert.equal(media.anyPlaying([placeholder(), placeholder(), running]), true);
  assert.equal(media.anyPlaying([placeholder(), track()]), false);
  assert.equal(media.anyPlaying([track({ paused: false, ended: true })]), false, 'a finished track is not playing');
});

// ---------------------------------------------------------------------------
// The elevenreader.io shape: eight <audio> tags, one with a source.
// ---------------------------------------------------------------------------

function elevenreader() {
  const real = track({ currentTime: 42 });
  const nodes = [placeholder(), placeholder(), placeholder(), placeholder(), placeholder(), placeholder(), real, placeholder()];
  return { nodes, real };
}

test('PLAY resumes the real track and starts nothing else', () => {
  const { nodes, real } = elevenreader();
  assert.equal(media.applyMediaCommand(nodes, 'play', null), true);
  assert.equal(real.played, 1, 'the track the user was listening to must resume');
  assert.equal(nodes.filter((node) => node !== real).some((node) => node.played > 0), false,
    'no placeholder may be started');
});

test('PLAY on something already playing reports handled, so the header corrects itself', () => {
  const running = track({ paused: false });
  assert.equal(media.applyMediaCommand([placeholder(), running], 'play', null), true);
  assert.equal(running.played, 0, 'a running element must not be poked');
});

test('PLAY prefers the element the page itself last started', () => {
  const older = track({ currentTime: 10 });
  const preferred = track({ currentTime: 5 });
  media.applyMediaCommand([older, preferred], 'play', preferred);
  assert.equal(preferred.played, 1);
  assert.equal(older.played, 0);
});

test('PLAY falls back to the longest piece of media on a page nothing has touched', () => {
  const short = track({ duration: 12, currentTime: 0 });
  const feature = track({ duration: 3600, currentTime: 0, tagName: 'VIDEO' });
  media.applyMediaCommand([short, feature], 'play', null);
  assert.equal(feature.played, 1, 'a 12-second trailer is not what the header meant');
});

test('PAUSE silences everything that is running, and only that', () => {
  const one = track({ paused: false });
  const two = track({ paused: false });
  const idle = track();
  assert.equal(media.applyMediaCommand([one, two, idle], 'pause', null), true);
  assert.equal(one.paused_calls, 1);
  assert.equal(two.paused_calls, 1);
  assert.equal(idle.paused_calls, 0, 'pausing what is already paused is noise');
});

test('STOP pauses and rewinds', () => {
  const running = track({ paused: false, currentTime: 120 });
  media.applyMediaCommand([running], 'stop', null);
  assert.equal(running.paused, true);
  assert.equal(running.currentTime, 0);
});

test('PAUSE on a page with nothing running reports unhandled, so main can use the media key', () => {
  assert.equal(media.applyMediaCommand([placeholder(), placeholder()], 'pause', null), false);
  assert.equal(media.applyMediaCommand([], 'pause', null), false);
});

test('PLAY on a page with no reachable media reports unhandled', () => {
  assert.equal(media.applyMediaCommand([], 'play', null), false);
});

test('NEXT moves between real tracks, never onto a placeholder', () => {
  const first = track({ paused: false });
  const second = track();
  const nodes = [placeholder(), first, placeholder(), second, placeholder()];
  assert.equal(media.applyMediaCommand(nodes, 'next', null), true);
  assert.equal(first.paused, true, 'the outgoing track stops');
  assert.equal(second.played, 1, 'the incoming track starts');
  assert.equal(nodes.filter((node) => !node.currentSrc).some((node) => node.played > 0), false);
});

test('PREVIOUS at the head of the list restarts the track', () => {
  const only = track({ paused: false, currentTime: 90 });
  assert.equal(media.applyMediaCommand([placeholder(), only], 'previous', null), true);
  assert.equal(only.currentTime, 0);
  assert.equal(only.played, 1);
});

test('NEXT at the tail of the list does nothing and says so', () => {
  const last = track({ paused: false });
  assert.equal(media.applyMediaCommand([last], 'next', null), false);
  assert.equal(last.paused, false, 'the running track must survive a Next that has nowhere to go');
});

test('THE REGRESSION: Previous no longer lands on the first sourceless placeholder', () => {
  // The old code took index 0 of the raw list when nothing looked active — on
  // elevenreader.io that is an empty <audio> — and paused the real track to
  // "switch" to it. The controls appeared to do nothing but silence the page.
  const { nodes, real } = elevenreader();
  real.paused = false;
  media.applyMediaCommand(nodes, 'previous', null);
  assert.equal(real.paused, false, 'the track the user is listening to must not be stopped by Previous');
});

test('an element that throws on play or pause does not take the others down', () => {
  const hostile = { ...track({ paused: false }), play() { throw new Error('nope'); }, pause() { throw new Error('nope'); } };
  const ordinary = track({ paused: false });
  assert.equal(media.applyMediaCommand([hostile, ordinary], 'pause', null), true);
  assert.equal(ordinary.paused, true);
});

test('an unlistenable page still answers rather than acting on nothing', () => {
  // Every element is a placeholder: the fallback keeps them in play for Pause,
  // because misjudging one and pausing it is harmless, but nothing is running,
  // so the command reports unhandled and main reaches for the media key.
  const nodes = [placeholder(), placeholder()];
  assert.equal(media.applyMediaCommand(nodes, 'play', null), true, 'trying is better than refusing');
  assert.equal(media.applyMediaCommand(nodes, 'previous', null), true);
});

test('kind is read from the tag, and unknown for anything else', () => {
  assert.equal(media.kindOf({ tagName: 'VIDEO' }), 'video');
  assert.equal(media.kindOf({ tagName: 'audio' }), 'audio');
  assert.equal(media.kindOf({ tagName: 'DIV' }), 'unknown');
  assert.equal(media.kindOf(null), 'unknown');
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
