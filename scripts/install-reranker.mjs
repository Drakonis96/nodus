#!/usr/bin/env node
// Installs the local reranker (bge-reranker-v2-m3 Q8_0, Apache-2.0) that orders Chemistry
// Studio's textbook evidence (electron/ai/localReranker.ts). Verifies size and SHA-256.
//
//   node scripts/install-reranker.mjs                 # download from the pinned Hugging Face revision
//   node scripts/install-reranker.mjs <local .gguf>   # use a copy you already have
//   node scripts/install-reranker.mjs --remove
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MODEL = {
  id: 'bge-reranker-v2-m3-q8_0', file: 'bge-reranker-v2-m3-Q8_0.gguf', bytes: 635_676_416,
  sha256: 'a43c7c9b11a4c1517e5bf95151960e1621d1b72f7a493364b01e386cf1aaa1d3',
  url: 'https://huggingface.co/gpustack/bge-reranker-v2-m3-GGUF/resolve/3093af03b1a635e67b084b1d8c03c5f5e020fd05/bge-reranker-v2-m3-Q8_0.gguf?download=true',
};
const dir = path.join(os.homedir(), 'Library', 'Application Support', 'Nodus', 'local-ai', 'models', MODEL.id);
const target = path.join(dir, MODEL.file);
const arg = process.argv[2];

const sha256 = (file) => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  fs.createReadStream(file).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
});

if (arg === '--remove') {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`removed ${dir}`);
  process.exit(0);
}
fs.mkdirSync(dir, { recursive: true });
const staging = `${target}.part`;
if (arg) {
  fs.copyFileSync(arg, staging);
} else {
  console.log(`downloading ${MODEL.url}`);
  const response = await fetch(MODEL.url);
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
  fs.writeFileSync(staging, Buffer.from(await response.arrayBuffer()));
}
const size = fs.statSync(staging).size;
const digest = await sha256(staging);
if (size !== MODEL.bytes || digest !== MODEL.sha256) {
  fs.rmSync(staging, { force: true });
  throw new Error(`verification failed (size ${size}, sha256 ${digest})`);
}
fs.renameSync(staging, target);
console.log(`installed ${target} (verified)`);
