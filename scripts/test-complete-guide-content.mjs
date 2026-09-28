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
  assert.deepEqual(result.blocks.map((block) => `${block.kind}:${block.provenance}`), ['definition:materials', 'ai_example:ai', 'mistake:materials', 'mistake:ai', 'table:materials', 'explanation:materials']);
  assert.deepEqual(result.blocks[0].itemIds, ['K0001']);
  assert.deepEqual(result.blocks[4].table, { headers: ['A', 'B\\|C'], rows: [['1', '2']] });
  assert.deepEqual(result.dropped, { unsupported: 1, aiDisabled: 0, malformed: 1 });
  const strict = blocks.normalizeWrittenBlocks({ blocks: [{ kind: 'ai_analogy', itemIds: [], markdown: 'x' }, { kind: 'mistake', itemIds: ['K0001'], markdown: 'y' }] }, { validItemIds: new Set(['K0001']), items: itemMap, aiExamples: false });
  assert.equal(strict.blocks.length, 0);
  assert.equal(strict.dropped.aiDisabled, 2);
  const cite = () => ['[A1 · p. 2](nodus://study/material/m?page=2&e=K0001)'];
  const ai = blocks.renderBlock({ kind: 'ai_example', provenance: 'ai', markdown: 'Globo.', itemIds: ['K0001'] }, { labels, cite }).markdown;
  assert.match(ai, /^> \[!ai-example\] Ejemplo elaborado por IA/);
  assert.ok(!ai.includes('nodus://'));
  const definition = blocks.renderBlock({ kind: 'definition', provenance: 'materials', title: 'Presión', markdown: 'Fuerza.', itemIds: ['K0001'] }, { labels, cite }).markdown;
  assert.equal(definition, '> [!definition] Definición · Presión\n> Fuerza.\n>\n> [A1 · p. 2](nodus://study/material/m?page=2&e=K0001)');
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
  assert.match(sheet, /\$\$PV = nRT\$\$/);
  assert.match(sheet, /\*Condiciones:\* baja presión/);
  const timeline = reference.renderTimeline(list, cite, labels);
  assert.ok(timeline.indexOf('44 a. C.') < timeline.indexOf('s. XV') && timeline.indexOf('s. XV') < timeline.indexOf('1789'));
  assert.equal(reference.acceptCheatPhrase('PV = nRT para gases ideales', list[1]), 'PV = nRT para gases ideales');
  assert.match(reference.acceptCheatPhrase('La presión vale 101325 Pa siempre', list[0]), /^Presión: Fuerza/, 'a phrase with a new number falls back to the item');
  const cheat = reference.renderCheatSheet([{ title: 'Gases', items: list, points: [{ itemId: 'K0001', phrase: 'Presión es fuerza por área' }, { itemId: 'K0404', phrase: 'x' }] }], cite, labels);
  assert.match(cheat, /### Gases/);
  assert.match(cheat, /- Presión es fuerza por área \(\[A1/);
  assert.match(cheat, /Gases ideales: \$PV = nRT\$ — baja presión/);
});

test('labels exist for all 15 generation languages and keep AI provenance explicit', () => {
  assert.equal(Object.keys(COMPLETE_GUIDE_LABELS).length, 15);
  const keys = Object.keys(COMPLETE_GUIDE_LABELS.es).sort();
  for (const [language, pack] of Object.entries(COMPLETE_GUIDE_LABELS)) {
    assert.deepEqual(Object.keys(pack).sort(), keys, language);
    for (const key of keys) assert.ok(String(pack[key]).trim(), `${language}.${key}`);
  }
});
