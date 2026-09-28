// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Builds the homepage hero figure for the "What Nodus is" section out of the app's own
 * components instead of a raster illustration: NodiOrb as the galaxy sphere, and the
 * classic Nodi leaning out from behind its upper-left rim, waving.
 *
 * Both are rendered here with the same React components the app ships, so the figure
 * can never drift from the mascot the user meets inside the product. The composition
 * lives in one SVG: the orb group paints first, then the character, masked by a disc
 * concentric with the sphere — which is what makes the body read as hidden behind the
 * glass while the head and raised arm stay in front of the orb's glow.
 *
 * Writes:
 *   site/index.html ................ the composed hero figure, and the standing character
 *                                    the Toolkit stage's cover shows, each between its
 *                                    own generated markers
 *   site/assets/css/what-nodi.css .. the two component stylesheets, copied verbatim
 *
 * Run: npm run site:what-nodi
 */
import { build } from 'esbuild';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML_PATH = path.join(root, 'site/index.html');
const CSS_PATH = path.join(root, 'site/assets/css/what-nodi.css');
const ORB_CSS_PATH = path.join(root, 'src/components/nodi/nodiOrb.css');
const CHAR_CSS_PATH = path.join(root, 'src/components/nodi/nodi.css');
const START = '<!-- generated:what-nodi:start -->';
const END = '<!-- generated:what-nodi:end -->';
/** The standing character on the Toolkit stage's cover, written the same way. */
const COVER_START = '<!-- generated:nodi-cover:start -->';
const COVER_END = '<!-- generated:nodi-cover:end -->';

/** Hue every cool colour in the orb derives from. The app defaults to Nodi's blue
 *  (210); the hero follows the violet of the illustration this figure replaces. */
const HUE = 240;
/** Where the character sits, in the orb's own viewBox units. Read off the
 *  illustration this figure replaces: the character's ball is 0.279 of the sphere's
 *  radius, its centre 1.145 radii out, 20° to the left of vertical, so about three
 *  quarters of it shows above the rim and the rest reads as hidden behind the glass. */
const CHAR_AT = { x: 78.1, y: 19.8, scale: 0.393 };
/** Disc the character disappears behind: the sphere (r 79) plus its rim glow. */
const MASK_RADIUS = 80;

const ALT =
  'Nodi, the Nodus mascot: a small smiling figure waving from behind a glossy violet orb that holds a constellation of connected nodes, ringed by orbiting satellites.';

/** The components render on their own; this only stitches them into the entry bundle. */
async function loadComponents() {
  const result = await build({
    stdin: {
      contents: [
        `export { Nodi } from './src/components/nodi/Nodi.tsx';`,
        `export { NodiOrb } from './src/components/nodi/NodiOrb.tsx';`,
      ].join('\n'),
      resolveDir: root,
      sourcefile: 'what-nodi-entry.tsx',
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    alias: { '@shared': path.join(root, 'shared') },
    // React stays external so the components and the renderer share one instance.
    external: ['react', 'react-dom', 'react-dom/server'],
  });
  const cacheDir = path.join(root, 'node_modules/.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const bundlePath = path.join(cacheDir, `what-nodi-${process.pid}.mjs`);
  fs.writeFileSync(bundlePath, result.outputFiles[0].text);
  try {
    return await import(`file://${bundlePath}`);
  } finally {
    fs.unlinkSync(bundlePath);
  }
}

const innerOf = (markup) =>
  markup
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .trim();

/** Replace whatever sits between two markers, and refuse to guess when one is gone. */
function betweenMarkers(html, start, end, replacement) {
  const from = html.indexOf(start);
  const to = html.indexOf(end);
  if (from === -1 || to === -1) throw new Error(`the markers ${start} / ${end} are missing from site/index.html`);
  return html.slice(0, from) + replacement + html.slice(to + end.length);
}

/** React namespaces its gradient/filter ids with useId(); two components rendered in
 *  one document would share a prefix and shadow each other's defs. */
function prefixIds(markup, probe, prefix) {
  const match = markup.match(new RegExp(`id="([^"]+)-${probe}"`));
  if (!match) throw new Error(`no ${probe} id in the rendered markup`);
  return markup.split(`${match[1]}-`).join(`${prefix}-`);
}

async function main() {
  const { Nodi, NodiOrb } = await loadComponents();

  const orb = prefixIds(innerOf(renderToStaticMarkup(React.createElement(NodiOrb, { state: 'idle', hue: HUE }))), 'sphereClip', 'wn-orb');
  const character = prefixIds(innerOf(renderToStaticMarkup(React.createElement(Nodi, { state: 'waving' }))), 'bodyClip', 'wn-char');
  // The same character standing on its own, for the cover of the presentation the
  // Toolkit stage plays. Its own prefix again: the two are different renders of one
  // component and would otherwise share every gradient and filter id.
  const standing = prefixIds(innerOf(renderToStaticMarkup(React.createElement(Nodi, { state: 'idle' }))), 'bodyClip', 'wns-char');

  const figure = [
    START,
    '    <!-- The app\'s own Nodi components, composed here: generated by',
    '         scripts/build-what-nodi.mjs (npm run site:what-nodi). Do not edit by hand. -->',
    `    <figure class="what-nodi">`,
    `      <svg class="what-nodi-figure" viewBox="0 0 320 340" role="img" aria-label="${ALT}">`,
    `        <g class="nodi-orb" data-state="idle" style="--nodi-hue:${HUE}deg">`,
    ...orb.split('\n').map((line) => `          ${line.trim()}`),
    '        </g>',
    `        <mask id="wn-peek" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="-40" y="-40" width="400" height="420">`,
    '          <rect x="-40" y="-40" width="400" height="420" fill="#fff"/>',
    `          <circle cx="160" cy="160" r="${MASK_RADIUS}" fill="#000"/>`,
    '        </mask>',
    // The mask lives on an untransformed wrapper: maskUnits="userSpaceOnUse" resolves
    // against the space in effect for the element that references the mask, so a
    // transform on that same element would redefine the disc in the wrong units.
    '        <g class="what-nodi-peek" mask="url(#wn-peek)">',
    `          <g class="what-nodi-char" transform="translate(${CHAR_AT.x} ${CHAR_AT.y}) scale(${CHAR_AT.scale})">`,
    `            <svg class="nodi-svg" viewBox="0 0 270 300" width="270" height="300" data-state="waving" role="img" aria-label="Nodi">`,
    ...character.split('\n').map((line) => `              ${line.trim()}`),
    '            </svg>',
    '          </g>',
    '        </g>',
    '      </svg>',
    '    </figure>',
    END,
  ].join('\n');

  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const replaced = betweenMarkers(html, START, END, figure);

  // The cover of the presentation the Toolkit stage shows: the character standing,
  // with nothing in front of it, sized and placed by the page's own stylesheet.
  const cover = [
    COVER_START,
    '          <!-- The app\'s own Nodi, standing on the cover of the presentation the',
    '               stage plays: generated by scripts/build-what-nodi.mjs. Do not edit by hand. -->',
    '          <div class="slide-nodi" aria-hidden="true">',
    '            <svg class="nodi-svg" viewBox="0 0 270 300" width="270" height="300" data-state="idle" focusable="false">',
    ...standing.split('\n').map((line) => `              ${line.trim()}`),
    '            </svg>',
    '          </div>',
    '          ' + COVER_END,
  ].join('\n');
  fs.writeFileSync(HTML_PATH, betweenMarkers(replaced, COVER_START, COVER_END, cover));

  const header = [
    '/* SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors',
    ' * SPDX-License-Identifier: AGPL-3.0-only',
    ' *',
    ' * The Nodi components, as the homepage hero figure uses them. Generated by',
    ' * scripts/build-what-nodi.mjs (npm run site:what-nodi): the two stylesheets below',
    ' * are verbatim copies of src/components/nodi/nodiOrb.css and nodi.css, so the',
    ' * figure on the site and the mascot in the app stay one thing. Do not edit by hand.',
    ' *',
    ' * Loaded only by the homepage. The demo pages load the ported orb inside nodi.js,',
    ' * and a page must never load both. */',
    '',
  ].join('\n');
  fs.writeFileSync(
    CSS_PATH,
    header + fs.readFileSync(ORB_CSS_PATH, 'utf8').trimEnd() + '\n\n' + fs.readFileSync(CHAR_CSS_PATH, 'utf8').trimEnd() + '\n',
  );

  const kb = (p) => Math.round(fs.statSync(p).size / 1024);
  console.log(`Nodi components: ${kb(HTML_PATH)} KB index.html, ${kb(CSS_PATH)} KB what-nodi.css`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
