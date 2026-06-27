// Unit tests for the citation sanitiser that backs project-suggestion generation.
// The pure helpers in electron/ai/citationSanitize.ts have no Electron/DB deps,
// so we bundle just that file with esbuild to a temp ESM module and import the
// REAL functions (not a mirror). This locks the fix for the bug where a
// hallucinated `nodus://passage/<uuid>` survived into a suggestion and rendered
// as a broken "⚠" citation.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-citation-test-'));
try {
  const outfile = path.join(tmp, 'citationSanitize.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/ai/citationSanitize.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    // The module only imports a type from @shared/types, erased at compile time.
    external: ['@shared/*'],
    logLevel: 'silent',
  });
  const mod = await import(pathToFileURL(outfile).href);
  const { CITATION_KINDS, citationUrl, dedupeRefs, normalizeRefs, extractCitationRefs, stripDisallowedCitations } = mod;

  // ── citationUrl / extractCitationRefs round-trip ────────────────────────────
  assert.equal(citationUrl({ kind: 'idea', id: 'g-0001' }), 'nodus://idea/g-0001');
  assert.equal(citationUrl({ kind: 'work', id: 'a b' }), 'nodus://work/a%20b');
  assert.deepEqual(
    extractCitationRefs('Ver [X](nodus://idea/g-1) y [Y](nodus://work/w-2).'),
    [
      { kind: 'idea', id: 'g-1' },
      { kind: 'work', id: 'w-2' },
    ]
  );
  // Encoded ids are decoded back.
  assert.deepEqual(extractCitationRefs('[a](nodus://work/a%20b)'), [{ kind: 'work', id: 'a b' }]);

  // ── normalizeRefs: only real project kinds survive (no passage) ─────────────
  assert.ok(!CITATION_KINDS.includes('passage'), 'passage is not a project citation kind');
  assert.deepEqual(
    normalizeRefs([
      { kind: 'idea', id: 'g-1' },
      { kind: 'passage', id: 'x#0' },
      { kind: 'bogus', id: 'z' },
      { kind: 'idea', id: 'g-1' },
    ]),
    [{ kind: 'idea', id: 'g-1' }],
    'passage + unknown + duplicate ideas are dropped'
  );

  // ── dedupeRefs ──────────────────────────────────────────────────────────────
  assert.deepEqual(
    dedupeRefs([
      { kind: 'idea', id: 'g-1' },
      { kind: 'idea', id: 'g-1' },
      { kind: 'work', id: 'w-1' },
    ]),
    [
      { kind: 'idea', id: 'g-1' },
      { kind: 'work', id: 'w-1' },
    ]
  );

  // ── stripDisallowedCitations: the core fix ──────────────────────────────────
  const allowed = new Set(['idea:g-1', 'work:w-2']);

  // The phantom passage link (a chunk UUID) is removed; allowed links are kept.
  const phantom =
    'Las emociones articulan la experiencia [Smith, 2020](nodus://idea/g-1) ' +
    '[pasaje](nodus://passage/9b1afd69-1511-4d88-bb85-e87aa2fed62b).';
  const cleaned = stripDisallowedCitations(phantom, allowed);
  assert.ok(!cleaned.includes('passage'), 'phantom passage citation removed');
  assert.ok(!cleaned.includes('9b1afd69'), 'phantom passage id removed');
  assert.ok(cleaned.includes('nodus://idea/g-1'), 'allowed idea citation kept');
  assert.ok(!/\s\./.test(cleaned), 'no dangling space before the period');
  assert.ok(!cleaned.includes('()'), 'no empty parentheses left behind');

  // Allowed connected-idea links survive so the suggestion can link them.
  const connected =
    'A [a](nodus://idea/g-1) matiza a [b](nodus://work/w-2), frente a [c](nodus://idea/g-9).';
  const cleaned2 = stripDisallowedCitations(connected, allowed);
  assert.ok(cleaned2.includes('nodus://idea/g-1') && cleaned2.includes('nodus://work/w-2'), 'allowed kept');
  assert.ok(!cleaned2.includes('g-9'), 'disallowed idea link dropped');

  // Nothing allowed ⇒ all citations stripped, text still tidy.
  const stripped = stripDisallowedCitations('Idea [x](nodus://idea/zzz).', new Set());
  assert.equal(stripped, 'Idea.', 'all-disallowed collapses cleanly');

  console.log('citation sanitiser test passed');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
