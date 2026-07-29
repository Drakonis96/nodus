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

if (!process.argv.includes('--electron-prosop-population-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-prosopography-population.mjs'), '--electron-prosop-population-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' },
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-prosop-population-'));
installRuntimeHooks(root);

try {
  const { getDb, closeDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
  const study = require(path.join(repoRoot, 'electron/db/prosopStudyRepo.ts'));
  const questionnaire = require(path.join(repoRoot, 'electron/db/prosopQuestionnaireRepo.ts'));
  const population = require(path.join(repoRoot, 'electron/db/prosopPopulationRepo.ts'));

  assert.ok(SCHEMA_VERSION >= 106, 'prosopography requires schema v106 or later');
  assert.equal(getDb().pragma('user_version', { simple: true }), SCHEMA_VERSION);
  const expectedTables = [
    'prosop_studies', 'prosop_methodology_versions', 'prosop_population_criteria',
    'prosop_population_memberships', 'prosop_membership_assessments',
    'prosop_questionnaire_versions', 'prosop_variables', 'prosop_variable_revisions',
    'prosop_vocabularies', 'prosop_vocabulary_terms', 'prosop_term_labels',
    'prosop_person_profiles', 'prosop_sources', 'prosop_source_segments',
    'prosop_capture_templates', 'prosop_capture_batches', 'prosop_capture_rows',
    'prosop_proposals', 'prosop_factoids', 'prosop_statements',
    'prosop_statement_entities', 'prosop_resolutions', 'prosop_missing_values',
    'prosop_cohorts', 'prosop_cohort_members', 'prosop_analysis_definitions',
    'prosop_analysis_runs', 'prosop_network_layers', 'prosop_network_edges',
    'prosop_network_edge_factoids', 'prosop_audit_log', 'note_links',
  ];
  for (const table of expectedTables) {
    assert.ok(getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} exists`);
  }

  let currentStudy = study.ensureProsopStudy({ title: 'Mujeres de letras' });
  currentStudy = study.updateProsopStudy({
    researchQuestion: '¿Cómo circularon las escritoras en las academias del XVII?',
    populationDefinition: 'Mujeres documentadas en academias literarias de Madrid entre 1620 y 1680.',
    samplingStrategy: 'Exhaustiva dentro del corpus seleccionado.',
    sourceStrategy: 'Cartas, actas y paratextos.',
    knownBiases: 'Conservación desigual de correspondencia.',
  });
  assert.match(currentStudy.researchQuestion, /academias/);

  const methodV1 = study.createProsopMethodologyDraft('investigadora');
  study.replaceProsopCriteria(methodV1.versionId, [
    { kind: 'include', label: 'Actividad literaria documentada', required: true, weight: 1 },
    { kind: 'exclude', label: 'Sin evidencia dentro del periodo', required: false, weight: 1 },
  ]);
  const publishedMethodV1 = study.publishProsopMethodology(methodV1.versionId, 'Primera versión', 'investigadora');
  assert.equal(publishedMethodV1.status, 'published');
  assert.throws(() => study.replaceProsopCriteria(methodV1.versionId, []), /inmutable/);
  const methodV2 = study.createProsopMethodologyDraft('investigadora');
  assert.equal(methodV2.versionNo, 2);
  assert.equal(study.getProsopCriteria(methodV2.versionId).length, 2, 'v2 clones v1 criteria');
  study.replaceProsopCriteria(methodV2.versionId, [
    ...study.getProsopCriteria(methodV2.versionId),
    { kind: 'supporting', label: 'Atribución dudosa', weight: 0.5 },
  ]);
  assert.equal(study.getProsopCriteria(methodV1.versionId).length, 2, 'editing v2 leaves v1 untouched');

  const occupations = questionnaire.saveProsopVocabulary({ name: 'Ocupaciones históricas', version: '1' });
  const poet = questionnaire.saveProsopVocabularyTerm({
    vocabularyId: occupations.vocabularyId,
    code: 'poeta',
    preferredLabel: 'Poeta',
    definition: 'Término normalizado del proyecto.',
  });
  assert.equal(poet.preferredLabel, 'Poeta');

  const q1 = questionnaire.createProsopQuestionnaireDraft({ title: 'Cuestionario común', createdBy: 'investigadora' });
  questionnaire.saveProsopVariableRevision(q1.questionnaireVersionId, {
    key: 'ocupacion', label: 'Ocupación', question: '¿Qué ocupación atribuye la fuente?',
    valueType: 'term', cardinality: 'many', vocabularyId: occupations.vocabularyId,
    sensitivity: 'ordinary',
  });
  const publishedQ1 = questionnaire.publishProsopQuestionnaire(q1.questionnaireVersionId, 'Primera versión', 'investigadora');
  assert.equal(publishedQ1.status, 'published');
  assert.throws(() => questionnaire.saveProsopVariableRevision(q1.questionnaireVersionId, {
    key: 'otra', label: 'Otra', question: '¿Otra?', valueType: 'text',
  }), /inmutable/);
  const q2 = questionnaire.createProsopQuestionnaireDraft({ title: 'Cuestionario común v2' });
  assert.equal(questionnaire.listProsopVariableRevisions(q2.questionnaireVersionId).length, 1);
  questionnaire.saveProsopVariableRevision(q2.questionnaireVersionId, {
    key: 'lugar', label: 'Lugar', question: '¿Dónde consta?', valueType: 'place',
  });
  assert.equal(questionnaire.listProsopVariableRevisions(q1.questionnaireVersionId).length, 1, 'v1 stays unchanged');
  assert.equal(questionnaire.listProsopVariableRevisions(q2.questionnaireVersionId).length, 2, 'v2 receives new variable');

  const workspace = population.getProsopPopulationWorkspace();
  assert.equal(workspace.study.currentMethodologyVersionId, methodV1.versionId);
  assert.equal(workspace.study.currentQuestionnaireVersionId, q1.questionnaireVersionId);
  assert.equal(workspace.vocabularies[0].terms.length, 1);

  const [ipc, preload, api, view] = await Promise.all([
    readFile(path.join(repoRoot, 'electron/ipc.ts'), 'utf8'),
    readFile(path.join(repoRoot, 'electron/preload.ts'), 'utf8'),
    readFile(path.join(repoRoot, 'shared/types.ts'), 'utf8'),
    readFile(path.join(repoRoot, 'src/views/ProsopPopulationView.tsx'), 'utf8'),
  ]);
  for (const channel of [
    'prosop:population:workspace', 'prosop:study:update', 'prosop:methodology:publish',
    'prosop:questionnaire:saveVariable', 'prosop:questionnaire:publish',
    'prosop:vocabulary:saveTerm',
  ]) {
    assert.match(ipc, new RegExp(channel.replaceAll(':', '\\:')));
    assert.match(preload, new RegExp(channel.replaceAll(':', '\\:')));
  }
  assert.match(api, /getProsopPopulationWorkspace/);
  assert.match(view, /data-testid="prosop-population-view"/);
  assert.match(view, /Publicar versión/);
  assert.match(view, /dark:/);

  closeDb();
  console.log('Prosopography population phase tests passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-test', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(String(value), 'utf8'),
      decryptString: (value) => Buffer.from(value).toString('utf8'),
    },
    dialog: {}, shell: {}, BrowserWindow: class {},
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
