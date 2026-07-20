// F7 — PDF Presenter performance audit. Proves that a several-hundred-page deck does
// NOT collapse the app, by MEASURING WORK (renders launched, live canvases, render
// concurrency) rather than wall-clock ms — the harness landmine is that parallel
// tests make wall time lie. The two memory-bounding mechanisms are exercised
// headlessly against a synthetic 400-page document with a minimal DOM shim:
//   1. the lazy thumbnail engine (src/lib/presenter/thumbSession.ts): only visible
//      pages render, at most THUMB_RENDER_CONCURRENCY at a time, and offscreen
//      canvases are released (backing store freed).
//   2. the fitted slide renderer (src/lib/presenter/renderSlide.ts): rapid
//      navigation cancels superseded renders, so holding an arrow key does not queue
//      hundreds of heavy pdfjs renders.
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
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-presenter-perf-'));

function bundle(entry) {
  const out = path.join(outDir, `${path.basename(entry).replace(/\W+/g, '_')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, entry), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${out}`],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  return require(out);
}

const tick = () => new Promise((r) => setImmediate(r));
async function flush(n = 6) {
  for (let i = 0; i < n; i++) await tick();
}

// ── Minimal DOM shim (only what the two modules touch) ────────────────────────
class FakeCtx {
  clearRect() {}
  drawImage() {}
}
class FakeCanvas {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.dataset = {};
    this.style = {};
  }
  getContext() {
    return new FakeCtx();
  }
}
globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
globalThis.document = { createElement: () => new FakeCanvas() };

// A controllable IntersectionObserver: records the callback + observed elements so
// the test can drive intersection deterministically.
let ioCallback = null;
globalThis.IntersectionObserver = class {
  constructor(cb) {
    ioCallback = cb;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
};
function fire(entries) {
  ioCallback?.(entries);
}
function entryFor(el, intersecting, offscreen = false) {
  const rootBounds = { top: 0, bottom: 1000 };
  const boundingClientRect = offscreen ? { top: 5000, bottom: 5200 } : { top: 100, bottom: 300 };
  return { target: el, isIntersecting: intersecting, rootBounds, boundingClientRect };
}

const { createThumbSession } = bundle('src/lib/presenter/thumbSession.ts');
const { FittedSlideRenderer } = bundle('src/lib/presenter/renderSlide.ts');

test.after(() => rm(outDir, { recursive: true, force: true }));

test('thumbnails: opening a 400-page deck renders only visible pages, ≤2 at a time', async () => {
  const N = 400;
  const getPaged = new Set();
  let renderCount = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const pending = [];

  const doc = {
    numPages: N,
    getPage: async (n) => {
      getPaged.add(n);
      return {
        getViewport: () => ({ width: 1600, height: 900 }),
        render: () => {
          renderCount += 1;
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          let resolveOuter;
          const promise = new Promise((resolve) => {
            resolveOuter = () => {
              inFlight -= 1;
              resolve();
            };
          });
          pending.push(resolveOuter);
          return { promise };
        },
        cleanup: () => {},
      };
    },
  };

  const container = { innerHTML: '', appendChild() {} };
  const elements = [];
  createThumbSession({
    container,
    scrollRoot: null,
    doc,
    pageCount: N,
    scale: 0.5,
    buildItem: (pageNum) => {
      const canvas = new FakeCanvas();
      const element = { dataset: {}, canvasRef: canvas };
      elements.push({ pageNum, element, canvas });
      return { element, canvas };
    },
  });

  // Nothing is visible yet → nothing rendered (the whole point of lazy loading).
  await flush();
  assert.equal(renderCount, 0, 'no page renders before anything is visible');

  // Make the first 20 tiles visible. Only ~concurrency should start immediately.
  fire(elements.slice(0, 20).map((e) => entryFor(e.element, true)));
  await flush();
  assert.ok(maxInFlight <= 2, `never more than 2 concurrent renders (saw ${maxInFlight})`);
  assert.equal(renderCount, 2, 'exactly the concurrency limit starts; the rest queue');

  // Drain the queue one render at a time; the cap must hold throughout.
  let guard = 0;
  while (pending.length && guard < N * 2) {
    pending.shift()();
    await flush(2);
    guard += 1;
  }
  assert.ok(maxInFlight <= 2, `concurrency cap held while draining (max ${maxInFlight})`);
  assert.equal(getPaged.size, 20, 'only the 20 visible pages were ever fetched — not 400');
  assert.ok(renderCount <= 20, `only visible pages rendered (${renderCount}), not the whole deck`);
});

test('thumbnails: canvases are released (freed) once they scroll far offscreen', async () => {
  const N = 300;
  const doc = {
    numPages: N,
    getPage: async () => ({
      getViewport: () => ({ width: 1600, height: 900 }),
      render: () => ({ promise: Promise.resolve() }),
      cleanup: () => {},
    }),
  };
  const container = { innerHTML: '', appendChild() {} };
  const byPage = new Map();
  createThumbSession({
    container,
    doc,
    pageCount: N,
    scale: 0.5,
    buildItem: (pageNum) => {
      const canvas = new FakeCanvas();
      const element = { dataset: {} };
      byPage.set(pageNum, { element, canvas });
      return { element, canvas };
    },
  });

  // Render pages 1..10, then scroll them far away so they should be released.
  fire([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((p) => entryFor(byPage.get(p).element, true)));
  await flush();
  // A rendered canvas has a non-zero backing store...
  assert.ok(byPage.get(1).canvas.width > 0, 'a visible thumbnail has a real canvas');
  // ...until it scrolls far offscreen, when it is sized back to 0×0 (memory freed).
  fire([1, 2, 3, 4, 5].map((p) => entryFor(byPage.get(p).element, false, true)));
  await flush();
  for (const p of [1, 2, 3, 4, 5]) {
    assert.equal(byPage.get(p).canvas.width, 0, `offscreen thumbnail ${p} released its canvas`);
    assert.equal(byPage.get(p).canvas.height, 0);
  }
});

test('slide render: 50 rapid navigations collapse to a single heavy render (last wins)', async () => {
  const gates = [];
  let heavyRenders = 0;
  let getPageCalls = 0;
  const doc = {
    numPages: 500,
    getPage: async () => {
      getPageCalls += 1;
      await new Promise((resolve) => gates.push(resolve)); // hold until released
      return {
        getViewport: () => ({ width: 1600, height: 900 }),
        render: () => {
          heavyRenders += 1;
          return { promise: Promise.resolve() };
        },
        cleanup: () => {},
      };
    },
  };
  const canvas = new FakeCanvas();
  const container = { clientWidth: 1280, clientHeight: 720 };
  const renderer = new FittedSlideRenderer(canvas, container);

  // Fire 50 navigations before any getPage resolves (simulates a held arrow key).
  const runs = [];
  for (let i = 1; i <= 50; i += 1) runs.push(renderer.render(doc, i));
  await flush();
  assert.equal(getPageCalls, 50, 'each navigation requested its page');
  assert.equal(heavyRenders, 0, 'nothing rendered yet — all are awaiting their page');

  // Release every gate: only the most recent generation should survive the check.
  gates.forEach((resolve) => resolve());
  await Promise.allSettled(runs);
  await flush();
  assert.equal(heavyRenders, 1, 'only the last navigation runs a heavy render; the other 49 cancel');
});
