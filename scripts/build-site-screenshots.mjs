/*
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only

Mirrors the README screenshots the home page shows into the website's own asset
tree. The website is published from site/ alone (see build-pages-artifact.mjs),
so it cannot reach docs/screenshots at runtime: the window shown on the home page
has to be a copy that travels with the site.

The copy is derived, never hand-made. Run `npm run site:screenshots` after the
README images change and this script regenerates exactly the files the home page
references, from exactly the sources the README embeds.
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(repoRoot, 'docs', 'screenshots');
const targetDir = path.join(repoRoot, 'site', 'assets', 'screenshots');

/* The frames render at about 600 CSS px wide, so 1280 is a 2x copy: sharp on a
   laptop, no larger a download than the README's own JPEGs. Every source is
   1440x900, and every frame shows a 16:10 window, so nothing is ever cropped. */
export const SHOT_WIDTH = 1280;
export const SHOT_HEIGHT = 800;

/* One entry per screenshot the home page shows. A vault with several views
   carries all of them, in the order its scene's carousel steps through them. */
export const SITE_SHOTS = [
  { source: 'readme-academic-demo.jpg', target: 'academic-demo.webp' },
  { source: 'readme-academic-theme-relations.jpg', target: 'academic-theme-relations.webp' },
  { source: 'readme-academic-argument-map.jpg', target: 'academic-argument-map.webp' },
  { source: 'readme-academic-deep-research.jpg', target: 'academic-deep-research.webp' },
  { source: 'readme-academic-immersion.jpg', target: 'academic-immersion.webp' },
  { source: 'readme-teaching-demo.jpg', target: 'teaching-demo.webp' },
  { source: 'readme-study-demo.jpg', target: 'study-demo.webp' },
  { source: 'readme-databases-demo.jpg', target: 'databases-demo.webp' },
];

export async function buildSiteScreenshots({ root = repoRoot, quiet = false } = {}) {
  const from = path.join(root, 'docs', 'screenshots');
  const to = path.join(root, 'site', 'assets', 'screenshots');
  fs.mkdirSync(to, { recursive: true });

  const written = [];
  for (const { source, target } of SITE_SHOTS) {
    const input = path.join(from, source);
    const output = path.join(to, target);
    const image = sharp(input);
    const metadata = await image.metadata();
    if (metadata.width !== 1440 || metadata.height !== 900) {
      throw new Error(`${source} is ${metadata.width}x${metadata.height}; the site's frames assume the README's 1440x900 windows.`);
    }
    const buffer = await image
      .resize({ width: SHOT_WIDTH, height: SHOT_HEIGHT, fit: 'cover' })
      .webp({ quality: 80, effort: 5 })
      .toBuffer();
    fs.writeFileSync(output, buffer);
    written.push({ target, bytes: buffer.length });
    if (!quiet) {
      console.log(`site/assets/screenshots/${target}  ${(buffer.length / 1024).toFixed(0)} KB`);
    }
  }

  /* A file that no longer has a source would keep being served forever, so the
     folder is pruned back to this list rather than appended to. */
  const expected = new Set(SITE_SHOTS.map((shot) => shot.target));
  for (const entry of fs.readdirSync(to)) {
    if (entry === 'README.md' || expected.has(entry)) continue;
    fs.rmSync(path.join(to, entry));
    if (!quiet) console.log(`removed site/assets/screenshots/${entry} (no source left)`);
  }

  return written;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const written = await buildSiteScreenshots({ root: repoRoot });
  const total = written.reduce((sum, shot) => sum + shot.bytes, 0);
  console.log(`\n${written.length} screenshots mirrored from docs/screenshots (${(total / 1024).toFixed(0)} KB total).`);
  console.log(`The frames live in site/index.html; the sources are the images the README embeds.`);
}
