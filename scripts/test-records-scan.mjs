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

if (!process.argv.includes('--electron-records-scan-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-records-scan.mjs'), '--electron-records-scan-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-records-scan-test-'));
installRuntimeHooks(root);

try {
  const scan = require(path.join(repoRoot, 'electron/ai/recordsScan.ts'));
  const repo = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));

  // A fake 2-chunk extraction: Juan appears in both chunks (dedupe), María only as
  // an event participant (must still become a person), Sevilla mentioned twice.
  const perChunk = [
    {
      persons: [{ name: 'Juan Pérez', sex: 'male', quote: 'Juan Pérez, jornalero', location: 'p. 1' }],
      places: [{ name: 'Sevilla', kind: 'municipality' }],
    },
    {
      persons: [{ name: 'juan perez', birth: 'c. 1850', quote: 'natural de Sevilla', location: 'p. 4' }],
      events: [
        {
          type: 'marriage',
          date: '1875',
          place: 'Sevilla',
          participants: [
            { name: 'Juan Pérez', role: 'principal' },
            { name: 'María Ruiz', role: 'spouse' },
          ],
          quote: 'contrajeron matrimonio',
          location: 'p. 4',
        },
      ],
    },
  ];

  // ── Scenario A: merge across chunks, then persist ─────────────────────────
  const merged = require(path.join(repoRoot, 'shared/recordsExtraction.ts')).mergeRecordsResults(perChunk);
  const persisted = scan.persistRecords('work-parish-1875', merged);
  assert.equal(persisted.persons, 2, 'Juan (deduped) + María = 2 persons');
  assert.equal(persisted.places, 1, 'Sevilla is a single place');
  assert.equal(persisted.events, 1);
  assert.ok(persisted.evidence >= 3, 'person + event evidence recorded');

  // Juan collapsed across chunks and kept the coalesced birth date.
  const juan = repo.listPersons({ search: 'juan' })[0];
  assert.ok(juan, 'Juan persisted');
  assert.equal(juan.birthDate, 'c. 1850', 'birth date coalesced from the second chunk');
  const juanEvidence = repo.listEvidenceFor('person', juan.personId);
  assert.equal(juanEvidence.length, 2, 'both Juan mentions attached as evidence');

  // The marriage event links both spouses to Sevilla.
  const events = repo.listEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'marriage');
  assert.equal(events[0].placeName, 'Sevilla');
  assert.equal(events[0].participants.length, 2);
  const roles = events[0].participants.map((p) => p.role).sort();
  assert.deepEqual(roles, ['principal', 'spouse']);
  const eventEvidence = repo.listEvidenceFor('event', events[0].eventId);
  assert.equal(eventEvidence[0].location, 'p. 4');
  assert.equal(eventEvidence[0].sourceKind, 'work');

  // ── Scenario B: runRecordsScan drives the injected extractor per chunk ─────
  // Distinct names so it can't collide with scenario A on the same DB.
  let calls = 0;
  const wiringResult = await scan.runRecordsScan('work-census-1880', 'texto breve de un padrón', async (input) => {
    calls++;
    assert.equal(input.task, 'extract_records', 'extractor receives the records input payload');
    return { persons: [{ name: 'Testigo Aparte', quote: 'firmó como testigo', location: 'p. 2' }] };
  });
  assert.ok(calls >= 1, 'the per-chunk extractor was invoked');
  assert.equal(wiringResult.persons, 1);
  assert.equal(repo.listPersons({ search: 'testigo aparte' }).length, 1, 'runRecordsScan persisted its person');

  // ── Scenario C: archive source_kind flows through to the evidence ──────────
  await scan.runRecordsScan(
    'archive-item-1',
    'padrón',
    async () => ({ persons: [{ name: 'Registro Archivado', quote: 'consta en el padrón', location: 'p. 1' }] }),
    'archive'
  );
  const archived = repo.listPersons({ search: 'registro archivado' })[0];
  assert.ok(archived, 'archive-scanned person persisted');
  const archEvidence = repo.listEvidenceFor('person', archived.personId);
  assert.equal(archEvidence[0].sourceKind, 'archive', 'evidence marks the archive source kind');
  assert.equal(archEvidence[0].nodusId, 'archive-item-1', 'evidence points at the archive item id');

  console.log('Records scan orchestrator test passed!');
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
