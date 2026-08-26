import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(repoRoot, 'site/assets/social/nodus-research-og.png');

GlobalFonts.registerFromPath(path.join(repoRoot, 'site/assets/fonts/inter-latin.woff2'), 'Inter');
GlobalFonts.registerFromPath(path.join(repoRoot, 'site/assets/fonts/fraunces-latin.woff2'), 'Fraunces');

const [background, screenshot, logo] = await Promise.all([
  loadImage(path.join(repoRoot, 'scripts/assets/nodus-social-network-backdrop.png')),
  loadImage(path.join(repoRoot, 'docs/screenshots/02-graph.png')),
  loadImage(path.join(repoRoot, 'site/assets/nodus-logo.png')),
]);

const canvas = createCanvas(1200, 630);
const context = canvas.getContext('2d');

const cover = (image, x, y, width, height) => {
  const scale = Math.max(width / image.width, height / image.height);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  context.drawImage(
    image,
    (image.width - sourceWidth) / 2,
    (image.height - sourceHeight) / 2,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height,
  );
};

const roundedRect = (x, y, width, height, radius) => {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
};

cover(background, 0, 0, canvas.width, canvas.height);
const shade = context.createLinearGradient(0, 0, 780, 0);
shade.addColorStop(0, 'rgba(4, 3, 13, 0.18)');
shade.addColorStop(0.58, 'rgba(4, 3, 13, 0.42)');
shade.addColorStop(1, 'rgba(4, 3, 13, 0.08)');
context.fillStyle = shade;
context.fillRect(0, 0, canvas.width, canvas.height);

// Real Nodus product screenshot, clipped into a quiet card so the UI remains exact.
context.save();
context.shadowColor = 'rgba(1, 0, 10, 0.75)';
context.shadowBlur = 34;
context.shadowOffsetY = 18;
roundedRect(558, 112, 582, 364, 18);
context.fillStyle = '#f7f8fc';
context.fill();
context.restore();
context.save();
roundedRect(558, 112, 582, 364, 18);
context.clip();
cover(screenshot, 558, 112, 582, 364);
context.restore();
roundedRect(558, 112, 582, 364, 18);
context.strokeStyle = 'rgba(196, 181, 253, 0.68)';
context.lineWidth = 2;
context.stroke();

context.drawImage(logo, 66, 76, 74, 74);
context.fillStyle = '#ffffff';
context.font = '600 24px Inter';
context.fillText('Nodus Research', 156, 123);

context.fillStyle = '#c4b5fd';
context.font = '600 14px Inter';
context.letterSpacing = '2px';
context.fillText('OPEN SOURCE · LOCAL-FIRST', 68, 220);

context.fillStyle = '#ffffff';
context.font = '600 55px Fraunces';
context.fillText('Research that', 66, 292);
context.fillText('stays connected.', 66, 351);

context.fillStyle = '#d8d5e6';
context.font = '400 21px Inter';
context.fillText('Sources, ideas and evidence in one', 68, 406);
context.fillText('private academic workspace.', 68, 438);

context.fillStyle = '#9b96ac';
context.font = '500 15px Inter';
context.fillText('nodusresearch.com', 68, 552);

context.fillStyle = '#a78bfa';
context.fillRect(68, 524, 104, 3);

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, await canvas.encode('png'));
console.log(`Wrote ${path.relative(repoRoot, output)} (${canvas.width}x${canvas.height}).`);
