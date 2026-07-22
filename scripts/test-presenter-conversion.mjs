// Presenter external-format conversion. The provider orchestration is exercised
// with deterministic fake processes: format routing, installed-app detection,
// provider fallback, PDF validation and temporary-directory cleanup.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-presenter-conversion-test-'));
const bundle = path.join(outDir, 'conversion.cjs');

execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/toolkit/presenter/conversion.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
    `--alias:@shared=${path.join(repoRoot, 'shared')}`,
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' },
);

const conversion = require(bundle);
const tempDirs = [];

async function tempDir(prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function pdfBytes(label = 'test') {
  return Buffer.from(`%PDF-1.4\n% ${label}\n`, 'ascii');
}

test.after(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  await rm(outDir, { recursive: true, force: true });
});

test('recognises supported presentation formats case-insensitively', () => {
  assert.equal(conversion.presenterImportFormat('/tmp/Deck.PPTX'), 'pptx');
  assert.equal(conversion.presenterImportFormat('/tmp/talk.odp'), 'odp');
  assert.equal(conversion.presenterImportFormat('/tmp/slides.key'), 'key');
  assert.equal(conversion.presenterImportFormat('/tmp/document.docx'), null);
  assert.equal(conversion.canExtractOpenXmlNotes('pptx'), true);
  assert.equal(conversion.canExtractOpenXmlNotes('ppt'), false);
});

test('findLibreOfficeBinary checks platform locations and PATH without a shell', () => {
  const linux = conversion.findLibreOfficeBinary(
    'linux',
    { PATH: '/custom/bin:/other/bin' },
    (candidate) => candidate === '/custom/bin/soffice',
  );
  assert.equal(linux, '/custom/bin/soffice');

  const windows = conversion.findLibreOfficeBinary(
    'win32',
    { ProgramFiles: 'C:\\Program Files', PATH: '' },
    (candidate) => candidate === 'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  );
  assert.equal(windows, 'C:\\Program Files\\LibreOffice\\program\\soffice.exe');
});

test('reports no-converter when no compatible installed application exists', async () => {
  const dir = await tempDir('nodus-presenter-no-converter-');
  const source = path.join(dir, 'Deck.pptx');
  fs.writeFileSync(source, 'placeholder');

  await assert.rejects(
    conversion.convertPresentationToPdf(source, {
      platform: 'linux',
      env: { PATH: '' },
      exists: () => false,
      makeTempDir: () => path.join(dir, 'work'),
    }),
    (error) => error instanceof conversion.PresentationConversionError && error.code === 'no-converter',
  );
});

test('prefers headless LibreOffice on macOS and cleans the generated PDF', async () => {
  const dir = await tempDir('nodus-presenter-fallback-');
  const source = path.join(dir, 'My Deck.pptx');
  const work = path.join(dir, 'work');
  fs.writeFileSync(source, 'placeholder');
  const calls = [];
  const fakeExists = (candidate) =>
    candidate === '/Applications/Microsoft PowerPoint.app' || candidate === '/fake/bin/soffice';
  const run = async (executable, args) => {
    calls.push(executable);
    const outputDir = args[args.indexOf('--outdir') + 1];
    fs.writeFileSync(path.join(outputDir, 'My Deck.pdf'), pdfBytes('libreoffice'));
  };

  const converted = await conversion.convertPresentationToPdf(source, {
    platform: 'darwin',
    env: { PATH: '/fake/bin' },
    exists: fakeExists,
    run,
    makeTempDir: () => {
      fs.mkdirSync(work, { recursive: true });
      return work;
    },
  });

  assert.equal(converted.converter, 'libreoffice');
  assert.deepEqual(calls, ['/fake/bin/soffice']);
  assert.equal(fs.readFileSync(converted.pdfPath, 'ascii').startsWith('%PDF-'), true);
  converted.cleanup();
  assert.equal(fs.existsSync(work), false);
});

test('uses Keynote for .key packages and validates its PDF output', async () => {
  const dir = await tempDir('nodus-presenter-keynote-');
  const source = path.join(dir, 'Deck.key');
  const work = path.join(dir, 'work');
  fs.mkdirSync(source);
  const run = async (_executable, args) => {
    fs.writeFileSync(args.at(-1), pdfBytes('keynote'));
  };

  const converted = await conversion.convertPresentationToPdf(source, {
    platform: 'darwin',
    env: { PATH: '' },
    exists: (candidate) => candidate === '/Applications/Keynote.app',
    run,
    makeTempDir: () => {
      fs.mkdirSync(work, { recursive: true });
      return work;
    },
  });
  assert.equal(converted.converter, 'keynote');
  converted.cleanup();
});
