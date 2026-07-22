import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
if (!process.argv.includes('--electron-study-knowledge-test')) {
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [path.join(repoRoot, 'scripts/test-study-knowledge.mjs'), '--electron-study-knowledge-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-study-knowledge-'));
installRuntimeHooks(root);
try {
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const materials = require(path.join(repoRoot, 'electron/db/studyMaterialsRepo.ts'));
  const knowledge = require(path.join(repoRoot, 'electron/db/studyKnowledgeRepo.ts'));
  const ai = require(path.join(repoRoot, 'electron/ai/studyKnowledge.ts'));
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  assert.ok(SCHEMA_VERSION >= 74, 'the knowledge graph schema and any later migrations are installed');
  for (const table of ['study_ideas', 'study_idea_occurrences', 'study_idea_evidence', 'study_idea_edges', 'study_knowledge_jobs']) {
    assert.ok(getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} exists`);
  }

  const course = org.createStudyCourse({ name: 'Curso' });
  const subjectA = org.createStudySubject({ courseId: course.id, name: 'Historia' });
  const subjectB = org.createStudySubject({ courseId: course.id, name: 'Filosofía' });
  const sourcePath = path.join(root, 'tema.txt');
  fs.writeFileSync(sourcePath, 'La separación de poderes limita la concentración del poder político. El poder legislativo crea leyes y el ejecutivo las aplica.');
  const imported = await materials.importStudyMaterialFile(sourcePath, { courseId: course.id, subjectId: subjectA.id });
  materials.addStudyMaterialPlacement(imported.material.id, { courseId: course.id, subjectId: subjectB.id });

  const extraction = {
    ideas: [{ key: 'limits', type: 'principle', label: 'Separación de poderes', statement: 'La separación de poderes limita la concentración política.', role: 'principal', confidence: 0.95,
      evidence: [{ quote: 'La separación de poderes limita la concentración del poder político.', location: 'p. 1' }] }],
    relations: [],
  };
  for (const subject of [subjectA, subjectB]) knowledge.replaceStudySourceKnowledge({ subjectId: subject.id, sourceKind: 'material', sourceId: imported.material.id,
    sourceTitle: 'Tema', sourceHash: 'hash-1', ideas: extraction.ideas, relations: extraction.relations, embeddings: [[1, 0, 0]], embeddingProvider: 'test', embeddingModel: 'test' });
  const ideasA = knowledge.listStudyIdeas(subjectA.id); const ideasB = knowledge.listStudyIdeas(subjectB.id);
  assert.equal(ideasA.length, 1); assert.equal(ideasB.length, 1);
  assert.notEqual(ideasA[0].id, ideasB[0].id, 'the same concept is independently canonicalised in each subject');
  assert.equal(knowledge.getStudyIdeaDetail(ideasA[0].id).evidence[0].quote, extraction.ideas[0].evidence[0].quote);
  knowledge.replaceStudySourceKnowledge({ subjectId: subjectA.id, sourceKind: 'material', sourceId: imported.material.id,
    sourceTitle: 'Tema', sourceHash: 'hash-1b', ideas: extraction.ideas, relations: extraction.relations, embeddings: [null], embeddingProvider: 'test', embeddingModel: 'test' });
  assert.ok(knowledge.listStudyIdeaVectors(subjectA.id)[0].embedding, 'reanalyzing an existing idea without a new vector preserves its embedding');

  const sourcePath2 = path.join(root, 'tema-2.txt'); fs.writeFileSync(sourcePath2, 'La limitación del poder protege el equilibrio institucional.');
  const second = await materials.importStudyMaterialFile(sourcePath2, { courseId: course.id, subjectId: subjectA.id });
  knowledge.replaceStudySourceKnowledge({ subjectId: subjectA.id, sourceKind: 'material', sourceId: second.material.id, sourceTitle: 'Tema 2', sourceHash: 'hash-2',
    ideas: [{ key: 'balance', type: 'concept', label: 'Equilibrio institucional', statement: 'El equilibrio institucional limita el poder.', role: 'principal', confidence: 0.9,
      evidence: [{ quote: 'La limitación del poder protege el equilibrio institucional.', location: '' }] }], relations: [], embeddings: [[0.99, 0.01, 0]], embeddingProvider: 'test', embeddingModel: 'test' });
  knowledge.connectStudySourceIdeasSemantically(subjectA.id, 'material', second.material.id);
  assert.ok(knowledge.getStudyKnowledgeGraph(subjectA.id).edges.length >= 1, 'semantic neighbours inside one subject are connected');
  assert.equal(knowledge.getStudyKnowledgeGraph(subjectB.id).edges.length, 0, 'relations never cross subjects');
  const secondIdea = knowledge.listStudyIdeas(subjectA.id).find((idea) => idea.label === 'Equilibrio institucional');
  assert.ok(secondIdea, 'the second source produced its canonical idea');
  assert.equal(knowledge.deleteStudyIdea(secondIdea.id), true, 'an idea can be deleted explicitly');
  assert.equal(knowledge.getStudyIdeaDetail(secondIdea.id), null, 'deleting an idea removes its detail and embedding row');
  assert.equal(knowledge.getStudyKnowledgeGraph(subjectA.id).nodes.some((node) => node.id === secondIdea.id), false, 'the deleted idea leaves the graph');
  assert.equal(knowledge.getStudyKnowledgeGraph(subjectA.id).edges.some((edge) => edge.source === secondIdea.id || edge.target === secondIdea.id), false, 'dependent graph connections are deleted with the idea');

  const merged = ai.mergeStudyKnowledgeExtractions([extraction, { ideas: [{ ...extraction.ideas[0], key: 'duplicate', statement: 'Una formulación más extensa sobre la separación de poderes.' }], relations: [] }]);
  assert.equal(merged.ideas.length, 1, 'duplicate labels from separate chunks are merged');

  // Relation vocabulary drift must cost the offending relation, never the extraction.
  // Observed live against gemini-2.5-flash-lite: it emits `produces`, and leaks the IDEA
  // type `consequence` into relations because the prompt lists both vocabularies together.
  // A strict guard rejected the whole payload, every retry hit the same drift, and idea
  // extraction failed outright with "El JSON no cumple el esquema esperado".
  const drifted = {
    ideas: [
      { key: 'i1', type: 'process', label: 'Fase luminosa', statement: 'La fase luminosa produce ATP y NADPH.', role: 'principal', confidence: 0.9, evidence: [{ quote: 'La fase luminosa produce ATP y NADPH', location: 'p. 2' }] },
      { key: 'i2', type: 'concept', label: 'Ciclo de Calvin', statement: 'El ciclo de Calvin fija el CO2.', role: 'principal', confidence: 0.9, evidence: [{ quote: 'El ciclo de Calvin fija el dioxido de carbono', location: 'p. 3' }] },
    ],
    relations: [
      { from: 'i1', to: 'i2', type: 'produces', basis: 'Aporta ATP y NADPH.', confidence: 0.9 },
      { from: 'i1', to: 'i2', type: 'consequence', basis: 'Leak del vocabulario de ideas.', confidence: 0.8 },
      { from: 'i2', to: 'i1', type: 'depends_on', basis: 'El ciclo consume ATP y NADPH.', confidence: 0.9 },
    ],
  };
  assert.ok(ai.isStudyKnowledgeExtraction(drifted), 'off-vocabulary relation types do not invalidate a sound extraction');
  const mergedDrift = ai.mergeStudyKnowledgeExtractions([drifted]);
  assert.equal(mergedDrift.ideas.length, 2, 'both ideas survive an off-vocabulary relation');
  assert.deepEqual(mergedDrift.relations.map((relation) => relation.type), ['depends_on'],
    'unknown relation types are dropped, not coerced onto the generic `related`');
  // Ideas stay strict: they are the payload, so a malformed one is a real defect.
  assert.equal(ai.isStudyKnowledgeExtraction({ ideas: [{ key: 'i1', type: 'not_a_type', label: 'x', statement: 'y', evidence: [] }], relations: [] }), false,
    'an idea with an unknown type is still rejected');
  assert.equal(ai.isStudyKnowledgeExtraction({ ideas: [], relations: [{ from: 'i1', to: 'i2' }] }), false,
    'a relation without a type string is still rejected');
  assert.match(ai.buildStudyKnowledgePrompt('Tema', 'Texto').system, /citas textuales exactas/i);
  const policySource = await readFile(path.join(repoRoot, 'electron/ai/studyAiPolicy.ts'), 'utf8');
  assert.match(policySource, /externalConsentKey/);
  assert.match(policySource, /Finalidad:/);
  assert.match(await readFile(path.join(repoRoot, 'electron/ai/studyKnowledge.ts'), 'utf8'), /mapa conceptual trazable/);
  assert.deepEqual(ai.chunkStudyKnowledgeText('A'.repeat(120) + '\n\n' + 'B'.repeat(120), 150, 4).map((part) => part.length), [120, 120]);

  const placementB = materials.getStudyMaterial(imported.material.id).placements.find((placement) => placement.subjectId === subjectB.id);
  materials.removeStudyMaterialPlacement(imported.material.id, placementB.id);
  knowledge.syncStudyKnowledgeSourceScopes('material', imported.material.id);
  assert.equal(knowledge.listStudyIdeas(subjectB.id).length, 0, 'removing a placement removes only that subject projection');
  assert.ok(knowledge.listStudyIdeas(subjectA.id).length >= 1, 'the other subject projection remains intact');
  const assessmentContext = await ai.retrieveStudyKnowledgeContext(subjectA.id, 'limitación del poder', [`material:${imported.material.id}`]);
  assert.equal(assessmentContext.ideas.length, 1, 'assessment retrieval respects explicit source selection');
  assert.match(assessmentContext.outline, /Separación de poderes/);

  const sourcePath3 = path.join(root, 'tema-3.txt'); fs.writeFileSync(sourcePath3, 'La separación de poderes limita la concentración política.');
  const third = await materials.importStudyMaterialFile(sourcePath3, { courseId: course.id, subjectId: subjectA.id });
  knowledge.replaceStudySourceKnowledge({ subjectId: subjectA.id, sourceKind: 'material', sourceId: third.material.id,
    sourceTitle: 'Tema 3', sourceHash: 'hash-3', ideas: extraction.ideas, relations: [], embeddings: [[1, 0, 0]], embeddingProvider: 'test', embeddingModel: 'test' });
  const sharedIdeaId = knowledge.listStudyIdeas(subjectA.id).find((idea) => idea.label === 'Separación de poderes').id;
  knowledge.purgeStudyKnowledgeSource('material', imported.material.id);
  assert.ok(knowledge.getStudyIdeaDetail(sharedIdeaId), 'purging one source preserves an idea that is still supported by another source');
  knowledge.purgeStudyKnowledgeSource('material', third.material.id);
  assert.equal(knowledge.getStudyIdeaDetail(sharedIdeaId), null, 'purging the last source deletes the idea, embedding, evidence, and connections');

  const [searchSource, questionSource, ideasView, graphView, ideasEngine, graphEngine, adapter] = await Promise.all([
    readFile(path.join(repoRoot, 'electron/ai/studySearch.ts'), 'utf8'), readFile(path.join(repoRoot, 'electron/ai/studyQuestions.ts'), 'utf8'),
    readFile(path.join(repoRoot, 'src/views/StudyIdeasView.tsx'), 'utf8'), readFile(path.join(repoRoot, 'src/views/StudyGraphView.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/views/IdeasView.tsx'), 'utf8'), readFile(path.join(repoRoot, 'src/views/GraphView.tsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/views/studyKnowledgeViewSource.ts'), 'utf8'),
  ]);
  assert.match(searchSource, /study-fragment-v2/); assert.match(searchSource, /embedding: null/);
  assert.match(questionSource, /MAPA CONCEPTUAL DE LA ASIGNATURA/); assert.match(questionSource, /no es evidencia/);
  assert.match(ideasView, /<IdeasView/); assert.match(graphView, /<GraphView/);
  for (const marker of ['study-ideas-view', 'study-ideas-subject']) assert.match(ideasView, new RegExp(marker));
  for (const marker of ['study-graph-view', 'study-graph-subject']) assert.match(graphView, new RegExp(marker));
  for (const academicPattern of ['VirtualList', 'DETAIL_MIN_WIDTH', 'DETAIL_MAX_WIDTH', 'Ordenar: nombre', 'Todos los tipos', 'Ideas conectadas']) assert.match(ideasEngine, new RegExp(academicPattern));
  for (const graphCapability of ['SigmaGraph', 'GRAPH_PRESETS', 'layoutMode', 'highlightDepth', 'playGraphHistory', 'sigma-graph-engine']) assert.match(graphCapability === 'sigma-graph-engine' ? await readFile(path.join(repoRoot, 'src/views/graph/SigmaGraph.tsx'), 'utf8') : graphEngine, new RegExp(graphCapability));
  assert.match(adapter, /key: `study:\$\{subjectId\}`/);
  assert.match(adapter, /window\.nodus\.getStudyKnowledgeGraph\(subjectId\)/);
  assert.match(adapter, /window\.nodus\.listStudyIdeas\(subjectId/);
  assert.match(adapter, /theme:study:\$\{subjectId\}/);
  assert.match(adapter, /window\.nodus\.createStudyDocument/);
  assert.match(adapter, /placement: \{ courseId: subject\?\.courseId \?\? null, subjectId \}/);
  assert.doesNotMatch(adapter, /window\.nodus\.getGraph\(/);
  assert.match(graphEngine, /sourceStorageKey\(FILTER_KEY, dataSource\.key\)/, 'graph filters are isolated by knowledge source');
  closeDb(); console.log('Study knowledge graph tests passed!');
} finally { await rm(root, { recursive: true, force: true }); }

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript'); const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename; const originalLoad = Module._load;
  const electronStub = { app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (value) => Buffer.from(String(value)), decryptString: (value) => Buffer.from(value).toString() },
    dialog: { showMessageBoxSync: () => 0 }, shell: {}, BrowserWindow: class {} };
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function (request, parent, isMain) { if (request === 'electron') return electronStub; return originalLoad.call(this, request, parent, isMain); };
  require.extensions['.ts'] = function (module, filename) { const source = fs.readFileSync(filename, 'utf8'); module._compile(ts.transpileModule(source, { fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true } }).outputText, filename); };
}
