/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

The Toolkit section: the PDF Presenter hero, the projected slide the stage shows,
and the row of tools under it. These checks pin the three things a reader gets —
an entry with the same badge as the rest, a slide that looks like a Nodus deck
instead of a placeholder, and a single row that scrolls instead of wrapping.
*/
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const home = read('site/index.html');
const css = read('site/assets/css/home.css');
const script = read('site/assets/js/home.js');

const toolkit = home.slice(home.indexOf('<section id="tools"'), home.indexOf('</section>', home.indexOf('<section id="tools"')));

test('the PDF Presenter wears the same badge as the tools under it', () => {
  const hero = toolkit.slice(toolkit.indexOf('<article class="tool-hero'));
  assert.match(hero, /<span class="pic"><svg viewBox="0 0 24 24">/, 'the hero carries an icon');
  assert.match(hero, /<span class="pic">[\s\S]{0,220}?<\/svg><\/span>\s*<span class="kicker">Presenting<\/span>/, 'the icon sits above its kicker');
  assert.match(hero, /<h3>PDF Presenter<\/h3>/);
  // The tools under it are the reference: same badge, same glyph weight.
  assert.equal(toolkit.match(/<span class="pic">/g).length, 6, 'the hero and the five tool cards all carry one');
  assert.match(css, /\.tool-hero \.pic \{[^}]*width: 44px; height: 44px;/, 'the hero badge is the bigger one');
  assert.match(css, /\.tool-hero \.pic svg \{[^}]*stroke-width: 1\.7/, 'and draws its glyph like the rest');
});

test('the stage presents a Nodus cover instead of placeholder text', () => {
  const slide = toolkit.slice(toolkit.indexOf('id="stage-slide"'), toolkit.indexOf('class="stage-tools"'));
  assert.doesNotMatch(slide, /Your document, page by page/, 'the placeholder is gone');
  assert.match(slide, /<div class="slide-deck">/, 'the slide holds one deck the zoom tool can scale whole');
  assert.match(slide, /<img class="slide-mark" src="assets\/nodus-logo.svg"/, 'the cover carries the Nodus mark');
  assert.match(slide, /<strong>Nodus<\/strong>/, 'and the name');
  const points = [...slide.matchAll(/<li>([^<]+)<\/li>/g)].map((match) => match[1]);
  assert.equal(points.length, 3, 'three points, briefly');
  for (const point of points) assert.ok(point.length > 30 && point.length < 90, `"${point}" stays a line`);
  // The mascot is the app's own character, generated into the page, standing.
  assert.match(slide, /<!-- generated:nodi-cover:start -->[\s\S]*<!-- generated:nodi-cover:end -->/, 'the cover reserves the generated block');
  assert.match(slide, /<div class="slide-nodi" aria-hidden="true">\s*<svg class="nodi-svg" viewBox="0 0 270 300" width="270" height="300" data-state="idle"/, 'the character stands on it, and is decoration');
  assert.match(slide, /id="wns-char-bodyG"/, 'and it is the component the build script renders, not a drawing');
  assert.match(css, /\.stage-slide \{[^}]*background: #04050a;/, 'the projected slide is black');
  assert.match(css, /\.slide-nodi \.nodi-svg \{ height: clamp\(112px, 13vw, 176px\);/, 'the mascot is sized to the slide');
  // The stage still hands the tools something to act on.
  assert.match(slide, /id="stage-canvas"[\s\S]*class="stage-spot"[\s\S]*class="stage-laser"/, 'the drawing canvas, the spotlight and the laser are still there');
  assert.match(slide, /<span class="stage-page">Slide \d+ of \d+<\/span>/, 'and the deck still has its page label');
});

test('the tools under the stage are one row that scrolls', () => {
  assert.equal(toolkit.match(/<div class="tool-cards">/g).length, 1, 'one row, not a grid of them');
  assert.equal(toolkit.match(/<article class="card lit tool-card/g).length, 5, 'with the five tools in it');
  assert.match(css, /\.tool-cards \{[^}]*display: flex; flex-wrap: nowrap;/, 'the row never wraps');
  assert.match(css, /\.tool-cards \{[^}]*overflow-x: auto;/, 'so it scrolls sideways');
  assert.match(css, /\.tool-card \{ flex: 0 0 clamp\(232px, 31%, 320px\);/, 'each card keeps a width of its own');
  // Drag: the mouse gets the drag, the touch screen keeps its native scroll.
  assert.match(script, /function rail\(\)/, 'home.js drives the row');
  assert.match(script, /if \(event\.pointerType !== 'mouse' \|\| event\.button !== 0\) return;/, 'a drag is a left-button mouse gesture');
  assert.match(script, /row\.setPointerCapture\(event\.pointerId\);/, 'the drag survives leaving the row');
  assert.match(script, /if \(moved <= 6\) return;[\s\S]{0,80}event\.preventDefault\(\)/, 'a drag that ends on a card is not a click on it');
  assert.match(css, /\.tool-cards\.is-dragging \{ cursor: grabbing;/, 'and the cursor says so while it happens');
  assert.match(script, /opening\(\);\s*stage\(\);\s*rail\(\);/, 'the row is wired on load');
});
