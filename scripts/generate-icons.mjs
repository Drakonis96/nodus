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

  // Static fallback matches the current dynamic icon system. The renderer will
  // replace it with the active vault/theme variant and macOS persists that last
  // selection after Nodus exits.
  drawRoundedRect(ctx, 61 * s, 61 * s, 902 * s, 902 * s, 212 * s);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.10)';
  ctx.lineWidth = 6 * s;
  ctx.stroke();

  const stroke = ctx.createLinearGradient(260 * s, 235 * s, 765 * s, 790 * s);
  stroke.addColorStop(0, '#b1b3f5');
  stroke.addColorStop(0.45, '#6366f1');
  stroke.addColorStop(1, '#3b3d91');
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 92 * s;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(286 * s, 737 * s);
  ctx.lineTo(286 * s, 287 * s);
  ctx.lineTo(738 * s, 737 * s);
  ctx.lineTo(738 * s, 287 * s);
  ctx.stroke();

  const nodes = [
    [286, 287, '#b1b3f5'],
    [286, 737, '#6366f1'],
    [738, 737, '#5557cd'],
    [738, 287, '#3b3d91'],
  ];

  for (const [x, y, color] of nodes) {
    ctx.beginPath();
    ctx.arc(x * s, y * s, 69 * s, 0, Math.PI * 2);
    ctx.fillStyle = color;
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
