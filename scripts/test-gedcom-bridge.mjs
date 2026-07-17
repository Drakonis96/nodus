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

if (!process.argv.includes('--electron-gedcom-bridge-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-gedcom-bridge.mjs'), '--electron-gedcom-bridge-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-gedcom-bridge-test-'));
installRuntimeHooks(root);

const SAMPLE = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Juan /Pérez/
1 SEX M
1 BIRT
2 DATE ABT 1850
2 PLAC Sevilla
1 DEAT
2 DATE 1910
0 @I2@ INDI
1 NAME María /Ruiz/
1 SEX F
0 @I3@ INDI
1 NAME Pedro /Pérez/
1 SEX M
1 BIRT
2 DATE 2 MAR 1875
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 MARR
2 DATE 1873
2 PLAC Sevilla
0 TRLR
`;

try {
  const bridge = require(path.join(repoRoot, 'electron/genealogy/gedcomBridge.ts'));
  const ent = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const rel = require(path.join(repoRoot, 'electron/db/relationshipsRepo.ts'));
  const ged = require(path.join(repoRoot, 'shared/gedcom.ts'));

  // ── Import ────────────────────────────────────────────────────────────────
  const result = bridge.importGedcom(SAMPLE);
  assert.equal(result.persons, 3, 'three persons imported');
  assert.ok(result.relationships >= 3, 'spouse + two parent edges');
  assert.ok(result.events >= 3, 'birth/death/marriage events created');

  const persons = ent.listPersons();
  assert.equal(persons.length, 3);
  const juan = persons.find((p) => p.displayName === 'Juan Pérez');
  const maria = persons.find((p) => p.displayName === 'María Ruiz');
  const pedro = persons.find((p) => p.displayName === 'Pedro Pérez');
  assert.equal(juan.sex, 'male');
  assert.equal(juan.birthDate, 'c. 1850', 'ABT date normalised');
  assert.equal(maria.sex, 'female');

  // Kinship reconstructed.
  assert.deepEqual(rel.spouseIdsOf(juan.personId), [maria.personId]);
  assert.deepEqual(new Set(rel.parentIdsOf(pedro.personId)), new Set([juan.personId, maria.personId]));

  // Birth place became an event with the place.
  const juanEvents = ent.listEvents({ personId: juan.personId });
  assert.ok(juanEvents.some((e) => e.type === 'birth' && e.placeName === 'Sevilla'), 'birth event carries place');

  // ── Export → parse round trip ─────────────────────────────────────────────
  const text = bridge.exportGedcom();
  const data = ged.parseGedcom(text);
  assert.equal(data.persons.length, 3);
  assert.equal(data.families.length, 1, 'one derived family');
  const fam = data.families[0];
  // Husband is the male parent, wife the female; child is Pedro.
  const nameByXref = new Map(data.persons.map((p) => [p.xref, p.name]));
  assert.equal(nameByXref.get(fam.husband), 'Juan Pérez');
  assert.equal(nameByXref.get(fam.wife), 'María Ruiz');
  assert.equal(fam.children.length, 1);
  assert.equal(nameByXref.get(fam.children[0]), 'Pedro Pérez');
  assert.equal(fam.marriageDate, '1873', 'marriage event surfaced on the family');
  assert.equal(fam.marriagePlace, 'Sevilla');

  // An adoptive parent link must survive export → re-import: exporting it as a plain
  // CHIL silently turned adopted children into birth children (audit 2026-07).
  const adoptee = ent.createPerson({ displayName: 'Adela Adoptada', sex: 'female', birthDate: '1955' });
  rel.addRelationship(juan.personId, adoptee.personId, 'parent', 'user_asserted', 'adoptive');
  const withAdoption = bridge.buildGedcomData();
  const adoptiveFamily = withAdoption.families.find((f) => (f.adoptedChildren ?? []).length > 0);
  assert.ok(adoptiveFamily, 'the derived family marks its adopted child');
  const adoptionText = bridge.exportGedcom();
  assert.match(adoptionText, /2 PEDI adopted/, 'export carries the adoption as FAMC/PEDI');

  const reimported = ged.parseGedcom(adoptionText);
  const backFamily = reimported.families.find((f) => (f.adoptedChildren ?? []).length > 0);
  assert.ok(backFamily, 'a re-parsed export still knows which child was adopted');
  assert.equal(backFamily.adoptedChildren.length, 1);

  console.log('GEDCOM bridge test passed!');
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
