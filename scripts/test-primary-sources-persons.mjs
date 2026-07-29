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

if (!process.argv.includes('--electron-primary-sources-persons-test')) {
  const [view, app, repo, shared, preload, ipc] = [
    'src/views/PrimarySourcesPersonsView.tsx',
    'src/App.tsx',
    'electron/db/primarySourcePersonsRepo.ts',
    'shared/types.ts',
    'electron/preload.ts',
    'electron/ipc.ts',
  ].map((file) => fs.readFileSync(path.join(repoRoot, file), 'utf8'));

  for (const marker of [
    'primary-sources-persons-view',
    'Apariciones documentales',
    'Datos documentados',
    'Discrepancias explícitas',
    'Identidad reunida, historial intacto',
    'Comparar identidades posibles',
    'Revertir fusión',
    'nodus:navigate-primary-source',
  ]) assert.ok(view.includes(marker), `phase 7 UI contains ${marker}`);
  assert.match(app, /isPrimarySources \? <PrimarySourcesPersonsView \/>/);
  assert.doesNotMatch(view, /GEDCOM|árbol genealógico|sugerencias de parentesco/i);
  assert.match(repo, /entity_resolutions/);
  assert.match(repo, /decision='merge'/);
  assert.match(repo, /archive_person_mentions/);
  assert.doesNotMatch(repo, /DELETE FROM persons|UPDATE archive_person_mentions SET person_id/);

  for (const method of [
    'listPrimarySourcePersons',
    'getPrimarySourcePersonDossier',
    'addPrimarySourcePersonVariant',
    'mergePrimarySourcePersons',
    'revertPrimarySourcePersonMerge',
  ]) {
    assert.ok(shared.includes(method), `${method} is typed`);
    assert.ok(preload.includes(method), `${method} is exposed`);
  }
  for (const channel of [
    'primarySources:persons:list',
    'primarySources:persons:dossier',
    'primarySources:persons:addVariant',
    'primarySources:persons:merge',
    'primarySources:persons:revertMerge',
  ]) assert.ok(ipc.includes(channel), `${channel} is registered`);

  const buildDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-primary-persons-i18n-'));
  try {
    const output = path.join(buildDir, 'persons.cjs');
    execFileSync(path.join(repoRoot, 'node_modules/.bin/esbuild'), [
      path.join(repoRoot, 'src/i18n.primarySourcesPersons.ts'),
      '--bundle', '--platform=node', '--format=cjs', `--outfile=${output}`,
    ], { cwd: repoRoot, stdio: 'inherit' });
    const translations = require(output).PRIMARY_SOURCES_PERSONS_TRANSLATIONS;
    const reference = Object.keys(translations.en).sort();
    assert.ok(reference.length >= 55, 'phase 7 translation catalogue is substantive');
    for (const language of ['en', 'fr', 'de', 'pt', 'ptBR', 'it', 'tr']) {
      assert.deepEqual(Object.keys(translations[language]).sort(), reference, `${language} has every phase 7 key`);
      assert.ok(Object.values(translations[language]).every(Boolean), `${language} has no blank phase 7 copy`);
    }
  } finally {
    await rm(buildDir, { recursive: true, force: true });
  }

  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-primary-sources-persons.mjs'), '--electron-primary-sources-persons-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-primary-persons-'));
installRuntimeHooks(root);

try {
  const archive = require(path.join(repoRoot, 'electron/db/archiveRepo.ts'));
  const primary = require(path.join(repoRoot, 'electron/db/primarySourcesArchiveRepo.ts'));
  const textRepo = require(path.join(repoRoot, 'electron/db/archiveTextsRepo.ts'));
  const evidenceRepo = require(path.join(repoRoot, 'electron/db/archiveEvidenceRepo.ts'));
  const proposals = require(path.join(repoRoot, 'electron/db/archiveProposalsRepo.ts'));
  const entities = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const peopleRepo = require(path.join(repoRoot, 'electron/db/primarySourcePersonsRepo.ts'));
  const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));

  function createSource(number, label, date) {
    const content = `${label}, nacida según esta fuente en ${date}.`;
    const item = archive.createItem({
      title: `Fuente documental ${number}`,
      kind: 'text',
      fileName: `fuente-${number}.txt`,
      mimeType: 'text/plain',
      blob: Buffer.from(content),
    });
    primary.ensurePrimarySourceProjection(item.itemId, {
      title: `Fuente documental ${number}`,
      referenceCode: `ARC/PER/${number}`,
    });
    const version = textRepo.createPrimarySourceTextVersion({
      itemId: item.itemId,
      kind: 'transcription',
      languageCode: 'es',
      content,
      status: 'reviewed',
      createdBy: 'researcher',
    }).version;
    const excerpt = evidenceRepo.createStableArchiveExcerpt({
      itemId: item.itemId,
      textVersionId: version.textVersionId,
      startOffset: 0,
      endOffset: content.length,
      locatorDisplay: `folio ${number}r, línea 1`,
      reviewStatus: 'reviewed',
      createdBy: 'researcher',
    });
    return { item, excerpt, label, date };
  }

  function acceptPerson(source, matchedTargetId, evidenceRole = 'supports') {
    const proposal = proposals.createEntityProposal({
      itemId: source.item.itemId,
      excerptId: source.excerpt.excerptId,
      proposalKind: 'person',
      payload: {
        displayName: source.label.replace('Ysabel', 'Isabel').replace('Roxas', 'Rojas'),
        originalLabel: source.label,
        birthDate: source.date,
        sex: 'female',
      },
      matchedTargetId,
      confidence: 0.9,
      rationale: 'explicit_person_mention',
      sourceEngine: 'test-provider',
      sourceModel: 'test-model',
    });
    return proposals.acceptEntityProposal(proposal.proposalId, {
      matchedTargetId,
      evidenceRole,
      reviewer: 'researcher',
    });
  }

  const sources = [
    createSource(1, 'Ysabel de Roxas', '1842'),
    createSource(2, 'Isabel Rojas', '1843'),
    createSource(3, 'Isabela de Rojas', '1842'),
    createSource(4, 'Ysabel de Roxas', '1844'),
  ];
  const first = acceptPerson(sources[0], null);
  const firstId = first.decision.materializedTargetId;
  const second = acceptPerson(sources[1], null);
  const secondId = second.decision.materializedTargetId;
  acceptPerson(sources[2], secondId);
  acceptPerson(sources[3], firstId, 'contradicts');

  const genealogyOnly = entities.createPerson({ displayName: 'Persona solo genealógica' });
  const beforeMergeRows = peopleRepo.listPrimarySourcePersons();
  assert.equal(beforeMergeRows.length, 2, 'only people with documentary evidence appear');
  assert.ok(!beforeMergeRows.some((person) => person.personId === genealogyOnly.personId));
  assert.ok(beforeMergeRows.every((person) => person.identityStatus === 'provisional'));

  const beforeDossier = peopleRepo.getPrimarySourcePersonDossier(firstId);
  assert.equal(beforeDossier.summary.sourceCount, 2);
  assert.ok(beforeDossier.candidates.some((candidate) => candidate.personId === secondId), 'conservative comparison proposes the compatible identity');
  assert.ok(beforeDossier.mentions.every((mention) => mention.excerptId && mention.excerptLocator));

  const personCount = getDb().prepare('SELECT COUNT(*) AS count FROM persons').get().count;
  const mentionSnapshot = getDb().prepare(
    'SELECT mention_id, person_id, original_label, excerpt_id FROM archive_person_mentions ORDER BY mention_id'
  ).all();
  const merged = peopleRepo.mergePrimarySourcePersons({
    sourcePersonId: secondId,
    targetPersonId: firstId,
    rationale: 'Cuatro fuentes, variantes compatibles y fechas próximas.',
    createdBy: 'researcher',
  });

  assert.equal(peopleRepo.listPrimarySourcePersons().length, 1, 'the merged identity is listed once');
  assert.equal(merged.summary.sourceCount, 4);
  assert.equal(merged.summary.mentionCount, 4);
  assert.equal(merged.summary.identityMemberCount, 2);
  assert.deepEqual(
    new Set(merged.summary.variants.map((variant) => variant.value)),
    new Set(['Isabel de Rojas', 'Ysabel de Roxas', 'Isabel Rojas', 'Isabela de Rojas']),
    'all canonical and original forms remain visible'
  );
  assert.deepEqual(
    new Set(merged.mentions.map((mention) => mention.originalLabel)),
    new Set(['Ysabel de Roxas', 'Isabel Rojas', 'Isabela de Rojas']),
    'one person carries three original names across four sources'
  );
  assert.ok(merged.discrepancies.some((entry) =>
    entry.field === 'birth_date'
      && new Set(entry.alternatives.map((alternative) => alternative.value)).size === 3
  ), 'incompatible dates remain explicit');
  assert.ok(merged.assertions.length >= 8);
  for (const assertion of merged.assertions) {
    assert.ok(assertion.itemId);
    assert.ok(assertion.excerptId);
    assert.ok(assertion.excerptLocator);
    assert.ok(sources.some((source) => source.excerpt.excerptId === assertion.excerptId), 'every fact returns to one of the four exact excerpts');
  }
  assert.ok(merged.assertions.some((assertion) => assertion.evidenceRole === 'contradicts'));
  assert.equal(getDb().prepare('SELECT COUNT(*) AS count FROM persons').get().count, personCount, 'merge deletes no person rows');
  assert.deepEqual(
    getDb().prepare('SELECT mention_id, person_id, original_label, excerpt_id FROM archive_person_mentions ORDER BY mention_id').all(),
    mentionSnapshot,
    'merge rewrites neither original labels nor mention ownership'
  );
  const activeMerge = merged.resolutions.find((resolution) => resolution.status === 'active');
  assert.ok(activeMerge);
  assert.throws(
    () => peopleRepo.mergePrimarySourcePersons({ sourcePersonId: firstId, targetPersonId: secondId }),
    /ya forman una única identidad/,
    'a second merge inside the same identity cannot create a cycle'
  );

  const withVariant = peopleRepo.addPrimarySourcePersonVariant(firstId, 'Isabel de Rojas y Mendoza');
  assert.ok(withVariant.summary.variants.some((variant) => variant.value === 'Isabel de Rojas y Mendoza'));
  assert.ok(withVariant.mentions.every((mention, index) =>
    mention.originalLabel === merged.mentions[index].originalLabel
  ), 'editorial variants do not alter documentary forms');

  peopleRepo.revertPrimarySourcePersonMerge(activeMerge.resolutionId);
  const separated = peopleRepo.listPrimarySourcePersons();
  assert.equal(separated.length, 2, 'reverting immediately restores the two dossiers');
  assert.deepEqual(
    getDb().prepare('SELECT mention_id, person_id, original_label, excerpt_id FROM archive_person_mentions ORDER BY mention_id').all(),
    mentionSnapshot,
    'revert needs no restorative rewrite because source rows were never changed'
  );
  assert.equal(
    getDb().prepare('SELECT status FROM entity_resolutions WHERE resolution_id=?').get(activeMerge.resolutionId).status,
    'reverted'
  );
  assert.equal(
    getDb().prepare(
      `SELECT COUNT(*) AS count FROM archive_audit_log
       WHERE action IN ('entity_resolution_created', 'entity_resolution_reverted')`
    ).get().count >= 2,
    true,
    'merge and revert leave an audit trail'
  );
  assert.deepEqual(getDb().pragma('foreign_key_check'), []);

  console.log('Primary Sources documentary people phase test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath: () => userDataPath,
      getVersion: () => '0.0.0-test',
      getAppPath: () => repoRoot,
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(String(value), 'utf8'),
      decryptString: (value) => Buffer.from(value).toString('utf8'),
    },
    protocol: {
      registerSchemesAsPrivileged: () => undefined,
      handle: () => undefined,
    },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
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
