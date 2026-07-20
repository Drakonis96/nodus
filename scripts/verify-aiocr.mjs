// Manual verification of the AI OCR pipeline against a REAL local vision model. Not part
// of `npm test` (it needs Ollama or LM Studio running with a vision-capable model). It
// exercises the exact F0 engine — rasterize → ocrPageImage → reconstructMarkdown — with
// the model call bound to a direct local HTTP request, so it proves the pipeline works
// end to end without the Electron/aiClient stack.
//
// Usage:
//   node scripts/verify-aiocr.mjs <file.pdf|image> --model <name> [--provider ollama|lmstudio] [--host URL] [--pages N]
// Examples:
//   node scripts/verify-aiocr.mjs scan.pdf --provider ollama   --model llama3.2-vision --pages 1
//   node scripts/verify-aiocr.mjs scan.png --provider lmstudio --model qwen2-vl-7b
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// ── args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const provider = flag('provider', process.env.NODUS_OCR_PROVIDER || 'ollama');
const model = flag('model', process.env.NODUS_OCR_MODEL || '');
const maxPages = Number(flag('pages', '2'));
const defaultHost = provider === 'lmstudio' ? 'http://127.0.0.1:1234' : 'http://127.0.0.1:11434';
const host = flag('host', defaultHost).replace(/\/+$/, '');

if (!file || !model) {
  console.error('Uso: node scripts/verify-aiocr.mjs <file.pdf|image> --model <name> [--provider ollama|lmstudio] [--host URL] [--pages N]');
  process.exit(1);
}

// ── bundle the real F0 modules ─────────────────────────────────────────────────
const bundleDir = mkdtempSync(path.join(repoRoot, 'node_modules', '.nodus-aiocr-verify-'));
const build = (entry, out, externals = []) => execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, entry),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
    `--alias:@shared=${path.join(repoRoot, 'shared')}`,
    ...externals.flatMap((e) => [`--external:${e}`]),
    `--outfile=${path.join(bundleDir, out)}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' },
);
build('electron/toolkit/aiOcr/rasterize.ts', 'rasterize.cjs', ['pdfjs-dist', '@napi-rs/canvas']);
build('electron/toolkit/aiOcr/engine.ts', 'engine.cjs');
build('shared/aiOcrReconstruct.ts', 'reconstruct.cjs');
const { rasterizePdf, rasterizeImage } = require(path.join(bundleDir, 'rasterize.cjs'));
const { ocrPageImage } = require(path.join(bundleDir, 'engine.cjs'));
const { reconstructMarkdown } = require(path.join(bundleDir, 'reconstruct.cjs'));

// ── model call bound to the local provider directly ────────────────────────────
function unfence(text) {
  const m = String(text || '').match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : String(text || '')).trim();
}
async function callLocal({ system, user, images }) {
  const image = images[0];
  if (provider === 'lmstudio') {
    const res = await fetch(`${host}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: `${system}\n\n${user}` },
            { type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.base64}` } },
          ],
        }],
        temperature: 0.1,
        stream: false,
      }),
    });
    if (!res.ok) throw new Error(`LM Studio ${res.status}: ${await res.text()}`);
    return (await res.json())?.choices?.[0]?.message?.content ?? '';
  }
  // ollama
  const res = await fetch(`${host}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: `${system}\n\n${user}`, images: [image.base64] }],
      options: { temperature: 0.1 },
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  return (await res.json())?.message?.content ?? '';
}
const modelCall = {
  async completeJson(opts) {
    const text = await callLocal(opts);
    return JSON.parse(unfence(text));
  },
  async completeText(opts) {
    return callLocal(opts);
  },
};

// ── run ─────────────────────────────────────────────────────────────────────────
const options = { outputMode: 'structured', processingMode: 'ocr', removeReferences: true, singleColumn: false };

async function main() {
  console.log(`[verify-aiocr] ${provider} @ ${host}  model=${model}  file=${path.basename(file)}`);
  const isPdf = path.extname(file).toLowerCase() === '.pdf';
  const pages = isPdf ? await rasterizePdf(file, { maxEdge: 1800 }) : [await rasterizeImage(file, { maxEdge: 1800 })];
  const take = pages.slice(0, Math.max(1, maxPages));
  console.log(`[verify-aiocr] rasterized ${pages.length} page(s); OCRing ${take.length}…`);
  const results = [];
  for (const page of take) {
    const image = { base64: Buffer.from(page.buffer).toString('base64'), mediaType: page.mediaType };
    const start = Date.now();
    const outcome = await ocrPageImage(image, options, null, modelCall);
    const chars = outcome.result.blocks.reduce((n, b) => n + b.text.length, 0);
    console.log(`  page ${page.pageNumber}: mode=${outcome.mode} blank=${outcome.result.blankPage} blocks=${outcome.result.blocks.length} chars=${chars} (${Date.now() - start}ms)`);
    results.push(outcome.result);
  }
  const markdown = reconstructMarkdown(results);
  console.log('\n──────── TRANSCRIPCIÓN ────────\n');
  console.log(markdown || '(vacío)');
  if (!markdown.trim()) {
    console.error('\n[verify-aiocr] FALLO: no se reconoció texto. ¿El modelo tiene visión?');
    process.exitCode = 1;
  } else {
    console.log(`\n[verify-aiocr] OK: ${markdown.length} caracteres reconstruidos.`);
  }
}

main()
  .catch((err) => {
    console.error('[verify-aiocr] ERROR:', err?.message || err);
    process.exitCode = 1;
  })
  .finally(() => rmSync(bundleDir, { recursive: true, force: true }));
