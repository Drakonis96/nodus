// Complete study guide, milestones 3–4: the multi-pass orchestrator run end to end
// with a deterministic fake model. Checks full reading, anchored extraction, planned
// coverage, provenance labels, KaTeX validity, the audit, the reading cache and resume.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
async function load(entry) {
  const built = await build({ entryPoints: [entry], bundle: true, write: false, format: 'cjs', platform: 'node', tsconfig: 'electron/tsconfig.json' });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', built.outputFiles[0].text)(module, module.exports, require_);
  return module.exports;
}
const core = await load('electron/ai/completeGuide/core.ts');
const prompts = await load('electron/ai/completeGuide/prompts.ts');
const { buildCompleteGuideSnapshot } = await load('shared/completeGuide/snapshot.ts');
const { resolveCompleteGuideSelection } = await load('shared/completeGuide/selection.ts');
const { normalizeCompleteGuideConfig } = await load('shared/completeGuide/types.ts');
const { invalidMath } = await load('shared/completeGuide/math.ts');

const scope = (extra = {}) => ({ courseId: null, subjectId: null, folderId: null, topicId: null, ...extra });
const organization = {
  courses: [{ id: 'c', name: 'Bachillerato', position: 0 }],
  subjects: [{ id: 'chem', name: 'Química', courseId: 'c', position: 0 }],
  folders: [],
  topics: [
    { id: 't1', name: 'Tema 1 · Gases', subjectId: 'chem', folderId: null, parentId: null, position: 0 },
    { id: 't2', name: 'Tema 2 · Ácidos', subjectId: 'chem', folderId: null, parentId: null, position: 1 },
  ],
};

const filler = (n) => Array.from({ length: n }, (_, i) => `Texto de relleno número ${i} que describe el contexto histórico del tema sin datos nuevos.`).join(' ');
const pages = {
  gases: [
    'Definición: la presión se define como la fuerza por unidad de superficie.',
    `La ley de los gases ideales es $PV = nRT$ y solo vale a baja presión y alta temperatura. ${filler(8)}`,
    'Ejemplo resuelto: 2 mol de gas a 300 K en 10 L ejercen una presión de 4,9 atm.',
    'Error frecuente: usar grados Celsius en lugar de kelvin en la ecuación de estado.',
  ],
  acids: [
    'Un ácido de Brønsted se define como una especie que cede protones.',
    'El pH se calcula como pH = -log[H3O+] a 25 °C.',
    'Ejemplo: una disolución 0,01 M de HCl tiene pH 2.',
  ],
  note: '# Resumen\nLa constante R vale 0,082 atm·L/(mol·K).\n## Unidades\nLa presión se mide en pascales.',
};
const catalog = [
  { sourceKey: 'material:gases', kind: 'material', sourceId: 'gases', title: 'Gases (apuntes)', placements: [scope({ topicId: 't1' })], available: true },
  { sourceKey: 'material:acids', kind: 'material', sourceId: 'acids', title: 'Ácidos y bases', placements: [scope({ topicId: 't2' })], available: true },
  { sourceKey: 'document:note', kind: 'document', sourceId: 'note', title: 'Mis notas', placements: [scope({ topicId: 't1' })], available: true },
  { sourceKey: 'material:secret', kind: 'material', sourceId: 'secret', title: 'Material no seleccionado', placements: [scope({ subjectId: 'other' })], available: true },
];
const config = normalizeCompleteGuideConfig({ runId: 'cg-test-run', selection: { nodes: [{ kind: 'subject', id: 'chem' }], excludedSourceKeys: [] } });
const resolved = resolveCompleteGuideSelection(config.selection, catalog, organization);
const markers = (list) => list.map((text, index) => `[[p. ${index + 1}]]\n${text}`).join('\n');
const snapshot = buildCompleteGuideSnapshot(resolved.sources.map((source) => ({
  source, updatedAt: '2026-01-01',
  text: source.sourceKey === 'document:note' ? pages.note : markers(pages[source.sourceId]),
})), organization);

const sentences = (text) => text.split(/(?<=\.)\s+/).map((part) => part.trim()).filter(Boolean);

function fakeModel(options = {}) {
  const calls = [];
  const readPassages = { recon: [], extract: [] };
  const json = async (call) => {
    calls.push(call);
    if (options.failAfter && calls.length > options.failAfter) { const error = new Error('aborted'); error.name = 'AbortError'; throw error; }
    const user = JSON.parse(call.user);
    if (call.system === prompts.RECON_SYSTEM) {
      readPassages.recon.push(...user.passages.map((passage) => passage.id));
      return { outline: [{ title: user.source.title, firstPassage: user.passages[0].id, lastPassage: user.passages.at(-1).id, summary: 'Resumen.' }], keyTerms: ['presión'] };
    }
    if (call.system === prompts.EXTRACT_SYSTEM || call.system === prompts.RECOVER_SYSTEM) {
      if (call.system === prompts.EXTRACT_SYSTEM) readPassages.extract.push(...user.passages.map((passage) => passage.id));
      const items = [];
      for (const passage of user.passages) {
        for (const sentence of sentences(passage.text)) {
          if (/relleno/.test(sentence)) continue;
          const type = options.figure?.test(sentence) ? 'figure' : /se define|Definición/.test(sentence) ? 'definition' : /=|\$/.test(sentence) ? 'formula' : /Ejemplo/.test(sentence) ? 'example' : /Error/.test(sentence) ? 'mistake' : 'fact';
          items.push({
            type, title: sentence.slice(0, 30), statement: sentence, importance: type === 'fact' ? 'support' : 'core',
            ...(type === 'formula' ? { latex: sentence.includes('PV') ? 'PV = nRT' : 'pH = -\\log[H_3O^+]', conditions: ['baja presión'] } : {}),
            // Models often cite the neighbouring passage: anchoring must still find it.
            passageId: passage.id, quote: sentence,
          });
        }
      }
      // An invented quote must never become "from your materials".
      items.push({ type: 'fact', title: 'Inventado', statement: 'El argón es verde.', importance: 'core', passageId: user.passages[0].id, quote: 'El argón es un gas de color verde intenso.' });
      return { items };
    }
    if (call.system === prompts.PLAN_SYSTEM) {
      const ids = user.items.map((item) => item.id);
      const half = Math.ceil(ids.length / 2);
      // One item left unassigned and one invented id: code must fix both.
      return { overview: `Visión de ${user.unit}.`, sections: [
        { title: `Fundamentos de ${user.unit}`, purpose: 'Entender.', itemIds: [...ids.slice(0, half), 'K9999'] },
        { title: `Aplicaciones de ${user.unit}`, purpose: 'Aplicar.', itemIds: ids.slice(half, -1) },
      ] };
    }
    if (call.system === prompts.WRITE_SYSTEM || call.system === prompts.CONTINUE_SYSTEM) {
      const ids = user.items.map((item) => item.id);
      const blocks = [];
      const covered = call.system === prompts.WRITE_SYSTEM ? ids.slice(0, Math.max(1, ids.length - 2)) : ids.slice(0, Math.max(0, ids.length - 1));
      for (const id of covered) {
        const item = user.items.find((entry) => entry.id === id);
        blocks.push({ kind: item.type === 'formula' ? 'formula' : item.type === 'definition' ? 'definition' : 'explanation', itemIds: [id],
          markdown: item.type === 'formula' ? `${item.statement} Se escribe $${item.latex}$ [A1](nodus://study/material/secret?page=1).` : `${item.statement}${options.invent ? ' INVENTADO: el valor es 999.' : ''}` });
      }
      if (call.system === prompts.WRITE_SYSTEM) {
        blocks.push({ kind: 'explanation', itemIds: [], markdown: 'Una afirmación sin respaldo en ningún ítem.' });
        blocks.push({ kind: 'ai_example', itemIds: [ids[0]], markdown: 'Imagina un globo que se calienta al sol.' });
        blocks.push({ kind: 'formula', itemIds: [ids[0]], markdown: 'Fórmula rota: $\\frac{a}{$' });
        blocks.push({ kind: 'selfcheck', itemIds: [ids[0]], question: '¿Qué es la presión?', answer: 'Fuerza por unidad de superficie.' });
        blocks.push({ kind: 'mistake', itemIds: [ids[0]], markdown: 'Confundir masa y peso.' });
        if (user.webEvidence?.length) {
          blocks.push({ kind: 'web', itemIds: [ids[0]], webPassageIds: [user.webEvidence[0].id], markdown: 'Los globos aerostáticos aplican esta idea. INVENTADO: vuelan a 999 km.' });
          blocks.push({ kind: 'web', itemIds: [ids[0]], webPassageIds: ['web:ffffffffffff'], markdown: 'Un pasaje que nunca se registró.' });
          blocks.push({ kind: 'web', itemIds: [ids[0]], markdown: 'Sin pasajes web.' });
        }
      }
      return { blocks };
    }
    if (call.system === prompts.REPAIR_LATEX_SYSTEM) return { fixes: user.formulas.map((formula) => ({ index: formula.index, latex: '\\frac{a}{b}' })) };
    if (call.system === prompts.REVISE_SYSTEM) return { markdown: user.block.replace(/INVENTADO[^.]*\./g, '').trim() };
    if (call.system === prompts.MAP_SYSTEM) return { overview: 'Los gases preparan el estudio de los ácidos.', connections: [{ from: user.units[0].title, to: user.units.at(-1).title, relation: 'Prepara' }, { from: 'Inventada', to: 'Nada', relation: 'x' }] };
    if (call.system === prompts.CHEAT_SYSTEM) return { points: user.items.slice(0, 3).map((item) => ({ itemId: item.id, phrase: item.statement.split(' ').slice(0, 8).join(' ') })).concat([{ itemId: 'K9999', phrase: 'inventado' }]) };
    throw new Error(`unexpected prompt ${call.system.slice(0, 40)}`);
  };
  return { json, calls, readPassages };
}

function memoryDeps(model, stores = { cache: new Map(), checkpoints: new Map() }, extra = {}) {
  return {
    json: model.json,
    cacheGet: (key) => stores.cache.get(key) ?? null,
    cachePut: (key, _stage, value) => stores.cache.set(key, JSON.parse(JSON.stringify(value))),
    checkpointGet: (stage, unit) => stores.checkpoints.get(`${stage}|${unit}`) ?? null,
    checkpointPut: (stage, unit, value) => stores.checkpoints.set(`${stage}|${unit}`, JSON.parse(JSON.stringify(value))),
    hash: (value) => { let h = 0; for (const char of value) h = (h * 31 + char.codePointAt(0)) | 0; return `h${h >>> 0}-${value.length}`; },
    audit: async (markdown) => {
      const kept = markdown.split(/(?<=\.)\s+/).filter((sentence) => !/INVENTADO/.test(sentence));
      return { markdown: kept.join(' '), removed: markdown.split(/(?<=\.)\s+/).length - kept.length };
    },
    conflicts: async () => [],
    ...extra,
    stores,
  };
}

const input = (overrides = {}) => ({ config, snapshot, organization, language: 'es', modelKey: 'fake/model', promptVersion: 'test', instructions: '', windows: { reconChars: 400, extractChars: 250 }, concurrency: { read: 2, write: 2, verify: 2 }, ...overrides });

test('every readable passage is read once per pass; unselected material never enters', async () => {
  const model = fakeModel();
  const result = await core.runCompleteGuide(input(), memoryDeps(model));
  const readable = snapshot.passages.filter((passage) => !passage.duplicateOf).map((passage) => passage.id).sort();
  assert.deepEqual([...model.readPassages.recon].sort(), readable, 'reconnaissance covers everything once');
  assert.deepEqual([...model.readPassages.extract].sort(), readable, 'extraction covers everything once, without ranking');
  assert.ok(!result.markdown.includes('material/secret'), 'the model-inserted link to an unselected material is removed');
  assert.ok(!snapshot.sources.some((source) => source.sourceId === 'secret'));
  assert.equal(result.counts.failedWindows, 0);
});

test('extraction keeps only anchored items; the plan covers every item; leftovers become a cited table', async () => {
  const result = await core.runCompleteGuide(input(), memoryDeps(fakeModel()));
  assert.ok(result.items.length >= 8);
  assert.ok(!result.items.some((item) => item.statement.includes('argón')), 'invented quote discarded');
  assert.ok(result.items.every((item) => item.evidence.every((evidence) => evidence.anchor !== 'missing' || item.reconstructedLatex)));
  const planned = result.chapters.flatMap((chapter) => chapter.sections.flatMap((section) => section.blocks.flatMap((block) => block.itemIds)));
  for (const item of result.items) assert.ok(planned.includes(item.id), `${item.id} reaches the guide`);
  assert.match(result.markdown, /\*\*Detalles adicionales\*\*/);
  assert.deepEqual(result.chapters.map((chapter) => chapter.title), ['Tema 1 · Gases', 'Tema 2 · Ácidos']);
  assert.ok(result.counts.droppedUnsupported >= 1, 'a block with no items is dropped');
});

test('provenance labels come from data: AI blocks are labelled and never cite materials', async () => {
  const result = await core.runCompleteGuide(input(), memoryDeps(fakeModel()));
  const callouts = result.markdown.split(/\n(?=> \[!)/);
  const ai = callouts.filter((block) => /^> \[!ai-(example|analogy|mistake)\]/.test(block));
  assert.ok(ai.length >= 2);
  for (const block of ai) {
    const body = block.split('\n\n')[0];
    assert.ok(!/nodus:\/\/study/.test(block.split(/\n(?!>)/)[0]), 'AI callouts carry no material links');
    assert.match(body, /elaborad[oa] por IA|sugerido por IA/);
  }
  assert.match(result.markdown, /> \[!definition\] Definición/);
  assert.match(result.markdown, /\[A1 · p\. \d+\]\(nodus:\/\/study\/material\/gases\?page=\d+&e=K\d{4}\)/, 'citations carry page and item');
  assert.match(result.markdown, /\[D1 · § Resumen\]\(nodus:\/\/study\/doc\/note\?from=\d+&e=K\d{4}\)/);
  assert.match(result.markdown, /\*\*Respuestas de autoevaluación\*\*/);
  assert.match(result.markdown, /\*\*Para ampliar:\*\* A1 — Gases \(apuntes\) \(pp?\. [\d–, ]+\)/);
  const noAi = await core.runCompleteGuide(input({ config: { ...config, aiExamples: false } }), memoryDeps(fakeModel()));
  assert.ok(!/\[!ai-/.test(noAi.markdown), 'AI additions can be switched off');
});

test('LaTeX is valid everywhere; reference sections and the review sheet are built from items', async () => {
  const result = await core.runCompleteGuide(input(), memoryDeps(fakeModel()));
  assert.deepEqual(invalidMath(result.markdown), []);
  assert.ok(result.counts.invalidLatex >= 1, 'broken LaTeX was detected and repaired');
  for (const heading of ['## Cómo usar esta guía', '## Mapa del temario', '## Glosario', '## Formulario', '## Ficha de repaso', '## Cobertura y limitaciones', '## Índice de fuentes']) {
    assert.ok(result.markdown.includes(heading), heading);
  }
  assert.match(result.cheatSheetMarkdown, /PV = nRT/);
  assert.ok(!result.markdown.includes('Inventada'), 'map edges between unknown units are dropped');
  assert.equal(result.coverage.find((row) => row.source.sourceKey === 'material:gases').passagesRead, snapshot.passages.filter((passage) => passage.sourceKey === 'material:gases').length);
});

test('audit removes unsupported sentences after a repair attempt', async () => {
  const result = await core.runCompleteGuide(input({ config: { ...config, verification: 'exhaustive' } }), memoryDeps(fakeModel({ invent: true })));
  assert.ok(!result.markdown.includes('INVENTADO'));
  assert.ok(result.counts.auditedBlocks > 0);
  assert.ok(result.counts.repairedBlocks > 0);
});

test('the audit is handed a citation URL, so its own links never nest inside a Markdown link', async () => {
  const seen = [];
  const deps = memoryDeps(fakeModel(), undefined, {
    // What the real audit does with what it is given: `applyResearchProseVerdicts` wraps every
    // sentence it verifies as `[label](citation)`. That is a link when the caller passes a URL
    // (ideas, works, passages all do) and a link inside a link when it passes the guide's
    // rendered Markdown link, which Markdown refuses to parse.
    audit: async (markdown, sources) => {
      const sentences = markdown.split(/(?<=\.)\s+/);
      const kept = sentences.filter((sentence) => !/INVENTADO/.test(sentence));
      if (sources.length) seen.push(...sources.map((source) => source.citation));
      const cited = sources.map((source) => `[${source.label}](${source.citation})`).join(' ');
      return { markdown: [kept.join(' '), cited].filter(Boolean).join(' '), removed: sentences.length - kept.length };
    },
  });
  const result = await core.runCompleteGuide(input({ config: { ...config, verification: 'exhaustive' } }), deps);
  assert.ok(seen.length, 'the audit ran on at least one block');
  for (const citation of seen) assert.match(citation, /^nodus:\/\/study\//, `a citation URL, never a rendered link: ${citation}`);
  assert.ok(!result.markdown.includes('](['), 'nothing renders as a link inside a link');
  assert.match(result.markdown, /\]\(nodus:\/\/study\/material\//, 'the verified sentence carries a single link to its material');
});

test('a second version reuses the reading cache; an interrupted run resumes from checkpoints', async () => {
  const stores = { cache: new Map(), checkpoints: new Map() };
  await core.runCompleteGuide(input(), memoryDeps(fakeModel(), stores));
  const second = fakeModel();
  const again = await core.runCompleteGuide(input({ config: { ...config, runId: 'cg-other-run' } }), memoryDeps(second, { cache: stores.cache, checkpoints: new Map() }));
  assert.equal(second.readPassages.recon.length + second.readPassages.extract.length, 0, 'no source is read twice');
  assert.ok(again.counts.cacheHits > 0);
  const reread = fakeModel();
  await core.runCompleteGuide(input({ config: { ...config, rereadAll: true } }), memoryDeps(reread, { cache: stores.cache, checkpoints: new Map() }));
  assert.ok(reread.readPassages.extract.length > 0, '"reread all" bypasses the cache');

  const resumeStores = { cache: new Map(), checkpoints: new Map() };
  const interrupted = fakeModel({ failAfter: 25 });
  await assert.rejects(core.runCompleteGuide(input(), memoryDeps(interrupted, resumeStores)), /aborted/);
  const resumed = fakeModel();
  const finished = await core.runCompleteGuide(input(), memoryDeps(resumed, { cache: resumeStores.cache, checkpoints: resumeStores.checkpoints }));
  assert.ok(finished.markdown.includes('## Ficha de repaso'));
  assert.ok(resumed.calls.length < interrupted.calls.length + 40);
});

test('failed windows are reported as unread when rare, and fail the job when frequent', async () => {
  const flaky = fakeModel();
  const original = flaky.json;
  let broken = 0;
  flaky.json = async (call) => {
    if (call.system === prompts.EXTRACT_SYSTEM && JSON.parse(call.user).passages.some((passage) => passage.id.startsWith('A2'))) { broken += 1; throw new Error('provider down'); }
    return original(call);
  };
  await assert.rejects(core.runCompleteGuide(input(), memoryDeps(flaky)), /No se pudieron leer/);
  assert.ok(broken > 0);
});

test('figure items of materials become figure requests; a failing renderer only warns', async () => {
  const requests = [];
  const figures = async (list) => {
    requests.push(...list);
    return list.map((request) => ({ itemId: request.itemId, caption: request.caption, png: 'iVBORw0KGgo=', width: 600, height: 400, source: request.source, wholePage: false }));
  };
  const result = await core.runCompleteGuide(input(), memoryDeps(fakeModel({ figure: /Ejemplo resuelto|Resumen|Brønsted/ }), undefined, { figures }));
  assert.ok(requests.length >= 1, 'a figure is requested');
  assert.ok(requests.every((request) => request.materialId && request.source.startsWith('nodus://study/material/')), 'only materials have pictures');
  assert.ok(requests.every((request) => request.page), 'requests carry the cited page');
  assert.equal(result.counts.figures, requests.length);
  assert.deepEqual(result.figures.map((figure) => figure.itemId), requests.map((request) => request.itemId));
  for (const figure of result.figures) assert.ok(Array.isArray(result.figureSiblings[figure.itemId]));

  const broken = await core.runCompleteGuide(input(), memoryDeps(fakeModel({ figure: /Ejemplo resuelto/ }), undefined, { figures: async () => { throw new Error('canvas missing'); } }));
  assert.ok(broken.warnings.includes('figures_failed'));
  assert.equal(broken.figures.length, 0);
  assert.ok(broken.markdown.length > 500, 'the guide is still written');

  const none = await core.runCompleteGuide(input(), memoryDeps(fakeModel(), undefined, { figures }));
  assert.equal(none.counts.figures, 0, 'no figure items, no figures');
});

test('the optional web complement is one search per chapter, labelled, audited and cited apart', async () => {
  const requests = [];
  const web = async (request) => {
    requests.push(request);
    const n = requests.length;
    return [
      { id: `web:${String(n).repeat(16)}`, title: `Globos (${request.unit})`, site: 'ejemplo.org', url: `https://ejemplo.org/globos-${n}?a=(1)`, text: 'Los globos aerostáticos aplican esta idea al calentar el aire.' },
      { id: 'not-a-web-id', title: 'x', site: 'x', url: 'https://x.org', text: 'x' },
    ];
  };
  const webConfig = { ...config, webText: true };
  const stores = { cache: new Map(), checkpoints: new Map() };
  const result = await core.runCompleteGuide(input({ config: webConfig }), memoryDeps(fakeModel(), stores, { web }));
  assert.equal(requests.length, 2, 'one web step per chapter');
  assert.ok(requests[0].unit === 'Tema 1 · Gases' && requests[0].sections.length >= 1);
  assert.ok(result.counts.webBlocks >= 1);
  assert.match(result.markdown, /> \[!web\] Fuentes web/);
  assert.match(result.markdown, /\[W1 · ejemplo\.org\]\(nodus:\/\/passage\/web%3A1{16}\)/);
  assert.ok(!result.markdown.includes('Un pasaje que nunca se registró') && !result.markdown.includes('Sin pasajes web'), 'web blocks need recorded passages');
  assert.ok(!result.markdown.includes('999 km'), 'web blocks are audited against their passages');
  const webSection = result.markdown.split('## Fuentes web\n')[1];
  assert.ok(webSection, 'a final web sources section');
  assert.match(webSection, /\*\*W1\*\* — \[Globos \(Tema 1 · Gases\)\]\(https:\/\/ejemplo\.org\/globos-1\?a=%281%29\) · ejemplo\.org/);
  assert.deepEqual(result.webSources.map((page) => page.alias), ['W1', 'W2']);
  for (const block of result.chapters.flatMap((chapter) => chapter.sections.flatMap((section) => section.blocks))) {
    if (block.provenance === 'web') assert.ok(block.webPassageIds.length && block.webPassageIds.every((id) => id.startsWith('web:')));
  }
  const webCallouts = result.markdown.match(/^> \[!web\][^\n]*(?:\n>[^\n]*)*/gm) ?? [];
  assert.ok(webCallouts.length && webCallouts.every((part) => !part.includes('nodus://study') && part.includes('no procede de tus materiales')), 'web blocks never cite materials and are labelled');

  const again = await core.runCompleteGuide(input({ config: webConfig }), memoryDeps(fakeModel(), stores, { web }));
  assert.equal(requests.length, 2, 'the web step is checkpointed');
  assert.equal(again.counts.webBlocks, result.counts.webBlocks);

  const off = await core.runCompleteGuide(input(), memoryDeps(fakeModel(), undefined, { web }));
  assert.equal(requests.length, 2, 'off by default');
  assert.equal(off.counts.webBlocks, 0);
  assert.ok(!off.markdown.includes('## Fuentes web'));

  const down = await core.runCompleteGuide(input({ config: webConfig }), memoryDeps(fakeModel(), undefined, { web: async () => { throw new Error('searxng down'); } }));
  assert.ok(down.warnings.includes('web_unavailable'));
  assert.equal(down.counts.webBlocks, 0);
  assert.ok(down.markdown.length > 500);
});

test('web images illustrate core concepts without material figures, attributed and listed apart', async () => {
  const asked = [];
  const webImages = async (requests) => {
    asked.push(...requests);
    return requests.slice(0, 1).map((request) => ({ itemId: request.itemId, caption: `${request.caption} — Foto, Ana · CC BY-SA 4.0 · Wikimedia Commons`, png: 'iVBORw0KGgo=', width: 800, height: 600,
      source: 'https://commons.wikimedia.org/wiki/File:Foto.png', wholePage: false,
      attribution: { title: 'Foto', author: 'Ana', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Foto.png', site: 'Wikimedia Commons' } }));
  };
  const stores = { cache: new Map(), checkpoints: new Map() };
  const result = await core.runCompleteGuide(input({ config: { ...config, webImages: true } }), memoryDeps(fakeModel(), stores, { webImages }));
  assert.ok(asked.length >= 1 && asked.length <= 2, 'at most one request per chapter');
  assert.ok(asked.every((request) => result.items.find((item) => item.id === request.itemId)?.importance === 'core'));
  assert.equal(result.counts.webImages, 1);
  assert.equal(result.figures.filter((figure) => figure.attribution).length, 1);
  assert.match(result.markdown, /## Fuentes web[\s\S]*\*\*W1\*\* — \[Foto — Ana\]\(https:\/\/commons\.wikimedia\.org\/wiki\/File:Foto\.png\) · Wikimedia Commons · CC BY-SA 4\.0/);
  const before = asked.length;
  const again = await core.runCompleteGuide(input({ config: { ...config, webImages: true } }), memoryDeps(fakeModel(), stores, { webImages }));
  assert.equal(asked.length, before, 'checkpointed: no second search');
  assert.equal(again.counts.webImages, 1);

  const off = await core.runCompleteGuide(input(), memoryDeps(fakeModel(), undefined, { webImages: async () => { throw new Error('must not run'); } }));
  assert.equal(off.counts.webImages, 0);
  const failing = await core.runCompleteGuide(input({ config: { ...config, webImages: true } }), memoryDeps(fakeModel(), undefined, { webImages: async () => { throw new Error('down'); } }));
  assert.ok(failing.warnings.includes('web_images_failed'));
});

test('settlePool keeps siblings running when one task fails', async () => {
  const results = await core.settlePool([1, 2, 3, 4], 2, async (value) => { if (value === 2) throw new Error('x'); return value * 2; });
  assert.deepEqual(results.map((result) => (result.ok ? result.value : 'error')), [2, 'error', 6, 8]);
});
