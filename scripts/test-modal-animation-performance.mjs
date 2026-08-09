import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');
const [avatar, classicCss, orbCss, whatsNew, startupUpdate, app, styles, main] = await Promise.all([
  read('src/components/nodi/NodiAvatar.tsx'),
  read('src/components/nodi/nodi.css'),
  read('src/components/nodi/nodiOrb.css'),
  read('src/components/WhatsNewModal.tsx'),
  read('src/components/StartupUpdateModal.tsx'),
  read('src/App.tsx'),
  read('src/index.css'),
  read('electron/main.ts'),
]);

test('cinematic modals bound the expensive Nodi SVG animation', () => {
  assert.match(avatar, /restAfterMs\?: number/);
  assert.match(avatar, /QUIESCENT\.has\(state\) \|\| restAfterMs !== undefined/);
  assert.match(avatar, /\[state, settled, reduceMotion, restAfterMs\]/);
  assert.match(whatsNew, /<NodiAvatar state="celebrating" height=\{205\} restAfterMs=\{2_400\} \/>/);
  assert.match(startupUpdate, /<NodiAvatar state=\{presentation\.nodiState\} height=\{162\} restAfterMs=\{2_400\} \/>/);
  assert.match(classicCss, /\.nodi-svg\.nodi-at-rest \* \{ animation-play-state: paused !important; \}/);
  assert.match(orbCss, /\.nodi-orb\.nodi-at-rest \* \{ animation-play-state: paused !important; \}/);
});

test('cinematic decoration finishes instead of repainting forever', () => {
  const whatsNewAurora = styles.match(/\.whats-new-aurora \{[^\n]+/u)?.[0] ?? '';
  const whatsNewConfetti = styles.match(/\.whats-new-confetti \{[^\n]+/u)?.[0] ?? '';
  const updateAurora = styles.match(/\.startup-update-aurora \{[^\n]+/u)?.[0] ?? '';
  assert.ok(whatsNewAurora && whatsNewConfetti && updateAurora);
  assert.doesNotMatch(whatsNewAurora, /infinite/);
  assert.doesNotMatch(whatsNewConfetti, /infinite/);
  assert.doesNotMatch(updateAurora, /infinite/);
});

test('closing the update modal removes its listener and progress is throttled', () => {
  assert.match(startupUpdate, /if \(!shouldShow \|\| !open\) return;/);
  assert.match(startupUpdate, /\[attempt, open, shouldShow\]/);
  assert.match(app, /!manualWhatsNewOpen && !updateSettled && <StartupUpdateModal/);
  assert.match(main, /const UPDATE_PROGRESS_MIN_INTERVAL_MS = 200;/);
  assert.match(main, /roundedPercent === lastDownloadProgressPercent/);
  assert.match(main, /now - lastDownloadProgressEmitAt < UPDATE_PROGRESS_MIN_INTERVAL_MS/);
});
