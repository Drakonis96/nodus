// Complete study guide content rules: quote anchoring, model-output sanitizing,
// provenance decisions, plan coverage, locators and the item-built reference sections.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
async function load(entry) {
  const built = await build({ entryPoints: [entry], bundle: true, write: false, format: 'cjs', platform: 'node' });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', built.outputFiles[0].text)(module, module.exports, require_);
  return module.exports;
}
const items = await load('shared/completeGuide/items.ts');
const blocks = await load('shared/completeGuide/blocks.ts');
const plan = await load('shared/completeGuide/plan.ts');
const reference = await load('shared/completeGuide/reference.ts');
const locators = await load('shared/completeGuide/locators.ts');
const { guideShape } = await load('shared/completeGuide/shape.ts');
const { COMPLETE_GUIDE_LABELS, completeGuideLabels } = await load('shared/completeGuide/labels.ts');
const labels = completeGuideLabels('es');

test('quotes anchor through ligatures, hyphenation, typographic quotes and case; invented quotes do not', () => {
  const passage = 'La con-\nstante de equilibrio “Kc” depende de la tem­peratura. Se calcula con las ﬁguras del apartado.';
  assert.equal(items.anchorQuote(passage, 'la constante de equilibrio "Kc" depende de la temperatura'), 'exact');
  assert.equal(items.anchorQuote(passage, 'Se calcula con las figuras del apartado'), 'exact');
  assert.equal(items.anchorQuote(passage, 'constante de equilibrio depende de la temperatura absoluta'), 'fuzzy');
  assert.equal(items.anchorQuote(passage, 'El argón es un gas de color verde intenso'), 'missing');
  assert.equal(items.anchorQuote(passage, 'Kc'), 'missing', 'too short to prove anything');
  const window = [{ id: 'A1.1', text: 'Primera página sin fórmulas relevantes para este caso.' }, { id: 'A1.2', text: 'P V = n R T para gases ideales a baja presión.' }];
  const neighbour = items.anchorRawItem({ type: 'fact', passageId: 'A1.1', quote: 'para gases ideales a baja presión' }, window);
  assert.equal(neighbour.passage.id, 'A1.2', 'a quote in the neighbouring passage is re-anchored');
  const garbled = items.anchorRawItem({ type: 'formula', passageId: 'A1.1', quote: 'PV=nRT' }, window);
  assert.equal(garbled.reconstructed, true, 'a formula whose text is damaged survives, flagged');
  assert.equal(items.anchorRawItem({ type: 'definition', passageId: 'A1.1', quote: 'PV=nRT' }, window), null);
});

test('raw items are validated and merged; semantic duplicates merge within a unit only', () => {
  assert.equal(items.normalizeRawItem({ type: 'definition', statement: '', passageId: 'A1.1' }), null);
  const raw = items.normalizeRawItem({ type: 'weird', title: '', statement: 'La  presión es\nfuerza/área.', importance: 'vital', passageId: 'A1.1', quote: 'x', latex: '$$P=F/A$$', variables: [{ symbol: 'P', meaning: 'presión', unit: 'Pa' }, { symbol: '' }] });
  assert.equal(raw.type, 'concept');
  assert.equal(raw.importance, 'support');
  assert.equal(raw.latex, 'P=F/A');
  assert.deepEqual(raw.variables, [{ symbol: 'P', meaning: 'presión', unit: 'Pa' }]);
  const noted = items.normalizeRawItem({ type: 'fact', title: '## Repaso', statement: '> [!note] # Repaso El agua pura tiene pH 7. ## Indicadores Si T > 0 vale.', passageId: 'D1.1', quote: '# Repaso' });
  assert.equal(noted.title, 'Repaso', 'block markup copied from notes is removed');
  assert.equal(noted.statement, 'Repaso El agua pura tiene pH 7. Indicadores Si T > 0 vale.', 'comparisons survive');
  assert.equal(noted.quote, '# Repaso', 'quotes keep the raw text for anchoring');
  const passage = (id, sourceKey = 'material:a') => ({ id, sourceKey });
  const pending = [
    { raw: { ...raw, type: 'definition', statement: 'Presión: fuerza por área', importance: 'support' }, passage: passage('A1.2'), anchor: 'exact', position: 0 },
    { raw: { ...raw, type: 'definition', statement: 'presión:  FUERZA por área', importance: 'core' }, passage: passage('A1.1'), anchor: 'fuzzy', position: 0 },
    { raw: { ...raw, type: 'fact', statement: 'Otro hecho' }, passage: passage('B1.1', 'material:b'), anchor: 'exact', position: 1 },
  ];
  const order = new Map([['A1.1', 0], ['A1.2', 1], ['B1.1', 2]]);
  const finalized = items.finalizeItems(pending, order, new Map([['material:a', 'topic:1'], ['material:b', 'topic:2']]));
  assert.deepEqual(finalized.map((item) => item.id), ['K0001', 'K0002']);
  assert.equal(finalized[0].evidence.length, 2);
  assert.equal(finalized[0].importance, 'core');
  assert.equal(finalized[1].unitKey, 'topic:2');
  const near = items.mergeNearDuplicates(
    [{ ...finalized[0], type: 'definition' }, { ...finalized[0], id: 'K0002', statement: 'Presión: fuerza ejercida por unidad de área', evidence: [{ passageId: 'A1.9', sourceKey: 'material:a' }] }, { ...finalized[1], id: 'K0003', type: 'definition', unitKey: 'topic:2' }],
    [[1, 0], [0.99, 0.05], [1, 0]],
  );
  assert.deepEqual(near.items.map((item) => item.id), ['K0001', 'K0002']);
  assert.equal(near.items[0].evidence.length, 3);
  assert.match(near.items[0].statement, /ejercida/);
  assert.equal(items.looksDense('Se define la entalpía como H = U + PV'), true);
  assert.equal(items.looksDense('Índice'), false);
});

test('model markdown loses links, callout markers, headings and pseudo-citations; provenance comes from data', () => {
  const dirty = '# Título\n> [!note] fake\nTexto [A1](nodus://study/material/x?page=2) y [web](https://evil.test) y https://x.test [A1 · p. 3] (K0001) <b>x</b>.';
  assert.equal(blocks.sanitizeModelMarkdown(dirty), '**Título**\n\nTexto y web y x.');
  const itemMap = new Map([['K0001', { id: 'K0001', type: 'definition' }], ['K0002', { id: 'K0002', type: 'mistake' }]]);
  const result = blocks.normalizeWrittenBlocks({ blocks: [
    { kind: 'definition', itemIds: ['k0001', 'K0404'], markdown: 'Def.' },
    { kind: 'explanation', itemIds: [], markdown: 'Sin respaldo.' },
    { kind: 'ai_example', itemIds: ['K0001'], markdown: 'Globo.' },
    { kind: 'mistake', itemIds: ['K0002'], markdown: 'Error del material.' },
    { kind: 'mistake', itemIds: ['K0001'], markdown: 'Error sugerido.' },
    { kind: 'table', itemIds: ['K0001'], table: { headers: ['A', 'B|C'], rows: [['1', '2'], []] } },
    { kind: 'selfcheck', itemIds: ['K0001'], question: '¿Q?', answer: '' },
    { kind: 'web', itemIds: ['K0001'], markdown: 'Pretends to be web.' },
  ] }, { validItemIds: new Set(['K0001', 'K0002']), items: itemMap, aiExamples: true });
  // A block that claims to be web without recorded passages is dropped, never relabelled as material.
  assert.deepEqual(result.blocks.map((block) => `${block.kind}:${block.provenance}`), ['definition:materials', 'ai_example:ai', 'mistake:materials', 'mistake:ai', 'table:materials']);
  assert.deepEqual(result.blocks[0].itemIds, ['K0001']);
  assert.deepEqual(result.blocks[4].table, { headers: ['A', 'B\\|C'], rows: [['1', '2']] });
  assert.deepEqual(result.dropped, { unsupported: 2, aiDisabled: 0, malformed: 1, redundant: 0 });
  // "To memorize" restates what the prose says; the review sheet is where the guide says what to remember.
  const memorize = blocks.normalizeWrittenBlocks({ blocks: [{ kind: 'memorize', itemIds: ['K0001'], markdown: '- P = F/S' }, { kind: 'explanation', itemIds: ['K0001'], markdown: 'La presión es fuerza por área.' }] },
    { validItemIds: new Set(['K0001']), items: itemMap, aiExamples: true });
  assert.deepEqual(memorize.blocks.map((block) => block.kind), ['explanation']);
  assert.equal(memorize.dropped.redundant, 1);
  const web = blocks.normalizeWrittenBlocks({ blocks: [{ kind: 'web', itemIds: ['K0001'], webPassageIds: ['web:abc123abc123', 'web:unknown'], markdown: 'Contexto [W1](https://x.test).' }] },
    { validItemIds: new Set(['K0001']), items: itemMap, aiExamples: true, webIds: new Set(['web:abc123abc123']) });
  assert.deepEqual(web.blocks.map((block) => [block.provenance, block.webPassageIds, block.markdown]), [['web', ['web:abc123abc123'], 'Contexto.']]);
  const webRendered = blocks.renderBlock(web.blocks[0], { labels, cite: () => ['[A1](nodus://study/material/m)'], citeWeb: (id) => `[W1 · x.test](nodus://passage/${encodeURIComponent(id)})` }).markdown;
  assert.equal(webRendered, '> [!web] Fuentes web\n> Contexto.\n>\n> *Fuente web: no procede de tus materiales.*\n>\n> [W1 · x.test](nodus://passage/web%3Aabc123abc123)');
  const strict = blocks.normalizeWrittenBlocks({ blocks: [{ kind: 'ai_analogy', itemIds: [], markdown: 'x' }, { kind: 'mistake', itemIds: ['K0001'], markdown: 'y' }] }, { validItemIds: new Set(['K0001']), items: itemMap, aiExamples: false });
  assert.equal(strict.blocks.length, 0);
  assert.equal(strict.dropped.aiDisabled, 2);
  const cite = () => ['[A1 · p. 2](nodus://study/material/m?page=2&e=K0001)'];
  const ai = blocks.renderBlock({ kind: 'ai_example', provenance: 'ai', markdown: 'Globo.', itemIds: ['K0001'] }, { labels, cite }).markdown;
  assert.match(ai, /^> \[!ai-example\] Ejemplo \(IA\)/);
  assert.ok(ai.includes('*Elaborado por IA: no procede de tus materiales.*'), 'without guide state every AI block carries the full notice');
  assert.ok(!ai.includes('nodus://'));
  // A definition is a sentence in a paragraph, cited after it; only a legacy title survives, as a lead-in.
  const definition = blocks.renderBlock({ kind: 'definition', provenance: 'materials', title: 'Presión', markdown: 'Fuerza.', itemIds: ['K0001'] }, { labels, cite }).markdown;
  assert.equal(definition, '**Presión.** Fuerza. ([A1 · p. 2](nodus://study/material/m?page=2&e=K0001))');
});

test('the AI notice is written in full once; later AI blocks carry only the mark', () => {
  const cite = () => [];
  const state = { aiNoticeShown: false };
  const render = (kind, markdown, extra = {}) => blocks.renderBlock({ kind, provenance: 'ai', markdown, itemIds: ['K0001'], ...extra }, { labels, cite, state }).markdown;
  const first = render('ai_example', 'Globo.');
  const second = render('ai_analogy', 'Como un mapa.', { title: 'El mapa' });
  const third = render('mistake', 'Confundir masa y peso.');
  assert.equal(first, '> [!ai-example] Ejemplo (IA)\n> Globo.\n>\n> *Elaborado por IA: no procede de tus materiales.*');
  assert.equal(second, '> [!ai-analogy] Analogía (IA) · El mapa\n> Como un mapa.');
  assert.equal(third, '> [!ai-mistake] Error frecuente (IA)\n> Confundir masa y peso.');
  assert.equal([first, second, third].join('\n').split(labels.aiNote).length - 1, 1);
  // Web pages keep their note on every block: they are cited apart and the note is short.
  const web = blocks.renderBlock({ kind: 'web', provenance: 'web', markdown: 'Contexto.', itemIds: [], webPassageIds: ['web:1'] }, { labels, cite, citeWeb: () => '[W1](nodus://passage/web%3A1)', state });
  assert.match(web.markdown, /Fuente web: no procede de tus materiales\./);
});

test('boxes only for a different mode of reading: definitions, rules, formulas and procedures are prose', () => {
  const cite = (id) => [`[A1 · p. 1](nodus://study/material/m?page=1&e=${id})`];
  const render = (block) => blocks.renderBlock({ provenance: 'materials', itemIds: ['K0001'], ...block }, { labels, cite }).markdown;
  for (const kind of ['explanation', 'definition', 'rule', 'formula', 'procedure']) assert.ok(!render({ kind, markdown: 'Texto.' }).startsWith('>'), kind);
  assert.equal(render({ kind: 'explanation', title: 'Ignorado', markdown: 'La **presión** es fuerza por área.' }), 'La **presión** es fuerza por área. ([A1 · p. 1](nodus://study/material/m?page=1&e=K0001))');
  assert.match(render({ kind: 'example', title: 'Conversión', markdown: '1 atm = 101325 Pa.' }), /^> \[!example\] Ejemplo de los materiales · Conversión\n> 1 atm = 101325 Pa\.\n>\n> \[A1 · p\. 1\]/);
  assert.match(render({ kind: 'mistake', markdown: 'No uses °C.' }), /^> \[!mistake\] Error frecuente\n/);
  // Citations go on a line of their own after a list, a table or a displayed formula.
  assert.equal(blocks.appendCitations('1. Uno\n2. Dos', '[A1]'), '1. Uno\n2. Dos\n\n([A1])');
  assert.equal(blocks.appendCitations('Se cumple\n\n$$\nPV = nRT\n$$', '[A1]'), 'Se cumple\n\n$$\nPV = nRT\n$$\n\n([A1])');
  assert.equal(blocks.appendCitations('Una frase.', ''), 'Una frase.');
  assert.equal(render({ kind: 'explanation', markdown: 'Se cumple $$PV = nRT$$' }), 'Se cumple\n\n$$\nPV = nRT\n$$\n\n([A1 · p. 1](nodus://study/material/m?page=1&e=K0001))');
  // A sentence the audit verified already links its item: only the items no link points to are cited after it.
  const audited = render({ kind: 'explanation', itemIds: ['K0001', 'K0002'], markdown: 'La presión es fuerza por área. [A1 · p. 1](nodus://study/material/m?page=1&e=K0001)' });
  assert.ok(!audited.endsWith('e=K0001))'), 'K0001 is not cited twice');
  assert.match(audited, /\(\[A1 · p\. 1\]\(nodus:\/\/study\/material\/m\?page=1&e=K0002\)\)$/);
});

test('a box title does not say again what the box is', () => {
  assert.equal(blocks.boxTitle('Ejemplo: convertir 0,5 atm a Pa', 'Ejemplo (IA)'), 'convertir 0,5 atm a Pa');
  assert.equal(blocks.boxTitle('Ejemplo resuelto: 2 mol a 300 K', 'Ejemplo de los materiales'), '2 mol a 300 K');
  assert.equal(blocks.boxTitle('Error frecuente: quedarse solo con Cuba', 'Error frecuente (IA)'), 'quedarse solo con Cuba');
  assert.equal(blocks.boxTitle('Error frecuente', 'Error frecuente (IA)'), '');
  assert.equal(blocks.boxTitle('El precio por unidad', 'Analogía (IA)'), 'El precio por unidad');
  assert.equal(blocks.boxTitle('Ejemplos de la ley en la cocina', 'Ejemplo (IA)'), 'Ejemplos de la ley en la cocina', 'no colon: the title says something else');
  assert.equal(blocks.boxTitle('示例：转换压强', '示例（AI）'), '转换压强');
  assert.equal(blocks.boxTitle(undefined, 'Ejemplo (IA)'), '');
  const rendered = blocks.renderBlock({ kind: 'ai_example', provenance: 'ai', title: 'Ejemplo: aplicar Boyle', markdown: 'Un gas a 2 atm.', itemIds: ['K0001'] }, { labels, cite: () => [], state: { aiNoticeShown: true } }).markdown;
  assert.equal(rendered, '> [!ai-example] Ejemplo (IA) · aplicar Boyle\n> Un gas a 2 atm.');
});

test('LaTeX delimiters other than dollars are converted before anything else reads the formula', () => {
  assert.equal(blocks.sanitizeModelMarkdown('En \\(\\mathrm{pH}\\) y \\(K_w = 1{,}0\\cdot 10^{-14}\\) valen.'), 'En $\\mathrm{pH}$ y $K_w = 1{,}0\\cdot 10^{-14}$ valen.');
  assert.equal(blocks.sanitizeModelMarkdown('Se cumple\n\\[\nPV = nRT\n\\]\nsiempre.'), 'Se cumple\n$$PV = nRT$$\nsiempre.');
  assert.equal(blocks.sanitizeModelMarkdown('Matriz con salto $a \\\\[2pt] b$ intacta.'), 'Matriz con salto $a \\\\[2pt] b$ intacta.', 'a line break with spacing inside a formula is not a delimiter');
  assert.equal(blocks.sanitizeModelMarkdown('Coste de $5 y $6.'), 'Coste de $5 y $6.');
});

test('at most one AI addition per section, the first; the audit\'s leftovers are tidied', () => {
  const list = [
    { kind: 'explanation', provenance: 'materials' }, { kind: 'ai_example', provenance: 'ai' }, { kind: 'ai_analogy', provenance: 'ai' },
    { kind: 'mistake', provenance: 'ai' }, { kind: 'mistake', provenance: 'materials' }, { kind: 'web', provenance: 'web' },
  ];
  const capped = blocks.capAiBlocks(list);
  assert.deepEqual(capped.blocks.map((block) => block.kind), ['explanation', 'ai_example', 'mistake', 'web']);
  assert.equal(capped.dropped, 2);
  assert.equal(blocks.capAiBlocks([{ kind: 'explanation', provenance: 'materials' }]).dropped, 0);
  // Events over time: no analogy and no invented example, a warning about a confusion may stay.
  const narrative = blocks.capAiBlocks(list, 1, ['ai_example', 'ai_analogy']);
  assert.deepEqual(narrative.blocks.map((block) => block.kind), ['explanation', 'mistake', 'mistake', 'web']);
  assert.equal(narrative.dropped, 2);
  // Steps the audit removed leave a list that counts 1, 2, 3, 6; a removed opener leaves a lone **.
  assert.equal(blocks.renumberOrderedLists('1. Uno\n2. Dos\n3. Tres\n\n6. Seis\n\nFin.\n\n5. Otra lista'), '1. Uno\n2. Dos\n3. Tres\n\n4. Seis\n\nFin.\n\n5. Otra lista');
  assert.equal(blocks.renumberOrderedLists('1. Uno\n   1. Sub\n   2. Sub\n2. Dos'), '1. Uno\n   1. Sub\n   2. Sub\n2. Dos');
  assert.equal(blocks.renumberOrderedLists('1874. Sagunto.\n\n1876. La Constitución.'), '1874. Sagunto.\n\n1876. La Constitución.', 'a year at the start of a paragraph is not a step');
  assert.equal(blocks.removeStrayBold('Identifica el año.** Se trata de **1898**.'), 'Identifica el año. Se trata de **1898**.');
  assert.equal(blocks.removeStrayBold('**Paso 1. Datos y resultado'), 'Paso 1. Datos y resultado');
  assert.equal(blocks.removeStrayBold('Una **frase** entera y $a**b$.'), 'Una **frase** entera y $a**b$.');
  assert.equal(blocks.tidyAuditedMarkdown('1. A\n3. B\n\nTexto.** más'), '1. A\n2. B\n\nTexto. más');
});

test('the chapter\'s questions are printed together, mixed across its sections, answers after', () => {
  const entry = (n) => ({ question: `Pregunta ${n}`, answer: `Respuesta ${n}` });
  const printed = blocks.renderPractice([[entry(1), entry(2), entry(3)], [entry(4)], [], [entry(5), entry(6)]], labels);
  assert.equal(printed, [
    '> [!selfcheck] Autoevaluación\n>\n> 1. Pregunta 1\n> 2. Pregunta 4\n> 3. Pregunta 5\n> 4. Pregunta 2\n> 5. Pregunta 6\n> 6. Pregunta 3',
    '**Respuestas de autoevaluación**',
    '**1.** Respuesta 1', '**2.** Respuesta 4', '**3.** Respuesta 5', '**4.** Respuesta 2', '**5.** Respuesta 6', '**6.** Respuesta 3',
  ].join('\n\n'));
  assert.equal(blocks.renderPractice([[], []], labels), '');
  const rendered = blocks.renderBlock({ kind: 'selfcheck', provenance: 'derived', question: 'Explica $$P=F/S$$', answer: 'Es fuerza por área.', markdown: '', itemIds: ['K0001'] }, { labels, cite: () => ['[A1]'] });
  assert.equal(rendered.markdown, '');
  assert.deepEqual(rendered.practice, { question: 'Explica $P=F/S$', answer: 'Es fuerza por área. ([A1])' });
});

test('chapter plans assign every item exactly once and split oversized sections', () => {
  const list = Array.from({ length: 50 }, (_, index) => ({ id: `K${String(index + 1).padStart(4, '0')}`, order: index }));
  const result = plan.normalizeChapterPlan({ overview: 'x', sections: [
    { title: 'A', itemIds: ['K0001', 'K0002', 'K0002', 'K9999'] },
    { title: 'B', itemIds: ['K0002', ...list.slice(10, 50).map((item) => item.id)] },
    { title: '', itemIds: ['K0003'] },
  ] }, { unitKey: 'topic:1', title: 'Unidad', items: list });
  const all = result.sections.flatMap((section) => section.itemIds);
  assert.equal(all.length, 50);
  assert.equal(new Set(all).size, 50);
  assert.ok(result.sections.every((section) => section.itemIds.length <= 36));
  assert.ok(result.sections.some((section) => /\(1\/2\)/.test(section.title)));
  assert.ok(result.sections[0].itemIds.includes('K0005'), 'unassigned items join their nearest neighbour');
  assert.equal(plan.normalizeChapterPlan(null, { unitKey: 'u', title: 'Solo', items: list.slice(0, 3) }).sections[0].title, 'Solo');
});

test('locators, citation links and "read more" ranges', () => {
  const material = { kind: 'material', sourceId: 'm 1', alias: 'A1', title: 'Manual', sourceKey: 'material:m 1' };
  const recording = { kind: 'transcript', sourceId: 'tr', recordingId: 'rec', alias: 'G1', title: 'Clase', sourceKey: 'transcript:tr' };
  assert.equal(locators.citationLink(material, { locator: { kind: 'page', page: 12, from: 0, to: 1 } }, labels, 'K0003'), '[A1 · p. 12](nodus://study/material/m%201?page=12&e=K0003)');
  assert.equal(locators.citationUrl(recording, { kind: 'time', start: 754.6, end: 800, segmentIds: [] }), 'nodus://study/recording/rec?t=754');
  assert.equal(locators.locatorLabel({ kind: 'time', start: 3754, end: 0, segmentIds: [] }, labels), '1:02:34');
  assert.equal(locators.locatorLabel({ kind: 'slide', slide: 4, from: 0, to: 0 }, labels), 'diap. 4');
  const ranges = locators.readMoreRanges([material, recording], [
    { sourceKey: 'material:m 1', locator: { kind: 'page', page: 3 } }, { sourceKey: 'material:m 1', locator: { kind: 'page', page: 4 } },
    { sourceKey: 'material:m 1', locator: { kind: 'page', page: 9 } }, { sourceKey: 'transcript:tr', locator: { kind: 'time', start: 60, end: 200 } },
  ], labels);
  assert.deepEqual(ranges.map((entry) => entry.ranges), ['pp. 3–4, 9', '1:00–3:20']);
});

test('reference sections come from items: glossary, formula sheet, timeline, review sheet', () => {
  const cite = (id) => [`[A1 · p. 1](nodus://study/material/m?page=1&e=${id})`];
  const list = [
    { id: 'K0001', type: 'definition', title: 'Presión', statement: 'Fuerza por unidad de área.', importance: 'core', order: 1 },
    { id: 'K0002', type: 'formula', title: 'Gases ideales', statement: 'PV = nRT', latex: 'PV = nRT', variables: [{ symbol: 'R', meaning: 'constante', unit: 'J/(mol·K)' }], conditions: ['baja presión'], importance: 'core', order: 2 },
    { id: 'K0003', type: 'event', title: 'Revolución', statement: 'Toma de la Bastilla.', date: '1789', importance: 'core', order: 3 },
    { id: 'K0004', type: 'event', title: 'César', statement: 'Muerte de César.', date: '44 a. C.', importance: 'core', order: 4 },
    { id: 'K0005', type: 'event', title: 'Imprenta', statement: 'Gutenberg.', date: 's. XV', importance: 'core', order: 5 },
  ];
  assert.match(reference.renderGlossary(list, cite, labels), /\| Presión \| Fuerza por unidad de área\. \| \[A1 · p\. 1\]/);
  const sheet = reference.renderFormulaSheet([{ title: 'Gases', items: list }], cite, labels);
  assert.match(sheet, /\$\$\nPV = nRT\n\$\$/);
  assert.match(sheet, /\*Condiciones:\* baja presión/);
  const timeline = reference.renderTimeline(list, cite, labels);
  assert.ok(timeline.indexOf('44 a. C.') < timeline.indexOf('s. XV') && timeline.indexOf('s. XV') < timeline.indexOf('1789'));
  assert.equal(reference.acceptCheatPhrase('PV = nRT para gases ideales', list[1]), 'PV = nRT para gases ideales');
  assert.match(reference.acceptCheatPhrase('La presión vale 101325 Pa siempre', list[0]), /^Presión: Fuerza/, 'a phrase with a new number falls back to the item');
  const water = { id: 'K0100', type: 'fact', title: 'Producto iónico', statement: `A 25 °C el producto iónico del agua vale $K_w = 1{,}0 \\cdot 10^{-14}$. ${'Texto largo. '.repeat(16)}` };
  const cut = reference.acceptCheatPhrase('A 25 °C el producto iónico del agua vale $K_w = 1{,}0', water);
  assert.ok(cut.startsWith('Producto iónico: A 25 °C') && cut.includes('$K_w = 1{,}0 \\cdot 10^{-14}$'), 'a phrase cut inside a formula falls back to the whole item');
  const long = { ...water, statement: `${'Texto largo previo. '.repeat(10)}vale $K_w = 1{,}0 \\cdot 10^{-14}$ a 25 °C.` };
  const truncated = reference.acceptCheatPhrase('', long);
  assert.ok(truncated.endsWith('…') && (truncated.match(/\$/g) ?? []).length % 2 === 0, `the fallback never cuts a formula: ${truncated}`);
  const cheat = reference.renderCheatSheet([{ title: 'Gases', items: list, points: [{ itemId: 'K0001', phrase: 'Presión es fuerza por área' }, { itemId: 'K0404', phrase: 'x' }] }], cite, labels);
  assert.match(cheat, /### Gases/);
  assert.match(cheat, /- Presión es fuerza por área \(\[A1/);
  assert.match(cheat, /Gases ideales: \$PV = nRT\$ — baja presión/);
});

test('a chapter\'s chronology and key concepts are built from its items; dates come from the item or from its own quote', () => {
  const cite = (id) => [`[A3 · p. 1](nodus://study/material/r?page=1&e=${id})`];
  const item = (id, order, fields) => ({ id, order, type: 'definition', importance: 'core', evidence: [{ passageId: 'A3.1', sourceKey: 'material:r', quote: '', anchor: 'exact' }], ...fields });
  const history = [
    // Typed as definitions with no `date`: the year is read from the anchored quote and repeated in the title or statement.
    item('K0001', 1, { title: 'Restauración borbónica', statement: 'Periodo que comenzó en 1874 con el pronunciamiento de Sagunto.', evidence: [{ passageId: 'A3.1', sourceKey: 'material:r', quote: 'La Restauración comenzó en 1874 con el pronunciamiento de Sagunto.', anchor: 'exact' }] }),
    item('K0002', 2, { title: 'Constitución de 1876', statement: 'Texto vigente hasta 1923.', evidence: [{ passageId: 'A3.1', sourceKey: 'material:r', quote: 'La Constitución de 1876 estuvo vigente hasta 1923.', anchor: 'exact' }] }),
    item('K0003', 3, { type: 'event', title: 'Desastre del 98', statement: 'Pérdida de Cuba, Puerto Rico y Filipinas.', date: '25 de abril de 1898' }),
    item('K0004', 4, { title: 'Caciquismo', statement: 'Garantizaba los resultados electorales.', evidence: [{ passageId: 'A3.2', sourceKey: 'material:r', quote: 'El caciquismo garantizaba los resultados electorales.', anchor: 'exact' }] }),
    // A year that is not about the item (not repeated in its title or statement) does not date it.
    item('K0005', 5, { title: 'Turno pacífico', statement: 'Alternancia de conservadores y liberales.', evidence: [{ passageId: 'A3.2', sourceKey: 'material:r', quote: 'Desde 1881 el turno alternó a conservadores y liberales.', anchor: 'exact' }] }),
  ];
  const dated = reference.datedItems(history, { quoteYears: true });
  assert.deepEqual(dated.map((entry) => [entry.item.id, entry.year]), [['K0001', 1874], ['K0002', 1876], ['K0003', 1898]]);
  assert.deepEqual(reference.datedItems(history, { quoteYears: false }).map((entry) => entry.item.id), ['K0003'], 'without quote years only the recorded date counts');
  assert.equal(reference.eventYear('25 de marzo de 1874'), 1874, 'the year, not the day');
  assert.equal(reference.eventYear('44 a. C.'), -44);
  const chronology = reference.renderChronology(dated, cite, labels).split('\n');
  assert.equal(chronology.length, 3);
  assert.match(chronology[0], /^- \*\*1874\*\* — Restauración borbónica: Periodo que comenzó en 1874/);
  assert.match(chronology[2], /^- \*\*25 de abril de 1898\*\* — Desastre del 98: Pérdida de Cuba, Puerto Rico y Filipinas\. \(\[A3 · p\. 1\]/);
  const concepts = reference.renderKeyConcepts(history, cite, labels);
  assert.equal(concepts.split('\n').length, 4, 'the definitions and concepts of the chapter, one line each');
  assert.match(concepts, /^- \*\*Restauración borbónica\*\*: Periodo que comenzó en 1874/);
  assert.equal(reference.renderKeyConcepts(history.slice(0, 2), cite, labels), '', 'fewer than three concepts are not a list');
  // Chemistry: the chapter has formulas, so a number in a quote is a quantity, never a year.
  const gases = [item('K0010', 1, { type: 'formula', title: 'Gases ideales', statement: 'PV = nRT', latex: 'PV = nRT' }), item('K0011', 2, { type: 'formula', title: 'Boyle', statement: 'P1V1 = P2V2', latex: 'P_1V_1=P_2V_2' }),
    item('K0012', 3, { type: 'fact', title: 'Volumen', statement: 'Ocupa 1500 L', evidence: [{ passageId: 'A1.1', sourceKey: 'material:g', quote: 'Ocupa 1500 L a 300 K', anchor: 'exact' }] })];
  assert.deepEqual(reference.chapterProfile(gases), { kind: 'quantitative', formulas: 2, dated: 0, quoteYears: false });
  assert.equal(reference.chapterProfile(history).kind, 'narrative');
  assert.equal(reference.chapterProfile(history.slice(0, 2)).kind, 'conceptual');
  assert.equal(reference.sentenceCap('Primera frase. Segunda frase larga que no cabe.', 20), 'Primera frase.');
});

test('a chronology lists what happened once: a definition that only restates an event of its year is left to the key concepts', () => {
  const cite = (id) => [`[A3 · p. 1](nodus://study/material/r?page=1&e=${id})`];
  const entry = (id, order, type, title, statement, date) => ({ id, order, type, title, statement, date, importance: 'core', evidence: [] });
  // The paid guide: the same year twice, once as the event and once as the definition of the period it opened.
  const items = [
    entry('K0020', 1, 'event', 'Pronunciamiento de Martínez Campos en Sagunto (1874)', 'El pronunciamiento militar de Martínez Campos en Sagunto, en 1874, dio comienzo a la Restauración borbónica.', '1874'),
    entry('K0021', 2, 'definition', 'La Restauración borbónica', 'Régimen o periodo histórico que comenzó en 1874 con el pronunciamiento de Martínez Campos en Sagunto y en el que se encuadran la Constitución de 1876.', '1874'),
    entry('K0022', 3, 'fact', 'Constitución de 1876', 'La Constitución de 1876 fue la norma fundamental vigente durante la Restauración, y permaneció en vigor hasta 1923.', '1876-1923'),
    entry('K0025', 4, 'fact', 'Desastre de 1898', 'El desastre de 1898 supuso la pérdida para España de Cuba, Puerto Rico y Filipinas.', '1898'),
  ];
  const chronology = reference.chronologyOf(items);
  assert.deepEqual(chronology.map((entry) => entry.item.id), ['K0020', 'K0022', 'K0025']);
  const lines = reference.renderChronology(chronology, cite, labels).split('\n');
  // The sentence names its own subject: no title in front of it.
  assert.match(lines[0], /^- \*\*1874\*\* — El pronunciamiento militar de Martínez Campos en Sagunto, en 1874, dio comienzo/);
  assert.match(lines[1], /^- \*\*1876-1923\*\* — La Constitución de 1876 fue la norma fundamental/);
  // A definition of something no other entry of the year names is kept: it is the only entry there.
  const alone = reference.chronologyOf([entry('K0030', 1, 'definition', 'Cortes de Cádiz', 'Asamblea que en 1812 aprobó la primera Constitución.', '1812'), items[0]]);
  assert.equal(alone.length, 2);
  // Events are never dropped, even two in one year.
  assert.equal(reference.chronologyOf([items[0], entry('K0040', 5, 'event', 'Manifiesto de Sandhurst', 'El manifiesto de Sandhurst, en 1874, presentó a Alfonso XII.', '1874')]).length, 2);
});

test('the shape of a guide is measured: prose against boxes, AI share, notices', () => {
  const guide = ['## Tema', '', 'Una explicación de diez palabras que enseña algo a quien la lee.', '', '> [!ai-example] Ejemplo (IA)', '> Cinco palabras de un ejemplo.', '>', '> *Elaborado por IA: no procede de tus materiales.*', '', '> [!example] Ejemplo de los materiales', '> Tres palabras aquí.', '', 'Cierre.'].join('\n');
  const shape = guideShape(guide, labels.aiNote);
  assert.equal(shape.aiNotices, 1);
  assert.equal(shape.callouts, 2);
  assert.deepEqual(shape.byKind, { 'ai-example': 1, example: 1 });
  assert.equal(shape.aiCallouts, 1);
  assert.ok(shape.boxedWords > 0 && shape.aiWords > 0 && shape.aiWords < shape.boxedWords);
  assert.equal(shape.proseWords + shape.boxedWords, shape.words);
});

test('labels exist for all 15 generation languages and keep AI provenance explicit', () => {
  assert.equal(Object.keys(COMPLETE_GUIDE_LABELS).length, 15);
  const keys = Object.keys(COMPLETE_GUIDE_LABELS.es).sort();
  for (const [language, pack] of Object.entries(COMPLETE_GUIDE_LABELS)) {
    assert.deepEqual(Object.keys(pack).sort(), keys, language);
    for (const key of keys) assert.ok(String(pack[key]).trim(), `${language}.${key}`);
    // The AI mark in a title is the same in all three short labels and is explained in "how to use".
    const marks = [pack.aiExampleShort, pack.aiAnalogyShort, pack.aiMistakeShort].map((label) => label.match(/[（(][^）)]+[）)]/)?.[0]);
    assert.ok(marks[0] && marks.every((mark) => mark === marks[0]), `${language}: one mark on every AI title (${marks.join(' ')})`);
    assert.ok(pack.howToUseBody.includes(marks[0]), `${language}: the how-to explains ${marks[0]}`);
    // The full notice still says that it is not from the materials.
    assert.ok(pack.aiNote.trim().length > 12, language);
  }
});
