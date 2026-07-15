// Live, isolated reliability suite for Nodi. The API key exists only in the
// process environment and the ephemeral secret store; the resulting report is
// sanitized and contains no credentials.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const reportPath = path.resolve(process.env.NODUS_NODI_REPORT || path.join(os.tmpdir(), 'nodus-nodi-gemini-shadow-report.json'));

if (!process.argv.includes('--electron-nodi-gemini-shadow')) {
  if (!process.env.GEMINI_API_KEY?.trim()) throw new Error('Set GEMINI_API_KEY for this one isolated run.');
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [path.join(repoRoot, 'scripts/verify-nodi-gemini-shadow.mjs'), '--electron-nodi-gemini-shadow'], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const apiKey = process.env.GEMINI_API_KEY?.trim();
assert.ok(apiKey);
const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-nodi-gemini-shadow-'));
installRuntimeHooks(root);
let closeDb = () => undefined;
let clearApiKey = () => undefined;
const startedAt = Date.now();

try {
  const vaults = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
  const providers = require(path.join(repoRoot, 'electron/ai/providers.ts'));
  const settings = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const nodi = require(path.join(repoRoot, 'electron/ai/nodiChat.ts'));
  const demo = require(path.join(repoRoot, 'electron/db/demoData.ts'));
  const org = require(path.join(repoRoot, 'electron/db/studyOrgRepo.ts'));
  const studySearch = require(path.join(repoRoot, 'electron/ai/studySearch.ts'));
  const entities = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const relationships = require(path.join(repoRoot, 'electron/db/relationshipsRepo.ts'));
  const databases = require(path.join(repoRoot, 'electron/db/databasesRepo.ts'));
  const databaseApi = require(path.join(repoRoot, 'electron/db/database.ts'));
  const crossVault = require(path.join(repoRoot, 'electron/db/crossVault.ts'));
  ({ closeDb } = databaseApi);
  clearApiKey = () => secrets.clearApiKey('gemini');

  secrets.setApiKey('gemini', apiKey);
  delete process.env.GEMINI_API_KEY;
  const [chatModels, embeddingModels] = await Promise.all([
    providers.listModels('gemini', secrets.getApiKey('gemini')),
    providers.listEmbeddingModels('gemini', secrets.getApiKey('gemini')),
  ]);
  const modelName = ['gemini-2.5-flash-lite', 'gemini-3.1-flash-lite'].find((id) => chatModels.some((item) => item.id === id));
  const embeddingName = ['gemini-embedding-001', 'text-embedding-004'].find((id) => embeddingModels.some((item) => item.id === id));
  assert.ok(modelName && embeddingName, 'cheap Gemini chat and embedding models are available');
  const model = { provider: 'gemini', model: modelName };
  const configureActiveVault = () => {
    secrets.setApiKey('gemini', apiKey);
    settings.updateSettings({ uiLanguage: 'es', promptLanguage: 'es', nodiModel: model, chatModel: model, embeddingProvider: 'gemini', embeddingModel: embeddingName });
  };
  const switchVault = (id) => {
    crossVault.closeCrossVaultConnections();
    databaseApi.closeDb();
    vaults.setActiveVault(id);
    databaseApi.getDb();
    configureActiveVault();
  };
  configureActiveVault();

  const academic = vaults.renameVault(vaults.getActiveVault().id, 'Investigación aprendizaje shadow');
  assert.equal(demo.seedDemoData(), true);

  const study = vaults.createVault('Estudio biología shadow', 'estudio');
  switchVault(study.id);
  const course = org.createStudyCourse({ name: 'Biología celular shadow' });
  const subject = org.createStudySubject({ courseId: course.id, name: 'Bioenergética shadow' });
  org.createStudyDocument({
    title: 'Mitocondria y ATP shadow', kind: 'apunte',
    contentMarkdown: 'La fosforilación oxidativa ocurre en la membrana mitocondrial interna y produce ATP mediante la ATP sintasa. El oxígeno actúa como aceptor final de electrones.',
    placement: { courseId: course.id, subjectId: subject.id },
  });
  await studySearch.rebuildStudySearchIndex();
  await waitForStudySearch(studySearch);

  const genealogy = vaults.createVault('Familia Robles shadow', 'genealogy');
  switchVault(genealogy.id);
  const alicia = entities.createPerson({ displayName: 'Alicia Robles', sex: 'female', birthDate: '1958' });
  const bruno = entities.createPerson({ displayName: 'Bruno Robles', sex: 'male', birthDate: '1984' });
  relationships.addRelationship(alicia.personId, bruno.personId, 'parent', 'user_asserted', null, 'Alicia consta como madre de Bruno en el registro familiar shadow.');

  const databaseVault = vaults.createVault('Proyectos financieros shadow', 'databases');
  switchVault(databaseVault.id);
  const budget = databases.createDatabase('Presupuestos shadow');
  const projectColumn = databases.createColumn(budget.id, 'Proyecto', 'title');
  const amountColumn = databases.createColumn(budget.id, 'Presupuesto EUR', 'number');
  const row = databases.createRow(budget.id);
  databases.setCell(row.id, projectColumn.id, 'Proyecto Aurora');
  databases.setCell(row.id, amountColumn.id, '42000');

  const answers = {};
  const ask = async (id, question, contexts, currentView = null) => {
    const deltas = [];
    const answer = await retryOnce(() => nodi.streamNodiChat({ messages: [{ role: 'user', content: question }], contexts, currentView, model }, (delta) => { if (delta) deltas.push(delta); }));
    assert.ok(deltas.length > 0, `${id} streamed`);
    answers[id] = answer;
    await pace();
    return answer;
  };

  switchVault(academic.id);
  const roadmap = await ask('product_roadmap', 'Enumera el roadmap oficial de Nodus en orden y aclara si tiene fechas.', ['documentation']);
  for (const expected of ['Pulido', 'docencia', 'fuentes primarias', 'testimonios', 'worldbuilding', 'Servidor', 'Compartir']) assert.match(roadmap, new RegExp(expected, 'i'));
  assert.match(roadmap, /sin fechas|no.*fechas|ninguna fecha/i);
  assert.doesNotMatch(roadmap, /20\d{2}/, 'roadmap answer invented no year');

  const location = await ask('product_location', '¿Dónde están Roadmap, el cambio de tema y Ajustes?', ['documentation']);
  assert.match(location, /superior|cabecera/i);
  assert.match(location, /derech/i);
  assert.match(location, /Roadmap[\s\S]{0,180}tema[\s\S]{0,180}Ajustes/i);

  const schedule = await ask('product_schedule', '¿Cómo añado una actividad independiente en Horarios?', ['documentation']);
  assert.match(schedule, /Horarios/i); assert.match(schedule, /celda/i); assert.match(schedule, /desplegable/i); assert.match(schedule, /actividad independiente/i);

  const trap = await ask('product_trap', '¿Cómo exporto el calendario a Excel con el botón Exportar hoja?', ['documentation']);
  assert.match(trap, /No puedo verificar|no.*documentad|no aparece|no existe/i);
  assert.doesNotMatch(trap, /haz clic en .?Exportar hoja|pulsa .?Exportar hoja/i);

  const future = await ask('product_future', '¿Puedo crear ahora mismo un vault de Docencia? Dime la versión y fecha de lanzamiento.', ['documentation']);
  assert.match(future, /no.*disponible|futuro|todavía/i); assert.match(future, /no.*fecha|sin fecha|no se indica/i);

  const view = await ask('current_view', '¿Dónde está Revalidar evidencia y qué hace?', ['current_view'], {
    viewId: 'audit-shadow', title: 'Auditoría shadow', text: 'Panel Auditoría documental. En la esquina superior izquierda está el botón «Revalidar evidencia». Al pulsarlo vuelve a comprobar las citas seleccionadas.', capturedAt: Date.now(),
  });
  assert.match(view, /superior izquierda/i); assert.match(view, /comprobar|revalidar/i);

  const unsupported = await ask('no_sources', '¿Dónde está el botón Fusionar calendarios?', []);
  assert.match(unsupported, /No puedo verificar.*fuentes seleccionadas/i);

  const academicAnswer = await ask('academic_vault', 'Según este vault, ¿qué efecto tiene la práctica de recuperación frente a volver a estudiar?', ['vault']);
  assert.match(academicAnswer, /retención/i); assert.match(academicAnswer, /largo plazo/i);

  switchVault(study.id);
  const studyAnswer = await ask('study_vault', '¿Dónde ocurre la fosforilación oxidativa y qué produce?', ['vault']);
  assert.match(studyAnswer, /membrana mitocondrial interna/i); assert.match(studyAnswer, /ATP/i);

  switchVault(genealogy.id);
  const genealogyAnswer = await ask('genealogy_vault', '¿Qué parentesco documentado hay entre Alicia Robles y Bruno Robles?', ['vault']);
  assert.match(genealogyAnswer, /madre|progenitora|parent|hijo/i); assert.doesNotMatch(genealogyAnswer, /esposa|cónyuge/i);

  switchVault(databaseVault.id);
  const databaseAnswer = await ask('database_vault', '¿Cuál es el presupuesto del Proyecto Aurora?', ['vault']);
  assert.match(databaseAnswer, /42[.\s]?000|42000/); assert.match(databaseAnswer, /Aurora/i);

  const allVaults = await ask('all_vaults', 'Resume mis cuatro vaults y menciona un elemento verificable de cada uno.', ['all_vaults']);
  for (const expected of ['Investigación aprendizaje shadow', 'Estudio biología shadow', 'Familia Robles shadow', 'Proyectos financieros shadow']) assert.match(allVaults, new RegExp(expected, 'i'));
  assert.match(allVaults, /ATP|Mitocondria/i); assert.match(allVaults, /Alicia|Bruno/i); assert.match(allVaults, /Presupuestos|Aurora/i);

  const report = {
    isolated: true, cleanedAfterRun: true, model: modelName, embeddingModel: embeddingName,
    cases: Object.entries(answers).map(([id, answer]) => ({ id, passed: true, answer })),
    totals: { passed: Object.keys(answers).length, failed: 0 }, durationMs: Date.now() - startedAt,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ ...report, cases: report.cases.map(({ id, passed }) => ({ id, passed })) }, null, 2));
  console.log(`Sanitized report: ${reportPath}`);
  console.log('Live isolated Gemini Nodi reliability verification passed.');
} finally {
  delete process.env.GEMINI_API_KEY;
  try { clearApiKey(); } catch { /* ephemeral profile is the final backstop */ }
  try { closeDb(); } catch { /* DB may not have opened */ }
  await rm(root, { recursive: true, force: true });
}

async function waitForStudySearch(search) {
  for (let i = 0; i < 120; i += 1) {
    const status = search.getStudySearchIndexStatus();
    if (status.state === 'ready') return status;
    if (status.state === 'error') throw new Error(status.error || 'study search indexing failed');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('study search indexing timed out');
}

async function retryOnce(operation) {
  try { return await operation(); }
  catch { await new Promise((resolve) => setTimeout(resolve, 20_000)); return operation(); }
}

async function pace() { await new Promise((resolve) => setTimeout(resolve, 1_500)); }

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript'); const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename; const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-nodi-shadow-test', getAppPath: () => repoRoot, isPackaged: false },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (value) => Buffer.from(String(value)), decryptString: (value) => Buffer.from(value).toString() },
    dialog: { showMessageBoxSync: () => 1 }, shell: {}, BrowserWindow: class {}, ipcMain: { handle: () => undefined, on: () => undefined },
  };
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('@shared/')) return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function (request, parent, isMain) { if (request === 'electron') return electronStub; return originalLoad.call(this, request, parent, isMain); };
  require.extensions['.ts'] = function (module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, resolveJsonModule: true, skipLibCheck: true } }).outputText;
    module._compile(output, filename);
  };
}
