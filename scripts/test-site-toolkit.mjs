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

test('the tools under the stage turn like a ring, one card focused', () => {
  assert.equal(toolkit.match(/<div class="tool-cards reveal">/g).length, 1, 'the row is one element, and it is the thing that fades in');
  assert.equal(toolkit.match(/<article class="card lit tool-card"/g).length, 5, 'with the five tools in it');
  // The cards must NOT carry .reveal: its `transform: none` beats the ring's
  // transform, and the ring would paint all five cards on top of each other.
  assert.equal(toolkit.match(/<article class="card lit tool-card reveal"/g), null, 'a card carries no reveal of its own');

  // home.js keeps the signed distance to the middle on each card; the CSS reads it.
  assert.match(css, /\.tool-cards \{[^}]*position: relative;/, 'the ring positions its cards');
  assert.match(css, /\.tool-cards \{[^}]*perspective: 1500px;/, 'and has depth');
  assert.match(css, /\.tool-cards \{[^}]*overflow: hidden;/, 'the waiting cards are clipped, so the page never scrolls sideways');
  assert.match(css, /\.tool-cards \{[^}]*margin-inline: calc\(var\(--gut, 24px\) \* -1\);/, 'the clip happens out in the page margins, where the look wants it');
  assert.match(css, /\.tool-cards \.tool-card \{[^}]*position: absolute;/, 'a card is placed by the ring, not by the flow');
  assert.match(css, /\.tool-cards \.tool-card \{[^}]*transform:\s*translateX\(calc\(var\(--d, 0\) \* var\(--slot, 296px\)\)\)/, 'its distance to the middle moves it');
  assert.match(css, /\.tool-cards \.tool-card \{[^}]*opacity: var\(--alpha, 1\);/, 'and how far it is fades it');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.tool-cards \.tool-card \{ transition: none; \}/, 'the turning stops for reduced motion');

  assert.match(script, /function tools\(\)/, 'home.js turns the ring');
  assert.match(script, /if \(distance > cards\.length \/ 2\) distance -= cards\.length;/, 'distance is measured the short way round');
  assert.match(script, /active = \(active \+ by \+ cards\.length\) % cards\.length;/, 'so stepping past the last card arrives at the first');
  assert.match(script, /if \(Math\.abs\(dx\) < 40\) return;/, 'a drag has to be meant before it turns the ring');
  assert.match(script, /const index = cards\.indexOf\(card\);\s*if \(index === active\) return;/, 'clicking a waiting card brings it to the middle');
  assert.match(script, /if \(moved > 6\) \{\s*event\.preventDefault\(\)/, 'and the click that ended a drag does not count');
  // Capture must wait for the drag to start: capturing on pointerdown retargets the
  // click that ends a plain press to the ring, and no card under it ever hears one.
  const press = script.slice(script.indexOf("addEventListener('pointerdown'"), script.indexOf("addEventListener('pointermove'"));
  assert.equal(/setPointerCapture/.test(press), false, 'a plain press does not capture the pointer');
  const move = script.slice(script.indexOf("addEventListener('pointermove'"), script.indexOf('const settle'));
  assert.match(move, /if \(moved <= 6 \|\| ring\.classList\.contains\('is-dragging'\)\) return;/, 'the drag is declared only once it has moved');
  assert.match(move, /setPointerCapture\(event\.pointerId\)/, 'and the pointer is captured for the drag, not for the press');
  assert.match(script, /event\.key === 'ArrowLeft'[\s\S]{0,90}event\.key === 'ArrowRight'/, 'the arrow keys turn it');
  assert.match(script, /ring\.addEventListener\('wheel'/, 'so does a sideways wheel');
  // One trackpad swipe is dozens of wheel events plus a tail of inertia: it turns
  // the ring once, and a click during that tail still lands where it was aimed.
  assert.match(script, /if \(Math\.abs\(event\.deltaX\) <= Math\.abs\(event\.deltaY\)\) return;/, 'a vertical wheel stays a page scroll');
  assert.match(script, /if \(Math\.abs\(wheelTotal\) < WHEEL_STEP\) return;/, 'a sideways gesture has to pass a threshold to count');
  assert.match(script, /forgetWheel\(\);\s*wheelBlocked = Date\.now\(\) \+ WHEEL_QUIET;\s*step\(by\);/, 'and then the rest of the gesture is its tail, not a second turn');
  assert.match(script, /if \(Date\.now\(\) < wheelBlocked\) \{ forgetWheel\(\); return; \}/, 'a gesture still in flight cannot turn it again');
  assert.match(script, /forgetWheel\(\);\s*wheelBlocked = Date\.now\(\) \+ 400;\s*step\(index - active\);/, 'a click jumps straight to its card and ignores the trackpad tail');
  assert.match(script, /cards\.map\(\(card\) => card\.offsetHeight\)/, 'the ring is as tall as its tallest card');
  assert.match(script, /function place\(\) \{[\s\S]{0,200}cards\.forEach/, 'every card is placed from one table of distances');
  assert.equal(/setInterval|autoplay/i.test(script), false, 'and nothing turns it on its own');
  assert.match(script, /opening\(\);\s*stage\(\);\s*tools\(\);/, 'the ring is wired on load');
});
