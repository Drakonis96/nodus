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

if (!process.argv.includes('--electron-entities-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-entities.mjs'), '--electron-entities-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-entities-test-'));
installRuntimeHooks(root);

try {
  const repo = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));

  // Schema migrated to the current version (the entity ontology arrived at v33).
  const version = getDb().pragma('user_version', { simple: true });
  assert.equal(version, SCHEMA_VERSION, `DB migrated to schema v${SCHEMA_VERSION}`);
  assert.ok(version >= 33, 'entity ontology present');

  // ── Persons with name variants + fuzzy dates ──────────────────────────────
  const juan = repo.createPerson({
    displayName: 'Juan Pérez',
    sex: 'male',
    birthDate: 'c. 1850',
    names: [{ name: 'Juan Pérez', kind: 'birth' }, { name: 'Joan Peres', kind: 'variant' }],
  });
  const maria = repo.createPerson({ displayName: 'María Ruiz', sex: 'female', birthDate: '1855' });

  const fetched = repo.getPerson(juan.personId);
  assert.equal(fetched.displayName, 'Juan Pérez');
  assert.equal(fetched.birthDate, 'c. 1850');
  assert.equal(fetched.names.length, 2, 'name variants stored');

  // The fuzzy birth date got a sortable key.
  const juanRow = getDb().prepare('SELECT birth_date_sort FROM persons WHERE person_id = ?').get(juan.personId);
  assert.equal(juanRow.birth_date_sort, '1850-01-01', 'circa date resolves to a sort key');

  // Search matches a name variant, not just the display name.
  assert.deepEqual(
    repo.listPersons({ search: 'peres' }).map((p) => p.personId),
    [juan.personId],
    'person is found by a name variant'
  );

  // ── Places de-duplicate case-insensitively ────────────────────────────────
  const sevilla = repo.findOrCreatePlace('Sevilla', 'municipality');
  const sevillaAgain = repo.findOrCreatePlace('sevilla');
  assert.equal(sevillaAgain.placeId, sevilla.placeId, 'places de-dupe by name, case-insensitive');
  assert.equal(repo.listPlaces().length, 1);

  // ── Events, participants, place join ──────────────────────────────────────
  const marriage = repo.createEvent({
    type: 'marriage',
    date: '1875',
    placeId: sevilla.placeId,
    participants: [
      { personId: juan.personId, role: 'principal' },
      { personId: maria.personId, role: 'spouse' },
    ],
  });
  const gotEvent = repo.getEvent(marriage.eventId);
  assert.equal(gotEvent.placeName, 'Sevilla', 'event resolves its place name');
  assert.equal(gotEvent.participants.length, 2);
  assert.ok(
    gotEvent.participants.some((p) => p.personId === maria.personId && p.displayName === 'María Ruiz'),
    'participant carries the person display name'
  );

  // ── Timeline ordering: dated events chronologically, undated last ─────────
  repo.createEvent({ type: 'birth', date: 'c. 1850', participants: [{ personId: juan.personId, role: 'principal' }] });
  repo.createEvent({ type: 'death', date: 'antes de 1880', participants: [{ personId: juan.personId, role: 'principal' }] });
  repo.createEvent({ type: 'other', date: '', label: 'sin fecha' });

  const timeline = repo.listEvents();
  const dated = timeline.filter((e) => e.sortKey);
  const sortKeys = dated.map((e) => e.sortKey);
  assert.deepEqual(sortKeys, [...sortKeys].sort(), 'events are ordered by sort key ascending');
  assert.equal(timeline[timeline.length - 1].sortKey, null, 'undated events sort last');

  // Filter the timeline by a participating person.
  const juanEvents = repo.listEvents({ personId: juan.personId });
  assert.ok(juanEvents.length >= 3 && juanEvents.every((e) => e.type !== 'other'), 'person filter narrows the timeline');

  // ── Evidence ──────────────────────────────────────────────────────────────
  repo.addRecordEvidence({
    targetKind: 'person',
    targetId: juan.personId,
    nodusId: 'work-census-1875',
    quote: 'Juan Pérez, 25 años, casado',
    location: 'p. 12',
    confidence: 0.9,
  });
  const evidence = repo.listEvidenceFor('person', juan.personId);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].location, 'p. 12');
  assert.equal(evidence[0].sourceKind, 'work');

  const counts = repo.recordCounts();
  assert.deepEqual(counts, { persons: 2, places: 1, events: 4 });

  // ── Cascade delete ────────────────────────────────────────────────────────
  repo.deletePerson(juan.personId);
  assert.equal(repo.getPerson(juan.personId), null, 'person removed');
  assert.equal(repo.listEvidenceFor('person', juan.personId).length, 0, 'person evidence removed');
  assert.equal(
    getDb().prepare('SELECT COUNT(*) AS c FROM event_participants WHERE person_id = ?').get(juan.personId).c,
    0,
    'participations cascade away'
  );
  assert.equal(
    getDb().prepare('SELECT COUNT(*) AS c FROM person_names WHERE person_id = ?').get(juan.personId).c,
    0,
    'name variants cascade away'
  );
  // The marriage event survives; María's participation remains.
  assert.equal(repo.getEvent(marriage.eventId).participants.length, 1, 'event keeps its other participant');

  console.log('Entities repository test passed!');
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
