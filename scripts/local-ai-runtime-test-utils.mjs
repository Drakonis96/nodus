import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function loadRuntimeModule(t, relative, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nodus-runtime-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outfile = path.join(directory, 'module.mjs');
  await build({
    entryPoints: [path.resolve(repoRoot, relative)], outfile, bundle: true,
    platform: 'node', format: 'esm', logLevel: 'silent',
    external: ['@huggingface/transformers'],
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
    ...options,
  });
  return import(pathToFileURL(outfile).href);
}
export async function stubFile(directory, name, text) {
  const file = path.join(directory, name);
  await writeFile(file, text);
  return file;
}
export async function until(predicate, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the test condition');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
