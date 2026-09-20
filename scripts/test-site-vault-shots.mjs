/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

The vault windows on the home page. Each scene used to draw an app view with SVG
and CSS; it now shows the real thing — the screenshots the README ships — inside
a window frame whose three controls are the desktop's own colours. A vault with
more than one view carries them all and steps through them with arrows.

These checks pin what a visitor gets: real images that exist in the published
tree, the same set the mirror script produces, a window that looks like a window,
and carousel controls that are only there when there is something to step to.
*/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SHOT_HEIGHT, SHOT_WIDTH, SITE_SHOTS } from './build-site-screenshots.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'site');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const readSite = (relative) => fs.readFileSync(path.join(site, relative), 'utf8');

const home = read('site/index.html');
const css = read('site/assets/css/home.css');

/* One chunk per vault scene, so a check on one window cannot accidentally count
   another scene's markup. Splitting on the section tag rather than on comments
   keeps this reading the structure the browser sees, not the editor's notes. */
const scenes = home
  .split('<section class="scene"')
  .slice(1)
  .map((chunk) => chunk.slice(0, chunk.indexOf('</section>')));
const windows = scenes
  .filter((scene) => scene.includes('<div class="frame" data-shots>'))
  .map((scene) => {
    const vault = scene.match(/<div class="frame-bar"><i><\/i><i><\/i><i><\/i><span>Nodus Research · ([^<]+)<\/span>/)?.[1];
    const figures = [...scene.matchAll(/<figure class="(shot[^"]*)"[^>]*>([\s\S]*?)<\/figure>/g)].map((match) => {
      const block = match[2];
      const image = block.match(/<img src="([^"]+)" width="(\d+)" height="(\d+)"[^>]*alt="([^"]*)"/);
      return {
        classes: match[1],
        ariaHidden: /aria-hidden="true"/.test(match[0]),
        src: image?.[1],
        width: Number(image?.[2]),
        height: Number(image?.[3]),
        alt: image?.[4],
        text: block.match(/<span class="shot-text">([\s\S]*?)<\/span>/)?.[1],
        step: block.match(/<span class="shot-step">([^<]+)<\/span>/)?.[1],
        lazy: /\bloading="lazy"/.test(block),
        async: /\bdecoding="async"/.test(block),
      };
    });
    return {
      scene,
      vault,
      figures,
      arrows: [...scene.matchAll(/<button class="shot-arrow (\w+)"([^>]*)>/g)].map((match) => ({
        side: match[1],
        attributes: match[2],
      })),
      shotsLabel: scene.match(/<div class="shots"[^>]*aria-label="([^"]+)"/)?.[1],
      carouselRole: /<div class="shots"[^>]*aria-roledescription="carousel"/.test(scene),
    };
  });

test('every main vault scene shows a window of real screenshots', () => {
  assert.deepEqual(
    windows.map((window) => window.vault),
    ['Academic vault', 'Teaching vault', 'Study vault', 'Databases vault'],
    'the four vault scenes each carry a window, in the order they appear on the page',
  );

  for (const window of windows) {
    assert.ok(window.figures.length > 0, `${window.vault}: the window holds at least one screenshot`);
    // Only the window that actually steps through views calls itself a carousel.
    if (window.figures.length > 1) {
      assert.ok(window.carouselRole, `${window.vault}: a window you can step through says so`);
      assert.ok(window.shotsLabel, `${window.vault}: the carousel has a label for screen readers`);
    } else {
      assert.ok(!window.carouselRole, `${window.vault}: one screenshot is not a carousel`);
      assert.equal(window.shotsLabel, undefined, `${window.vault}: a single view needs no carousel label`);
    }
    for (const figure of window.figures) {
      assert.match(figure.src ?? '', /^assets\/screenshots\/[a-z-]+\.webp$/, `${window.vault}: ${figure.src} is a mirrored site asset`);
      assert.ok(!figure.src?.includes('docs/'), `${window.vault}: the page never reaches into repository documentation`);
      assert.ok(fs.existsSync(path.join(site, figure.src)), `${window.vault}: ${figure.src} exists in the published tree`);
      // A relative src would resolve against the page and copy the assets tree in
      // under the deploy; an absolute one would leave the site folder entirely.
      assert.ok(!figure.src?.startsWith('/') && !figure.src?.startsWith('..'), `${window.vault}: ${figure.src} is site-relative`);
      // The screenshots are read as text by anyone who cannot see them, and the
      // README's own description is what they get.
      assert.ok((figure.alt ?? '').length > 24, `${window.vault}: "${figure.alt}" describes what the screenshot shows`);
      assert.ok((figure.text ?? '').length > 20, `${window.vault}: the caption says what the view is`);
      assert.equal(figure.width, SHOT_WIDTH, `${window.vault}: the reserved width matches the mirrored file`);
      assert.equal(figure.height, SHOT_HEIGHT, `${window.vault}: the reserved height matches the mirrored file`);
      assert.ok(figure.async, `${window.vault}: screenshots decode off the main thread`);
    }
  }
});

test('the files on disk are exactly the ones the mirror script produces', () => {
  const referenced = new Set(windows.flatMap((window) => window.figures.map((figure) => figure.src)));
  const mirrored = SITE_SHOTS.map((shot) => `assets/screenshots/${shot.target}`);

  for (const target of mirrored) {
    assert.ok(referenced.has(target), `${target} is mirrored but no window shows it`);
  }
  for (const reference of referenced) {
    assert.ok(mirrored.includes(reference), `${reference} is shown but the mirror script does not produce it`);
  }

  for (const entry of fs.readdirSync(path.join(site, 'assets', 'screenshots'))) {
    if (entry === 'README.md') continue;
    assert.ok(mirrored.includes(`assets/screenshots/${entry}`), `site/assets/screenshots/${entry} is not shown anywhere`);
    const bytes = fs.statSync(path.join(site, 'assets', 'screenshots', entry)).size;
    assert.ok(bytes > 8_000, `${entry} looks empty (${bytes} bytes)`);
    // The README originals run 100-200 KB each. A 2x copy belongs in that range:
    // anything larger means the resize was skipped and the home page pays for it.
    assert.ok(bytes < 250_000, `${entry} is too heavy for the home page (${bytes} bytes)`);
  }

  for (const shot of SITE_SHOTS) {
    assert.ok(
      fs.existsSync(path.join(root, shot.source)),
      `${shot.source} is the original capture; the mirror cannot be rebuilt without it`,
    );
  }
});

test('the academic vault carries all five of its README views, and steps through them', () => {
  const academic = windows[0];
  assert.equal(academic.figures.length, 5, 'the academic window shows its five views');
  assert.deepEqual(
    academic.figures.map((figure) => figure.src),
    [
      'assets/screenshots/academic-demo.webp',
      'assets/screenshots/academic-theme-relations.webp',
      'assets/screenshots/academic-argument-map.webp',
      'assets/screenshots/academic-deep-research.webp',
      'assets/screenshots/academic-immersion.webp',
    ],
    'the order is the order the README introduces them in',
  );
  assert.deepEqual(
    academic.figures.map((figure) => figure.step),
    ['01 / 05', '02 / 05', '03 / 05', '04 / 05', '05 / 05'],
    'each view says where it sits in the set',
  );

  // The first view is the page's resting state: it is what a visitor sees before
  // any script runs, and what they keep if no script ever runs.
  assert.match(academic.figures[0].classes, /\bis-active\b/, 'the first view is the one that shows');
  assert.ok(!academic.figures[0].ariaHidden, 'the visible view is part of the page');
  for (const figure of academic.figures.slice(1)) {
    assert.ok(!figure.classes.includes('is-active'), 'only one view shows at a time');
    assert.ok(figure.ariaHidden, 'a view nobody can see is out of the accessibility tree');
    assert.ok(figure.lazy, 'the views behind the first load when the window reaches the screen');
  }

  assert.deepEqual(academic.arrows.map((arrow) => arrow.side).sort(), ['next', 'prev'], 'the window has both arrows');
  for (const arrow of academic.arrows) {
    assert.match(arrow.attributes, /\bhidden\b/, 'an arrow the script never lights up must not sit there inert');
    assert.match(arrow.attributes, /aria-label="[^"]+screenshot"/, 'each arrow says where it goes');
    assert.match(arrow.attributes, /data-shots-(prev|next)/, 'each arrow is a hook for the carousel');
  }
  assert.equal(
    (academic.scene.match(/<button class="shot-arrow[^>]*>[\s\S]*?<\/button>/g) ?? [])
      .filter((button) => button.includes('<svg')).length,
    2,
    'both arrows are drawn with an icon',
  );
});

test('every other main vault has the same five-view gallery as Academic', () => {
  for (const window of windows.slice(1)) {
    assert.equal(window.figures.length, 5, `${window.vault} has five useful views`);
    assert.equal(window.arrows.length, 2, `${window.vault} has previous and next controls`);
    assert.deepEqual(window.figures.map((figure) => figure.step), ['01 / 05', '02 / 05', '03 / 05', '04 / 05', '05 / 05']);
    assert.ok(window.figures[0].classes.includes('is-active'));
    for (const figure of window.figures.slice(1)) {
      assert.ok(figure.ariaHidden);
      assert.ok(figure.lazy);
    }
  }
});

test('the drawn app views left with the graphics they belonged to', () => {
  /* Matched as class names, not as words: "rubrics" is still the word the teaching
     scene uses for the real feature, and that copy is not going anywhere. */
  const drawn = ['graph-svg', 'grid-table', 'mark-pill', 'rubric', 'week', 'flash', 'db-cols', 'bars-axis', 'evidence'];
  for (const name of drawn) {
    assert.ok(!home.includes(`class="${name}`), `site/index.html no longer draws the ${name} view`);
    assert.ok(!css.includes(`.${name}`), `home.css no longer styles the ${name} view`);
  }
});

test('the window wears the three colours a desktop window wears', () => {
  // The order is the order the controls appear in: close, minimise, zoom.
  const controls = [
    ['1', '#ff5f57'],
    ['2', '#febc2e'],
    ['3', '#28c840'],
  ];
  for (const [position, colour] of controls) {
    assert.match(
      css,
      new RegExp(`\\.frame-bar i:nth-child\\(${position}\\)\\s*\\{\\s*background:\\s*${colour};`),
      `the ${position === '1' ? 'first' : position === '2' ? 'second' : 'third'} control is ${colour}`,
    );
  }
  assert.match(css, /\.frame-bar i \{[^}]*border-radius: 50%/, 'the controls are round');
  // The dot that used to be a grey placeholder must not still paint over them.
  assert.ok(!/\.frame-bar i \{[^}]*background: var\(--membrane-2\)/.test(css), 'the three controls are coloured, not grey');
});

test('the carousel is a row of screenshots that swaps in place, with real arrows', () => {
  const script = readSite('assets/js/vault-shots.js');
  assert.match(home, /<script src="assets\/js\/vault-shots\.js\?v=/, 'the page loads the carousel');
  assert.match(css, /\.shots \{ position: relative; display: grid;/, 'the views stack in one cell, so a swap cannot shift the layout');
  assert.match(css, /\.shot\.is-active \{ opacity: 1;/, 'the current view is the opaque one');
  assert.match(css, /\.shot img \{[^}]*aspect-ratio: 16 \/ 10/, 'every screenshot keeps the 16:10 window it was captured in');
  // The screenshot is what the window is for. A caption laid over it — the scrim
  // that came first — hid a strip of the app on every view, so the caption is a
  // bar under the image and nothing is drawn on top of the shot itself.
  assert.match(css, /\.shot figcaption \{[^}]*flex: 1 1 auto/, 'the caption is in the flow, under the image');
  assert.doesNotMatch(css, /\.shot figcaption \{[^}]*position: absolute/, 'the caption is not laid over the screenshot');
  assert.doesNotMatch(css, /\.shot figcaption \{[^}]*linear-gradient/, 'no scrim darkens the bottom of the screenshot');
  // `hidden` is how the markup keeps the arrows out of a script-less page, and
  // display: grid would otherwise beat the browser's own [hidden] rule.
  assert.match(css, /\.shot-arrow\[hidden\] \{ display: none; \}/, 'a hidden arrow is really hidden');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.shot \{ transition: none; \}/, 'the swap respects reduced motion');

  // Wrapping in both directions, so neither end is a dead end.
  assert.match(script, /index = \(target \+ slides\.length\) % slides\.length/, 'the carousel wraps around');
  assert.match(script, /previous\.hidden = false/, 'the arrows appear only once the carousel is live');
  assert.match(script, /if \(slides\.length < 2 \|\| !previous \|\| !next\) return;/, 'a single view never becomes a carousel');
  assert.match(script, /event\.key === 'ArrowLeft'/, 'the left arrow key steps back');
  assert.match(script, /event\.key === 'ArrowRight'/, 'the right arrow key steps forward');
  // A swipe must not fire on a vertical drag: that is the page being scrolled.
  assert.match(script, /Math\.abs\(dx\) < Math\.abs\(dy\)\) return;/, 'a scroll is not a swipe');
});
