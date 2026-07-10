// Unit tests for the pure citation-preview formatter that feeds the chat's
// citation hover-cards. electron/citations/citationPreview.ts has no Electron/DB
// deps (only a compile-time type import), so we bundle just that file with
// esbuild and exercise the REAL functions — locking in the trim/truncate/empty
// rules the hover-card relies on to never render a blank or overflowing card.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-citation-preview-test-'));
try {
  const outfile = path.join(tmp, 'citationPreview.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/citations/citationPreview.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    external: ['@shared/*'],
    logLevel: 'silent',
  });
  const mod = await import(pathToFileURL(outfile).href);
  const {
    truncate,
    buildCitationPreview,
    CITATION_PREVIEW_TITLE_MAX,
    CITATION_PREVIEW_SNIPPET_MAX,
    CITATION_PREVIEW_SUBTITLE_MAX,
  } = mod;

  // ── truncate: whitespace collapse + capped length with ellipsis ─────────────
  assert.equal(truncate('  hola   mundo \n\t sí ', 100), 'hola mundo sí');
  assert.equal(truncate(null, 10), '');
  assert.equal(truncate(undefined, 10), '');
  assert.equal(truncate('exacto', 6), 'exacto', 'text at the limit is kept verbatim');
  const long = 'a'.repeat(50);
  const cut = truncate(long, 10);
  assert.equal(cut.length, 10, 'truncated length includes the ellipsis');
  assert.ok(cut.endsWith('…'), 'truncation appends an ellipsis');
  assert.equal(cut, `${'a'.repeat(9)}…`);

  // ── buildCitationPreview: kind passthrough + per-field limits ───────────────
  const full = buildCitationPreview('idea', {
    title: '  Una  idea  central ',
    subtitle: ' Autor · 2020 ',
    snippet: '  Un fragmento del corpus.  ',
  });
  assert.deepEqual(full, {
    kind: 'idea',
    title: 'Una idea central',
    subtitle: 'Autor · 2020',
    snippet: 'Un fragmento del corpus.',
  });

  // Empty subtitle/snippet are dropped so the card never renders blank rows.
  const sparse = buildCitationPreview('work', { title: 'Solo título', subtitle: '   ', snippet: null });
  assert.deepEqual(sparse, { kind: 'work', title: 'Solo título' });
  assert.ok(!('subtitle' in sparse) && !('snippet' in sparse));

  // A missing title never yields an empty card.
  assert.equal(buildCitationPreview('gap', { title: '   ' }).title, '—');
  assert.equal(buildCitationPreview('passage', { title: undefined }).title, '—');

  // Each field respects its own cap.
  const capped = buildCitationPreview('contradiction', {
    title: 'T'.repeat(400),
    subtitle: 'S'.repeat(400),
    snippet: 'N'.repeat(400),
  });
  assert.equal(capped.title.length, CITATION_PREVIEW_TITLE_MAX);
  assert.equal(capped.subtitle.length, CITATION_PREVIEW_SUBTITLE_MAX);
  assert.equal(capped.snippet.length, CITATION_PREVIEW_SNIPPET_MAX);
  assert.ok(capped.title.endsWith('…') && capped.subtitle.endsWith('…') && capped.snippet.endsWith('…'));
  assert.equal(capped.kind, 'contradiction');

  console.log('test-citation-preview: OK');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
