// The 5.3.1 to 5.3.2 move, end to end, against real signed packages.
//
// Everything here runs under Electron because the migrations are the packages' own
// scripts and they run in the packages' own worker processes. What is exercised is the
// real store, the real registry, the real journal and the real ladder; only the source of
// the bytes is local, and only the key is ephemeral.
//
// The scenarios are the states a profile is actually in: one discipline enabled, another,
// all three, none at all — and then the ways the move fails, because a migration that
// cannot finish must leave the skill the user had, a reason, and something to retry.
//
// Electron exits 0 on SIGTERM, so the child reports through a verdict file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { createHash, generateKeyPairSync, sign as signBytes } from 'node:crypto';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const marketplace = process.env.NODUS_MARKETPLACE_DIR;
if (!marketplace || !fs.existsSync(path.join(marketplace, 'build'))) {
  const message = 'set NODUS_MARKETPLACE_DIR to a marketplace checkout with built packages to run this';
  if (process.env.CI) throw new Error(`Cannot verify the migration: ${message}.`);
  console.log(`SKIP: ${message}.`);
  process.exit(0);
}

const target = `${process.platform}-${process.arch}`;
const index = JSON.parse(fs.readFileSync(path.join(marketplace, 'build/index.json'), 'utf8'))
  .filter(entry => entry.target === target || entry.target === 'any');
if (!index.length) {
  const message = `no package is built for ${target}. Run "node scripts/build-plugins.mjs" in the marketplace checkout`;
  if (process.env.CI) throw new Error(`Cannot verify the migration: ${message}.`);
  console.log(`SKIP: ${message}.`);
  process.exit(0);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-migration-e2e-'));
try {
  // A throwaway key stands in for the release key, which lives in a protected environment
  // and is never present on a development machine or in CI.
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  // The key id follows the packages, so a rotation is exercised here rather than breaking
  // this check.
  const keyId = JSON.parse(fs.readFileSync(path.join(marketplace, 'plugins', index[0].manifest.id, 'plugin.json'), 'utf8')).publisher.keyId;
  const trustedKeys = { keys: [{ keyId, publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() }] };

  // The bootstrap layout the application looks for inside its own build, staged outside it
  // so each scenario can copy the tree it wants into place.
  const bootstrapRoot = path.join(temporary, 'good');
  const packages = [];
  for (const entry of index) {
    const archive = fs.readFileSync(path.join(marketplace, 'build', entry.asset));
    const release = {
      schemaVersion: 1,
      plugin: entry.manifest.id,
      version: entry.manifest.version,
      publisher: { id: 'NodusResearch', keyId },
      createdAt: new Date().toISOString(),
      targets: [{ target: entry.target, asset: entry.asset, bytes: archive.byteLength, sha256: createHash('sha256').update(archive).digest('hex') }],
    };
    const manifestBytes = Buffer.from(`${JSON.stringify(release, null, 2)}\n`);
    const dir = path.join(bootstrapRoot, entry.manifest.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, entry.asset), archive);
    fs.writeFileSync(path.join(dir, 'release-manifest.json'), manifestBytes);
    fs.writeFileSync(path.join(dir, 'release-manifest.sig'), signBytes(null, manifestBytes, privateKey));
    packages.push({ id: entry.manifest.id, asset: entry.asset, version: entry.manifest.version });
  }

  // A second bootstrap tree holding the same packages, damaged in the three ways that
  // matter: a signature by someone else, an archive that does not match its manifest, and
  // an archive that is not an archive.
  const brokenRoot = path.join(temporary, 'broken');
  const impostor = generateKeyPairSync('ed25519');
  for (const { id, asset } of packages) {
    const from = path.join(bootstrapRoot, id);
    for (const [kind, damage] of Object.entries({
      'wrong-key': dir => {
        fs.writeFileSync(path.join(dir, 'release-manifest.sig'), signBytes(null, fs.readFileSync(path.join(dir, 'release-manifest.json')), impostor.privateKey));
      },
      tampered: dir => {
        const bytes = fs.readFileSync(path.join(dir, asset));
        bytes[bytes.length - 20] ^= 0xff;
        fs.writeFileSync(path.join(dir, asset), bytes);
      },
      corrupt: dir => { fs.writeFileSync(path.join(dir, asset), Buffer.from('this is not a zip file at all')); },
    })) {
      const dir = path.join(brokenRoot, kind, id);
      fs.mkdirSync(dir, { recursive: true });
      for (const file of fs.readdirSync(from)) fs.copyFileSync(path.join(from, file), path.join(dir, file));
      damage(dir);
    }
  }

  const payload = path.join(temporary, 'payload.json');
  fs.writeFileSync(payload, JSON.stringify({ packages, bootstrapRoot, brokenRoot }));

  const bootstrapBundle = path.join(temporary, 'worker-bootstrap.cjs');
  await build({
    entryPoints: [path.join(root, 'electron/capabilities/workerBootstrap.ts')],
    outfile: bootstrapBundle, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'silent',
  });

  const verdict = path.join(temporary, 'verdict.txt');
  const outfile = path.join(temporary, 'main.cjs');
  await build({
    stdin: { contents: `
      import { app } from 'electron';
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import path from 'node:path';
      import { initializeCapabilityPluginStore, listInstalledPluginsV2, readPluginStateV2, removePluginV2, rollbackPluginV2 } from './electron/capabilities/pluginStoreV2';
      import { rebuildCapabilityRegistry, capabilityIsAvailable } from './electron/capabilities/registry';
      import { runCapabilityMigration, readMigrationJournal, detectMigrationTargets, pendingMigrations, MIGRATION_MAP } from './electron/capabilities/migration';
      import { runPluginDataMigrations } from './electron/capabilities/dataMigrations';
      import { stopCapabilityWorkers } from './electron/capabilities/workerHost';

      const payload = JSON.parse(fs.readFileSync(${JSON.stringify(payload)}, 'utf8'));
      const profiles = ${JSON.stringify(path.join(temporary, 'profiles'))};
      // The application looks for its bundled packages beside its own app path.
      app.setPath('userData', path.join(profiles, 'initial'));
      app.on('window-all-closed', () => {});

      let failed = false;
      const check = async (name, body) => {
        try { await body(); console.log('  ok  ' + name); }
        catch (error) { failed = true; console.error('  FAIL ' + name + '\\n      ' + (error && error.stack || error)); }
      };

      // ---------------------------------------------------------------- fixtures

      const BUILTINS = {
        chemistry: { id: 'builtin-chemistry', name: 'Chemistry Studio', capability: 'nodus:chemistry', plugin: 'chemistry-studio' },
        legal: { id: 'builtin-legal', name: 'Legalize', capability: 'nodus:legal', plugin: 'legalize' },
        genomics: { id: 'builtin-genomics', name: 'AlphaGenome', capability: 'nodus:genomics', plugin: 'alphagenome' },
      };
      const available = new Set(payload.packages.map(entry => entry.id));

      const builtinSkill = (builtin, enabled) => ({
        id: BUILTINS[builtin].id, name: BUILTINS[builtin].name, builtin,
        description: 'Baseline ' + builtin + ' description.',
        instructions: 'Baseline ' + builtin + ' instructions.',
        capabilities: [BUILTINS[builtin].capability],
        enabled, author: 'nodus', category: 'Research', version: '1.0.0', license: 'AGPL-3.0-only', tools: [],
      });

      /** One profile, one migration, with the library and the legacy files a 5.3.1 install
       *  would have left behind. */
      function profile(name, { enabled = [], preLibraryProfile = false, bootstrap = payload.bootstrapRoot, online } = {}) {
        const dir = path.join(profiles, name);
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        app.setPath('userData', dir);
        initializeCapabilityPluginStore();
        // Each scenario starts from its own profile's truth, not from the table the
        // previous one left behind.
        rebuildCapabilityRegistry();

        let library = [
          ...Object.keys(BUILTINS).map(builtin => builtinSkill(builtin, {
            assistant: enabled.includes(builtin), nodi: false,
          })),
          { id: 'builtin-svg', name: 'SVG Studio', builtin: 'svg', description: 'Draw.', instructions: 'Draw.', capabilities: ['nodus:svg'], enabled: { assistant: true, nodi: true }, author: 'nodus', category: 'Research', version: '1.0.0', license: 'AGPL-3.0-only', tools: [] },
        ];

        // What the built-ins left in the profile for their packages to adopt.
        fs.writeFileSync(path.join(dir, 'chemistry-outcomes.jsonl'), JSON.stringify({ at: '2026-09-01T00:00:00.000Z', reason: 'not-drawn', question: 'Draw ferrocene.' }) + '\\n');
        fs.mkdirSync(path.join(dir, 'legalize-indexes'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'legalize-indexes', 'es.json'), JSON.stringify({ revision: 'a'.repeat(40), entries: [{ identifier: 'BOE-A-1978-31229', title: 'Constitución Española', path: 'es/BOE-A-1978-31229.md' }] }));

        const context = {
          readSkills: () => library,
          writeSkills: next => { library = next; },
          baseline: builtin => ({ name: BUILTINS[builtin].name, description: 'Baseline ' + builtin + ' description.', instructions: 'Baseline ' + builtin + ' instructions.' }),
          packaged: pluginId => {
            const state = readPluginStateV2(pluginId);
            if (!state?.active) return undefined;
            const root = path.join(dir, 'plugins', 'installed', pluginId, 'versions', state.active.version + '-' + state.active.digest);
            const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
            const skill = JSON.parse(fs.readFileSync(path.join(root, manifest.skills[0]), 'utf8'));
            return {
              id: pluginId, name: skill.name, description: skill.description, version: skill.version,
              instructions: fs.readFileSync(path.join(root, path.dirname(manifest.skills[0]), 'SKILL.md'), 'utf8'),
              digest: state.active.digest,
            };
          },
          legacyData: pluginId => {
            if (pluginId === 'chemistry-studio') {
              return { chemistryOutcomes: fs.readFileSync(path.join(dir, 'chemistry-outcomes.jsonl'), 'utf8').split('\\n').filter(Boolean).map(line => JSON.parse(line)) };
            }
            if (pluginId === 'legalize') {
              return { legalizeIndexes: fs.readdirSync(path.join(dir, 'legalize-indexes')).map(file => ({ country: file.slice(0, -5), index: JSON.parse(fs.readFileSync(path.join(dir, 'legalize-indexes', file), 'utf8')) })) };
            }
            if (pluginId === 'alphagenome') return { genomics: { apiKey: 'A'.repeat(32), termsVersion: '2026-09-08' } };
            return {};
          },
          migrateData: (pluginId, legacy) => runPluginDataMigrations(pluginId, legacy),
          preLibraryProfile,
          installer: online ? { online } : {},
        };
        return { dir, context, library: () => library, bootstrap };
      }

      // The bootstrap directory the migration reads is the application's own build tree.
      const appPath = app.getAppPath();
      const useBootstrap = source => {
        const target = path.join(appPath, 'build', 'capability-bootstrap');
        fs.rmSync(target, { recursive: true, force: true });
        fs.mkdirSync(target, { recursive: true });
        if (source) fs.cpSync(source, target, { recursive: true });
      };

      app.whenReady().then(async () => {
        console.log('\\n— a clean 5.3.2 install');
        await check('nothing is installed and nothing is migrated', async () => {
          const fixture = profile('clean');
          useBootstrap(payload.bootstrapRoot);
          const outcome = await runCapabilityMigration(fixture.context);
          assert.deepEqual(outcome.installed, []);
          assert.deepEqual(outcome.failed, []);
          assert.deepEqual(listInstalledPluginsV2(), []);
          assert.equal(readMigrationJournal(), null, 'a clean install writes no journal at all');
        });

        await check('SVG stays in the core and keeps working', async () => {
          rebuildCapabilityRegistry();
          assert.equal(capabilityIsAvailable('nodus:svg'), true);
          assert.equal(capabilityIsAvailable('nodus:image'), true);
          assert.equal(capabilityIsAvailable('nodus:chemistry'), false);
        });

        console.log('\\n— one discipline at a time, offline, from the bundled packages');
        for (const [builtin, entry] of Object.entries(BUILTINS)) {
          if (!available.has(entry.plugin)) continue;
          await check(builtin + ' alone: its package is installed, migrated, registered and adopted', async () => {
            const fixture = profile('only-' + builtin, { enabled: [builtin] });
            useBootstrap(payload.bootstrapRoot);
            const outcome = await runCapabilityMigration(fixture.context);

            assert.deepEqual(outcome.failed, [], 'the migration reported a failure');
            assert.deepEqual(outcome.installed, [entry.plugin], 'exactly the package this profile needed');
            assert.deepEqual(listInstalledPluginsV2().map(state => state.id), [entry.plugin], 'and nothing else was installed');

            const state = readPluginStateV2(entry.plugin);
            assert.equal(state.status, 'ready');
            assert.ok(state.dataVersion > 0, 'the declared migrations ran');

            const registry = rebuildCapabilityRegistry();
            assert.deepEqual(registry.problems, []);
            assert.equal(capabilityIsAvailable(entry.capability), true, 'the capability is available once everything is in place');

            // The skill keeps its identity, its position and its activation, and now comes
            // from the package.
            const adopted = fixture.library().find(skill => skill.id === entry.id);
            assert.ok(adopted, 'the skill the user had is still there, with the same id');
            assert.equal(adopted.enabled.assistant, true, 'and the activation the user chose');
            assert.equal(adopted.plugin?.id, entry.plugin, 'and is now provided by the package');
            assert.equal(adopted.builtin, undefined, 'and is no longer a built-in');

            const journal = readMigrationJournal();
            assert.equal(journal.entries.find(record => record.pluginId === entry.plugin).phase, 'complete');
            assert.deepEqual(pendingMigrations(), []);
          });
        }

        await check('all three at once', async () => {
          const fixture = profile('all-three', { enabled: Object.keys(BUILTINS) });
          useBootstrap(payload.bootstrapRoot);
          const outcome = await runCapabilityMigration(fixture.context);
          assert.deepEqual(outcome.failed, []);
          assert.deepEqual(outcome.installed.sort(), [...available].sort());
          const registry = rebuildCapabilityRegistry();
          assert.deepEqual(registry.problems, []);
          for (const entry of Object.values(BUILTINS)) {
            if (!available.has(entry.plugin)) continue;
            assert.equal(capabilityIsAvailable(entry.capability), true, entry.capability + ' is not available');
          }
        });

        await check('a profile from before the library had chemistry on, and keeps it', async () => {
          if (!available.has('chemistry-studio')) return;
          const fixture = profile('pre-library', { enabled: [], preLibraryProfile: true });
          useBootstrap(payload.bootstrapRoot);
          const outcome = await runCapabilityMigration(fixture.context);
          assert.deepEqual(outcome.installed, ['chemistry-studio']);
          assert.equal(readMigrationJournal().entries[0].reason, 'implicit-legacy-chemistry');
        });

        console.log('\\n— what the packages adopted');
        await check('the legacy files the built-ins left are adopted by their packages', async () => {
          const fixture = profile('adoption', { enabled: ['legal'] });
          useBootstrap(payload.bootstrapRoot);
          if (!available.has('legalize')) return;
          await runCapabilityMigration(fixture.context);
          // Legalize keeps its country index in the package cache tree.
          const cache = path.join(fixture.dir, 'plugins', 'cache', 'legalize');
          assert.ok(fs.existsSync(cache), 'the package has a cache directory');
          const files = fs.readdirSync(cache);
          assert.ok(files.length, 'the cached index the built-in downloaded was adopted rather than re-downloaded');
        });

        console.log('\\n— when it cannot finish');
        for (const [kind, expected] of Object.entries({ 'wrong-key': /signature|verif|key/i, tampered: /digest|size/i, corrupt: /size|digest|archive|zip|end of central directory|Invalid/i })) {
          await check('a ' + kind + ' package is refused, and the skill is left as it was', async () => {
            const fixture = profile('broken-' + kind, { enabled: ['legal'] });
            if (!available.has('legalize')) return;
            useBootstrap(path.join(payload.brokenRoot, kind));
            const outcome = await runCapabilityMigration(fixture.context);

            assert.equal(outcome.installed.length, 0, 'nothing was installed');
            assert.equal(outcome.failed.length, 1, 'the failure is reported');
            assert.match(outcome.failed[0].detail, expected);
            assert.equal(readPluginStateV2('legalize'), null, 'and nothing was left half-installed');

            // The skill the user had is untouched: a migration that cannot finish must
            // never look like a deactivation.
            const skill = fixture.library().find(entry => entry.id === 'builtin-legal');
            assert.equal(skill.enabled.assistant, true, 'the activation the user chose survived');
            assert.equal(skill.builtin, 'legal', 'and so did the skill itself');

            // There is something to retry, and it says where it stopped.
            const pending = pendingMigrations();
            assert.equal(pending.length, 1);
            assert.ok(pending[0].failure, 'the journal records why');
            assert.ok(pending[0].attempts >= 1);

            // Retrying with a working source finishes the job and keeps the skill.
            useBootstrap(payload.bootstrapRoot);
            const retried = await runCapabilityMigration(fixture.context);
            assert.deepEqual(retried.failed, [], 'the retry failed too');
            assert.deepEqual(retried.installed, ['legalize']);
            assert.deepEqual(pendingMigrations(), [], 'and the journal is settled');
            const after = fixture.library().find(entry => entry.id === 'builtin-legal');
            assert.equal(after.plugin?.id, 'legalize');
            assert.equal(after.enabled.assistant, true);
          });
        }

        await check('with no bundled package and no network, the skill survives and the retry is offered', async () => {
          if (!available.has('legalize')) return;
          const fixture = profile('offline', { enabled: ['legal'] });
          useBootstrap(null);
          const outcome = await runCapabilityMigration(fixture.context);
          assert.equal(outcome.failed.length, 1);
          assert.equal(fixture.library().find(entry => entry.id === 'builtin-legal').enabled.assistant, true);
          assert.ok(pendingMigrations().length, 'something is left to retry');
        });

        await check('an online migration installs from the source when nothing is bundled', async () => {
          if (!available.has('legalize')) return;
          let asked = 0;
          const fixture = profile('online', {
            enabled: ['legal'],
            online: async pluginId => {
              asked += 1;
              // Stands in for the catalogue: the same verified install, from bytes that
              // arrived over the network rather than with the application.
              const { installVerifiedPlugin } = require('./electron/capabilities/pluginStoreV2');
              const dir = path.join(payload.bootstrapRoot, pluginId);
              const asset = fs.readdirSync(dir).find(name => name.endsWith('.nodus-plugin'));
              return installVerifiedPlugin({
                archive: fs.readFileSync(path.join(dir, asset)),
                releaseManifestBytes: fs.readFileSync(path.join(dir, 'release-manifest.json')),
                signature: fs.readFileSync(path.join(dir, 'release-manifest.sig')),
                source: { id: 'nodusresearch/nodus-research-skill-marketplace', path: 'plugins/' + pluginId, commit: 'b'.repeat(40) },
              }, { approvePermissions: true });
            },
          });
          useBootstrap(null);
          const outcome = await runCapabilityMigration(fixture.context);
          assert.deepEqual(outcome.failed, []);
          assert.equal(asked, 1, 'the source was asked exactly once');
          assert.deepEqual(outcome.installed, ['legalize']);
          rebuildCapabilityRegistry();
          assert.equal(capabilityIsAvailable('nodus:legal'), true);
        });

        await check('an interrupted migration resumes instead of starting again', async () => {
          if (!available.has('legalize')) return;
          const fixture = profile('interrupted', { enabled: ['legal'] });
          useBootstrap(payload.bootstrapRoot);

          // Stop it in the middle of the data step, exactly as a crash would.
          const interrupted = { ...fixture.context, migrateData: async () => { throw new Error('the application was closed'); } };
          const first = await runCapabilityMigration(interrupted);
          assert.equal(first.failed[0].phase, 'data-snapshotted', 'it stopped where it was interrupted');
          assert.ok(readPluginStateV2('legalize')?.active, 'the package it had already installed is still installed');
          rebuildCapabilityRegistry();
          assert.equal(capabilityIsAvailable('nodus:legal'), false, 'and is not announced, because its data has not moved');

          const resumed = await runCapabilityMigration(fixture.context);
          assert.deepEqual(resumed.failed, []);
          assert.deepEqual(resumed.installed, [], 'the package was not installed a second time');
          assert.equal(readPluginStateV2('legalize').dataVersion > 0, true, 'the data step finished on the retry');
          rebuildCapabilityRegistry();
          assert.equal(capabilityIsAvailable('nodus:legal'), true);
          assert.deepEqual(pendingMigrations(), []);
        });

        await check('a package with no previous version cannot be rolled back to one', async () => {
          if (!available.has('legalize')) return;
          assert.throws(() => rollbackPluginV2('legalize'), /No previous version/);
        });

        await check('removing a migrated package takes the capability and keeps the work', async () => {
          if (!available.has('legalize')) return;
          const data = path.join(app.getPath('userData'), 'plugins', 'data', 'legalize');
          fs.mkdirSync(data, { recursive: true });
          fs.writeFileSync(path.join(data, 'kept.json'), '{"user":"work"}');
          await stopCapabilityWorkers(() => true);
          removePluginV2('legalize');
          assert.equal(rebuildCapabilityRegistry().providers.has('nodus:legal'), false);
          assert.equal(capabilityIsAvailable('nodus:legal'), false);
          assert.equal(fs.existsSync(path.join(data, 'kept.json')), true);
        });

        await stopCapabilityWorkers(() => true);
        if (!failed) fs.writeFileSync(${JSON.stringify(verdict)}, 'pass');
        app.exit(failed ? 1 : 0);
      }).catch(error => {
        console.error('FAILED: ' + (error && error.stack || error));
        app.exit(1);
      });
    `, resolveDir: root, loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'silent',
    plugins: [
      { name: 'test-environment', setup(api) {
        api.onResolve({ filter: /trustedKeys\.json$/ }, () => ({ path: 'keys', namespace: 'test' }));
        api.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: JSON.stringify(trustedKeys), loader: 'json' }));
        api.onResolve({ filter: /^@shared\// }, ({ path: value }) => ({ path: path.join(root, 'shared', `${value.slice(8)}.ts`) }));
      } },
    ],
  });

  // The application's own build tree, so `bootstrapPackages()` finds what a real build
  // would have bundled.
  fs.mkdirSync(path.join(temporary, 'app', 'build'), { recursive: true });
  fs.copyFileSync(outfile, path.join(temporary, 'app', 'main.cjs'));
  // The worker host looks for its bootstrap beside the built main process, which is where
  // a packaged build puts it.
  fs.copyFileSync(bootstrapBundle, path.join(temporary, 'app', 'capabilityWorkerBootstrap.js'));
  fs.writeFileSync(path.join(temporary, 'app', 'package.json'), JSON.stringify({ name: 'nodus-migration-e2e', main: 'main.cjs' }));

  const electron = createRequire(import.meta.url)('electron');
  const { stdout } = await promisify(execFile)(electron, [path.join(temporary, 'app')], {
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
    maxBuffer: 16 * 1024 * 1024,
  });
  console.log(stdout);
  if (fs.readFileSync(verdict, 'utf8') !== 'pass') throw new Error('The migration verification did not report a pass.');
  console.log('CAPABILITY MIGRATION PASS: clean install, each discipline alone, all three, pre-library profile, adoption of legacy data, refusal of a wrong key, a tampered archive and a corrupt package, offline and online sources, interruption and retry, rollback and removal.');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
