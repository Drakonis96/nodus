// F6 — text utilities (E1–E4) with golden assertions. The Electron-free textOps
// module is bundled and driven directly; the pure string transforms are asserted
// against exact expected output, and E4 against a known SHA-256/MD5 of fixed bytes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-tk-text-'));
const bundle = path.join(outDir, 'textOps.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'electron/toolkit/convert/textOps.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022',
    `--alias:@shared=${path.join(repoRoot, 'shared')}`,
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' },
);
const { textOps } = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

const dec = (bytes) => Buffer.from(bytes).toString('utf8');
function ctx(options = {}) {
  return { request: {}, outputFormat: null, options, signal: { cancelled: false }, onPageProgress() {} };
}
function write(name, content) {
  const p = path.join(outDir, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

test('E1 — cleans PDF-pasted text: de-hyphenates, rejoins wraps, keeps paragraphs', async () => {
  const input = write(
    'paste.txt',
    'This is an exam-\nple of text that was\ncopied from a PDF.\n\nIt has two para-\ngraphs  here.\n',
  );
  const [out] = await textOps['text-clean-pdf-paste'].run([input], ctx());
  assert.equal(
    dec(out.data),
    'This is an example of text that was copied from a PDF.\n\nIt has two paragraphs here.\n',
  );
});

test('E2 — recasing: sentence / title (Spanish minor words) / upper / lower', async () => {
  const input = write('case.txt', 'el ingenioso hidalgo. don quijote de la mancha vive aqui');
  assert.equal(
    dec((await textOps['text-change-case'].run([input], ctx({ mode: 'title' })))[0].data),
    'El Ingenioso Hidalgo. Don Quijote de la Mancha Vive Aqui',
  );
  assert.equal(
    dec((await textOps['text-change-case'].run([input], ctx({ mode: 'sentence' })))[0].data),
    'El ingenioso hidalgo. Don quijote de la mancha vive aqui',
  );
  assert.equal(
    dec((await textOps['text-change-case'].run([input], ctx({ mode: 'upper' })))[0].data),
    'EL INGENIOSO HIDALGO. DON QUIJOTE DE LA MANCHA VIVE AQUI',
  );
  assert.equal(
    dec((await textOps['text-change-case'].run([input], ctx({ mode: 'lower' })))[0].data),
    'el ingenioso hidalgo. don quijote de la mancha vive aqui',
  );
});

test('E3 — SRT → clean text: no timestamps or indices, one line per cue', async () => {
  const srt = [
    '1', '00:00:01,000 --> 00:00:03,000', 'Hola y bienvenidos a la entrevista.', '',
    '2', '00:00:03,500 --> 00:00:06,000', 'Hoy hablamos sobre el proyecto', 'y sus objetivos principales.', '',
    '3', '00:00:06,500 --> 00:00:09,000', 'Gracias por venir.', '',
  ].join('\n');
  const input = write('interview.srt', srt);
  const [out] = await textOps['subtitles-to-txt'].run([input], ctx());
  assert.equal(
    dec(out.data),
    'Hola y bienvenidos a la entrevista.\nHoy hablamos sobre el proyecto y sus objetivos principales.\nGracias por venir.\n',
  );
});

test('E4 — checksum matches a known SHA-256 / MD5 of the exact bytes', async () => {
  const bytes = Buffer.from('Nodus Toolkit checksum fixture\n', 'utf8');
  const input = path.join(outDir, 'checkme.bin');
  fs.writeFileSync(input, bytes);
  const expectedSha = crypto.createHash('sha256').update(bytes).digest('hex');
  const expectedMd5 = crypto.createHash('md5').update(bytes).digest('hex');

  const [both] = await textOps['file-checksum'].run([input], ctx({ algorithm: 'both' }));
  const text = dec(both.data);
  assert.match(text, new RegExp(`SHA-256\\s+${expectedSha}`));
  assert.match(text, new RegExp(`MD5\\s+${expectedMd5}`));

  const [shaOnly] = await textOps['file-checksum'].run([input], ctx({ algorithm: 'sha256' }));
  assert.match(dec(shaOnly.data), new RegExp(expectedSha));
  assert.doesNotMatch(dec(shaOnly.data), /MD5/);
});
