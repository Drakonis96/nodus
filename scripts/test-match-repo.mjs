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

if (!process.argv.includes('--electron-match-repo-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-match-repo.mjs'), '--electron-match-repo-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-match-repo-test-'));
installRuntimeHooks(root);

try {
  const ent = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const rel = require(path.join(repoRoot, 'electron/db/relationshipsRepo.ts'));
  const match = require(path.join(repoRoot, 'electron/db/matchRepo.ts'));
  const { pairKey } = require(path.join(repoRoot, 'shared/matchCandidates.ts'));

  // Two records of the same man across sources + a near-duplicate + a control.
  const juan1 = ent.createPerson({ displayName: 'Juan Pérez', sex: 'male', birthDate: 'c. 1850', names: [{ name: 'Juan Pérez', kind: 'birth' }] });
  const juan2 = ent.createPerson({ displayName: 'Juan Peres', sex: 'unknown', birthDate: '1852', names: [{ name: 'Joan Peres', kind: 'variant' }] });
  const juan3 = ent.createPerson({ displayName: 'Juan Pérez', birthDate: '1851' });
  const pedro = ent.createPerson({ displayName: 'Pedro Ruiz', birthDate: '1850' });
  const child = ent.createPerson({ displayName: 'Hijo' });
  const spouseP = ent.createPerson({ displayName: 'Esposa' });

  // Attach data to both Juans to prove the merge is lossless.
  rel.addRelationship(juan1.personId, child.personId, 'parent');
  ent.setPersonPortrait(juan1.personId, Buffer.from('IMG'), 'image/jpeg');
  ent.createEvent({ type: 'census', date: '1875', participants: [{ personId: juan1.personId, role: 'principal' }] });
  ent.addRecordEvidence({ targetKind: 'person', targetId: juan1.personId, quote: 'censo 1875', location: 'p. 1' });

  rel.addRelationship(juan2.personId, spouseP.personId, 'spouse');
  ent.createEvent({ type: 'marriage', date: '1878', participants: [{ personId: juan2.personId, role: 'spouse' }] });
  ent.addRecordEvidence({ targetKind: 'person', targetId: juan2.personId, quote: 'matrimonio 1878', location: 'p. 2' });

  // ── Candidates ────────────────────────────────────────────────────────────
  const candidates = match.findMatchCandidates();
  const hasPair = (a, b) => candidates.some((c) => c.aId === a && c.bId === b) || candidates.some((c) => c.aId === b && c.bId === a);
  assert.ok(hasPair(juan1.personId, juan2.personId), 'the two Juan records are proposed');
  assert.ok(!candidates.some((c) => c.aId === pedro.personId || c.bId === pedro.personId), 'Pedro is never proposed');

  // ── Dismissal persists and repoints on merge ─────────────────────────────
  match.dismissMatch(juan2.personId, juan3.personId);
  assert.ok(
    !match.findMatchCandidates().some((c) => new Set([c.aId, c.bId]).has(juan2.personId) && new Set([c.aId, c.bId]).has(juan3.personId)),
    'dismissed pair excluded'
  );

  // ── Merge juan2 → juan1, losslessly ──────────────────────────────────────
  const merged = match.mergePersons(juan1.personId, juan2.personId);
  assert.equal(ent.getPerson(juan2.personId), null, 'source person removed');
  assert.equal(merged.birthDate, 'c. 1850', 'target birth date kept (target wins)');
  assert.equal(merged.sex, 'male', 'target sex kept');
  assert.ok(merged.names.some((n) => n.name === 'Joan Peres'), 'source name variant moved');
  assert.ok(merged.portrait, 'target portrait kept');

  assert.equal(ent.listEvidenceFor('person', juan1.personId).length, 2, 'both evidences now on the target');
  const juanEvents = ent.listEvents({ personId: juan1.personId });
  assert.ok(juanEvents.some((e) => e.type === 'census') && juanEvents.some((e) => e.type === 'marriage'), 'events from both merged');
  assert.deepEqual(rel.spouseIdsOf(juan1.personId), [spouseP.personId], 'source spouse relationship moved');
  assert.ok(rel.childIdsOf(juan1.personId).includes(child.personId), 'target parent relationship intact');

  // The dismissal juan2↔juan3 became juan1↔juan3.
  assert.ok(match.listDismissedPairs().has(pairKey(juan1.personId, juan3.personId)), 'dismissal repointed to the merge target');

  assert.equal(ent.listPersons().length, 5, 'one person fewer after the merge');

  console.log('Match repository test passed!');
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
      encryptString: (v) => Buffer.from(String(v), 'utf8'),
      decryptString: (v) => Buffer.from(v).toString('utf8'),
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
