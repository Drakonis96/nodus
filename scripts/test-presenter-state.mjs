// F2 — PDF Presenter runtime-state reducer. The Electron-free module
// (shared/presenterState.ts) is esbuild-bundled and driven directly; assertions
// cover slide clamping, next/prev bounds, zoom clamping, black-screen toggling,
// the timer transitions and reducer purity — the invariants both windows and the
// mobile remote rely on.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-presenter-state-'));
const bundle = path.join(outDir, 'presenterState.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [path.join(repoRoot, 'shared/presenterState.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
  { cwd: repoRoot, stdio: 'inherit' },
);
const S = require(bundle);
test.after(() => rm(outDir, { recursive: true, force: true }));

test('beginPresentation clamps the start slide and marks presenting', () => {
  const s = S.beginPresentation('deck1', 5, 3);
  assert.equal(s.presenting, true);
  assert.equal(s.pdfId, 'deck1');
  assert.equal(s.totalSlides, 3);
  assert.equal(s.currentSlide, 3); // 5 clamped to 3
  assert.equal(S.beginPresentation('d', 0, 3).currentSlide, 1); // 0 clamped up to 1
});

test('navigate clamps to [1,total] and always resets zoom', () => {
  let s = { ...S.beginPresentation('d', 1, 10), slideZoom: { scale: 3, originX: 20, originY: 20 } };
  s = S.presenterReducer(s, { type: 'navigate', slide: 7 });
  assert.equal(s.currentSlide, 7);
  assert.deepEqual(s.slideZoom, S.NO_ZOOM);
  assert.equal(S.presenterReducer(s, { type: 'navigate', slide: 99 }).currentSlide, 10);
  assert.equal(S.presenterReducer(s, { type: 'navigate', slide: -4 }).currentSlide, 1);
});

test('next/prev respect the deck bounds', () => {
  const base = S.beginPresentation('d', 1, 3);
  assert.equal(S.presenterReducer(base, { type: 'prev' }).currentSlide, 1); // already first
  let s = S.presenterReducer(base, { type: 'next' });
  assert.equal(s.currentSlide, 2);
  s = S.presenterReducer(S.presenterReducer(s, { type: 'next' }), { type: 'next' });
  assert.equal(s.currentSlide, 3); // capped at total
});

test('next is allowed while the total is still unknown (0)', () => {
  const s = S.presenterReducer(S.beginPresentation('d', 1, 0), { type: 'next' });
  assert.equal(s.currentSlide, 2);
});

test('setTotal clamps an out-of-range current slide', () => {
  const s = S.presenterReducer({ ...S.initialPresenterState(), currentSlide: 9 }, { type: 'setTotal', total: 4 });
  assert.equal(s.totalSlides, 4);
  assert.equal(s.currentSlide, 4);
});

test('slideZoom clamps scale to [1,5] and collapses <=1 to NO_ZOOM', () => {
  const base = S.initialPresenterState();
  assert.equal(S.presenterReducer(base, { type: 'slideZoom', data: { scale: 9, originX: 10, originY: 90 } }).slideZoom.scale, 5);
  assert.deepEqual(S.presenterReducer(base, { type: 'slideZoom', data: { scale: 0.5, originX: 10, originY: 90 } }).slideZoom, S.NO_ZOOM);
});

test('blackScreen toggles or takes an explicit value', () => {
  const base = S.initialPresenterState();
  assert.equal(S.presenterReducer(base, { type: 'blackScreen' }).blackScreen, true);
  assert.equal(S.presenterReducer({ ...base, blackScreen: true }, { type: 'blackScreen' }).blackScreen, false);
  assert.equal(S.presenterReducer(base, { type: 'blackScreen', enabled: true }).blackScreen, true);
});

test('timer sync / toggle / reset', () => {
  const base = S.initialPresenterState();
  let s = S.presenterReducer(base, { type: 'timerSync', timerSeconds: 42, timerRunning: true });
  assert.equal(s.timerSeconds, 42);
  assert.equal(s.timerRunning, true);
  s = S.presenterReducer(s, { type: 'timerToggle' });
  assert.equal(s.timerRunning, false);
  assert.equal(S.presenterReducer(s, { type: 'timerReset' }).timerSeconds, 0);
});

test('tool actions update the tool state; streams leave it unchanged', () => {
  const base = S.initialPresenterState();
  assert.equal(base.toolMode, null);
  assert.equal(base.zoomFactor, 2);
  assert.equal(base.toolColor, '#ef4444');

  assert.equal(S.presenterReducer(base, { type: 'setTool', tool: 'draw' }).toolMode, 'draw');
  assert.equal(S.presenterReducer(base, { type: 'setToolColor', color: '#22c55e' }).toolColor, '#22c55e');
  assert.equal(S.presenterReducer(base, { type: 'setToolSize', tool: 'pointer', size: 33 }).toolSizes.pointer, 33);
  // zoomFactor clamps to [1,4].
  assert.equal(S.presenterReducer(base, { type: 'setZoomFactor', factor: 9 }).zoomFactor, 4);

  // Streamed overlay messages must NOT change the canonical state (same reference).
  assert.equal(S.presenterReducer(base, { type: 'toolData', data: { tool: 'pointer', x: 1, y: 2 } }), base);
  assert.equal(S.presenterReducer(base, { type: 'clearDraw' }), base);
});

test('video: toggle flips playing, seek is a stream, navigation resets playing', () => {
  const base = S.beginPresentation('d', 1, 10);
  assert.equal(base.videoPlaying, false);
  const playing = S.presenterReducer(base, { type: 'videoToggle' });
  assert.equal(playing.videoPlaying, true);
  // Seek does not change canonical state.
  assert.equal(S.presenterReducer(playing, { type: 'videoSeek', time: 42 }), playing);
  // Any navigation stops playback (a new slide has its own video, or none).
  assert.equal(S.presenterReducer(playing, { type: 'next' }).videoPlaying, false);
  assert.equal(S.presenterReducer(playing, { type: 'navigate', slide: 5 }).videoPlaying, false);
});

test('the reducer never mutates its input', () => {
  const s = S.beginPresentation('d', 1, 5);
  const frozen = JSON.stringify(s);
  S.presenterReducer(s, { type: 'next' });
  S.presenterReducer(s, { type: 'blackScreen' });
  S.presenterReducer(s, { type: 'slideZoom', data: { scale: 2, originX: 1, originY: 1 } });
  assert.equal(JSON.stringify(s), frozen);
});
