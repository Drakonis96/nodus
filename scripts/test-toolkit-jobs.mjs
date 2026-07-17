// F1 — the toolkit job engine's semantics, tested directly against fake operations.
// The engine (electron/toolkit/toolkitJobs.ts) is Electron-free, so we esbuild-bundle
// it (aliasing @shared → shared) and drive it with in-memory ops. This asserts the
// parts that must never regress regardless of the operation: anti-collision naming,
// never overwriting an original, atomic writes leaving no .tmp, cooperative
// cancellation, per-file error isolation, monotonic progress, and merge outputs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-toolkit-jobs-'));
const bundle = path.join(outDir, 'toolkitJobs.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/toolkit/toolkitJobs.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--alias:@shared=${path.join(repoRoot, 'shared')}`,
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' },
);
const { runToolkitJob } = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

const enc = (s) => new TextEncoder().encode(s);

/** Fresh scratch dir per test so outputs never collide across cases. */
function scratch(name) {
  const dir = fs.mkdtempSync(path.join(outDir, `${name}-`));
  return dir;
}

function baseRequest(overrides) {
  return {
    opId: 'file-checksum',
    inputPaths: [],
    outputFormat: null,
    options: {},
    outputDir: null,
    mergedName: null,
    zipOutput: false,
    zipName: null,
    openFolderOnDone: false,
    ...overrides,
  };
}

test('anti-collision names, atomic writes leave no .tmp behind', async () => {
  const dir = scratch('collide');
  const input = path.join(dir, 'doc.pdf');
  fs.writeFileSync(input, 'x');
  // A fake "extract images" op that yields two PNGs with the same base name.
  const registry = {
    'pdf-extract-images': {
      arity: 'each',
      run: async () => [
        { data: enc('image-one'), ext: 'png' },
        { data: enc('image-two'), ext: 'png' },
      ],
    },
  };
  const result = await runToolkitJob(
    'job1',
    baseRequest({ opId: 'pdf-extract-images', inputPaths: [input], outputDir: dir }),
    registry,
  );
  const outputs = result.files[0].outputPaths.map((p) => path.basename(p));
  assert.deepEqual(outputs.sort(), ['doc (2).png', 'doc.png']);
  assert.equal(fs.readFileSync(path.join(dir, 'doc.png'), 'utf8'), 'image-one');
  assert.equal(fs.readFileSync(path.join(dir, 'doc (2).png'), 'utf8'), 'image-two');
  const leftovers = fs.readdirSync(dir).filter((n) => n.includes('.tmp-'));
  assert.deepEqual(leftovers, [], 'no temp files remain');
});

test('never overwrites the original when writing beside it', async () => {
  const dir = scratch('nooverwrite');
  const input = path.join(dir, 'note.txt');
  fs.writeFileSync(input, 'ORIGINAL');
  const registry = {
    'text-clean-pdf-paste': { arity: 'each', run: async () => [{ data: enc('CLEANED'), ext: 'txt' }] },
  };
  const result = await runToolkitJob(
    'job2',
    baseRequest({ opId: 'text-clean-pdf-paste', inputPaths: [input], outputDir: null }),
    registry,
  );
  assert.equal(fs.readFileSync(input, 'utf8'), 'ORIGINAL', 'original untouched');
  const out = result.files[0].outputPaths[0];
  assert.equal(path.basename(out), 'note (2).txt');
  assert.equal(fs.readFileSync(out, 'utf8'), 'CLEANED');
});

test('cooperative cancellation stops the batch and writes no partial output', async () => {
  const dir = scratch('cancel');
  const inputs = ['a', 'b', 'c'].map((n) => {
    const p = path.join(dir, `${n}.txt`);
    fs.writeFileSync(p, n);
    return p;
  });
  const signal = { cancelled: false };
  const registry = {
    'text-clean-pdf-paste': {
      arity: 'each',
      run: async ([p]) => [{ data: enc(`out-${path.basename(p)}`), ext: 'txt' }],
    },
  };
  const result = await runToolkitJob(
    'job3',
    baseRequest({ opId: 'text-clean-pdf-paste', inputPaths: inputs, outputDir: dir }),
    registry,
    {
      signal,
      // Cancel once the first file is done.
      onProgress: (p) => {
        if (p.done >= 1) signal.cancelled = true;
      },
    },
  );
  const statuses = result.files.map((f) => f.status);
  assert.equal(statuses[0], 'done');
  assert.ok(statuses.slice(1).every((s) => s === 'cancelled'), `rest cancelled, got ${statuses}`);
  assert.equal(result.cancelled, true);
  const leftovers = fs.readdirSync(dir).filter((n) => n.includes('.tmp-'));
  assert.deepEqual(leftovers, [], 'cancellation leaves no temp files');
  // Exactly the first file produced an output; the cancelled ones produced none.
  assert.equal(result.files[0].outputPaths.length, 1);
  assert.ok(fs.existsSync(result.files[0].outputPaths[0]));
  assert.deepEqual(result.files[1].outputPaths, []);
  assert.deepEqual(result.files[2].outputPaths, []);
});

test('one failing input does not abort the batch; progress stays monotonic', async () => {
  const dir = scratch('errors');
  const inputs = ['a', 'b', 'c'].map((n) => {
    const p = path.join(dir, `${n}.txt`);
    fs.writeFileSync(p, n);
    return p;
  });
  const registry = {
    'text-clean-pdf-paste': {
      arity: 'each',
      run: async ([p]) => {
        if (path.basename(p) === 'b.txt') throw new Error('boom on b');
        return [{ data: enc('ok'), ext: 'txt' }];
      },
    },
  };
  const seenDone = [];
  const result = await runToolkitJob(
    'job4',
    baseRequest({ opId: 'text-clean-pdf-paste', inputPaths: inputs, outputDir: dir }),
    registry,
    { onProgress: (p) => seenDone.push(p.done) },
  );
  assert.deepEqual(result.files.map((f) => f.status), ['done', 'error', 'done']);
  assert.match(result.files[1].error, /boom on b/);
  // done is non-decreasing and ends at 2 (two successes).
  for (let i = 1; i < seenDone.length; i++) assert.ok(seenDone[i] >= seenDone[i - 1]);
  assert.equal(seenDone.at(-1), 2);
});

test('merge produces a single named output attributed to the batch', async () => {
  const dir = scratch('merge');
  const inputs = ['one.pdf', 'two.pdf'].map((n) => {
    const p = path.join(dir, n);
    fs.writeFileSync(p, n);
    return p;
  });
  const registry = {
    'pdf-merge': { arity: 'merge', run: async (all) => [{ data: enc(`merged:${all.length}`), ext: 'pdf' }] },
  };
  const result = await runToolkitJob(
    'job5',
    baseRequest({ opId: 'pdf-merge', inputPaths: inputs, outputDir: dir, mergedName: 'combinado' }),
    registry,
  );
  assert.ok(result.files.every((f) => f.status === 'done'));
  const out = result.files[0].outputPaths[0];
  assert.equal(path.basename(out), 'combinado.pdf');
  assert.equal(fs.readFileSync(out, 'utf8'), 'merged:2');
});

test('zipOutput packages every produced file into one archive, none loose', async () => {
  const dir = scratch('zip');
  const inputs = ['one.pdf', 'two.pdf'].map((n) => {
    const p = path.join(dir, n);
    fs.writeFileSync(p, n);
    return p;
  });
  // Two inputs, each yielding two PNGs → four entries in one zip.
  const registry = {
    'pdf-extract-images': {
      arity: 'each',
      run: async ([p]) => [
        { data: enc(`a-${path.basename(p)}`), ext: 'png' },
        { data: enc(`b-${path.basename(p)}`), ext: 'png' },
      ],
    },
  };
  const outDir = scratch('zip-out');
  const result = await runToolkitJob(
    'zjob',
    baseRequest({ opId: 'pdf-extract-images', inputPaths: inputs, outputDir: outDir, zipOutput: true, zipName: 'imagenes' }),
    registry,
  );
  assert.ok(result.zipPath, 'a zip path is returned');
  assert.equal(path.basename(result.zipPath), 'imagenes.zip');
  assert.ok(fs.existsSync(result.zipPath));
  // No loose png files were written next to the zip.
  const loose = fs.readdirSync(outDir).filter((n) => n.endsWith('.png'));
  assert.deepEqual(loose, [], 'no loose files, only the zip');
  // The zip really contains four entries (read via the same manual layout: check EOCD count).
  const AdmZip = require('adm-zip');
  const names = new AdmZip(fs.readFileSync(result.zipPath)).getEntries().map((e) => e.entryName).sort();
  assert.equal(names.length, 4, `four entries, got ${names.join(', ')}`);
  assert.ok(names.every((n) => n.endsWith('.png')));
  // Both source files point at the zip for "reveal".
  assert.ok(result.files.every((f) => f.outputPaths[0] === result.zipPath));
});

test('an unknown operation or too-few inputs is rejected up front', async () => {
  await assert.rejects(
    runToolkitJob('jobX', baseRequest({ opId: 'pdf-merge', inputPaths: [] }), {}),
    /Operación desconocida|suficientes/,
  );
  const dir = scratch('few');
  const p = path.join(dir, 'a.pdf');
  fs.writeFileSync(p, 'a');
  await assert.rejects(
    runToolkitJob(
      'jobY',
      baseRequest({ opId: 'pdf-merge', inputPaths: [p] }),
      { 'pdf-merge': { arity: 'merge', run: async () => [] } },
    ),
    /suficientes/,
  );
});
