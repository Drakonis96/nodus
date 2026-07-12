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

if (!process.argv.includes('--electron-relationships-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-relationships.mjs'), '--electron-relationships-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-relationships-test-'));
installRuntimeHooks(root);

try {
  const ent = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const rel = require(path.join(repoRoot, 'electron/db/relationshipsRepo.ts'));
  const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));

  assert.equal(getDb().pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.ok(SCHEMA_VERSION >= 35, 'kinship table present');

  const mk = (name) => ent.createPerson({ displayName: name }).personId;
  const abuelo = mk('Abuelo');
  const abuela = mk('Abuela');
  const padre = mk('Padre');
  const madre = mk('Madre');
  const hijo1 = mk('Hijo 1');
  const hijo2 = mk('Hijo 2');

  // Spouse is symmetric and de-duplicates regardless of argument order.
  rel.addRelationship(abuelo, abuela, 'spouse');
  rel.addRelationship(abuela, abuelo, 'spouse');
  assert.equal(rel.allRelationships().filter((r) => r.type === 'spouse').length, 1, 'spouse pair stored once');

  // Grandparents → father.
  rel.addRelationship(abuelo, padre, 'parent');
  rel.addRelationship(abuela, padre, 'parent');
  assert.deepEqual(new Set(rel.parentIdsOf(padre)), new Set([abuelo, abuela]));
  assert.ok(rel.childIdsOf(abuelo).includes(padre));

  // Parents → two children (siblings).
  rel.addRelationship(padre, madre, 'spouse');
  for (const child of [hijo1, hijo2]) {
    rel.addRelationship(padre, child, 'parent');
    rel.addRelationship(madre, child, 'parent');
  }
  assert.deepEqual(rel.siblingIdsOf(hijo1), [hijo2], 'sibling derived from shared parents');
  assert.deepEqual(rel.spouseIdsOf(padre), [madre]);

  const kin = rel.kinOf(padre);
  assert.deepEqual(new Set(kin.parents.map((p) => p.displayName)), new Set(['Abuelo', 'Abuela']));
  assert.deepEqual(new Set(kin.children.map((p) => p.displayName)), new Set(['Hijo 1', 'Hijo 2']));
  assert.deepEqual(kin.spouses.map((p) => p.displayName), ['Madre']);
  assert.deepEqual(kin.siblings, []);

  // Provenance upgrade: an AI-suggested edge later confirmed by the user. Hang it off
  // the grandfather so it doesn't alter the father's children set below.
  const suggested = mk('Sugerido');
  rel.addRelationship(abuelo, suggested, 'parent', 'ai_confirmed');
  const before = rel.listRelationshipsForPerson(suggested)[0];
  assert.equal(before.provenance, 'ai_confirmed');
  rel.addRelationship(abuelo, suggested, 'parent', 'user_asserted');
  assert.equal(rel.listRelationshipsForPerson(suggested)[0].provenance, 'user_asserted', 'provenance upgraded on re-assert');

  // Adoptive parent edge keeps its subtype (hung off the grandfather so it doesn't
  // change the father's children set used by the cascade test below).
  const adoptado = mk('Adoptado');
  rel.addRelationship(abuelo, adoptado, 'parent', 'user_asserted', 'adoptive');
  const adoptiveRel = rel.listRelationshipsForPerson(adoptado).find((r) => r.type === 'parent');
  assert.equal(adoptiveRel.subtype, 'adoptive', 'adoptive subtype stored');
  assert.ok(rel.childIdsOf(abuelo).includes(adoptado), 'adoptive child is still a child for layout');

  // Self relationship is rejected.
  assert.equal(rel.addRelationship(padre, padre, 'parent'), null);

  // Cascade: deleting a person removes their relationships.
  ent.deletePerson(hijo2);
  assert.equal(rel.listRelationshipsForPerson(hijo2).length, 0, 'relationships cascade with the person');
  assert.deepEqual(rel.siblingIdsOf(hijo1), [], 'former sibling no longer derived');

  console.log('Relationships repository test passed!');
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
