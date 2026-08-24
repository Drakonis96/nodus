// Live AI check for the teaching vault's analysis + authoring chain, end to end over a
// throwaway profile: idea extraction from the teacher's own materials, the chat that
// answers from them, and Unit design in both of its modes (AI-designed structure and a
// structure the teacher fixes). Not in `npm test` — it spends real tokens.
//
//   GEMINI_API_KEY=... node scripts/verify-unit-design.mjs
//   UNIT_VERIFY_PROVIDER=ollama UNIT_VERIFY_MODEL=qwen2.5:7b node scripts/verify-unit-design.mjs
//
// The assertion that matters is the last one: with a fixed outline, the unit must come
// back with exactly the teacher's parts, in their order, with their titles. A model is
// free to ignore that instruction, so the check is against the real generated report,
// not against the prompt.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-unit-design')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/verify-unit-design.mjs'), '--electron-unit-design'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const provider = process.env.UNIT_VERIFY_PROVIDER || 'gemini';
const apiKey = process.env.GEMINI_API_KEY;
if (provider === 'gemini' && !apiKey) {
  console.error('Set GEMINI_API_KEY (or UNIT_VERIFY_PROVIDER=ollama) to run this check.');
  process.exit(1);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-unit-design-'));
installRuntimeHooks(root);

const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
const vaults = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
const knowledgeRepo = require(path.join(repoRoot, 'electron/db/studyKnowledgeRepo.ts'));
const knowledge = require(path.join(repoRoot, 'electron/ai/studyKnowledge.ts'));
const search = require(path.join(repoRoot, 'electron/ai/studySearch.ts'));
const chat = require(path.join(repoRoot, 'electron/ai/studyAssistant.ts'));
const { generateDeepResearchReport } = require(path.join(repoRoot, 'electron/ai/deepResearch.ts'));
const { closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));

if (provider === 'gemini') {
  secrets.setApiKey('gemini', apiKey);
  delete process.env.GEMINI_API_KEY;
}

const modelRef = provider === 'gemini'
  ? { provider: 'gemini', model: process.env.UNIT_VERIFY_MODEL || 'gemini-2.5-flash-lite' }
  : { provider, model: process.env.UNIT_VERIFY_MODEL || 'qwen2.5:7b' };

vaults.setVaultType(vaults.getActiveVault().id, 'docencia');
settingsRepo.updateSettings({
  studyAiEnabled: true,
  studyAiPrivacyMode: 'balanced',
  studyAiLocalOnly: false,
  studyAiConfirmExternal: false,
  studyKnowledgeAutoProcess: 'always',
  promptLanguage: 'es',
  synthesisModel: modelRef,
  studyModel: modelRef,
  questionGenModel: modelRef,
  deepResearchModel: modelRef,
  ...(provider === 'gemini' ? { embeddingProvider: 'gemini', embeddingModel: 'gemini-embedding-001' } : {}),
});

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (error) { failures += 1; console.error(`  ✗ ${name}: ${error.message}`); }
};

// ── A teacher's actual materials ─────────────────────────────────────────────
const course = org.createStudyCourse({ name: 'Geografía e Historia · 4.º ESO' });
const subject = org.createStudySubject({ courseId: course.id, name: 'Historia contemporánea' });

const MATERIALS = [
  {
    title: 'La revolución industrial · apuntes de la unidad',
    text: `# La revolución industrial

## Del taller a la fábrica
Hasta mediados del siglo XVIII la producción se organizaba en talleres artesanales y en el trabajo a domicilio,
donde el ritmo lo marcaban las estaciones y el propio artesano. La introducción de la máquina de vapor de Watt
permitió liberar la producción de la energía hidráulica y, por tanto, situar las fábricas junto a las minas de
carbón y a las ciudades en lugar de junto a los ríos. La fábrica impone un horario, una división del trabajo y
una disciplina que no existían en el taller.

## La mecanización textil
El sector textil algodonero fue el primero en mecanizarse. La spinning jenny, la water frame y la mule
multiplicaron la producción de hilo, y el telar mecánico hizo lo propio con el tejido. El resultado fue una
caída del precio del tejido y una expansión enorme del mercado, pero también la desaparición del hilandero
artesano y los primeros conflictos por la destrucción de máquinas.

## Consecuencias sociales
El crecimiento urbano fue muy rápido y desordenado: barrios obreros sin saneamiento, epidemias de cólera y
jornadas de doce a catorce horas. El trabajo de mujeres y de menores era habitual porque su salario era más
bajo. De estas condiciones nacen las primeras sociedades de socorros mutuos, los sindicatos y, con el tiempo,
la legislación laboral que limita la jornada y el trabajo infantil.`,
  },
  {
    title: 'Cómo comentar una fuente histórica',
    text: `# El comentario de fuentes

## Clasificación
Antes de analizar el contenido hay que clasificar el documento: naturaleza (jurídico, periodístico, testimonial,
estadístico), autoría, destinatario, fecha y lugar. Una fuente primaria es contemporánea de los hechos; una
secundaria los interpreta después.

## Análisis
El análisis identifica las ideas principales y las secundarias y las ordena, distinguiendo siempre lo que la
fuente afirma de lo que el lector infiere. Conviene señalar el vocabulario de época y las omisiones.

## Contextualización y valoración
La contextualización sitúa el documento en su momento histórico. La valoración final debe razonar la fiabilidad
de la fuente y sus límites: quién escribe, con qué intención y qué no puede saber. Un error frecuente del
alumnado es resumir el texto en lugar de comentarlo, y otro es atribuir a la fuente lo que dice el manual.`,
  },
  {
    title: 'Fuente · Informe parlamentario sobre el trabajo en las fábricas (1832)',
    text: `# Testimonio ante la comisión Sadler (1832)

«Los niños entran en la fábrica antes del amanecer y salen cuando ya ha oscurecido. En temporada alta se les
despierta a las tres de la madrugada y no vuelven a casa hasta las diez de la noche. El aire está cargado de
polvo de algodón y el ruido de los telares impide toda conversación. Cuando el cansancio los vence, el capataz
los golpea con una correa para mantenerlos despiertos.»

«Se les da de comer mientras trabajan; no hay tiempo asignado para ello. Muchos padecen deformidades en las
piernas por permanecer de pie tanto tiempo, y son frecuentes los accidentes con la maquinaria descubierta.»

Este testimonio se recogió durante la investigación parlamentaria que precedió a la Factory Act de 1833, que
prohibió el empleo de menores de nueve años en las fábricas textiles y limitó la jornada de los menores de
trece años.`,
  },
];

const documentIds = MATERIALS.map((material) => {
  const created = org.createStudyDocument({ title: material.title, kind: 'apunte', contentMarkdown: material.text });
  org.addStudyPlacement(created.id, { courseId: course.id, subjectId: subject.id });
  return created.id;
});

console.log(`\nRunning against ${modelRef.provider}/${modelRef.model}\n`);

// ── 1. Idea extraction from the teacher's materials ──────────────────────────
process.stdout.write('extracting ideas from 3 materials … ');
knowledge.queueStudyKnowledgeSources('document', documentIds, true, { explicit: true });
const deadline = Date.now() + 8 * 60_000;
while (Date.now() < deadline) {
  const state = knowledge.getStudyKnowledgeProgress();
  if (state.pending === 0 && state.running === 0) break;
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
console.log('done');

const jobs = knowledgeRepo.listStudyKnowledgeJobs(subject.id);
const ideas = knowledgeRepo.listStudyIdeas(subject.id);
const graph = knowledgeRepo.getStudyKnowledgeGraph(subject.id);
check('every material was analysed without error', () => {
  const bad = jobs.filter((job) => job.status !== 'done').map((job) => `${job.sourceId}:${job.status}:${job.error ?? ''}`);
  assert.deepEqual(bad, [], bad.join(' | '));
});
check('ideas were extracted', () => assert.ok(ideas.length >= 6, `only ${ideas.length} ideas`));
check('the ideas are related to each other', () => assert.ok(graph.edges.length >= 2, `only ${graph.edges.length} relations`));
check('the ideas are about the material, not generic', () => {
  const text = ideas.map((idea) => `${idea.label} ${idea.statement}`).join(' ').toLowerCase();
  assert.ok(/vapor|f[áa]brica|textil|industrial|obrer|infantil|fuente/.test(text), text.slice(0, 240));
});
check('every idea carries its evidence', () => {
  const withEvidence = ideas.filter((idea) => idea.evidenceCount > 0).length;
  assert.ok(withEvidence >= Math.ceil(ideas.length / 2), `${withEvidence}/${ideas.length} ideas have evidence`);
});
console.log(`    → ${ideas.length} ideas, ${graph.edges.length} relations: ${ideas.slice(0, 4).map((idea) => idea.label).join(' · ')}`);

// ── 2. The chat answers from those materials ─────────────────────────────────
process.stdout.write('indexing for retrieval … ');
await search.rebuildStudySearchIndex();
console.log('done');
check('the search index picked the materials up', () => {
  assert.ok(search.collectStudySearchEntries().length >= 3, 'nothing indexed');
});

process.stdout.write('asking the chat … ');
let answer;
try {
  answer = await chat.streamStudyAssistant({
    messages: [{ id: 'q1', role: 'user', content: '¿Qué condiciones de trabajo describe el informe de 1832 y qué ley vino después?', createdAt: new Date().toISOString() }],
    selection: { scope: 'library', courseId: null, subjectId: null, topicId: null, sourceKeys: [] },
    task: 'answer', level: 'standard', tone: 'clear', language: 'es', allowExternalKnowledge: false, model: modelRef,
  }, () => undefined);
  console.log('done');
  check('the chat answered from the corpus', () => assert.equal(answer.insufficientInformation, false, answer.answer.slice(0, 160)));
  check('the answer cites a real material', () => assert.ok(answer.citations.length > 0, 'no citations'));
  check('the answer used the 1832 source', () => {
    assert.match(answer.answer.toLowerCase(), /1832|1833|factory act|amanecer|algod[óo]n/, answer.answer.slice(0, 200));
  });
  console.log(`    → "${answer.answer.replace(/\s+/g, ' ').slice(0, 140)}…"`);
} catch (error) {
  failures += 1;
  console.error(`\n  ✗ chat threw: ${error.message}`);
}

// ── 3. Unit design, structure decided by the AI ──────────────────────────────
process.stdout.write('unit design (AI structure) … ');
try {
  const auto = await generateDeepResearchReport({
    objective: 'Unidad sobre la revolución industrial y sus consecuencias sociales para 4.º ESO',
    language: 'es',sectionLimit: 3, model: modelRef, unitMode: true, studyMode: true,
  });
  console.log('done');
  check('the AI proposed its own parts', () => assert.ok(auto.meta.sections >= 3, `${auto.meta.sections} sections`));
  check('it was written from the extracted ideas', () => assert.ok(auto.meta.ideasConsidered > 0, 'no ideas reached the generator'));
  check('every part cites a material', () => {
    const bodies = auto.draft.draftMarkdown.split(/^## /m).slice(1, 1 + auto.meta.sections);
    const uncited = bodies.filter((body) => !body.includes('nodus://study/')).length;
    assert.equal(uncited, 0, `${uncited} parts without a citation`);
  });
  console.log(`    → «${auto.draft.title}» · ${auto.meta.sections} partes · ${auto.meta.words} palabras`);
} catch (error) {
  failures += 1;
  console.error(`\n  ✗ AI-structure unit threw: ${error.message}`);
}

// ── 4. Unit design, structure fixed by the teacher ───────────────────────────
const OUTLINE = [
  { title: 'Punto de partida: la sociedad preindustrial', focus: 'cómo se trabajaba antes de la fábrica' },
  { title: 'La máquina de vapor y la mecanización textil' },
  { title: '', focus: 'el trabajo infantil según el informe de 1832' },
  { title: 'Del malestar a la legislación laboral' },
];

process.stdout.write('unit design (teacher structure) … ');
try {
  const fixed = await generateDeepResearchReport({
    objective: 'Unidad sobre la revolución industrial y sus consecuencias sociales para 4.º ESO',
    language: 'es',model: modelRef, unitMode: true, studyMode: true, outline: OUTLINE,
  });
  console.log('done');
  const titles = fixed.draft.outline.map((section) => section.title);
  check('the unit has exactly the number of parts the teacher asked for', () => {
    assert.equal(fixed.draft.outline.length, OUTLINE.length, `got ${fixed.draft.outline.length}`);
    assert.equal(fixed.meta.sections, OUTLINE.length);
  });
  check('the named parts keep their titles, in order', () => {
    assert.equal(titles[0], OUTLINE[0].title);
    assert.equal(titles[1], OUTLINE[1].title);
    assert.equal(titles[3], OUTLINE[3].title);
  });
  check('the unnamed part was named by the AI', () => {
    assert.ok(titles[2]?.trim().length > 3, `empty title: ${JSON.stringify(titles[2])}`);
    assert.ok(!OUTLINE.map((slot) => slot.title).includes(titles[2]), 'it reused another part’s title');
  });
  check('the body headings match the outline exactly', () => {
    const headings = [...fixed.draft.draftMarkdown.matchAll(/^## (.+)$/gm)].map((match) => match[1].trim());
    for (const title of titles) assert.ok(headings.includes(title), `«${title}» is missing from the body`);
  });
  check('the teacher’s focus is recorded on the part', () => {
    assert.match(fixed.draft.outline[0].purpose, /antes de la f[áa]brica/i, fixed.draft.outline[0].purpose);
  });
  check('the focused part actually follows the steer', () => {
    const body = fixed.draft.draftMarkdown.split(`## ${titles[2]}`)[1] ?? '';
    assert.match(body.toLowerCase(), /infantil|ni[ñn]o|menor/, body.replace(/\s+/g, ' ').slice(0, 220));
  });
  check('every part cites a material', () => {
    const bodies = fixed.draft.draftMarkdown.split(/^## /m).slice(1, 1 + OUTLINE.length);
    const uncited = bodies.filter((body) => !body.includes('nodus://study/')).length;
    assert.equal(uncited, 0, `${uncited} parts without a citation`);
  });
  console.log(`    → «${fixed.draft.title}»\n      ${titles.map((title, index) => `${index + 1}. ${title}`).join('\n      ')}`);
} catch (error) {
  failures += 1;
  console.error(`\n  ✗ fixed-structure unit threw: ${error.message}`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
if (provider === 'gemini') secrets.clearApiKey('gemini');
closeDb();
await rm(root, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-unit-verify', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (v) => Buffer.from(String(v)), decryptString: (v) => Buffer.from(v).toString() },
    dialog: { showMessageBoxSync: () => 1 },
    shell: {},
    BrowserWindow: class {},
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) },
    ipcMain: { handle: () => undefined, on: () => undefined },
  };
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      const rest = request.slice('@shared/'.length);
      const direct = path.join(repoRoot, 'shared', `${rest}.ts`);
      return fs.existsSync(direct) ? direct : path.join(repoRoot, 'shared', rest, 'index.ts');
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function (module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
