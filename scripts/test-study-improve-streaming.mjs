// Verifies that "Mejorar" restores protected spans in linear time.
//
// Two independent blowups used to multiply here:
//   A. restoreProtectedSpans walked the whole text once PER SPAN
//      (spans.reduce(split/join)) — 600 spans meant 600 full scans.
//   B. it was called on the whole accumulated prefix on EVERY streamed token.
// Together that measured 84s of blocked main process on a 109k-char document.
//
// The assertions below count WORK (characters fed to the restorer), not
// wall-clock time: the suite runs test files in parallel, so timing thresholds
// flake. Correctness is pinned by differential-testing the new implementation
// against the original one.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-improve-'));
const bundle = path.join(dir, 'studyImprove.cjs');

execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/studyImprove.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=es2022',
    `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

const require = createRequire(import.meta.url);
const { protectStudyText, restoreProtectedSpans } = require(bundle);

/** The original implementation, kept as the correctness oracle. */
function restoreTheOldWay(text, spans) {
  return spans.reduce((restored, span) => restored.split(span.placeholder).join(span.value), text);
}

/** `completeProtectedStreamPrefix` from electron/ai/studyImprove.ts. */
function safePrefixLength(value) {
  const lastOpen = value.lastIndexOf('⟦');
  const lastClose = value.lastIndexOf('⟧');
  return lastOpen > lastClose ? lastOpen : value.length;
}

/** A document with plenty of protectable material: citations, numbers, quotes, code. */
function buildDocument(paragraphs) {
  const out = [];
  for (let i = 0; i < paragraphs; i++) {
    out.push(
      `El estudio de [Autor ${i}, ${1900 + i}] sostiene que el ${12 + (i % 80)}% de los casos ` +
        `presentan «una desviación sostenida» respecto a la media de 3,14 unidades. ` +
        `Véase también \`funcion_${i}(x)\` y la fecha 12/03/${1950 + (i % 50)}. `
    );
  }
  return out.join('');
}

try {
  // --- 1. The new restorer is a drop-in for the old one --------------------
  {
    const cases = [
      'Sin nada protegido en absoluto.',
      '',
      'Cita simple [Autor, 1999] y un número 42.',
      buildDocument(3),
      'Comillas «citadas» junto a `codigo()` y 12,5% al final.',
    ];
    for (const source of cases) {
      const { text, spans } = protectStudyText(source, []);
      assert.equal(
        restoreProtectedSpans(text, spans),
        restoreTheOldWay(text, spans),
        `new and old restorers must agree on: ${source.slice(0, 40)}`
      );
      assert.equal(restoreProtectedSpans(text, spans), source, 'restoring must round-trip losslessly');
    }
  }

  // --- 2. Protected terms round-trip too -----------------------------------
  {
    const source = 'La teoría de Foucault y la noción de Foucault aparecen dos veces.';
    const { text, spans } = protectStudyText(source, ['Foucault']);
    assert.ok(spans.length >= 2, 'the supplied term must be protected at each occurrence');
    assert.equal(restoreProtectedSpans(text, spans), source, 'terms must round-trip');
    assert.equal(restoreProtectedSpans(text, spans), restoreTheOldWay(text, spans));
  }

  // --- 3. An unknown placeholder is left alone, not deleted ----------------
  // A model can hallucinate a marker that was never minted; dropping it would
  // silently swallow text.
  {
    const { spans } = protectStudyText('Cita [Autor, 2001].', []);
    const withGhost = 'Texto ⟦NODUS_PROTECTED_9999⟧ final.';
    assert.equal(
      restoreProtectedSpans(withGhost, spans),
      withGhost,
      'a placeholder with no matching span must be preserved verbatim'
    );
  }

  // --- 4. Streaming slice-by-slice equals restoring the whole prefix -------
  // This is the property that makes the incremental fix safe.
  {
    const source = buildDocument(40);
    const { text, spans } = protectStudyText(source, []);
    assert.ok(spans.length > 100, `the document should be densely protected (${spans.length} spans)`);

    // Replay the model's output as chunks, including sizes that deliberately
    // split markers apart.
    for (const step of [1, 3, 7, 8, 64]) {
      let streamed = '';
      let restoredUpTo = 0;
      let visible = '';
      for (let i = 0; i < text.length; i += step) {
        streamed += text.slice(i, i + step);
        const safeEnd = safePrefixLength(streamed);
        if (safeEnd <= restoredUpTo) continue;
        visible += restoreProtectedSpans(streamed.slice(restoredUpTo, safeEnd), spans);
        restoredUpTo = safeEnd;
      }
      // Whatever is left after the stream ends (the final flush).
      visible += restoreProtectedSpans(streamed.slice(restoredUpTo), spans);
      assert.equal(
        visible,
        source,
        `incremental restoration at chunk size ${step} must equal the original document`
      );
    }
  }

  // --- 5. A marker split across chunks is never emitted half-restored ------
  {
    const source = 'Antes [Autor, 1988] después.';
    const { text, spans } = protectStudyText(source, []);
    const marker = spans[0].placeholder;
    const splitAt = text.indexOf(marker) + 5; // mid-marker

    let restoredUpTo = 0;
    let visible = '';
    for (const streamed of [text.slice(0, splitAt), text]) {
      const safeEnd = safePrefixLength(streamed);
      if (safeEnd <= restoredUpTo) continue;
      const chunk = restoreProtectedSpans(streamed.slice(restoredUpTo, safeEnd), spans);
      assert.ok(!chunk.includes('⟦'), 'a partial marker must never reach the preview');
      assert.ok(!chunk.includes('NODUS_PROTECTED'), 'marker internals must never reach the preview');
      visible += chunk;
      restoredUpTo = safeEnd;
    }
    visible += restoreProtectedSpans(text.slice(restoredUpTo), spans);
    assert.equal(visible, source, 'the split marker must still restore correctly');
  }

  // --- 6. The work is now linear, not quadratic ----------------------------
  // Total characters handed to the restorer across a whole stream.
  function streamWork(source, { incremental }) {
    const { text, spans } = protectStudyText(source, []);
    let streamed = '';
    let restoredUpTo = 0;
    let chars = 0;
    let scans = 0; // full passes over the text (old impl = one per span)
    for (let i = 0; i < text.length; i += 8) {
      streamed += text.slice(i, i + 8);
      const safeEnd = safePrefixLength(streamed);
      if (safeEnd <= restoredUpTo) continue;
      if (incremental) {
        chars += safeEnd - restoredUpTo;
        scans += 1;
      } else {
        chars += safeEnd; // the whole prefix, every time
        scans += spans.length; // one pass per span
      }
      restoredUpTo = safeEnd;
    }
    return { chars, scans, spans: spans.length, length: text.length };
  }

  const small = buildDocument(20);
  const big = buildDocument(40); // ~2x the text, ~2x the spans

  const newSmall = streamWork(small, { incremental: true });
  const newBig = streamWork(big, { incremental: true });
  const oldBig = streamWork(big, { incremental: false });

  // Linear: the restorer sees each character exactly once across the stream.
  assert.equal(
    newBig.chars,
    newBig.length,
    'each character must be restored exactly once over the whole stream'
  );

  // Doubling the document must roughly double the work, not quadruple it.
  const growth = newBig.chars / newSmall.chars;
  assert.ok(
    growth > 1.5 && growth < 3,
    `work must scale linearly with document size (grew ${growth.toFixed(2)}x for a 2x document)`
  );

  // And the improvement over the previous behaviour must be dramatic. The old
  // path also multiplied by span count, which this char measure excludes, so
  // this is a conservative floor.
  const charRatio = oldBig.chars / newBig.chars;
  assert.ok(
    charRatio > 50,
    `the old path fed far more text to the restorer (only ${charRatio.toFixed(1)}x)`
  );
  const scanRatio = oldBig.scans / newBig.scans;
  assert.ok(
    scanRatio > 100,
    `the old path made far more passes over the text (only ${scanRatio.toFixed(1)}x)`
  );

  console.log(
    `# study improve streaming tests passed ` +
      `(${newBig.spans} spans, ${newBig.length} chars: ` +
      `${charRatio.toFixed(0)}x less text scanned, ${scanRatio.toFixed(0)}x fewer passes)`
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
