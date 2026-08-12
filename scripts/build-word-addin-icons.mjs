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
};

await mkdir(output, { recursive: true });
for (const [name, source] of Object.entries(icons)) {
  for (const size of sizes) {
    await sharp(source).resize(size, size).png().toFile(path.join(output, `icon-${name}-${size}.png`));
  }
}

console.log(`[word-addin] Built ${Object.keys(icons).length * sizes.length} action icons in ${path.relative(root, output)}`);
