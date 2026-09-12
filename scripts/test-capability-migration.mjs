import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-capability-migration-'));
const profile = path.join(scratch, 'profile');
fs.mkdirSync(profile, { recursive: true });
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

const bundle = path.join(scratch, 'migration.cjs');
await build({
  stdin: { contents: `export * from './electron/capabilities/migration';`, resolveDir: root, loader: 'ts' },
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  plugins: [{
    name: 'test-environment',
    setup(api) {
      api.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'mock' }));
      api.onResolve({ filter: /pluginStoreV2$/ }, () => ({ path: 'store', namespace: 'mock' }));
      api.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path: name }) => ({
        contents: name === 'electron'
          ? `export const app = { getPath: () => ${JSON.stringify(profile)}, getVersion: () => '5.3.2', isPackaged: false, getAppPath: () => ${JSON.stringify(scratch)} };`
          : `export const installVerifiedPlugin = (...args) => globalThis.__install(...args);
             export const listInstalledPluginsV2 = () => globalThis.__installed();
             export const readPluginStateV2 = (id) => globalThis.__state(id);`,
        loader: 'js',
      }));
      api.onResolve({ filter: /^@shared\// }, ({ path: value }) => ({ path: path.join(root, 'shared', `${value.slice(8)}.ts`) }));
    },
  }],
});
const lib = createRequire(import.meta.url)(bundle);

// ---------------------------------------------------------------- fixtures

const skill = (overrides = {}) => ({
  id: overrides.id ?? `s-${Math.random().toString(36).slice(2, 8)}`,
  name: 'A skill', description: 'Does a thing.', instructions: 'Do the thing.',
  enabled: { assistant: false, nodi: false }, capabilities: [], tools: [],
  author: 'local', category: 'Personal', version: '1.0.0', license: 'AGPL-3.0-only',
  ...overrides,
});

const builtinChemistry = (enabled = { assistant: true, nodi: false }, extra = {}) =>
  skill({ id: 'builtin-chemistry', name: 'Chemistry Studio', builtin: 'chemistry', capabilities: ['nodus:chemistry'], instructions: 'Baseline chemistry instructions.', description: 'Baseline chemistry description.', enabled, ...extra });
const builtinLegal = (enabled = { assistant: false, nodi: false }) =>
  skill({ id: 'builtin-legal', name: 'Legalize', builtin: 'legal', capabilities: ['nodus:legal'], instructions: 'Baseline legal instructions.', enabled });
const builtinGenomics = (enabled = { assistant: false, nodi: false }) =>
  skill({ id: 'builtin-genomics', name: 'AlphaGenome', builtin: 'genomics', capabilities: ['nodus:genomics'], instructions: 'Baseline genomics instructions.', enabled });

const BASELINES = {
  chemistry: { name: 'Chemistry Studio', description: 'Baseline chemistry description.', instructions: 'Baseline chemistry instructions.' },
  legal: { name: 'Legalize', description: 'Does a thing.', instructions: 'Baseline legal instructions.' },
  genomics: { name: 'AlphaGenome', description: 'Does a thing.', instructions: 'Baseline genomics instructions.' },
};

const PACKAGED = {
  'chemistry-studio': { id: 'chemistry-studio', name: 'Chemistry Studio', description: 'Packaged chemistry description.', instructions: 'Packaged chemistry instructions.', version: '2.0.0', digest: 'a'.repeat(64) },
  legalize: { id: 'legalize', name: 'Legalize', description: 'Packaged legal description.', instructions: 'Packaged legal instructions.', version: '2.0.0', digest: 'b'.repeat(64) },
  alphagenome: { id: 'alphagenome', name: 'AlphaGenome', description: 'Packaged genomics description.', instructions: 'Packaged genomics instructions.', version: '2.0.0', digest: 'c'.repeat(64) },
};

/** A store that behaves like the real one for the purposes of the migration: installing
 *  makes a package active, and the migration can read that back. */
function stubStore(options = {}) {
  const installed = new Map();
  const attempts = [];
  globalThis.__install = (download, opts) => {
    const id = download.source.path.split('/').pop();
    attempts.push(id);
    if (options.failInstall?.(id, attempts.filter(entry => entry === id).length)) throw new Error(`install refused for ${id}`);
    const state = { id, status: 'ready', active: { version: '2.0.0', digest: 'd'.repeat(64), target: 'any', installedAt: new Date().toISOString() }, dataVersion: 0 };
    installed.set(id, state);
    void opts;
    return { state, package: null, release: null, activated: true };
  };
  globalThis.__installed = () => [...installed.values()];
  globalThis.__state = id => installed.get(id) ?? null;
  return { installed, attempts };
}

function migrationContext(skills, overrides = {}) {
  let library = structuredClone(skills);
  const migrated = [];
  return {
    library: () => library,
    migrated,
    context: {
      readSkills: () => library,
      writeSkills: next => { library = next; },
      baseline: builtin => BASELINES[builtin],
      packaged: pluginId => PACKAGED[pluginId],
      legacyData: pluginId => ({ pluginId, sample: true }),
      migrateData: async (pluginId, legacy) => { migrated.push([pluginId, legacy]); },
      preLibraryProfile: false,
      ...overrides,
    },
  };
}

const resetJournal = () => fs.rmSync(path.join(profile, 'profile-migrations'), { recursive: true, force: true });

/** Bootstrap packages are what make the migration work offline. */
function bootstrapFor(ids) {
  const root = path.join(scratch, 'build', 'capability-bootstrap');
  fs.rmSync(root, { recursive: true, force: true });
  for (const id of ids) {
    const dir = path.join(root, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}-2.0.0-any.nodus-plugin`), 'archive');
    fs.writeFileSync(path.join(dir, 'release-manifest.json'), '{}');
    fs.writeFileSync(path.join(dir, 'release-manifest.sig'), 'signature');
  }
}

// ---------------------------------------------------------------- detection

test('a package is installed only when something in the profile actually asked for it', () => {
  const untouched = [builtinChemistry({ assistant: false, nodi: false }), builtinLegal(), builtinGenomics()];
  assert.deepEqual(lib.detectMigrationTargets(untouched, { preLibraryProfile: false }), [], 'a default nobody enabled is not a request');

  assert.deepEqual(lib.detectMigrationTargets([], { preLibraryProfile: false }), [], 'a default the user deleted stays deleted');

  const enabled = lib.detectMigrationTargets([builtinChemistry({ assistant: true, nodi: false })], { preLibraryProfile: false });
  assert.deepEqual(enabled.map(target => target.pluginId), ['chemistry-studio']);
  assert.equal(enabled[0].reason, 'builtin-enabled');

  const nodiOnly = lib.detectMigrationTargets([builtinGenomics({ assistant: false, nodi: true })], { preLibraryProfile: false });
  assert.deepEqual(nodiOnly.map(target => target.pluginId), ['alphagenome'], 'enabled on either surface counts');

  const all = lib.detectMigrationTargets(
    [builtinChemistry({ assistant: true, nodi: true }), builtinLegal({ assistant: true, nodi: false }), builtinGenomics({ assistant: false, nodi: true })],
    { preLibraryProfile: false },
  );
  assert.deepEqual(all.map(target => target.pluginId).sort(), ['alphagenome', 'chemistry-studio', 'legalize']);
});

test('a skill the user wrote keeps working, even with every default switched off', () => {
  const custom = skill({ id: 'mine', name: 'My analysis', capabilities: ['nodus:legal'], enabled: { assistant: true, nodi: false } });
  const targets = lib.detectMigrationTargets([builtinLegal({ assistant: false, nodi: false }), custom], { preLibraryProfile: false });
  assert.deepEqual(targets.map(target => target.pluginId), ['legalize']);
  assert.equal(targets[0].reason, 'custom-skill-depends');
  assert.deepEqual(targets[0].skills, [], 'nothing is adopted; the package is installed so the dependency resolves');

  // The short name is the same dependency written the older way.
  const legacyName = skill({ id: 'mine2', capabilities: ['chemistry'], enabled: { assistant: true, nodi: false } });
  assert.deepEqual(lib.detectMigrationTargets([legacyName], { preLibraryProfile: false }).map(target => target.pluginId), ['chemistry-studio']);
});

test('a downloaded copy of an official skill is the same package by another route', () => {
  const downloaded = skill({
    id: 'downloaded', name: 'Legalize', capabilities: ['nodus:legal'], enabled: { assistant: true, nodi: false },
    origin: { sourceId: 'nodusresearch/nodus-research-skill-marketplace', path: 'legalize', commit: 'x', packageId: 'legalize', version: '1.1.1', digest: 'e'.repeat(64) },
  });
  const targets = lib.detectMigrationTargets([builtinLegal({ assistant: false, nodi: false }), downloaded], { preLibraryProfile: false });
  assert.deepEqual(targets.map(target => target.pluginId), ['legalize']);
  assert.equal(targets[0].reason, 'downloaded-copy-enabled');
  assert.deepEqual(targets[0].skills.map(entry => entry.id), ['downloaded']);
});

test('a profile from before the library existed had chemistry on, and that is honoured', () => {
  const targets = lib.detectMigrationTargets([], { preLibraryProfile: true });
  assert.deepEqual(targets.map(target => target.pluginId), ['chemistry-studio']);
  assert.equal(targets[0].reason, 'implicit-legacy-chemistry');
});

// ---------------------------------------------------------------- adoption

test('adoption keeps the identity and turns the user\'s edits into overlays', () => {
  const edited = builtinChemistry({ assistant: true, nodi: true }, { instructions: 'My own chemistry rules.' });
  const adopted = lib.adoptSkill(edited, BASELINES.chemistry, {
    ...PACKAGED['chemistry-studio'], plugin: { id: 'chemistry-studio', version: '2.0.0', digest: 'a'.repeat(64) },
  });
  assert.equal(adopted.skill.id, 'builtin-chemistry', 'the local id is kept, so a conversation still refers to it');
  assert.deepEqual(adopted.skill.enabled, { assistant: true, nodi: true }, 'per-surface flags survive');
  assert.equal(adopted.skill.builtin, undefined, 'it is no longer part of the application');
  assert.equal(adopted.skill.plugin.id, 'chemistry-studio');
  assert.equal(adopted.skill.instructions, 'My own chemistry rules.', 'the edit wins over the package text');
  assert.deepEqual(adopted.overlay, { instructions: 'My own chemistry rules.' });
  assert.equal(adopted.skill.name, 'Chemistry Studio', 'what was not edited follows the package');

  const untouched = lib.adoptSkill(builtinChemistry(), BASELINES.chemistry, {
    ...PACKAGED['chemistry-studio'], plugin: { id: 'chemistry-studio', version: '2.0.0', digest: 'a'.repeat(64) },
  });
  assert.equal(untouched.overlay, undefined, 'an unedited default carries no overlay');
  assert.equal(untouched.skill.instructions, 'Packaged chemistry instructions.');
});

test('two identical copies become one skill; two different ones keep the user\'s words', () => {
  const plugin = { id: 'legalize', version: '2.0.0', digest: 'b'.repeat(64) };
  const first = lib.adoptSkill(builtinLegal({ assistant: true, nodi: false }), BASELINES.legal, { ...PACKAGED.legalize, plugin });
  const second = lib.adoptSkill(skill({ id: 'copy', name: 'Legalize', instructions: 'Baseline legal instructions.', enabled: { assistant: false, nodi: true } }), BASELINES.legal, { ...PACKAGED.legalize, plugin });
  const merged = lib.consolidate([first, second]);
  assert.equal(merged.skills.length, 1, 'the built-in and its downloaded twin are one skill');
  assert.deepEqual(merged.skills[0].enabled, { assistant: true, nodi: true }, 'and it is enabled wherever either copy was');
  assert.deepEqual(merged.preserved, []);

  const divergent = lib.adoptSkill(skill({ id: 'mine', name: 'Legalize', instructions: 'Completely different rules I wrote.', enabled: { assistant: true, nodi: false } }), BASELINES.legal, { ...PACKAGED.legalize, plugin });
  const split = lib.consolidate([first, divergent]);
  assert.equal(split.skills.length, 1);
  assert.equal(split.preserved.length, 1, 'the diverging copy is kept');
  assert.equal(split.preserved[0].instructions, 'Completely different rules I wrote.', 'with the text the user wrote');
  assert.deepEqual(split.preserved[0].enabled, { assistant: false, nodi: false }, 'switched off, so nothing runs unasked');
  assert.equal(split.preserved[0].plugin, undefined, 'and no longer claiming to be the package');
});

// ---------------------------------------------------------------- the whole move

test('the migration installs, adopts and records itself, in place', async () => {
  resetJournal();
  const store = stubStore();
  bootstrapFor(['chemistry-studio', 'legalize']);
  const other = skill({ id: 'before', name: 'Something else' });
  const after = skill({ id: 'after', name: 'Another thing' });
  const { context, library, migrated } = migrationContext([other, builtinChemistry({ assistant: true, nodi: false }), after]);

  const outcome = await lib.runCapabilityMigration(context);
  assert.deepEqual(outcome.failed, []);
  assert.deepEqual(outcome.installed, ['chemistry-studio']);
  assert.deepEqual(outcome.adopted, ['builtin-chemistry']);
  assert.deepEqual(migrated.map(([id]) => id), ['chemistry-studio'], 'the package migrated its own data');

  const result = library();
  assert.deepEqual(result.map(entry => entry.id), ['before', 'builtin-chemistry', 'after'], 'the skill keeps its position');
  assert.equal(result[1].plugin.id, 'chemistry-studio');
  assert.equal(result[1].builtin, undefined);

  const journal = lib.readMigrationJournal();
  assert.equal(journal.entries.length, 1);
  assert.equal(journal.entries[0].phase, 'complete');
  assert.equal(journal.entries[0].reason, 'builtin-enabled');
  assert.doesNotMatch(JSON.stringify(journal), /api[_-]?key|secret|password/i, 'the journal records decisions, never credentials');
});

test('a second run changes nothing and installs nothing again', async () => {
  resetJournal();
  const store = stubStore();
  bootstrapFor(['legalize']);
  const { context, library } = migrationContext([builtinLegal({ assistant: true, nodi: false })]);

  await lib.runCapabilityMigration(context);
  const first = structuredClone(library());
  await lib.runCapabilityMigration(context);
  assert.deepEqual(library(), first, 'the library is untouched by a repeat run');
  assert.deepEqual(store.attempts, ['legalize'], 'and nothing is installed twice');
});

test('a failure leaves the skill enabled, the data intact and something to retry', async () => {
  resetJournal();
  const store = stubStore({ failInstall: (id, attempt) => id === 'alphagenome' && attempt === 1 });
  bootstrapFor(['alphagenome']);
  const { context, library } = migrationContext([builtinGenomics({ assistant: true, nodi: false })]);

  const failed = await lib.runCapabilityMigration(context);
  assert.equal(failed.failed.length, 1);
  assert.equal(failed.failed[0].pluginId, 'alphagenome');
  assert.deepEqual(library()[0].enabled, { assistant: true, nodi: false }, 'the activation the user chose is untouched');
  assert.equal(library()[0].builtin, 'genomics', 'and nothing was adopted from a package that did not install');

  const pending = lib.pendingMigrations();
  assert.equal(pending.length, 1);
  assert.ok(pending[0].failure, 'the journal says what went wrong');

  // The retry succeeds and finishes the move.
  const retried = await lib.runCapabilityMigration(context);
  assert.deepEqual(retried.failed, []);
  assert.equal(library()[0].plugin.id, 'alphagenome');
  assert.equal(lib.readMigrationJournal().entries[0].attempts, 2, 'attempts are counted, not duplicated');
  assert.equal(lib.readMigrationJournal().entries.length, 1);
});

test('a crash after any phase resumes instead of restarting', async () => {
  for (const phase of lib.MIGRATION_PHASES.filter(entry => entry !== 'complete')) {
    resetJournal();
    const store = stubStore();
    bootstrapFor(['legalize']);
    const { context, library } = migrationContext([builtinLegal({ assistant: true, nodi: false })]);

    // Stand the journal up as if the process had died just after this phase.
    lib.recordPhase('legalize', phase, { reason: 'builtin-enabled', skillIds: ['builtin-legal'], attempts: 1 });
    if (['plugin-activated', 'data-snapshotted', 'data-migrated', 'skill-adopted', 'verified'].includes(phase)) {
      globalThis.__install({ source: { path: 'plugins/legalize' } }, {});
    }

    const outcome = await lib.runCapabilityMigration(context);
    assert.deepEqual(outcome.failed, [], `resuming from ${phase} completed`);
    assert.equal(library()[0].plugin.id, 'legalize', `resuming from ${phase} adopted the skill`);
    assert.equal(lib.readMigrationJournal().entries[0].phase, 'complete', `resuming from ${phase} finished the journal`);
    assert.ok(store.attempts.length <= 1, `resuming from ${phase} did not reinstall an active package`);
  }
});

// ---------------------------------------------------------------- offline

test('the bundled package is preferred, and the network is only the fallback', async () => {
  resetJournal();
  stubStore();
  bootstrapFor(['legalize']);
  let online = 0;
  const offline = await lib.installForMigration('legalize', { online: async () => { online++; throw new Error('should not be reached'); } });
  assert.equal(offline.activated, true);
  assert.equal(online, 0, 'an update that only worked online would strand anyone upgrading on a train');

  // Nothing bundled for this one, so the catalogue is the only route.
  bootstrapFor([]);
  await assert.rejects(lib.installForMigration('legalize'), /not bundled/);
  const fetched = await lib.installForMigration('legalize', { online: async () => { online++; return { activated: true, state: { id: 'legalize', status: 'ready' } }; } });
  assert.equal(fetched.activated, true);
  assert.equal(online, 1);
});

test('the bundled packages are inert until something asks for one', async () => {
  bootstrapFor(['chemistry-studio', 'legalize', 'alphagenome']);
  const bundled = lib.bootstrapPackages();
  assert.deepEqual(bundled.map(entry => entry.pluginId).sort(), ['alphagenome', 'chemistry-studio', 'legalize']);

  resetJournal();
  const store = stubStore();
  // A clean install: no library, no enabled defaults, nothing that ever used chemistry.
  const { context } = migrationContext([builtinChemistry({ assistant: false, nodi: false })], { preLibraryProfile: false });
  const outcome = await lib.runCapabilityMigration(context);
  assert.deepEqual(outcome.installed, [], 'a clean install registers, extracts and loads none of them');
  assert.deepEqual(store.attempts, []);
});
