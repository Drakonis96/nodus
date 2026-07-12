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

if (!process.argv.includes('--electron-kinsug-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-kinship-suggestions.mjs'), '--electron-kinsug-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-kinsug-test-'));
installRuntimeHooks(root);

try {
  const entities = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const rels = require(path.join(repoRoot, 'electron/db/relationshipsRepo.ts'));
  const sug = require(path.join(repoRoot, 'electron/db/kinshipSuggestionsRepo.ts'));
  const { deriveKinFromEvents, deriveKinFromClaims } = require(path.join(repoRoot, 'shared/kinshipInference.ts'));
  const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));

  const dad = entities.createPerson({ displayName: 'Juan Pérez', sex: 'male' });
  const mom = entities.createPerson({ displayName: 'María Ruiz', sex: 'female' });
  const child = entities.createPerson({ displayName: 'Ana Pérez', sex: 'female' });

  // A baptism naming the parents → two strong parent candidates.
  const baptism = entities.createEvent({
    type: 'baptism',
    date: '1875',
    participants: [
      { personId: child.personId, role: 'principal' },
      { personId: dad.personId, role: 'father' },
      { personId: mom.personId, role: 'mother' },
    ],
  });
  const cands = deriveKinFromEvents([
    { type: 'baptism', quote: 'hija de Juan y María', location: 'p. 3', participants: entities.getEvent(baptism.eventId).participants },
  ]);
  sug.recordKinCandidates(cands, { sourceKind: 'work', nodusId: 'work-baptism' });

  let open = sug.listOpenSuggestions();
  assert.equal(open.length, 2, 'two surfaced parent suggestions');
  assert.ok(open.every((s) => s.type === 'parent' && s.toPerson === child.personId));
  assert.ok(open.every((s) => s.strength === 'alta'), 'a baptism is strong evidence');
  assert.ok(open[0].evidence[0].quote === 'hija de Juan y María', 'evidence quote carried');
  assert.equal(sug.openSuggestionCount(), 2);

  // No real relationship yet — the AI only proposed.
  assert.equal(rels.parentIdsOf(child.personId).length, 0, 'no relationship written by inference');

  // Re-recording the SAME evidence must not create duplicates or inflate score.
  sug.recordKinCandidates(cands, { sourceKind: 'work', nodusId: 'work-baptism' });
  open = sug.listOpenSuggestions();
  assert.equal(open.length, 2, 'idempotent: same source does not duplicate');
  const dadSug = open.find((s) => s.fromPerson === dad.personId);
  assert.equal(dadSug.evidence.length, 1, 'evidence deduped by (signal, source, quote)');

  // Confirm one suggestion → a real ai_confirmed relationship + evidence attached.
  assert.ok(sug.confirmSuggestion(dadSug.suggestionId));
  const dadRels = rels.listRelationshipsForPerson(child.personId).filter((r) => r.type === 'parent');
  assert.equal(dadRels.length, 1, 'confirmed suggestion wrote one parent edge');
  assert.equal(dadRels[0].provenance, 'ai_confirmed', 'provenance records it was an AI proposal the user vetted');
  const relEvidence = entities.listEvidenceFor('relationship', dadRels[0].relId);
  assert.ok(relEvidence.length >= 1 && relEvidence[0].quote === 'hija de Juan y María', 'evidence attached to the edge');

  // The confirmed pair no longer surfaces (real relationship now exists).
  open = sug.listOpenSuggestions();
  assert.equal(open.length, 1, 'confirmed suggestion drops out');
  const momSug = open[0];

  // Dismiss the other → gone, and never re-proposed even if re-scanned.
  assert.ok(sug.dismissSuggestion(momSug.suggestionId));
  assert.equal(sug.listOpenSuggestions().length, 0, 'dismissed suggestion drops out');
  sug.recordKinCandidates(cands, { sourceKind: 'work', nodusId: 'work-baptism-2' });
  assert.equal(sug.listOpenSuggestions().length, 0, 'dismissal is persistent across rescans');

  // Existing relationship is never re-proposed as a suggestion.
  const p2 = entities.createPerson({ displayName: 'Luis Soto', sex: 'male' });
  const p3 = entities.createPerson({ displayName: 'Elena Soto', sex: 'female' });
  rels.addRelationship(p2.personId, p3.personId, 'spouse', 'user_asserted');
  sug.recordKinCandidates(
    deriveKinFromClaims([{ subjectId: p2.personId, objectId: p3.personId, relation: 'esposa', quote: 'su esposa', location: null }]),
    { sourceKind: 'archive', nodusId: 'item-1' }
  );
  assert.equal(
    sug.listSuggestionsForPerson(p2.personId).length,
    0,
    'a pair already asserted is never suggested'
  );

  // A single weak signal stays below the surfacing threshold until corroborated.
  const w1 = entities.createPerson({ displayName: 'Pedro Vega' });
  const w2 = entities.createPerson({ displayName: 'Lucía Vega' });
  sug.recordKinCandidates(
    deriveKinFromEvents([{ type: 'residence', participants: [{ personId: w1.personId, role: 'principal' }, { personId: w2.personId, role: 'spouse' }] }]),
    { sourceKind: 'work', nodusId: 'w-res' }
  );
  assert.equal(sug.listSuggestionsForPerson(w1.personId).length, 0, 'a lone 0.5 signal is held back');
  // A second, independent source corroborates → now it surfaces.
  sug.recordKinCandidates(
    deriveKinFromClaims([{ subjectId: w1.personId, objectId: w2.personId, relation: 'esposa', quote: 'su mujer Lucía', location: null }]),
    { sourceKind: 'archive', nodusId: 'w-diary' }
  );
  const nowSurfaced = sug.listSuggestionsForPerson(w1.personId);
  assert.equal(nowSurfaced.length, 1, 'corroboration surfaces the suggestion');
  assert.equal(nowSurfaced[0].evidence.length, 2, 'both sources retained as evidence');

  console.log('Kinship suggestions repository test passed!');
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
      getPath() {
        return userDataPath;
      },
      getVersion() {
        return '0.0.0-test';
      },
      getAppPath() {
        return repoRoot;
      },
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (v) => Buffer.from(String(v), 'utf8'),
      decryptString: (v) => Buffer.from(v).toString('utf8'),
    },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  };

  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    }
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
