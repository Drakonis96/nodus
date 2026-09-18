// The product documentation Nodi answers from, asserted question by question.
//
// A guide nobody tests is a guide that quietly stops covering a section: the corpus
// is therefore checked for integrity, for an index that names every sheet, and for
// recall — each question a user would really ask must pull the sheet that answers it
// into the reply, because a sheet that is not retrieved is a sheet Nodi never sees.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-docs-test-'));
const bundle = path.join(temporary, 'docs.cjs');
await build({
  stdin: { contents: `export * from './shared/nodusDocs';`, resolveDir: root, loader: 'ts' },
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
});
const docs = await import(pathToFileURL(bundle).href);

const { NODUS_DOC_TOPICS, NODUS_DOC_ENTRY_POINTS, NODUS_DOCS_SKILL_ID, buildNodusDocsSkill, selectNodusDocs, rankNodusDocTopics, nodusDocsIndex, nodusDocTopic } = docs;

/** The shared question matrix: what a user asks and which sheet answers it. */
import { RECALL } from './nodus-docs-questions.mjs';

test('every sheet is complete, unique and bilingual', () => {
  const ids = new Set();
  for (const topic of NODUS_DOC_TOPICS) {
    assert.ok(!ids.has(topic.id), `duplicate sheet id: ${topic.id}`);
    ids.add(topic.id);
    assert.ok(topic.keywords.length >= 5, `${topic.id} needs at least five keywords`);
    for (const language of ['es', 'en']) {
      assert.ok(topic.title[language].trim().length > 3, `${topic.id} has no ${language} title`);
      assert.ok(topic.body[language].trim().length > 200, `${topic.id} has a thin ${language} body`);
      assert.ok(/^[-#]|\n/.test(topic.body[language]), `${topic.id} is not written as a sheet`);
    }
  }
  for (const topic of NODUS_DOC_TOPICS) {
    for (const related of topic.related ?? []) {
      assert.ok(nodusDocTopic(related), `${topic.id} points at unknown sheet ${related}`);
    }
  }
  for (const entry of NODUS_DOC_ENTRY_POINTS) assert.ok(nodusDocTopic(entry), `missing entry point ${entry}`);
});

test('the index names every sheet once and stays inside the prompt budget', () => {
  const index = nodusDocsIndex('es');
  for (const topic of NODUS_DOC_TOPICS) {
    if (topic.area === 'protocol') continue;
    assert.ok(index.includes(topic.id), `${topic.id} is missing from the index`);
  }
  assert.ok(index.length < 12_000, `the index grew to ${index.length} characters`);
  assert.ok(nodusDocsIndex('en').includes('general-what-is-nodus'));
});

test('every question a user asks retrieves the sheet that answers it', () => {
  const missed = [];
  for (const [question, ...expected] of RECALL) {
    const selection = selectNodusDocs({ question, language: 'es' });
    if (!expected.some((id) => selection.ids.includes(id))) {
      missed.push({ question, expected, got: selection.ids.slice(0, 6), rank: rankNodusDocTopics(question).slice(0, 6) });
    }
  }
  assert.deepEqual(missed, [], `${missed.length} of ${RECALL.length} questions did not retrieve their sheet`);
});

test('a reply carries the sheets, the protocol and the hidden skill, inside the budget', () => {
  const selection = selectNodusDocs({ question: '¿Cómo conecto Ollama?', language: 'es' });
  assert.ok(selection.text.length <= 18_000, `the sheets grew to ${selection.text.length} characters`);
  assert.ok(selection.ids.includes('models-local-servers'), 'the answer sheet is not in the reply');
  assert.match(selection.text, /\(id: models-local-servers\)/, 'sheets must name their id so «Base:» can cite them');
  const skill = buildNodusDocsSkill(selection, 'es');
  assert.equal(skill.id, NODUS_DOCS_SKILL_ID);
  assert.match(skill.instructions, /Base:/, 'the protocol must ask for a base line');
  assert.match(skill.instructions, /No puedo verificarlo con las fuentes seleccionadas/);
  assert.ok(skill.instructions.includes('models-local-servers'), 'the served sheets must be named in the skill');
  assert.ok(skill.instructions.length < 16_000, `the skill grew to ${skill.instructions.length} characters`);
  assert.equal(skill.enabled.assistant, false, 'the documentation skill belongs to Nodi only');
});

test('an unrelated question still gets the entry points, and other languages read English sheets', () => {
  const empty = selectNodusDocs({ question: 'hola', language: 'es' });
  for (const entry of NODUS_DOC_ENTRY_POINTS) assert.ok(empty.ids.includes(entry), `entry point ${entry} is missing`);
  assert.ok(empty.text.length > 0);
  const question = '¿Cómo activo el OCR para PDFs escaneados?';
  const french = selectNodusDocs({ question, language: 'fr' });
  const english = selectNodusDocs({ question, language: 'en' });
  assert.equal(french.text, english.text, 'non-Spanish languages read the English sheets');
  assert.match(french.text, /Light OCR|Tesseract|scanned/i);
});

test('the corpus keeps the honest-state contract of the product', () => {
  const body = (id, language) => nodusDocTopic(id).body[language];
  // The Toolkit's real state: what works, what is local-only, what is still opening.
  assert.match(body('toolkit-convert', 'es'), /Nodus Convert ya funciona/);
  assert.match(body('toolkit-convert', 'es'), /determinista y 100 % offline/);
  assert.match(body('toolkit-ocr', 'es'), /OCR Workspace ya se puede abrir/);
  assert.match(body('toolkit-protect', 'es'), /no envía documentos a IA, proveedores ni servicios externos/);
  assert.match(body('toolkit-convert', 'en'), /Nodus Convert already works/);
  // Phases, per vault type.
  for (const id of ['vault-primary-sources', 'vault-testimonios', 'vault-prosopography']) {
    assert.match(body(id, 'es'), /PRE-ALPHA/);
    assert.match(body(id, 'es'), /no debe recomendarse para trabajo real/);
  }
  assert.match(body('vault-worldbuilding', 'es'), /ALPHA/);
  for (const id of ['vault-estudio', 'vault-docencia', 'vault-genealogy', 'vault-databases']) {
    assert.match(body(id, 'es'), /BETA/);
  }
  // The roadmap forbids presenting planned work as available.
  assert.match(body('general-roadmap', 'es'), /Planificado/);
  assert.match(body('general-roadmap', 'es'), /no están disponibles/);
  assert.match(body('general-roadmap', 'es'), /No hay fechas cerradas/);
  // The local-model notice is quoted, not paraphrased.
  assert.match(body('models-local-warning', 'es'), /Aviso sobre los modelos locales/);
  assert.match(body('models-local-warning', 'es'), /Gemma es ahora mismo la opción recomendada/);
  assert.match(body('models-local-warning', 'es'), /los proveedores en la nube están mucho más probados/);
  // Privacy: what leaves the machine, and what the server never publishes.
  assert.match(body('privacy-what-is-sent', 'es'), /no incluye publicidad ni telemetría/);
  assert.match(body('privacy-server-publishing', 'es'), /Nunca se publica: PDF, audio, claves, contraseñas, rutas locales, datos del alumnado ni el archivo SQLite/);
});
