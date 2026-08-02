// Draw the iOS app icon from shared/nodusMark.json, so it cannot drift from the in-app mark.
//
// The desktop rasterises its dock icon from the same numbers (src/dockIcon.ts). Doing it here
// too means the plate inset, the corner radius and the glyph scale are one source of truth
// rather than a PNG somebody exported once and nobody can regenerate.
//
//   node scripts/ios-app-icon.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mark = JSON.parse(fs.readFileSync(path.join(repoRoot, 'shared/nodusMark.json'), 'utf8'));
const outputDir = path.join(repoRoot, 'ios/Nodus/Assets.xcassets/AppIcon.appiconset');

const SIZE = 1024;
const { viewBoxSize, plateInsetRatio, plateRadiusRatio, markScaleRatio,
        strokeWidth, nodeRadius, leftX, rightX, topY, bottomY, gradient } = mark;

// The ink, not the viewBox: the round caps and the corner nodes paint half a stroke past the
// vertices, so fitting the box would leave the glyph small and off-centre inside the plate.
const ink = {
  x: leftX - nodeRadius,
  y: topY - nodeRadius,
  width: (rightX - leftX) + nodeRadius * 2,
  height: (bottomY - topY) + nodeRadius * 2,
};

const plateInset = SIZE * plateInsetRatio;
const plateSize = SIZE - plateInset * 2;
const plateRadius = SIZE * plateRadiusRatio;

// Fit the ink into the share of the plate the mark is allowed to occupy.
const markBox = plateSize * markScaleRatio;
const scale = Math.min(markBox / ink.width, markBox / ink.height);
const originX = SIZE / 2 - (ink.x + ink.width / 2) * scale;
const originY = SIZE / 2 - (ink.y + ink.height / 2) * scale;
const at = (x, y) => `${(originX + x * scale).toFixed(2)} ${(originY + y * scale).toFixed(2)}`;
const point = (x, y) => ({ x: originX + x * scale, y: originY + y * scale });

const nodes = [
  { x: leftX, y: bottomY, fill: '#a78bfa' },
  { x: leftX, y: topY, fill: '#ddd6fe' },
  { x: rightX, y: bottomY, fill: '#8b5cf6' },
  { x: rightX, y: topY, fill: '#7c3aed' },
];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="plate" x1="0" y1="0" x2="${SIZE}" y2="${SIZE}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#241a44"/>
      <stop offset="0.55" stop-color="#141026"/>
      <stop offset="1" stop-color="#0a0912"/>
    </linearGradient>
    <linearGradient id="mark" x1="${point(gradient.x1, gradient.y1).x}" y1="${point(gradient.x1, gradient.y1).y}" x2="${point(gradient.x2, gradient.y2).x}" y2="${point(gradient.x2, gradient.y2).y}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ddd6fe"/>
      <stop offset="0.45" stop-color="#a78bfa"/>
      <stop offset="1" stop-color="#7c3aed"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.42" r="0.62">
      <stop offset="0" stop-color="#7c3aed" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#7c3aed" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="url(#plate)"/>
  <rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="url(#glow)"/>

  <path d="M ${at(leftX, bottomY)} L ${at(leftX, topY)} L ${at(rightX, bottomY)} L ${at(rightX, topY)}"
        fill="none" stroke="url(#mark)" stroke-width="${(strokeWidth * scale).toFixed(2)}"
        stroke-linecap="round" stroke-linejoin="round"/>
${nodes.map((node) => {
  const centre = point(node.x, node.y);
  return `  <circle cx="${centre.x.toFixed(2)}" cy="${centre.y.toFixed(2)}" r="${(nodeRadius * scale).toFixed(2)}" fill="${node.fill}"/>`;
}).join('\n')}
</svg>
`;

fs.mkdirSync(outputDir, { recursive: true });
const svgPath = path.join(outputDir, 'icon.svg');
fs.writeFileSync(svgPath, svg);

// iOS 18+ wants one 1024 source and derives the rest; a Contents.json that names a single
// universal image is all the asset catalogue needs.
execFileSync('rsvg-convert', ['-w', String(SIZE), '-h', String(SIZE), '-o', path.join(outputDir, 'icon-1024.png'), svgPath]);
fs.unlinkSync(svgPath);

fs.writeFileSync(path.join(outputDir, 'Contents.json'), `${JSON.stringify({
  images: [{ filename: 'icon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }],
  info: { author: 'xcode', version: 1 },
}, null, 2)}\n`);

// The launch screen's background, so the first frame is the icon's plate rather than white.
const colorsDir = path.join(repoRoot, 'ios/Nodus/Assets.xcassets/LaunchBackground.colorset');
fs.mkdirSync(colorsDir, { recursive: true });
fs.writeFileSync(path.join(colorsDir, 'Contents.json'), `${JSON.stringify({
  colors: [
    {
      color: { 'color-space': 'srgb', components: { alpha: '1.000', blue: '0x12', green: '0x09', red: '0x0A' } },
      idiom: 'universal',
    },
    {
      appearances: [{ appearance: 'luminosity', value: 'dark' }],
      color: { 'color-space': 'srgb', components: { alpha: '1.000', blue: '0x12', green: '0x09', red: '0x0A' } },
      idiom: 'universal',
    },
  ],
  info: { author: 'xcode', version: 1 },
}, null, 2)}\n`);

fs.writeFileSync(path.join(repoRoot, 'ios/Nodus/Assets.xcassets/Contents.json'), `${JSON.stringify({
  info: { author: 'xcode', version: 1 },
}, null, 2)}\n`);

console.log(`Wrote ${path.relative(repoRoot, path.join(outputDir, 'icon-1024.png'))}`);
