import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(scriptDir, '..');
const buildDir = join(rootDir, 'build');
const markGeometry = JSON.parse(readFileSync(join(rootDir, 'shared', 'nodusMark.json'), 'utf8'));

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

  // This static fallback and the renderer's live vault-coloured icon consume
  // the same normalized geometry. macOS can therefore fall back to the bundled
  // icon without changing the Nodus mark's silhouette or apparent size.
  const inset = size * markGeometry.plateInsetRatio;
  const plateSize = size - inset * 2;
  drawRoundedRect(ctx, inset, inset, plateSize, plateSize, plateSize * markGeometry.plateRadiusRatio);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.10)';
  ctx.lineWidth = size * 0.006;
  ctx.stroke();

  const accent = '#6366f1';
  const light = shade(accent, 0.55);
  const dark = shade(accent, -0.4);
  const markSize = plateSize * markGeometry.markScaleRatio;
  const markOrigin = inset + (plateSize - markSize) / 2;
  const markUnit = markSize / markGeometry.viewBoxSize;
  const markX = (x) => markOrigin + x * markUnit;
  const markY = (y) => markOrigin + y * markUnit;
  const stroke = ctx.createLinearGradient(
    markX(markGeometry.gradient.x1),
    markY(markGeometry.gradient.y1),
    markX(markGeometry.gradient.x2),
    markY(markGeometry.gradient.y2),
  );
  stroke.addColorStop(0, light);
  stroke.addColorStop(0.45, accent);
  stroke.addColorStop(1, dark);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = markGeometry.strokeWidth * markUnit;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(markX(markGeometry.leftX), markY(markGeometry.bottomY));
  ctx.lineTo(markX(markGeometry.leftX), markY(markGeometry.topY));
  ctx.lineTo(markX(markGeometry.rightX), markY(markGeometry.bottomY));
  ctx.lineTo(markX(markGeometry.rightX), markY(markGeometry.topY));
  ctx.stroke();

  const nodes = [
    [markGeometry.leftX, markGeometry.topY, light],
    [markGeometry.leftX, markGeometry.bottomY, accent],
    [markGeometry.rightX, markGeometry.bottomY, shade(accent, -0.15)],
    [markGeometry.rightX, markGeometry.topY, dark],
  ];

  for (const [x, y, color] of nodes) {
    ctx.beginPath();
    ctx.arc(markX(x), markY(y), markGeometry.nodeRadius * markUnit, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  return canvas.toBuffer('image/png');
}

function clamp(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseHex(hex) {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function shade(hex, amount) {
  const target = amount >= 0 ? 255 : 0;
  const ratio = Math.abs(amount);
  return `#${parseHex(hex).map((channel) => clamp(channel + (target - channel) * ratio).toString(16).padStart(2, '0')).join('')}`;
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
