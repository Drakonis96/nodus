import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(scriptDir, '..');
const buildDir = join(rootDir, 'build');

mkdirSync(buildDir, { recursive: true });

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const s = size / 1024;

  const bg = ctx.createLinearGradient(128 * s, 96 * s, 900 * s, 940 * s);
  bg.addColorStop(0, '#15131f');
  bg.addColorStop(0.52, '#111118');
  bg.addColorStop(1, '#1d1830');
  drawRoundedRect(ctx, 64 * s, 64 * s, 896 * s, 896 * s, 212 * s);
  ctx.fillStyle = bg;
  ctx.fill();

  ctx.strokeStyle = 'rgba(196, 181, 253, 0.18)';
  ctx.lineWidth = 2 * s;
  ctx.stroke();

  const stroke = ctx.createLinearGradient(240 * s, 210 * s, 795 * s, 810 * s);
  stroke.addColorStop(0, '#ddd6fe');
  stroke.addColorStop(0.46, '#a78bfa');
  stroke.addColorStop(1, '#7c3aed');
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 86 * s;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(300 * s, 356 * s);
  ctx.bezierCurveTo(418 * s, 232 * s, 606 * s, 232 * s, 724 * s, 356 * s);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(300 * s, 668 * s);
  ctx.bezierCurveTo(420 * s, 792 * s, 604 * s, 792 * s, 724 * s, 668 * s);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(300 * s, 356 * s);
  ctx.bezierCurveTo(404 * s, 500 * s, 596 * s, 524 * s, 724 * s, 668 * s);
  ctx.stroke();

  const nodes = [
    [300, 356, '#c4b5fd'],
    [724, 356, '#a78bfa'],
    [300, 668, '#a78bfa'],
    [724, 668, '#7c3aed'],
  ];

  for (const [x, y, color] of nodes) {
    ctx.beginPath();
    ctx.arc(x * s, y * s, 82 * s, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8, 7, 14, 0.42)';
    ctx.fill();
  }
  for (const [x, y, color] of nodes) {
    ctx.beginPath();
    ctx.arc(x * s, y * s, 66 * s, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc((x - 18) * s, (y - 22) * s, 18 * s, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';
    ctx.fill();
  }

  return canvas.toBuffer('image/png');
}

function makeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = Buffer.alloc(images.length * 16);
  let offset = 6 + entries.length;
  for (let i = 0; i < images.length; i += 1) {
    const { size, buffer } = images[i];
    const entryOffset = i * 16;
    entries.writeUInt8(size >= 256 ? 0 : size, entryOffset);
    entries.writeUInt8(size >= 256 ? 0 : size, entryOffset + 1);
    entries.writeUInt8(0, entryOffset + 2);
    entries.writeUInt8(0, entryOffset + 3);
    entries.writeUInt16LE(1, entryOffset + 4);
    entries.writeUInt16LE(32, entryOffset + 6);
    entries.writeUInt32LE(buffer.length, entryOffset + 8);
    entries.writeUInt32LE(offset, entryOffset + 12);
    offset += buffer.length;
  }

  return Buffer.concat([header, entries, ...images.map((image) => image.buffer)]);
}

writeFileSync(join(buildDir, 'icon.png'), drawIcon(1024));

const iconsetDir = join(buildDir, 'icon.iconset');
rmSync(iconsetDir, { recursive: true, force: true });
mkdirSync(iconsetDir, { recursive: true });

const macImages = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png'],
];
for (const [size, name] of macImages) {
  writeFileSync(join(iconsetDir, name), drawIcon(size));
}

if (process.platform === 'darwin') {
  execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', join(buildDir, 'icon.icns')], { stdio: 'inherit' });
} else if (!existsSync(join(buildDir, 'icon.icns'))) {
  console.warn('iconutil is only available on macOS; build/icon.icns was not generated.');
}
rmSync(iconsetDir, { recursive: true, force: true });

const icoImages = [16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, buffer: drawIcon(size) }));
writeFileSync(join(buildDir, 'icon.ico'), makeIco(icoImages));

console.log('Generated build/icon.png, build/icon.icns and build/icon.ico');
