import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Deep Research Server Web exposes durable private job controls and PDF export', () => {
  const personal = read('src/serverWeb/PersonalViews.tsx');
  const readers = read('src/serverWeb/readers.tsx');
  const api = read('src/serverWeb/api.ts');
  const ai = read('server/lib/routes/ai.mjs');
  const artifacts = read('server/lib/routes/artifacts.mjs');
  const corpus = read('server/lib/routes/corpus.mjs');
  assert.match(personal, /api\.aiJobs\(\)/);
  assert.match(personal, /data-testid="deep-research-private-jobs"/);
  assert.match(personal, /api\.cancelAIJob\(job\.id/);
  assert.match(personal, /api\.retryAIJob\(job\.id/);
  assert.match(personal, /generationAbort/);
  assert.match(personal, /deep-research-tutorial-toggle/);
  assert.match(personal, /deep-research-tutorial/);
  assert.match(personal, /deep-research-audio/);
  assert.match(personal, /deep-research-audio-panel/);
  assert.match(personal, /La voz se reproduce en este navegador/);
  assert.match(personal, /title=\{valueText\(activeTranslation\?\.title \|\| open\.title, 'Informe'\)\}/);
  assert.match(personal, /\{valueText\(activeTranslation\?\.title \|\| open\.title, 'Informe'\)\}/);
  assert.match(personal, /deep-research-edit-brief/);
  assert.match(personal, /api\.updateArtifact\(valueText\(open\.id\)/);
  assert.match(personal, /function CitationValue/);
  assert.match(personal, /onCitation=\{setCitation\}/);
  assert.match(readers, /academic = .*idea\|work\|gap\|passage\|theme\|author/);
  assert.match(readers, /Deep Research citations are ordinary Markdown links/);
  assert.match(personal, /const allTranslations = \[\.\.\.nextTranslations, \.\.\.ownTranslations\]/);
  assert.match(api, /aiJobs: \(\) =>/);
  assert.match(api, /retryAIJob:/);
  assert.match(ai, /segments\[5\] === 'cancel'/);
  assert.match(ai, /segments\[5\] === 'retry'/);
  assert.match(ai, /request: redactStructured/);
  assert.match(artifacts, /segments\[5\] === 'document\.pdf'/);
  assert.match(corpus, /rest\[1\] === 'document\.pdf'/);
});

test('PDF export remains dependency-bounded and binary', async () => {
  const { deepResearchPdfBytes } = await import('../server/lib/core/deepResearchPdf.mjs');
  const bytes = await deepResearchPdfBytes({ title: 'Prueba privada', draftMarkdown: '# Hallazgo\n\nContenido seguro.' });
  assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.match(bytes.subarray(-32).toString('ascii'), /%%EOF/);
  assert.ok(bytes.length > 500);
});
