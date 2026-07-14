// Unit tests for the narration text pipeline that backs the local audio feature.
// electron/audio/speakable.ts is pure (only a @shared type, erased at compile),
// so we bundle just that file with esbuild and import the REAL functions. This
// locks the core guarantees: citation "buttons" are never narrated, markdown is
// flattened to clean prose, and reports/immersions split into sensible segments.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-speakable-test-'));
try {
  const outfile = path.join(tmp, 'speakable.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/audio/speakable.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    external: ['@shared/*'],
    logLevel: 'silent',
  });
  const { markdownToSpeech, splitForNarration, splitMarkdownSections, deepResearchSegments, immersionSegments, formulasToSpeech, studyNarrationSegments } =
    await import(pathToFileURL(outfile).href);

  // ── Citation buttons are removed entirely (label + link) ────────────────────
  {
    const md = 'El turismo fue propaganda [(García, 2019)](nodus://idea/g-12) del régimen.';
    const out = markdownToSpeech(md);
    assert.ok(!out.includes('nodus://'), 'bare nodus url must be gone');
    assert.ok(!out.includes('García'), 'citation label must not be narrated');
    assert.ok(!out.includes('['), 'no leftover brackets');
    assert.equal(out, 'El turismo fue propaganda del régimen.');
  }

  // ── Ordinary links keep their text; emphasis/code markers stripped ──────────
  {
    assert.equal(markdownToSpeech('Ver [la web](https://x.com) ahora.'), 'Ver la web ahora.');
    assert.equal(markdownToSpeech('Esto es **muy** `importante` y _claro_.'), 'Esto es muy importante y claro.');
  }

  // ── Headings become spoken sentences; lists get terminal punctuation ────────
  {
    const out = markdownToSpeech('# Introducción\n\nUno.\n\n- primero\n- segundo');
    assert.ok(out.startsWith('Introducción.'), 'heading kept as sentence');
    assert.ok(out.includes('primero.'), 'list item ends with a stop');
    assert.ok(out.includes('segundo.'));
  }

  // ── Code fences and tables are dropped ──────────────────────────────────────
  {
    const out = markdownToSpeech('Antes.\n\n```js\nconst x = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nDespués.');
    assert.ok(!out.includes('const x'), 'code fence dropped');
    assert.ok(!out.includes('|'), 'table rows dropped');
    assert.ok(out.includes('Antes.') && out.includes('Después.'));
  }

  // ── Section splitting picks the shallowest heading level ────────────────────
  {
    const sections = splitMarkdownSections('Lead in.\n\n## Uno\nCuerpo uno.\n\n## Dos\nCuerpo dos.');
    assert.equal(sections.length, 3);
    assert.equal(sections[0].heading, null);
    assert.equal(sections[1].heading, 'Uno');
    assert.equal(sections[2].heading, 'Dos');
  }

  // ── Long text splits on sentence boundaries under the budget ────────────────
  {
    const sentence = 'Esta es una frase de prueba con varias palabras. ';
    const long = sentence.repeat(120); // well over the ~2600 char budget
    const parts = splitForNarration(long);
    assert.ok(parts.length > 1, 'long text splits into multiple chunks');
    assert.ok(parts.every((p) => p.length <= 2700), 'each chunk stays near the budget');
    assert.ok(parts.every((p) => /[.!?]$/.test(p.trim())), 'chunks end on sentence boundaries');
  }

  // ── Deep Research: intro segment + one per section, citations stripped ───────
  {
    const draft = {
      title: 'La imagen de España',
      abstract: 'Un resumen con [cita](nodus://work/w-1).',
      draftMarkdown: '## Contexto\nTexto de contexto [(A, 2000)](nodus://idea/g-1).\n\n## Análisis\nTexto de análisis.',
    };
    const segs = deepResearchSegments(draft);
    assert.equal(segs[0].label, 'Resumen');
    assert.ok(segs[0].text.startsWith('La imagen de España.'), 'title spoken first');
    assert.ok(!segs.some((s) => s.text.includes('nodus://')), 'no citations survive anywhere');
    assert.deepEqual(segs.map((s) => s.label), ['Resumen', 'Contexto', 'Análisis']);
    assert.deepEqual(segs.map((s) => s.index), [0, 1, 2], 'indices are contiguous');
  }

  // ── Immersion: panorama + one segment per station, takeaways included ────────
  {
    const plan = {
      title: 'Turismo y régimen',
      overview: 'Panorama general [(X)](nodus://idea/g-9).',
      stations: [
        { title: 'El viajero', context: 'Contexto.', synthesis: 'Lección larga.', takeaways: ['Retén esto'] },
        { title: 'La mirada', context: '', synthesis: 'Otra lección.', takeaways: [] },
      ],
    };
    const segs = immersionSegments(plan);
    assert.equal(segs[0].label, 'Panorama');
    assert.ok(segs[1].label.startsWith('Estación 1 · El viajero'));
    assert.ok(segs[1].text.includes('Para recordar'), 'takeaways narrated');
    assert.ok(segs[2].label.startsWith('Estación 2 · La mirada'));
    assert.ok(!segs.some((s) => s.text.includes('nodus://')));
  }

  // ── Empty content yields no segments (no crash, nothing to narrate) ──────────
  {
    assert.deepEqual(deepResearchSegments({ title: '', abstract: '', draftMarkdown: '' }), []);
    assert.deepEqual(immersionSegments({ overview: '', stations: [] }), []);
  }

  // ── Study narration understands formulas, modes and pronunciation ──────────
  {
    assert.match(formulasToSpeech('La fórmula $x^2 + \\frac{a}{b}$.'), /x al cuadrado.*a dividido por b/);
    const markdown = '# Memoria\n\nLa sigla TCC explica $x^2$.\n\n## Referencias\n\nNo narrar esta referencia.';
    const full = studyNarrationSegments(markdown, { title: 'Apunte', pronunciations: [{ written: 'TCC', spoken: 'te ce ce' }] });
    assert.ok(full.some((segment) => segment.text.includes('te ce ce')));
    assert.ok(full.some((segment) => segment.text.includes('al cuadrado')));
    assert.ok(!full.some((segment) => segment.text.includes('No narrar')), 'reference sections stay silent');
    const selection = studyNarrationSegments(markdown, { mode: 'selection', selection: 'Sólo esta frase.', title: 'Selección' });
    assert.equal(selection.length, 1);
    assert.match(selection[0].text, /Sólo esta frase/);
    const cursor = studyNarrationSegments('Antes. Después del cursor.', { mode: 'cursor', cursorOffset: 7, title: 'Cursor' });
    assert.ok(!cursor[0].text.includes('Antes'));
    assert.match(cursor[0].text, /Después del cursor/);
  }

  console.log('test-speakable: all assertions passed');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
