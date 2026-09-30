// Complete study guide exports: print HTML (MathML formulas, callout cards, tables,
// figures, anchored headings), the professional-report input (sections, page breaks,
// theme) and Word (native OMML equations, tables, callout boxes, table of contents).
import assert from 'node:assert/strict';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
async function load(entry, external = []) {
  const built = await build({ entryPoints: [entry], bundle: true, write: false, format: 'cjs', platform: 'node', tsconfig: 'electron/tsconfig.json', external });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', built.outputFiles[0].text)(module, module.exports, require_);
  return module.exports;
}
const { guideMarkdownToHtml, reviewSheetHtml } = await load('shared/completeGuide/guideHtml.ts');
const { completeGuideReportInput, guideParts, completeGuideMarkdown } = await load('shared/completeGuide/reportInput.ts');
const { renderProfessionalReportHtml } = await load('shared/professionalReport.ts');
const { completeGuideDocx } = await load('electron/export/completeGuideDocx.ts', ['docx']);
const { latexToDocxMath } = await load('electron/export/mathToDocx.ts', ['docx']);

const SAMPLE = [
  '## Cómo usar esta guía', '', 'Texto de ayuda.', '',
  '## Tema 1 · Gases', '', '### Variables de estado', '',
  'La presión $P = F/A$ se mide en pascales ([A1 · p. 1](nodus://study/material/m?page=1&e=K0001)).', '',
  '> [!formula] Fórmula · Gases ideales', '> $$', '> PV = nRT', '> $$', '> Válida a baja presión.', '>', '> [A1 · p. 2](nodus://study/material/m?page=2&e=K0002)', '',
  '> [!ai-example] Ejemplo elaborado por IA', '> Un globo con $\\ce{H2O}$ al sol.', '',
  '| Magnitud | Unidad |', '| --- | --- |', '| Presión | Pa |', '',
  '![Diagrama de fases](guide-assets/figure-f1.png)', '',
  '## Glosario', '', '| Término | Significado | Fuente |', '| --- | --- | --- |', '| Presión | Fuerza por área | A1 |', '',
  '## Ficha de repaso', '', '### Tema 1 · Gases', '', '- $PV = nRT$ (A1)', '',
].join('\n');
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('print HTML renders MathML, callout cards, tables, figures and anchored headings', () => {
  const { html, headings } = guideMarkdownToHtml(SAMPLE, 'g', (url) => (url.endsWith('figure-f1.png') ? PIXEL : null));
  assert.match(html, /<math[^>]*>[\s\S]*<mi>P<\/mi>/, 'inline formula as MathML');
  assert.match(html, /<div class="gm-display"><span class="katex"><math[^>]*display="block"/, 'display formula');
  assert.match(html, /<aside class="gc gc-formula"><div class="gc-title">Fórmula · Gases ideales<\/div>/);
  assert.match(html, /<aside class="gc gc-ai-example">/);
  assert.match(html, /<aside class="gc gc-ai-example">[\s\S]*<mtext>H<\/mtext>|<aside class="gc gc-ai-example">[\s\S]*<math/, '\\ce{} rendered inside a callout');
  assert.ok(!html.includes('⟦'), 'no placeholder leaks');
  assert.match(html, /<table><thead><tr><th>Magnitud<\/th>/);
  assert.match(html, /<figure class="gf"><img src="data:image\/png;base64,/);
  assert.deepEqual(headings.map((heading) => heading.title), ['Variables de estado', 'Tema 1 · Gases']);
  assert.match(html, /<h3 id="g-variables-de-estado">/);
  assert.doesNotMatch(html, /href="nodus:/, 'citations print as readable labels');
  assert.match(html, /A1 · p\. 1/);
  const sheet = reviewSheetHtml({ title: 'Ficha', subtitle: 'hoy', markdown: '# Ficha de repaso\n\n### Tema\n\n- $PV = nRT$', language: 'es' });
  assert.match(sheet, /column-count: 2/);
  assert.match(sheet, /<math/);
});

test('the guide becomes the professional report: one numbered section per part, chapters on new pages', () => {
  const draft = {
    title: 'Guía de estudio: Gases', abstract: 'Resumen del temario.', generatedAt: '2026-09-28T10:00:00.000Z', draftMarkdown: SAMPLE,
    brief: { kind: 'deep_research', objective: 'x', language: 'es' }, outline: [{ id: 'topic:t1' }], stats: { selectedWorks: 1 },
    completeGuide: { sources: [{}, {}], config: { instructions: 'Prioriza fórmulas' }, cheatSheetMarkdown: '# Ficha\n\n- x' },
  };
  assert.deepEqual(guideParts(SAMPLE).map((part) => part.title), ['Cómo usar esta guía', 'Tema 1 · Gases', 'Glosario', 'Ficha de repaso']);
  const input = completeGuideReportInput(draft);
  assert.equal(input.kindLabel, 'Guía de estudio');
  assert.deepEqual(input.sections.map((section) => [section.number, section.title, Boolean(section.pageBreakBefore)]), [
    ['01', 'Cómo usar esta guía', false], ['02', 'Tema 1 · Gases', true], ['03', 'Glosario', true], ['04', 'Ficha de repaso', true],
  ]);
  assert.match(input.sections[0].html, /<style>[\s\S]*\.gc \{/, 'guide styles travel with the first section');
  assert.equal(input.objective, 'Prioriza fórmulas');
  assert.equal(input.metrics[1].value, '2');
  // The first metric counts topics (the chapters), not the numbered parts the contents lists.
  assert.deepEqual(input.metrics[0], { value: '1', label: 'temas' });
  const html = renderProfessionalReportHtml(input);
  // Without a picture the cover is typography only; the decorative motif that said nothing is gone.
  assert.match(html, /class="cover cover-plain"/);
  assert.doesNotMatch(html, /cover-motif/);
  assert.match(renderProfessionalReportHtml({ ...input, imageDataUrl: 'data:image/png;base64,AAAA' }), /class="cover"[\s\S]*class="cover-image"/);
  assert.match(html, /Variables de estado/, 'chapter headings reach the table of contents');
  assert.match(completeGuideMarkdown(draft), /^# Guía de estudio: Gases\n\nResumen del temario\.\n\n## Cómo usar esta guía/);
});

test('the reference parts are not chapters: no page break, the reference class; old guides keep their titles', () => {
  const markdown = ['## Cómo usar esta guía', '', 'x', '', '## Tema 1 · Gases', '', 'y', '', '## Fuentes y cobertura', '', 'z', '', '## Cobertura y limitaciones', '', 'w', '', '## Índice de fuentes', '', 'v'].join('\n');
  const draft = { title: 'G', abstract: '', generatedAt: '2026-09-28T10:00:00.000Z', draftMarkdown: markdown, brief: { kind: 'deep_research', objective: 'x', language: 'es' }, outline: [{ id: 't' }], stats: { selectedWorks: 1 } };
  const sections = completeGuideReportInput(draft).sections;
  assert.deepEqual(sections.map((section) => [section.title, section.className, Boolean(section.pageBreakBefore)]), [
    ['Cómo usar esta guía', 'guide-reference', false], ['Tema 1 · Gases', 'guide-chapter', true], ['Fuentes y cobertura', 'guide-reference', false],
    ['Cobertura y limitaciones', 'guide-reference', false], ['Índice de fuentes', 'guide-reference', false],
  ]);
});

test('Word export: native equations (OMML), tables, callout boxes and a table of contents', async () => {
  assert.ok(latexToDocxMath('\\frac{a}{b} + \\sqrt{x} + x^{2}_{i}'));
  assert.ok(latexToDocxMath('\\ce{2H2 + O2 -> 2H2O}'), 'chemistry converts too');
  assert.equal(latexToDocxMath('\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}'), null, 'unsupported structures fall back to text');
  const bytes = await completeGuideDocx(`# Guía\n\n${SAMPLE}\n\n$$\n\\frac{n}{V} = \\sqrt{2}\n$$`, { title: 'Guía de estudio: Gases', contentsLabel: 'Contenido' });
  const xml = new AdmZip(bytes).readAsText('word/document.xml');
  assert.match(xml, /<m:oMath>/, 'equations are native Word math');
  assert.match(xml, /<m:f>/, 'fractions');
  assert.match(xml, /<m:rad>/, 'radicals');
  assert.match(xml, /<w:tbl>/, 'tables and callout boxes are Word tables');
  assert.match(xml, /GASES IDEALES|FÓRMULA · GASES IDEALES/);
  assert.match(xml, /TOC \\h/, "table of contents field");
  assert.match(xml, /A1 · p\. 1/, 'citations stay readable');
  assert.doesNotMatch(xml, /\[!formula\]/, 'no raw callout markers');
});
