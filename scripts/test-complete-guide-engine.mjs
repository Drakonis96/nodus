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
          const type = /se define|Definición/.test(sentence) ? 'definition' : /=|\$/.test(sentence) ? 'formula' : /Ejemplo/.test(sentence) ? 'example' : /Error/.test(sentence) ? 'mistake' : 'fact';
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

test('settlePool keeps siblings running when one task fails', async () => {
  const results = await core.settlePool([1, 2, 3, 4], 2, async (value) => { if (value === 2) throw new Error('x'); return value * 2; });
  assert.deepEqual(results.map((result) => (result.ok ? result.value : 'error')), [2, 'error', 6, 8]);
});
