// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'word-addin', 'assets');
const sizes = [16, 32, 80];
const INK = '#171717';
const RED = '#dc2626';

function svg(content) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">${content}</g>
  </svg>`);
}

// These three glyphs deliberately reuse the exact paths from the corresponding
// task-pane tabs. Office requires raster ribbon assets, so only their rendering
// (black ink with the existing Nodus red accent) differs from the currentColor
// SVGs in taskpane.html. The complete original path stays intact; accentPath is
// only an optional colour overlay.
function sidebarIcon(pathData, accentPath = '') {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7">
      <path stroke="${INK}" d="${pathData}"/>
      ${accentPath ? `<path stroke="${RED}" d="${accentPath}"/>` : ''}
    </g>
  </svg>`);
}

const icons = {
  copilot: svg(`
    <path stroke="${INK}" stroke-width="6" d="M17 21h38a9 9 0 0 1 9 9v20a9 9 0 0 1-9 9H35L23 68v-9h-6a9 9 0 0 1-9-9V30a9 9 0 0 1 9-9Z"/>
    <circle fill="${INK}" stroke="none" cx="25" cy="40" r="3.5"/><circle fill="${INK}" stroke="none" cx="39" cy="40" r="3.5"/>
    <path stroke="${RED}" stroke-width="5" d="M59 8v14M52 15h14"/>
  `),
  citation: svg(`
    <path stroke="${INK}" stroke-width="7" d="M28 25H15v18h13v8c0 6-4 11-10 13M58 25H45v18h13v8c0 6-4 11-10 13"/>
    <path stroke="${RED}" stroke-width="5" d="M58 9v14M51 16h14"/>
  `),
  bibliography: svg(`
    <path stroke="${INK}" stroke-width="6" d="M10 17h21a9 9 0 0 1 9 9v40a9 9 0 0 0-9-9H10V17Zm60 0H49a9 9 0 0 0-9 9v40a9 9 0 0 1 9-9h21V17Z"/>
    <path stroke="${INK}" stroke-width="5" d="M18 30h13M18 41h13M49 30h13"/>
    <path stroke="${RED}" stroke-width="5" d="M49 42h13M49 51h13"/>
  `),
  refresh: svg(`
    <path stroke="${INK}" stroke-width="7" d="M65 33A27 27 0 0 0 19 22l-5 7M15 16l-1 13 13 1"/>
    <path stroke="${RED}" stroke-width="7" d="M15 47a27 27 0 0 0 46 11l5-7M65 64l1-13-13-1"/>
  `),
  preferences: svg(`
    <circle stroke="${INK}" stroke-width="6" cx="40" cy="40" r="17"/>
    <path stroke="${INK}" stroke-width="7" d="M40 9v9M40 62v9M9 40h9M62 40h9M18 18l7 7M55 55l7 7M62 18l-7 7M25 55l-7 7"/>
    <circle fill="${RED}" stroke="none" cx="40" cy="40" r="7"/>
  `),
  unlink: svg(`
    <path stroke="${INK}" stroke-width="7" d="m31 49-7 7a11 11 0 0 1-16-16l10-10a11 11 0 0 1 14-1M49 31l7-7a11 11 0 0 1 16 16L62 50a11 11 0 0 1-14 1"/>
    <path stroke="${INK}" stroke-width="6" d="m29 51 22-22"/>
    <path stroke="${RED}" stroke-width="7" d="M16 13l48 54"/>
  `),
  'ai-edit': sidebarIcon(
    'm14 4 1-2 1 2 2 1-2 1-1 2-1-2-2-1zM5 17l9-9 3 3-9 9H5zM12.5 9.5l3 3M18 16l.8-1.8.8 1.8 1.8.8-1.8.8-.8 1.8-.8-1.8-1.8-.8z',
    'm14 4 1-2 1 2 2 1-2 1-1 2-1-2-2-1zM18 16l.8-1.8.8 1.8 1.8.8-1.8.8-.8 1.8-.8-1.8-1.8-.8z',
  ),
  synonyms: sidebarIcon(
    'M4 5.5A2.5 2.5 0 0 1 6.5 3H11a2 2 0 0 1 2 2v16a2.5 2.5 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 21.5zM13 5a2 2 0 0 1 2-2h2M7 8h3M7 12h3M16 12h3M19 2l.5 1.5L21 4l-1.5.5L19 6l-.5-1.5L17 4l1.5-.5zM13 21a2.5 2.5 0 0 1 2-2h4a2 2 0 0 1 2 2v-9',
    'M19 2l.5 1.5L21 4l-1.5.5L19 6l-.5-1.5L17 4l1.5-.5z',
  ),
  chat: sidebarIcon('M20 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4zM8 9h8M8 13h5'),
};

await mkdir(output, { recursive: true });
for (const [name, source] of Object.entries(icons)) {
  for (const size of sizes) {
    await sharp(source).resize(size, size).png().toFile(path.join(output, `icon-${name}-${size}.png`));
  }
}

console.log(`[word-addin] Built ${Object.keys(icons).length * sizes.length} action icons in ${path.relative(root, output)}`);
