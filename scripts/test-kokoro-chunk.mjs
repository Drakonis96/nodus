// Unit tests for the Kokoro narration chunker. kokoro-js truncates input past
// ~509 tokens, cutting audio off mid-word; src/lib/audio/kokoroChunk.ts splits a
// segment into sentence-aligned pieces first and joins the PCM back. The module
// is pure (no kokoro-js runtime), so we bundle just it and exercise the real
// functions — locking the guarantee that no word is ever dropped or split.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-kokoro-chunk-test-'));
try {
  const outfile = path.join(tmp, 'kokoroChunk.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'src/lib/audio/kokoroChunk.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  const { splitSentences, chunkForKokoro, concatAudio } = await import(pathToFileURL(outfile).href);

  const LIMIT = 360;

  // ── splitSentences keeps a trailing, unterminated clause whole ──────────────
  {
    assert.deepEqual(
      splitSentences('Uno. Dos! cola sin punto con varias palabras'),
      ['Uno.', 'Dos!', 'cola sin punto con varias palabras'],
    );
    assert.deepEqual(splitSentences('   '), []);
  }

  // ── Short text is a single chunk; blank text yields none ────────────────────
  {
    assert.deepEqual(chunkForKokoro('Frase corta.'), ['Frase corta.']);
    assert.deepEqual(chunkForKokoro('   '), []);
  }

  // ── Long prose chunks under the budget without losing or splitting a word ───
  {
    const sentence = 'Esta es una frase de prueba con bastantes palabras para el troceado. ';
    const long = sentence.repeat(60); // ~4000 chars, well past the token ceiling
    const chunks = chunkForKokoro(long);
    assert.ok(chunks.length > 1, 'splits into several pieces');
    assert.ok(chunks.every((c) => c.length <= LIMIT), 'each chunk stays within budget');
    assert.deepEqual(
      chunks.join(' ').split(/\s+/),
      long.trim().split(/\s+/),
      'every word is preserved, in order, none cut',
    );
  }

  // ── A single sentence longer than the budget wraps on word boundaries ───────
  {
    const words = Array.from({ length: 200 }, (_, i) => `palabra${i}`).join(' ');
    const chunks = chunkForKokoro(words);
    assert.ok(chunks.every((c) => c.length <= LIMIT));
    assert.deepEqual(chunks.join(' ').split(/\s+/), words.split(/\s+/));
  }

  // ── A lone word longer than the budget is hard-sliced, never truncated ──────
  {
    const oneWord = 'a'.repeat(1000);
    const chunks = chunkForKokoro(oneWord);
    assert.ok(chunks.every((c) => c.length <= LIMIT));
    assert.equal(chunks.join(''), oneWord, 'hard-sliced word fully preserved');
  }

  // ── concatAudio joins buffers with a silent gap and preserves the samples ───
  {
    const a = Float32Array.from([0.1, 0.2]);
    const b = Float32Array.from([0.3]);
    const merged = concatAudio([a, b], 1000, 10); // 10 ms @ 1000 Hz → 10-sample gap
    assert.equal(merged.length, 2 + 10 + 1);
    assert.equal(merged[0], a[0]);
    assert.equal(merged[1], a[1]);
    assert.equal(merged[merged.length - 1], b[0]);
    assert.equal(merged[2], 0, 'gap is silence');

    assert.equal(concatAudio([a], 1000).length, 2, 'single part returned as-is');
    assert.equal(concatAudio([], 1000).length, 0, 'no parts → empty');
    assert.equal(concatAudio([new Float32Array(0), b], 1000).length, 1, 'empty parts skipped (no phantom gap)');
  }

  console.log('test-kokoro-chunk: all assertions passed');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
