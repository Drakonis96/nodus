// Live Gemini integration smoke test for the complete genealogy AI surface.
// The vault, secret, archive files, embeddings and database are all ephemeral.
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
const reportPath = path.resolve(process.env.NODUS_GENEALOGY_REPORT || path.join(os.tmpdir(), 'nodus-genealogy-gemini-shadow-report.json'));

if (!process.argv.includes('--electron-genealogy-gemini-shadow')) {
  if (!process.env.GEMINI_API_KEY?.trim()) throw new Error('Set GEMINI_API_KEY for this one isolated run.');
  execFileSync(path.join(repoRoot, 'node_modules/.bin/electron'), [path.join(repoRoot, 'scripts/verify-genealogy-gemini-shadow.mjs'), '--electron-genealogy-gemini-shadow'], {
    cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  });
  process.exit(0);
}

const apiKey = process.env.GEMINI_API_KEY?.trim();
assert.ok(apiKey, 'Gemini key is available only to the isolated process');
const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-genealogy-gemini-shadow-'));
installRuntimeHooks(root);
let closeDb = () => undefined;
let clearApiKey = () => undefined;
const startedAt = Date.now();

try {
  const vaults = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const vault = vaults.createVault('Genealogia shadow Gemini', 'genealogy');
  vaults.setActiveVault(vault.id);

  const secrets = require(path.join(repoRoot, 'electron/secrets/secretStore.ts'));
  const providers = require(path.join(repoRoot, 'electron/ai/providers.ts'));
  const settingsRepo = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const entities = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const relationships = require(path.join(repoRoot, 'electron/db/relationshipsRepo.ts'));
  const suggestionsRepo = require(path.join(repoRoot, 'electron/db/kinshipSuggestionsRepo.ts'));
  const social = require(path.join(repoRoot, 'electron/db/socialRepo.ts'));
  const archive = require(path.join(repoRoot, 'electron/db/archiveRepo.ts'));
  const ingest = require(path.join(repoRoot, 'electron/archive/archiveIngest.ts'));
  const discovery = require(path.join(repoRoot, 'electron/archive/archiveDiscovery.ts'));
  const records = require(path.join(repoRoot, 'electron/ai/recordsScan.ts'));
  const biographyAi = require(path.join(repoRoot, 'electron/ai/personBiography.ts'));
  const genealogyContext = require(path.join(repoRoot, 'electron/ai/genealogyChatContext.ts'));
  const researchAi = require(path.join(repoRoot, 'electron/ai/researchAssistant.ts'));
  const nodiAi = require(path.join(repoRoot, 'electron/ai/nodiChat.ts'));
  const genealogyDeep = require(path.join(repoRoot, 'electron/ai/genealogyDeepResearch.ts'));
  const matchRepo = require(path.join(repoRoot, 'electron/db/matchRepo.ts'));
  ({ closeDb } = require(path.join(repoRoot, 'electron/db/database.ts')));
  clearApiKey = () => secrets.clearApiKey('gemini');

  secrets.setApiKey('gemini', apiKey);
  delete process.env.GEMINI_API_KEY;
  const [chatModels, embeddingModels] = await Promise.all([
    providers.listModels('gemini', secrets.getApiKey('gemini')),
    providers.listEmbeddingModels('gemini', secrets.getApiKey('gemini')),
  ]);
  const modelName = ['gemini-2.5-flash-lite', 'gemini-3.1-flash-lite'].find((id) => chatModels.some((item) => item.id === id));
  const embeddingName = ['gemini-embedding-001', 'text-embedding-004'].find((id) => embeddingModels.some((item) => item.id === id));
  assert.ok(modelName, 'a cheap Gemini Flash Lite model is available');
  assert.ok(embeddingName, 'a Gemini embedding model is available');
  const model = { provider: 'gemini', model: modelName };
  settingsRepo.updateSettings({
    promptLanguage: 'es', uiLanguage: 'es', modelSettingsMode: 'advanced',
    embeddingProvider: 'gemini', embeddingModel: embeddingName,
    extractionModel: model, synthesisModel: model, chatModel: model, nodiModel: model, deepResearchModel: model,
  });

  const seed = [
    ['Elena Ruiz Navarro', 'female', '12 de marzo de 1885'],
    ['Manuel Ruiz Ortega', 'male', '1855'],
    ['Teresa Navarro Gil', 'female', '1860'],
    ['Joaquin Morales Vega', 'male', '1882'],
    ['Clara Ruiz Navarro', 'female', '1888'],
    ['Mateo Ruiz Soler', 'male', '1912'],
    ['Lucia Ruiz Navarro', 'female', '1890'],
    ['Antonio Perez Cano', 'male', '1870'],
    ['Rosa Molina Sanz', 'female', '1874'],
  ].map(([displayName, sex, birthDate]) => entities.createPerson({ displayName, sex, birthDate }));
  const byName = new Map(seed.map((person) => [fold(person.displayName), person]));
  const person = (name) => byName.get(fold(name));

  const fixtures = [
    {
      key: 'baptism', title: 'Partida de bautismo de Elena', docType: 'partida_bautismo',
      text: '[[p. 1]] En Villaverde, a 14 de marzo de 1885, bautice a Elena Ruiz Navarro, nacida el 12 de marzo de 1885, hija legitima de Manuel Ruiz Ortega, su padre, y Teresa Navarro Gil, su madre.',
    },
    {
      key: 'marriage', title: 'Acta matrimonial de Elena y Joaquin', docType: 'acta_matrimonio',
      text: '[[p. 2]] En Santa Marta, el 4 de mayo de 1908, contrajeron matrimonio Elena Ruiz Navarro y Joaquin Morales Vega, quienes declararon ser esposa y esposo respectivamente.',
    },
    {
      key: 'complex', title: 'Testamento de Clara Ruiz Navarro', docType: 'testamento',
      text: '[[p. 3]] Clara Ruiz Navarro declara: mi hijo Mateo Ruiz Soler sera heredero. Elena Ruiz Navarro, a quien Mateo llama tia Elena, comparece como testigo. El documento no identifica a Elena como madre de Mateo.',
    },
    {
      key: 'negative', title: 'Padron sin parentesco', docType: 'padron_habitantes',
      text: '[[p. 4]] Antonio Perez Cano, arrendador, y Rosa Molina Sanz, huesped, residen en la misma casa. No existe parentesco entre ellos. Lucia Ruiz Navarro comparece como funcionaria; compartir el apellido Ruiz no acredita parentesco con ninguna otra persona.',
    },
    {
      key: 'semantic', title: 'Nota anonima sobre la nina de Villaverde', docType: 'nota_genealogica',
      text: 'Registro auxiliar de una nina nacida el 12 de marzo de 1885 en Villaverde y bautizada dos dias despues. Sus progenitores constan en la partida parroquial. Este resumen omite deliberadamente su nombre.',
    },
    {
      key: 'distractor', title: 'Informe minero de Asturias', docType: 'informe',
      text: 'Produccion de carbon, turnos de trabajo y transporte ferroviario en una mina asturiana durante 1936. No contiene informacion familiar ni parroquial.',
    },
  ];
  const folder = archive.createFolder('Fuentes shadow');
  const fixtureDir = path.join(root, 'shadow-records');
  fs.mkdirSync(fixtureDir, { recursive: true });
  const items = new Map();
  for (const fixture of fixtures) {
    const filePath = path.join(fixtureDir, `${fixture.key}.txt`);
    fs.writeFileSync(filePath, fixture.text, 'utf8');
    const imported = await ingest.ingestArchiveFile(filePath, { folderId: folder.folderId, docType: fixture.docType });
    archive.updateItem(imported.item.itemId, { title: fixture.title, source: 'Fixture shadow aislado' });
    items.set(fixture.key, archive.getItem(imported.item.itemId));
  }
  assert.equal(archive.archiveCounts().items, fixtures.length);
  assert.ok([...items.values()].every((item) => item.extractedText?.trim()), 'all archive materials contain extracted text');

  const scanResults = {};
  for (const key of ['baptism', 'marriage', 'complex', 'negative']) {
    const item = items.get(key);
    scanResults[key] = await retryOnce(() => records.scanArchiveTextRecords(item.itemId, item.extractedText, model));
    await pace();
  }
  assert.ok(entities.listPlaces().some((place) => /villaverde/i.test(place.name)), 'place extraction found Villaverde');
  assert.ok(entities.listEvents().some((event) => event.type === 'baptism'));
  assert.ok(entities.listEvents().some((event) => event.type === 'marriage'));

  const open = suggestionsRepo.listOpenSuggestions();
  const hasSuggestion = (from, to, type) => open.some((item) => item.type === type && (
    type === 'spouse'
      ? new Set([fold(item.fromName), fold(item.toName)]).size === 2 && [fold(from), fold(to)].every((name) => [fold(item.fromName), fold(item.toName)].includes(name))
      : fold(item.fromName) === fold(from) && fold(item.toName) === fold(to)
  ));
  assert.ok(hasSuggestion('Manuel Ruiz Ortega', 'Elena Ruiz Navarro', 'parent'), 'easy paternal suggestion surfaced');
  assert.ok(hasSuggestion('Teresa Navarro Gil', 'Elena Ruiz Navarro', 'parent'), 'easy maternal suggestion surfaced');
  assert.ok(hasSuggestion('Elena Ruiz Navarro', 'Joaquin Morales Vega', 'spouse'), 'marriage suggestion surfaced');
  assert.ok(hasSuggestion('Clara Ruiz Navarro', 'Mateo Ruiz Soler', 'parent'), 'complex narrative parent suggestion surfaced');
  assert.ok(!open.some((item) => [fold(item.fromName), fold(item.toName)].includes(fold('Antonio Perez Cano')) && [fold(item.fromName), fold(item.toName)].includes(fold('Rosa Molina Sanz'))), 'explicit non-kin co-residents created no false kinship');
  assert.ok(!open.some((item) => [fold(item.fromName), fold(item.toName)].includes(fold('Elena Ruiz Navarro')) && [fold(item.fromName), fold(item.toName)].includes(fold('Mateo Ruiz Soler'))), 'aunt wording was not distorted into parent/spouse');
  assert.equal(relationships.allRelationships().length, 0, 'AI suggestions never alter the tree before confirmation');

  const spouseSuggestion = open.find((item) => item.type === 'spouse');
  assert.ok(spouseSuggestion && suggestionsRepo.confirmSuggestion(spouseSuggestion.suggestionId));
  const confirmed = relationships.allRelationships().find((item) => item.type === 'spouse');
  assert.equal(confirmed?.provenance, 'ai_confirmed');
  assert.ok(entities.listEvidenceFor('relationship', confirmed.relId).length > 0, 'confirmation preserves cited evidence');
  const dismissible = suggestionsRepo.listOpenSuggestions().find((item) => item.type === 'parent');
  assert.ok(dismissible && suggestionsRepo.dismissSuggestion(dismissible.suggestionId));
  assert.ok(!suggestionsRepo.listOpenSuggestions().some((item) => item.suggestionId === dismissible.suggestionId));

  const lexical = discovery.suggestPersonsForItem(items.get('baptism').itemId);
  assert.ok(lexical.some((item) => item.personId === person('Elena Ruiz Navarro').personId));
  assert.ok(!lexical.some((item) => item.personId === person('Antonio Perez Cano').personId));
  for (const key of ['baptism', 'marriage', 'complex']) {
    for (const suggestion of discovery.suggestPersonsForItem(items.get(key).itemId)) archive.linkItemPerson(items.get(key).itemId, suggestion.personId);
  }
  const indexResult = await discovery.embedArchiveBacklog();
  assert.equal(discovery.archiveIndexStatus().indexed, fixtures.length);
  const documentSuggestions = await discovery.suggestDocumentsForPerson(person('Elena Ruiz Navarro').personId);
  assert.ok(documentSuggestions.some((item) => item.itemId === items.get('semantic').itemId && item.reason === 'semantic'), 'unnamed but semantically relevant document surfaced');
  assert.ok(!documentSuggestions.some((item) => item.itemId === items.get('distractor').itemId), 'unrelated mining document stayed below the semantic threshold');

  const contact = social.createSocialContact({ displayName: 'Emilio Salvatierra', notes: 'Notario de Santa Marta.' });
  social.createSocialRelation({ personId: person('Elena Ruiz Navarro').personId, targetKind: 'contact', targetId: contact.contactId, role: 'patron y corresponsal', notes: 'Intercambiaron cartas entre 1910 y 1914.' });
  social.createSocialRelation({ personId: person('Elena Ruiz Navarro').personId, targetKind: 'person', targetId: person('Lucia Ruiz Navarro').personId, role: 'companera de oficio', notes: 'Trabajaron juntas; no se afirma parentesco.' });
  const socialGraph = social.socialGraph();
  assert.equal(socialGraph.edges.length, 2);
  assert.ok(socialGraph.nodes.some((node) => node.id === contact.contactId && node.kind === 'contact'));
  const context = await genealogyContext.buildGenealogyContext('Que relacion tuvo Elena con Emilio Salvatierra?');
  assert.equal(context.relaciones_sociales.length, 2, 'genealogy AI context includes Relations mode');
  assert.ok(context.relaciones_sociales.some((item) => item.contacto === 'Emilio Salvatierra'));
  assert.equal(genealogyDeep.buildFamilyFacts().relaciones_sociales.length, 2, 'Deep Research includes Relations mode');

  for (const key of ['baptism', 'marriage']) archive.linkItemPerson(items.get(key).itemId, person('Elena Ruiz Navarro').personId);
  const biography = await retryOnce(() => biographyAi.generatePersonBiography(person('Elena Ruiz Navarro').personId));
  await pace();
  assert.ok(biography.biography && biography.biography.length > 180, 'evidence-grounded biography was generated and persisted');
  assert.match(biography.biography, /1885|Villaverde/i);
  assert.doesNotMatch(biography.biography, /Paris|Nueva York/i, 'biography did not invent an unrelated place');

  const selection = { ideas: false, themes: false, contradictions: false, gaps: false, readingPath: false, authors: false, documents: true, passages: false, graph: false, graphParts: { ideaNodes: false, themeNodes: false, ideaEdges: false, authorGraph: false } };
  const researchDeltas = [];
  const researchAnswer = await retryOnce(() => researchAi.streamResearchChat({ messages: [{ role: 'user', content: 'Que relacion documentada tuvo Elena Ruiz Navarro con Emilio Salvatierra? Distingue parentesco de relacion social.' }], selection, model }, (delta) => { if (delta) researchDeltas.push(delta); }));
  await pace();
  assert.ok(researchDeltas.length > 0, 'genealogy research assistant streams');
  assert.match(researchAnswer.answer, /Emilio|corresponsal|patron/i);
  assert.match(researchAnswer.answer, /no.*parentesco|social/i);

  const nodiDeltas = [];
  const nodiAnswer = await retryOnce(() => nodiAi.streamNodiChat({ messages: [{ role: 'user', content: 'Resume la relacion entre Elena Ruiz Navarro y Emilio Salvatierra sin inventar parentesco.' }], contexts: ['vault'], model }, (delta) => { if (delta) nodiDeltas.push(delta); }));
  await pace();
  assert.ok(nodiDeltas.length > 0, 'Nodi streams over the genealogy vault');
  assert.match(nodiAnswer, /Emilio|corresponsal|patron/i);

  const progress = [];
  const deepReport = await retryOnce(() => genealogyDeep.generateGenealogyDeepResearchReport({
    objective: 'Reconstruir la vida documentada de Elena Ruiz Navarro, su parentesco probado y su red social con Emilio Salvatierra, separando hechos, hipotesis y ausencia de evidencia.',
    language: 'es', targetLength: 'concise', sectionLimit: 3, model, focusPersonId: person('Elena Ruiz Navarro').personId,
  }, (event) => progress.push(event)));
  assert.ok(progress.some((event) => event.phase === 'planning') && progress.some((event) => event.phase === 'done'));
  assert.ok(deepReport.meta.sections >= 3);
  assert.ok(deepReport.draft.draftMarkdown.length > 1200);
  assert.match(deepReport.draft.draftMarkdown, /Elena Ruiz Navarro/i);
  assert.match(deepReport.draft.draftMarkdown, /Emilio|corresponsal|patron/i, 'Deep Research uses the social-relations context');
  assert.ok(deepReport.draft.draftMarkdown.includes('nodus://archive/'), 'Deep Research cites local archive materials');

  const duplicate = entities.createPerson({ displayName: 'Elena Ruiz Navaro', sex: 'female', birthDate: '1885' });
  const matches = matchRepo.findMatchCandidates();
  assert.ok(matches.some((pair) => [pair.a.personId, pair.b.personId].includes(duplicate.personId) && [pair.a.personId, pair.b.personId].includes(person('Elena Ruiz Navarro').personId)), 'identity matching suggests the near-duplicate without auto-merging');

  const report = {
    isolated: true, cleanedAfterRun: true, model: modelName, embeddingModel: embeddingName,
    archive: { items: fixtures.length, indexed: discovery.archiveIndexStatus().indexed, newlyIndexed: indexResult.indexed },
    extraction: { persons: entities.listPersons().length, places: entities.listPlaces().length, events: entities.listEvents().length, scans: scanResults },
    kinship: { surfaced: open.length, expectedEasy: 3, expectedComplex: 1, falsePositivePairs: 0, confirmed: 1, dismissed: 1, treeBeforeConfirmation: 0 },
    discovery: { lexicalSuggestions: lexical.length, documentSuggestions: documentSuggestions.length, semanticUnnamedFound: true, distractorRejected: true },
    relationsMode: { nodes: socialGraph.nodes.length, edges: socialGraph.edges.length, includedInChatContext: true, includedInDeepResearch: true },
    biography: { chars: biography.biography.length },
    assistants: { researchDeltaEvents: researchDeltas.length, nodiDeltaEvents: nodiDeltas.length },
    deepResearch: { sections: deepReport.meta.sections, words: deepReport.meta.words, pages: deepReport.meta.pages, citedSources: deepReport.meta.worksCited },
    identityMatching: { candidates: matches.length }, durationMs: Date.now() - startedAt,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  console.log(`Sanitized report: ${reportPath}`);
  console.log('Live isolated Gemini genealogy verification passed.');
} finally {
  delete process.env.GEMINI_API_KEY;
  try { clearApiKey(); } catch { /* profile deletion is the final backstop */ }
  try { closeDb(); } catch { /* database may not have opened */ }
  await rm(root, { recursive: true, force: true });
}

async function retryOnce(operation) {
  try { return await operation(); }
  catch {
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    return operation();
  }
}

async function pace() { await new Promise((resolve) => setTimeout(resolve, 4_500)); }

function fold(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript'); const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename; const originalLoad = Module._load;
  const electronStub = {
    app: { getPath: () => userDataPath, getVersion: () => '0.0.0-genealogy-shadow-test', getAppPath: () => repoRoot, isPackaged: false },
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
