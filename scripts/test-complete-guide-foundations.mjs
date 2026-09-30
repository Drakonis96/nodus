// Complete study guide, milestone 1: config validation, selection expansion over the
// study organization, the frozen reading snapshot, the composer tree and the estimate.
// All pure modules, bundled with esbuild; no database, network or model.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';

function load(entry) {
  const built = buildSync({ entryPoints: [entry], bundle: true, write: false, format: 'cjs', platform: 'node' });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', built.outputFiles[0].text)(module, module.exports, () => ({}));
  return module.exports;
}

const { normalizeCompleteGuideConfig, CompleteGuideConfigError } = load('shared/completeGuide/types.ts');
const { resolveCompleteGuideSelection } = load('shared/completeGuide/selection.ts');
const { buildCompleteGuideSnapshot, splitReadingBlock, compactRanges } = load('shared/completeGuide/snapshot.ts');
const { buildCompleteGuideTree, completeGuideNodeState, toggleCompleteGuideGroup, toggleCompleteGuideSource } = load('shared/completeGuide/tree.ts');
const { estimateCompleteGuide } = load('shared/completeGuide/estimate.ts');

const scope = (extra = {}) => ({ courseId: null, subjectId: null, folderId: null, topicId: null, ...extra });
const named = (id, name, position, extra = {}) => ({ id, name, position, ...extra });
const organization = {
  courses: [named('c1', '2º Bachillerato', 0)],
  subjects: [named('chem', 'Química', 0, { courseId: 'c1' }), named('hist', 'Historia', 1, { courseId: 'c1' })],
  folders: [
    named('f-org', 'Orgánica', 0, { courseId: 'c1', subjectId: 'chem', parentId: null }),
    named('f-org-ex', 'Exámenes', 0, { courseId: 'c1', subjectId: 'chem', parentId: 'f-org' }),
    named('f-cycle-a', 'A', 5, { courseId: null, subjectId: null, parentId: 'f-cycle-b' }),
    named('f-cycle-b', 'B', 6, { courseId: null, subjectId: null, parentId: 'f-cycle-a' }),
  ],
  topics: [
    // Deliberately titled so that alphabetical order is wrong: position decides.
    named('t2', 'Tema 2 · Ácidos', 1, { subjectId: 'chem', folderId: null, parentId: null }),
    named('t1', 'Tema 1 · Enlace', 0, { subjectId: 'chem', folderId: null, parentId: null }),
    named('t1a', 'Enlace covalente', 0, { subjectId: 'chem', folderId: null, parentId: 't1' }),
    named('t-org', 'Alcanos', 0, { subjectId: 'chem', folderId: 'f-org', parentId: null }),
    named('t-hist', 'Revolución industrial', 0, { subjectId: 'hist', folderId: null, parentId: null }),
  ],
};
const source = (key, title, placements, extra = {}) => {
  const [kind, sourceId] = key.split(':');
  return { sourceKey: key, kind, sourceId, title, placements, available: true, ...extra };
};
const catalog = [
  source('material:bond', 'Apuntes de enlace', [scope({ topicId: 't1a' })]),
  source('material:acids', 'Ácidos y bases', [scope({ topicId: 't2' })]),
  source('material:alk', 'Alcanos', [scope({ topicId: 't-org' })]),
  source('material:exam', 'Examen orgánica', [scope({ folderId: 'f-org-ex' })]),
  source('material:shared', 'Tabla periódica', [scope({ topicId: 't1' }), scope({ subjectId: 'hist' })]),
  source('material:empty', 'Escaneado', [scope({ topicId: 't1' })], { available: false, unavailableReason: 'no_content' }),
  source('document:note', 'Mis apuntes', [scope({ topicId: 't1' })]),
  source('transcript:lit', 'Clase 3 (literal)', [scope({ topicId: 't2' })], { recordingId: 'rec3', transcriptKind: 'literal' }),
  source('transcript:cor', 'Clase 3 (corregida)', [scope({ topicId: 't2' })], { recordingId: 'rec3', transcriptKind: 'corrected' }),
  source('material:industry', 'La fábrica', [scope({ topicId: 't-hist' })]),
];
const keys = (resolved) => resolved.sources.map((item) => item.sourceKey).sort();

test('config fails closed and normalizes defaults', () => {
  assert.throws(() => normalizeCompleteGuideConfig({ selection: { nodes: [] } }), (error) => error instanceof CompleteGuideConfigError && error.code === 'empty_selection');
  assert.throws(() => normalizeCompleteGuideConfig({ selection: { nodes: [{ kind: 'source', id: 'question:q1' }] } }), /no admitida/);
  assert.throws(() => normalizeCompleteGuideConfig({ selection: { nodes: [{ kind: 'planet', id: 'x' }] } }), /no válido/);
  assert.throws(() => normalizeCompleteGuideConfig(null), /no válida/);
  const config = normalizeCompleteGuideConfig({
    runId: 'cg-keep-me', instructions: `  ${'x'.repeat(13_000)}  `,
    selection: { nodes: [{ kind: 'topic', id: 't1' }, { kind: 'topic', id: 't1' }], excludedSourceKeys: ['material:a', 'bogus'] },
  });
  assert.equal(config.runId, 'cg-keep-me');
  assert.equal(config.instructions.length, 12_000);
  assert.deepEqual(config.selection.nodes, [{ kind: 'topic', id: 't1' }]);
  assert.deepEqual(config.selection.excludedSourceKeys, ['material:a']);
  assert.equal(config.aiExamples, true, 'AI examples are on by default');
  assert.equal(config.webText, false);
  assert.equal(config.webImages, false);
  assert.equal(config.verification, 'standard');
  assert.equal(config.maxCostUsd, null);
  assert.match(normalizeCompleteGuideConfig({ selection: { nodes: [{ kind: 'subject', id: 's' }] } }).runId, /^cg-/);
  assert.equal(normalizeCompleteGuideConfig({ aiExamples: false, selection: { nodes: [{ kind: 'subject', id: 's' }] } }).aiExamples, false);
});

test('a unit includes its subunits; a folder includes subfolders and the units filed in it', () => {
  const unit = resolveCompleteGuideSelection({ nodes: [{ kind: 'topic', id: 't1' }], excludedSourceKeys: [] }, catalog, organization);
  assert.deepEqual(keys(unit), ['document:note', 'material:bond', 'material:shared']);
  assert.deepEqual(unit.unavailable.map((item) => [item.sourceKey, item.reason]), [['material:empty', 'no_content']], 'unreadable sources are reported, not dropped');
  const folder = resolveCompleteGuideSelection({ nodes: [{ kind: 'folder', id: 'f-org' }], excludedSourceKeys: [] }, catalog, organization);
  assert.deepEqual(keys(folder), ['material:alk', 'material:exam']);
  const cycle = resolveCompleteGuideSelection({ nodes: [{ kind: 'folder', id: 'f-cycle-a' }], excludedSourceKeys: [] }, catalog, organization);
  assert.deepEqual(keys(cycle), [], 'legacy folder cycles terminate');
});

test('subject and course selections include topic-only (legacy) placements; exclusions always win', () => {
  const subject = resolveCompleteGuideSelection({ nodes: [{ kind: 'subject', id: 'chem' }], excludedSourceKeys: ['material:exam'] }, catalog, organization);
  assert.deepEqual(keys(subject), ['document:note', 'material:acids', 'material:alk', 'material:bond', 'material:shared', 'transcript:cor']);
  assert.deepEqual(subject.subjectIds, ['chem']);
  const history = resolveCompleteGuideSelection({ nodes: [{ kind: 'subject', id: 'hist' }], excludedSourceKeys: [] }, catalog, organization);
  assert.deepEqual(keys(history), ['material:industry', 'material:shared']);
  assert.equal(history.sources.find((item) => item.sourceKey === 'material:shared').matchedPlacements[0].subjectId, 'hist', 'the placement that matched decides the reading position');
  const course = resolveCompleteGuideSelection({ nodes: [{ kind: 'course', id: 'c1' }], excludedSourceKeys: [] }, catalog, organization);
  assert.equal(course.subjectIds.length, 2);
});

test('one transcript per recording, preferring the corrected one; explicit unknown keys are reported', () => {
  const resolved = resolveCompleteGuideSelection({ nodes: [{ kind: 'topic', id: 't2' }, { kind: 'source', id: 'material:gone' }], excludedSourceKeys: [] }, catalog, organization);
  assert.deepEqual(keys(resolved), ['material:acids', 'transcript:cor']);
  assert.deepEqual(resolved.superseded, [{ sourceKey: 'transcript:lit', title: 'Clase 3 (literal)', keptSourceKey: 'transcript:cor' }]);
  assert.deepEqual(resolved.unavailable.map((item) => [item.sourceKey, item.reason]), [['material:gone', 'missing']]);
  const explicit = resolveCompleteGuideSelection({ nodes: [{ kind: 'source', id: 'material:industry' }], excludedSourceKeys: [] }, catalog, organization);
  assert.deepEqual(keys(explicit), ['material:industry']);
});

test('reading blocks never overlap and never lose text', () => {
  const paragraph = (index) => `Párrafo ${index}. ${'La entalpía de reacción depende del estado de agregación. '.repeat(12)}`;
  const text = Array.from({ length: 12 }, (_, index) => paragraph(index)).join('\n\n');
  const pieces = splitReadingBlock(text, 1_500);
  assert.ok(pieces.length > 3);
  for (const piece of pieces) {
    assert.ok(piece.text.length <= 1_500);
    assert.equal(text.slice(piece.from, piece.to), piece.text, 'offsets point at the exact text');
  }
  for (let index = 1; index < pieces.length; index += 1) assert.ok(pieces[index].from >= pieces[index - 1].to, 'no overlap');
  assert.equal(pieces.map((piece) => piece.text).join('').replace(/\s+/g, ''), text.replace(/\s+/g, ''));
  assert.equal(compactRanges([9, 1, 2, 3, 7, 10, 2]), '1–3, 7, 9–10');
});

test('snapshot: page and slide locators, empty pages, preamble, notes by heading, lecture windows, order and aliases', () => {
  const resolved = resolveCompleteGuideSelection({ nodes: [{ kind: 'subject', id: 'chem' }], excludedSourceKeys: [] }, catalog, organization);
  const bySource = new Map(resolved.sources.map((item) => [item.sourceKey, item]));
  const longPage = 'Definición: un ácido de Brønsted cede protones. '.repeat(120);
  const inputs = [
    { source: bySource.get('material:acids'), updatedAt: '2026-01-02', text: `[[p. 1]]\nPortada\n[[p. 2]]\n${longPage}\n[[p. 3]]\n   \n[[p. 4]]\npH = -\\log[H_3O^+] (a 25 °C)` },
    { source: bySource.get('material:bond'), updatedAt: '2026-01-01', text: 'Diagrama: enlace covalente entre dos átomos de H.\n\n[[slide. 1]]\nEnlace covalente\n[[slide. 2]]\nPolaridad y electronegatividad' },
    { source: bySource.get('material:shared'), updatedAt: '2026-01-01', text: '[[p. 1]]\nPortada' },
    { source: bySource.get('document:note'), updatedAt: '2026-01-01', text: `# Enlace\n${'Texto del apunte sobre enlace. '.repeat(50)}\n## Iónico\nRed cristalina.\n## Metálico\nMar de electrones.` },
    { source: bySource.get('transcript:cor'), updatedAt: '2026-01-01', segments: Array.from({ length: 10 }, (_, index) => ({ id: `s${index}`, start: index * 60, end: index * 60 + 55, text: `Minuto ${index}: la constante de acidez Ka.` })) },
    { source: bySource.get('material:alk'), updatedAt: '2026-01-01', text: '[[p. 1]]\nLos alcanos son hidrocarburos saturados.' },
  ];
  const snapshot = buildCompleteGuideSnapshot(inputs, organization);
  // Units by position (Tema 1 before Tema 2 although "Á" < "E" < "T"), folder units after.
  assert.deepEqual(snapshot.sources.map((item) => item.sourceKey), [
    'material:shared', 'document:note', 'material:bond', 'material:acids', 'transcript:cor', 'material:alk',
  ]);
  assert.deepEqual(snapshot.sources.map((item) => item.alias), ['A1', 'D1', 'A2', 'A3', 'G1', 'A4']);
  const acids = snapshot.sources.find((item) => item.sourceKey === 'material:acids');
  assert.equal(acids.locatorKind, 'page');
  assert.deepEqual(acids.pages, { total: 4, withText: 3, empty: [3] });
  const acidPassages = snapshot.passages.filter((passage) => passage.sourceKey === 'material:acids');
  assert.ok(acidPassages.filter((passage) => passage.locator.page === 2).length >= 2, 'a long page is split but keeps its page');
  assert.ok(acidPassages.every((passage) => passage.chars <= 3_600));
  const acidText = inputs[0].text;
  for (const passage of acidPassages) assert.equal(acidText.slice(passage.locator.from, passage.locator.to), passage.text);
  assert.equal(acidPassages.at(-1).locator.page, 4);
  assert.ok(snapshot.issues.some((issue) => issue.code === 'pages_without_text' && issue.detail === '3'));
  const bond = snapshot.passages.filter((passage) => passage.sourceKey === 'material:bond');
  assert.equal(bond[0].locator.kind, 'offset', 'visual description before the first marker is read too');
  assert.deepEqual(bond.slice(1).map((passage) => passage.locator.slide), [1, 2]);
  assert.equal(snapshot.sources.find((item) => item.sourceKey === 'material:bond').locatorKind, 'slide');
  const note = snapshot.passages.filter((passage) => passage.sourceKey === 'document:note');
  assert.equal(note[0].locator.heading, 'Enlace');
  assert.ok(note.some((passage) => passage.text.includes('Mar de electrones')));
  const lecture = snapshot.passages.filter((passage) => passage.sourceKey === 'transcript:cor');
  assert.ok(lecture.length >= 3);
  for (const passage of lecture) assert.ok(passage.locator.end - passage.locator.start <= 180);
  assert.deepEqual(lecture.flatMap((passage) => passage.locator.segmentIds), Array.from({ length: 10 }, (_, index) => `s${index}`));
  // "Portada" appears in two materials: the later copy is a duplicate, still counted.
  const covers = snapshot.passages.filter((passage) => passage.text === 'Portada');
  assert.equal(covers.length, 2);
  assert.equal(covers[1].duplicateOf, covers[0].id);
  assert.equal(snapshot.totals.readablePassages, snapshot.totals.passages - 1);
  assert.equal(snapshot.totals.pages, 4 + 1 + 2 + 1, 'pages and slides');
  assert.ok(snapshot.totals.estimatedTokens > 0);
});

test('tree: units and subunits are nodes; group toggles, exclusions and tri-state', () => {
  const tree = buildCompleteGuideTree(catalog, organization, { unplacedLabel: 'Sin ubicación' });
  const find = (node, id) => node.id === id ? node : node.children.map((child) => find(child, id)).find(Boolean);
  const chem = find(tree, 'subject:chem');
  assert.deepEqual(chem.children.map((child) => child.id), ['folder:f-org', 'topic:t1', 'topic:t2']);
  assert.deepEqual(find(tree, 'topic:t1').children.map((child) => child.id), ['topic:t1a']);
  assert.deepEqual(find(tree, 'folder:f-org').children.map((child) => child.id).sort(), ['folder:f-org-ex', 'topic:t-org']);
  assert.ok(find(tree, 'topic:t1').sourceKeys.includes('material:bond'), 'subunit sources roll up');
  assert.ok(!find(tree, 'topic:t1').sourceKeys.includes('material:empty'), 'unavailable sources are shown but not selectable');
  assert.ok(find(tree, 'topic:t1').sources.some((item) => item.sourceKey === 'material:empty'));

  let selection = { nodes: [], excludedSourceKeys: [] };
  const selected = () => new Set(resolveCompleteGuideSelection(selection.nodes.length ? selection : { nodes: [{ kind: 'source', id: 'none:x' }], excludedSourceKeys: [] }, catalog, organization).sources.map((item) => item.sourceKey));
  selection = toggleCompleteGuideGroup(selection, chem, selected());
  assert.deepEqual(selection.nodes, [{ kind: 'subject', id: 'chem' }]);
  assert.equal(completeGuideNodeState(chem, selected()), 'checked');
  selection = toggleCompleteGuideGroup(selection, find(tree, 'topic:t2'), selected());
  assert.ok(!selected().has('material:acids'), 'unticking a unit inside a ticked subject excludes it');
  assert.equal(completeGuideNodeState(chem, selected()), 'mixed');
  selection = toggleCompleteGuideSource(selection, 'material:acids', selected());
  assert.ok(selected().has('material:acids'));
  selection = toggleCompleteGuideGroup(selection, find(tree, 'topic:t2'), selected());
  assert.equal(completeGuideNodeState(chem, selected()), 'checked');
  assert.deepEqual(selection.excludedSourceKeys, []);
  const filtered = buildCompleteGuideTree(catalog, organization, { unplacedLabel: '', query: 'fabrica' });
  assert.deepEqual(filtered.sourceKeys, ['material:industry']);
});

function syntheticSnapshot(pages, charsPerPage = 2_000) {
  const passages = Array.from({ length: pages }, (_, index) => ({ id: `A1.${index + 1}`, sourceKey: 'material:x', chars: charsPerPage, contentHash: String(index) }));
  const chars = pages * charsPerPage;
  return { sources: [{ sourceKey: 'material:x' }], passages, issues: [], totals: { sources: 1, passages: pages, readablePassages: pages, chars, pages, estimatedTokens: Math.ceil(chars / 3.6) } };
}

test('estimate: the audit is most of the cost; large or multi-subject selections warn; cache reduces reading', () => {
  const flash = { provider: 'deepseek', model: 'deepseek-flash' };
  const small = estimateCompleteGuide({ snapshot: syntheticSnapshot(15), model: flash, unitCount: 2, subjectCount: 1 });
  // No sub-dollar guide: the measured run below cost $1.08 over thirteen passages of dense
  // material, and the premise audit is most of it.
  assert.ok(small.usd && small.usd.max > 1, JSON.stringify(small.usd));
  assert.ok(small.usd.min > 0);
  assert.deepEqual(small.warnings, []);
  assert.equal(small.expected.units, 2);
  const big = estimateCompleteGuide({ snapshot: syntheticSnapshot(900), model: flash, subjectCount: 3, unavailableSources: 2 });
  assert.deepEqual(big.warnings.map((warning) => warning.code), ['several_subjects', 'large_selection', 'unavailable_sources']);
  assert.ok(big.usd.max > small.usd.max * 20);
  const unknown = estimateCompleteGuide({ snapshot: syntheticSnapshot(15), model: { provider: 'openai', model: 'mystery' } });
  assert.equal(unknown.usd, null);
  assert.ok(unknown.warnings.some((warning) => warning.code === 'unknown_price'));
  const cached = estimateCompleteGuide({ snapshot: syntheticSnapshot(100), model: flash, cachedChars: 180_000 });
  const cold = estimateCompleteGuide({ snapshot: syntheticSnapshot(100), model: flash });
  const reading = (estimate) => estimate.stages.filter((stage) => stage.stage === 'recon' || stage.stage === 'extract').reduce((sum, stage) => sum + stage.inputTokens, 0);
  assert.ok(reading(cached) < reading(cold) * 0.2);
  assert.ok(Math.abs(cached.cachedShare - 0.9) < 1e-9);
  const exhaustive = estimateCompleteGuide({ snapshot: syntheticSnapshot(100), model: flash, verification: 'exhaustive' });
  assert.ok(exhaustive.usd.max > cold.usd.max);
  const withWeb = estimateCompleteGuide({ snapshot: syntheticSnapshot(100), model: flash, webText: true });
  assert.ok(withWeb.stages.some((stage) => stage.stage === 'web'));
});

test('estimate: the ceiling covers the measured live campaign run', () => {
  // scripts/verify-complete-guide-live.mjs over its seeded corpus (DeepSeek Flash chat,
  // bge-m3 embeddings, 2026-09-28): five sources, thirteen passages, 29 extracted items,
  // 160 written blocks, 18 of them audited. The first run spent $1.0813 and the second
  // $0.9222; the numbers travel in docs/verification/complete-guide-live-metrics.json.
  // The constants before this test were calibrated on nothing measured and promised $0.23.
  const sizes = [4, 3, 1, 3, 2];
  const keys = ['material:gases', 'material:acids', 'document:acid-notes', 'material:restoration', 'transcript:class-5'];
  const passages = [];
  keys.forEach((sourceKey, source) => {
    for (let index = 0; index < sizes[source]; index += 1) passages.push({ id: `${sourceKey}.${index + 1}`, sourceKey, chars: 166, duplicateOf: null });
  });
  const snapshot = {
    sources: keys.map((sourceKey) => ({ sourceKey })),
    passages,
    issues: [],
    totals: { sources: keys.length, passages: passages.length, readablePassages: passages.length, chars: 2_160, pages: 0, estimatedTokens: 600 },
  };
  const estimate = estimateCompleteGuide({ snapshot, model: { provider: 'deepseek', model: 'deepseek-flash' }, verification: 'standard', unitCount: 3, subjectCount: 2 });
  assert.ok(estimate.usd, 'a listed model always gets a price');
  assert.ok(estimate.usd.max >= 1.0813, `the ceiling must cover the measured first run: ${JSON.stringify(estimate.usd)}`);
  assert.ok(estimate.expected.items >= 20, `the measured extraction found 29 items, the estimate says ${estimate.expected.items}`);
  const verify = estimate.stages.find((stage) => stage.stage === 'verify');
  assert.ok(verify.calls >= (estimate.expected.items + estimate.expected.sections + estimate.expected.units * 3) * 4,
    'standard verification budgets the prose, answers and summaries, not only suspicious quantities');
  const cost = (stage) => (stage.inputTokens * 0.3 + stage.outputTokens * 1.2) / 1e6;
  const price = estimate.stages.filter((stage) => stage.stage !== 'embed').reduce((sum, stage) => sum + cost(stage), 0);
  assert.ok(cost(verify) / price > 0.5, `the audit carried 76 % of the measured run: ${(cost(verify) / price).toFixed(2)}`);
});
