import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const geometry = JSON.parse(await readFile(path.join(root, 'shared/nodusMark.json'), 'utf8'));
const image = await loadImage(path.join(root, 'build/icon.png'));
const canvas = createCanvas(image.width, image.height);
const context = canvas.getContext('2d');
context.drawImage(image, 0, 0);
const { data } = context.getImageData(0, 0, image.width, image.height);

let minX = image.width;
let minY = image.height;
let maxX = -1;
let maxY = -1;
for (let y = 0; y < image.height; y += 1) {
  for (let x = 0; x < image.width; x += 1) {
    const offset = (y * image.width + x) * 4;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const alpha = data[offset + 3];
    // The plate and its edge are neutral. Saturated opaque pixels isolate the N.
    if (alpha > 200 && Math.max(red, green, blue) - Math.min(red, green, blue) > 24) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
}

assert.ok(maxX >= minX && maxY >= minY, 'build/icon.png must contain the coloured Nodus mark');

const plateRatio = 1 - geometry.plateInsetRatio * 2;
const markBoxRatio = plateRatio * geometry.markScaleRatio;
const expectedMarkWidthRatio = markBoxRatio * (
  geometry.rightX - geometry.leftX + geometry.nodeRadius * 2
) / geometry.viewBoxSize;
const expectedMarkHeightRatio = markBoxRatio * (
  geometry.bottomY - geometry.topY + geometry.nodeRadius * 2
) / geometry.viewBoxSize;
const measuredWidthRatio = (maxX - minX + 1) / image.width;
const measuredHeightRatio = (maxY - minY + 1) / image.height;

assert.ok(
  Math.abs(measuredWidthRatio - expectedMarkWidthRatio) < 0.012,
  `Static N width ${measuredWidthRatio.toFixed(3)} must match canonical ${expectedMarkWidthRatio.toFixed(3)}`,
);
assert.ok(
  Math.abs(measuredHeightRatio - expectedMarkHeightRatio) < 0.012,
  `Static N height ${measuredHeightRatio.toFixed(3)} must match canonical ${expectedMarkHeightRatio.toFixed(3)}`,
);
assert.ok(measuredWidthRatio < 0.4, 'The bundled fallback must keep the compact, stylized N');

console.log('Static and dynamic Nodus icon geometry matches!');
