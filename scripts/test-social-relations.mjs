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

if (!process.argv.includes('--electron-social-relations-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-social-relations.mjs'), '--electron-social-relations-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-social-relations-test-'));
installRuntimeHooks(root);

try {
  const ent = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const social = require(path.join(repoRoot, 'electron/db/socialRepo.ts'));
  const match = require(path.join(repoRoot, 'electron/db/matchRepo.ts'));
  const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));
  const { SCHEMA_VERSION } = require(path.join(repoRoot, 'electron/db/migrations.ts'));

  assert.equal(getDb().pragma('user_version', { simple: true }), SCHEMA_VERSION, `DB migrated to schema v${SCHEMA_VERSION}`);
  assert.ok(SCHEMA_VERSION >= 43, 'social-relations tables present');

  // ── Tree persons for the network ────────────────────────────────────────────
  const tomas = ent.createPerson({ displayName: 'Tomás Serrano', sex: 'male', birthDate: '1850' });
  const encarna = ent.createPerson({ displayName: 'Encarnación Vidal', sex: 'female', birthDate: '1855' });

  // ── Contacts are lightweight, non-tree nodes ────────────────────────────────
  const notario = social.createSocialContact({ displayName: 'Antonio Ruiz', notes: 'Notario del pueblo, c. 1870.' });
  assert.equal(notario.displayName, 'Antonio Ruiz');
  assert.equal(social.listSocialContacts({ search: 'ruiz' }).length, 1, 'contact found by name substring');
  assert.equal(social.listSocialContacts({ search: 'nadie' }).length, 0);

  // ── A relation to a contact, and one to another tree person ────────────────
  const r1 = social.createSocialRelation({
    personId: tomas.personId,
    targetKind: 'contact',
    targetId: notario.contactId,
    role: 'cliente',
    notes: 'Le compró una finca en 1872.',
  });
  assert.equal(r1.targetName, 'Antonio Ruiz', 'target name resolved for a contact');
  assert.equal(r1.personName, 'Tomás Serrano', 'recording person name resolved');

  const r2 = social.createSocialRelation({
    personId: tomas.personId,
    targetKind: 'person',
    targetId: encarna.personId,
    role: 'mentor',
  });
  assert.equal(r2.targetName, 'Encarnación Vidal', 'target name resolved for a tree person');

  // ── Outgoing / incoming symmetry ─────────────────────────────────────────────
  assert.equal(social.listSocialRelationsForPerson(tomas.personId).length, 2, 'both relations recorded from Tomás');
  const incoming = social.listSocialRelationsTargetingPerson(encarna.personId);
  assert.equal(incoming.length, 1, 'Encarnación sees the incoming relation, read-only');
  assert.equal(incoming[0].personName, 'Tomás Serrano');
  assert.equal(social.listSocialRelationsTargetingContact(notario.contactId).length, 1, 'contact rollup finds its one mention');

  // ── Graph shape: nodes for both kinds, edges typed by role ──────────────────
  const graph = social.socialGraph();
  assert.equal(graph.nodes.length, 3, 'tomas + encarna + notario, all appear (they have relations)');
  assert.ok(graph.nodes.some((n) => n.id === notario.contactId && n.kind === 'contact'));
  assert.ok(graph.nodes.some((n) => n.id === tomas.personId && n.kind === 'person'));
  assert.equal(graph.edges.length, 2);
  assert.ok(graph.edges.some((e) => e.role === 'cliente' && e.fromId === tomas.personId && e.toId === notario.contactId));

  // A freshly-created, relation-less contact does NOT appear in the graph (only
  // relations create graph presence — see RelationsView's "always via a ficha" design).
  const lonely = social.createSocialContact({ displayName: 'Nadie los conoce' });
  assert.ok(!social.socialGraph().nodes.some((n) => n.id === lonely.contactId), 'a contact with no relation is invisible in the graph');

  // ── Update: role/notes mutable, target is not ───────────────────────────────
  const updated = social.updateSocialRelation(r1.relationId, { role: 'apoderado', notes: 'Actuó como su apoderado desde 1875.' });
  assert.equal(updated.role, 'apoderado');
  assert.equal(updated.targetId, notario.contactId, 'target untouched by update');

  // ── Deleting a contact cascades its relations (no FK, polymorphic target) ───
  social.deleteSocialContact(notario.contactId);
  assert.equal(social.listSocialRelationsForPerson(tomas.personId).length, 1, 'the relation to the deleted contact is gone');
  assert.equal(social.listSocialContacts().length, 1, 'only the lonely contact remains');

  // ── Deleting a person cascades relations they targeted (polymorphic, no FK) ─
  assert.equal(social.listSocialRelationsTargetingPerson(encarna.personId).length, 1);
  ent.deletePerson(encarna.personId);
  assert.equal(social.listSocialRelationsForPerson(tomas.personId).length, 0, 'Tomás no longer has a relation to the deleted Encarnación');
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM social_relations').get().n, 0, 'no orphaned relation rows remain');

  // ── Deleting the RECORDER of a relation cascades via the person_id FK ───────
  const throwaway = ent.createPerson({ displayName: 'Vecino de paso' });
  const anotherContact = social.createSocialContact({ displayName: 'Otro contacto' });
  const authoredRel = social.createSocialRelation({ personId: throwaway.personId, targetKind: 'contact', targetId: anotherContact.contactId, role: 'vecino' });
  assert.ok(social.getSocialRelation(authoredRel.relationId));
  ent.deletePerson(throwaway.personId);
  assert.equal(social.getSocialRelation(authoredRel.relationId), null, 'a relation authored by a deleted person cascades away');

  // ── mergePersons repoints social relations on both sides, drops self-loops ──
  const juan1 = ent.createPerson({ displayName: 'Juan Pérez' });
  const juan2 = ent.createPerson({ displayName: 'Juan Peres' });
  const amigo = social.createSocialContact({ displayName: 'Un amigo cualquiera' });
  social.createSocialRelation({ personId: juan1.personId, targetKind: 'contact', targetId: amigo.contactId, role: 'amigo' });
  social.createSocialRelation({ personId: juan2.personId, targetKind: 'person', targetId: tomas.personId, role: 'socio' });
  // A relation between the two records being merged must become a self-loop and be dropped.
  social.createSocialRelation({ personId: juan2.personId, targetKind: 'person', targetId: juan1.personId, role: 'primo' });

  match.mergePersons(juan1.personId, juan2.personId);
  const juan1Out = social.listSocialRelationsForPerson(juan1.personId);
  assert.equal(juan1Out.length, 2, 'both relations juan2 authored moved to juan1 (the self-loop was dropped)');
  assert.ok(juan1Out.some((r) => r.targetId === amigo.contactId), 'juan1 kept its own relation');
  assert.ok(juan1Out.some((r) => r.targetId === tomas.personId), 'juan2 relation to Tomás repointed to juan1');
  assert.equal(social.listSocialRelationsForPerson(juan1.personId).filter((r) => r.targetId === juan1.personId).length, 0, 'no self-loop survives');

  console.log('Social-relations network test passed!');
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
