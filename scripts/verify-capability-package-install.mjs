// End-to-end verification of capability API v2 against a real package.
//
// Takes a built `.nodus-plugin` from the marketplace checkout, signs it with a throwaway
// key, installs it through the real store, registers it, and runs its worker in a real
// utility process. This is the one check that exercises the whole chain — signature,
// archive, manifests, registry, worker host, permissions, artifacts — rather than any
// single link of it.
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
// Named, or not at all. Walking up to a sibling directory found a marketplace on exactly
// one machine and quietly skipped everywhere else, which is the shape of a check that
// reports a pass it never made.
const marketplace = process.env.NODUS_MARKETPLACE_DIR;
const packageId = process.argv[2] ?? 'legalize';

if (!marketplace || !fs.existsSync(path.join(marketplace, 'plugins'))) {
  // Silent only where there is genuinely nothing to check against: a developer machine
  // with no second checkout. In CI the checkout is part of the job, so its absence is a
  // failure rather than a skip.
  const message = 'set NODUS_MARKETPLACE_DIR to a marketplace checkout to run this';
  if (process.env.CI) throw new Error(`Cannot verify a capability package: ${message}.`);
  console.log(`SKIP: ${message}. The cross-repository job is what runs it in CI.`);
  process.exit(0);
}

const buildDir = path.join(marketplace, 'build');
const asset = fs.existsSync(buildDir)
  ? fs.readdirSync(buildDir).find(name => name.startsWith(`${packageId}-`) && name.endsWith('.nodus-plugin'))
  : undefined;
if (!asset) {
  console.log(`SKIP: ${packageId} is not built. Run "node scripts/build-plugins.mjs ${packageId}" in the marketplace checkout.`);
  process.exit(0);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-capability-package-'));
try {
  const archive = fs.readFileSync(path.join(buildDir, asset));
  const target = /-(any|darwin-x64|darwin-arm64|win32-x64|win32-arm64|linux-x64|linux-arm64)\.nodus-plugin$/.exec(asset)[1];
  const inner = JSON.parse(fs.readFileSync(path.join(marketplace, 'plugins', packageId, 'plugin.json'), 'utf8'));

  // A throwaway key stands in for the release key, which lives in a protected environment
  // and is never present on a development machine.
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const release = {
    schemaVersion: 1,
    plugin: inner.id,
    version: inner.version,
    publisher: { id: 'NodusResearch', keyId: inner.publisher.keyId },
    createdAt: new Date().toISOString(),
    targets: [{ target, asset, bytes: archive.byteLength, sha256: createHash('sha256').update(archive).digest('hex') }],
  };
  const releaseManifestBytes = Buffer.from(JSON.stringify(release, null, 2));
  const signature = signBytes(null, releaseManifestBytes, privateKey);
  const trustedKeys = { keys: [{ keyId: inner.publisher.keyId, publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() }] };

  const payload = path.join(temporary, 'payload.json');
  fs.writeFileSync(payload, JSON.stringify({
    archive: archive.toString('base64'),
    releaseManifestBytes: releaseManifestBytes.toString('base64'),
    signature: signature.toString('base64'),
    packageId: inner.id,
  }));

  const bootstrap = path.join(temporary, 'capabilityWorkerBootstrap.js');
  await build({
    entryPoints: [path.join(root, 'electron/capabilities/workerBootstrap.ts')],
    outfile: bootstrap, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'silent',
  });

  const verdict = path.join(temporary, 'verdict.txt');
  const outfile = path.join(temporary, 'main.cjs');
  await build({
    stdin: { contents: `
      import { app } from 'electron';
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import path from 'node:path';
      import { activePluginRoot, initializeCapabilityPluginStore, installVerifiedPlugin, pluginMigrationScripts, recordPluginDataVersion, resolveTrustedCapability, listInstalledPluginsV2, readPluginStateV2, removePluginV2 } from './electron/capabilities/pluginStoreV2';
      import { rebuildCapabilityRegistry, capabilityRegistry, capabilityIsAvailable, pinCapabilitiesForTurn } from './electron/capabilities/registry';
      import { CapabilityWorkerHandle } from './electron/capabilities/workerHost';
      import { createCapabilityHostServices } from './electron/capabilities/hostServices';
      import { createCapabilityAdapters, createTrustedCapabilityRunner } from './electron/capabilities/runner';
      import { runTrustedChatPipeline } from './electron/capabilities/chatPipeline';
      import { chatAssetOwner } from './electron/chatAssets';
      import { materializeTrustedPluginSkills } from './electron/capabilities/skillLibrary';
      import { listChatSkills, saveChatSkill, enabledChatSkills, restorePluginSkillAuthorVersion, deriveCapabilityTools } from './electron/chatSkills';

      app.setPath('userData', ${JSON.stringify(temporary)});
      app.on('window-all-closed', () => {});

      const payload = JSON.parse(fs.readFileSync(${JSON.stringify(payload)}, 'utf8'));
      let stage = 'start';
      app.whenReady().then(async () => { try {
        stage = 'install';
        initializeCapabilityPluginStore();
        const outcome = installVerifiedPlugin({
          archive: Buffer.from(payload.archive, 'base64'),
          releaseManifestBytes: Buffer.from(payload.releaseManifestBytes, 'base64'),
          signature: Buffer.from(payload.signature, 'base64'),
          source: { id: 'nodusresearch/nodus-research-skill-marketplace', path: 'plugins/' + payload.packageId, commit: 'a'.repeat(40) },
        }, { approvePermissions: true });
        assert.equal(outcome.activated, true, 'the signed package installed');
        assert.equal(outcome.state.trust.verified, true);

        stage = 'migration before announcement';
        // A package is not announced until the migrations it declares have run. Installing
        // and expecting a capability immediately is exactly the race this refuses — and the
        // migration itself is the package's own scripts, run in its own worker.
        const declared = pluginMigrationScripts(payload.packageId);
        if (declared.length) {
          const waiting = rebuildCapabilityRegistry();
          assert.equal([...waiting.providers.values()].some(entry => entry.plugin?.id === payload.packageId), false, 'announced before its data was migrated');
          assert.ok(waiting.problems.some(problem => problem.pluginId === payload.packageId), 'and says why');

          // Resolved from what was just installed rather than from the registry, which is
          // precisely what has not happened yet.
          const migrating = new CapabilityWorkerHandle(
            resolveTrustedCapability(outcome.package.capabilities[0].manifest.provides),
            { services: createCapabilityHostServices({}), bootstrapPath: ${JSON.stringify(bootstrap)} },
          );
          const climbed = await migrating.call('migrate', {
            fromDataVersion: 0, toDataVersion: declared.length, legacy: {}, scripts: declared,
          }, { timeoutMs: 120_000 });
          await migrating.stop();
          assert.equal(climbed.failed, undefined, 'a declared migration failed: ' + climbed.failed);
          assert.equal(climbed.dataVersion, declared.length, 'the ladder did not reach the top');
          recordPluginDataVersion(payload.packageId, climbed.dataVersion);
          assert.equal(readPluginStateV2(payload.packageId).dataVersion, declared.length, 'the version reached is recorded');
        }

        stage = 'registry';
        const registry = rebuildCapabilityRegistry();
        assert.deepEqual(registry.problems, [], 'the package registered without problems');
        const provider = [...registry.providers.values()].find(entry => entry.plugin?.id === payload.packageId);
        assert.ok(provider, 'its capability is registered');
        assert.equal(capabilityIsAvailable(provider.id), true);
        assert.ok(provider.chat, 'it declares a chat contract');
        for (const protocol of provider.chat.requestProtocols) {
          assert.equal(registry.fences.get(protocol.fence).provider.id, provider.id, protocol.fence + ' is claimed by its own provider');
        }

        stage = 'trusted chat protocol';
        const packagedSkills = materializeTrustedPluginSkills(payload.packageId).filter(skill => skill.plugin?.id === payload.packageId);
        assert.ok(packagedSkills.length > 0, 'the package installs at least one workflow');
        for (const skill of packagedSkills) {
          const advertised = deriveCapabilityTools(skill) ?? [];
          assert.ok(advertised.length > 0, 'a trusted v2 workflow advertises the tools its package declares');
          for (const tool of advertised) {
            // Each skill may reach a different capability of the same package, so the
            // protocol a tool travels under is the one its own provider declared.
            const owner = registry.providers.get(tool.capabilityId);
            assert.ok(owner, 'the advertised tool names a registered capability: ' + tool.capabilityId);
            assert.ok(owner.chat.requestProtocols.some(protocol => protocol.fence === tool.fence && protocol.toolId === tool.toolId), tool.toolId + ' travels under the fence ' + owner.id + ' declared');
            assert.ok(tool.inputSchema, 'carrying the published schema, so an input is built instead of guessed');
          }
        }

        stage = 'worker';
        const runtime = resolveTrustedCapability(provider.id);
        assert.ok(runtime, 'the worker entry resolves inside the installed version');
        assert.ok(fs.existsSync(runtime.entryPath), 'the bundled worker is on disk');
        // The adapters a capability has in the application: the subworker lane a validator
        // runs in, the SVG services, the Python runtime. Without them a live request fails
        // for a reason that says nothing about the package.
        const adapters = createCapabilityAdapters({
          locale: 'en',
          pins: { revision: 0, pins: new Map() },
          runCoreStages: async answer => answer,
        });
        const handle = new CapabilityWorkerHandle(runtime, {
          services: createCapabilityHostServices(adapters),
          bootstrapPath: ${JSON.stringify(bootstrap)},
        });
        const health = await handle.call('health', { nodusVersion: '5.4.0', locale: 'en', platform: process.platform, arch: process.arch, dataVersion: 0 }, { timeoutMs: 30_000 });
        // A package that needs a key or a runtime is entitled to say so on a clean
        // profile; what must not happen is an unrecognised status or a silent default.
        assert.ok(['ready', 'degraded', 'needs-setup', 'needs-migration'].includes(health.status), 'the package reports a known status, got ' + health.status);
        if (!provider.hasSettings) assert.equal(health.status, 'ready', 'a package with nothing to configure is ready on a clean profile');
        assert.ok(Number.isInteger(health.dataVersion));

        stage = 'chat hook';
        if (provider.chat.hooks.prepare) {
          // What a package decides about a given request is its own business — each one's
          // tests cover that. What has to hold for every package is that the hook answers
          // with well-formed mutations, names only its own nodes and its own tools, and
          // never invents either.
          const nodes = [
            { id: 'n0', kind: 'prose', content: 'A question the package did not ask for.', complete: true },
            { id: 'n1', kind: 'fence', fence: provider.chat.requestProtocols[0].fence, content: '{"version":1}', complete: true },
          ];
          const mutations = await handle.call('prepareChat', { locale: 'en', question: 'A question the package did not ask for.', nodes }, { timeoutMs: 30_000 });
          assert.ok(Array.isArray(mutations), 'prepareChat returns a list of mutations');
          const ids = new Set(nodes.map(node => node.id));
          const tools = new Set(provider.tools.map(tool => tool.id));
          for (const mutation of mutations) {
            assert.ok(['remove', 'promote-request', 'notice', 'claim'].includes(mutation.op), 'unknown mutation: ' + mutation.op);
            if (mutation.nodeId) assert.ok(ids.has(mutation.nodeId), 'the hook addressed a node it was not given: ' + mutation.nodeId);
            if (mutation.op === 'promote-request') assert.ok(tools.has(mutation.toolId), 'the hook named an undeclared tool: ' + mutation.toolId);
          }
        }

        // A real request, against the real services the package declares — off by default,
        // because a check that depends on somebody else's uptime fails for reasons that
        // have nothing to do with this repository. Run with NODUS_LIVE_CAPABILITY=1.
        if (process.env.NODUS_LIVE_CAPABILITY === '1' && provider.chat.requestProtocols.length) {
          stage = 'a real request';
          const live = {
            'chemistry-studio': { toolId: 'compile', input: { plan: JSON.stringify({ version: 2, kind: 'structure', depiction: 'skeletal', species: [{ id: 's1', input: { kind: 'name', value: 'ethanol' } }] }), question: 'Draw ethanol.' } },
            legalize: { toolId: 'retrieve', input: { version: 1, country: 'es', query: 'BOE-A-1978-31229' } },
          }[payload.packageId];
          if (live) {
            const produced = await handle.call('invoke', { invocationId: 'live', locale: 'en', ...live }, { timeoutMs: 300_000 });
            const artifact = produced.artifacts?.[0];
            assert.ok(artifact, 'the package produced nothing: ' + JSON.stringify(produced.notices ?? produced.view ?? {}).slice(0, 400));
            assert.ok(provider.artifacts.some(entry => entry.type === artifact.artifactType), 'it produced an artifact type it never declared');
            assert.ok(artifact.summary.length > 0);
            console.log('  live request produced: ' + artifact.summary.slice(0, 120));
          }
        }

        if (payload.packageId === 'research-visuals') {
          stage = 'all bundled workflows appear in the Skill library';
          const bundled = materializeTrustedPluginSkills(payload.packageId).filter(skill => skill.plugin?.id === payload.packageId);
          assert.equal(bundled.length, 3, 'all three workflows are installed');
          assert.deepEqual(bundled.map(skill => skill.origin.packageId).sort(), ['general-maps','historical-maps','research-images']);
          assert.ok(bundled.every(skill => !skill.enabled.assistant && !skill.enabled.nodi), 'new workflows start independently disabled');
          assert.ok(bundled.every(skill => skill.capabilities.every(id => id.startsWith('research-visuals:'))), 'self references resolve to the actual provider');
          const chosen = bundled[0];
          saveChatSkill({...chosen, instructions: chosen.instructions + ' Custom local instruction.', enabled: {assistant: true,nodi: false}});
          materializeTrustedPluginSkills(payload.packageId);
          const again = listChatSkills().filter(skill => skill.plugin?.id === payload.packageId);
          assert.equal(again.length,3,'reinstall does not duplicate workflows');
          assert.equal(again.find(skill=>skill.id===chosen.id).enabled.assistant,true);
          assert.ok(again.find(skill=>skill.id===chosen.id).instructions.endsWith('Custom local instruction.'),'local edits survive');
          assert.ok(enabledChatSkills('assistant').some(skill=>skill.id===chosen.id),'the enabled workflow reaches the chat prompt');
          assert.ok(!enabledChatSkills('nodi').some(skill=>skill.id===chosen.id),'Nodi activation is independent');
          const workflowPath = path.join(activePluginRoot(payload.packageId), 'skills/research-images/skill.json');
          const originalWorkflow = fs.readFileSync(workflowPath, 'utf8');
          const beforeInvalid = JSON.stringify(listChatSkills());
          try {
            fs.writeFileSync(workflowPath, JSON.stringify({...JSON.parse(originalWorkflow), version: '99.0.0'}));
            assert.throws(() => materializeTrustedPluginSkills(payload.packageId), /identity.version/);
            assert.equal(JSON.stringify(listChatSkills()), beforeInvalid, 'invalid final workflow cannot partially rewrite the library');
          } finally { fs.writeFileSync(workflowPath, originalWorkflow); }
          const restored = restorePluginSkillAuthorVersion(chosen.id).find(skill => skill.id === chosen.id);
          assert.equal(restored.instructions, chosen.instructions, 'the author restore action reads signed v2 content');
          assert.equal(restored.enabled.assistant, true, 'restoring text preserves activation');
          stage = 'all Research Visuals tools through saved chat pipelines';
          const imageRuntime = resolveTrustedCapability('research-visuals:images');
          const imageHandle = new CapabilityWorkerHandle(imageRuntime, { services: createCapabilityHostServices({}), bootstrapPath: ${JSON.stringify(bootstrap)} });
          const settings = await imageHandle.call('getSettings', {});
          assert.equal(settings.fields.wikimedia.value, true);
          await imageHandle.call('applySettings', { fields: { wikimedia: false, met: false, aic: false } });
          await imageHandle.stop();
          const source = { label: 'Synthetic route fixture', attribution: 'Synthetic fixture, not historical evidence', license: 'CC0', url: 'https://example.org/fixture', period: { from: '1850-01-01', to: '1850-12-31' } };
          const map = { title: 'Synthetic route', alt: 'Two synthetic points linked by an arrow', markers: [{ coordinates: [0,0], label: 'A' }, { coordinates: [1,1], label: 'B' }], routes: [{ coordinates: [[0,0],[1,1]], arrow: true }], overlaySource: source };
          // The same route with no dataset behind it: the request that used to be refused
          // outright. It renders, and the map itself says what it is.
          const reconstructed = { ...map, overlaySource: { label: 'Reconstruction from general knowledge', attribution: 'Synthetic fixture, not historical evidence', license: 'CC0' } };
          const requests = [
            ['research-map-request', map, null],
            ['historical-map-request', { ...map, period: source.period }, null],
            ['historical-map-request', { ...reconstructed, period: { from: '1940-01-01', to: '1940-12-31' } }, /Approximate historical reconstruction/],
            ['research-image-request', { query: 'synthetic plate' }, null],
          ];
          const fence = (tag, input) => String.fromCharCode(96).repeat(3) + tag + String.fromCharCode(10) + JSON.stringify(input) + String.fromCharCode(10) + String.fromCharCode(96).repeat(3);
          for (const surface of ['assistant','nodi','deep-research','immersion']) {
            const runner = createTrustedCapabilityRunner({ owner: chatAssetOwner(surface, 'research-visuals-fixture'), question: 'Draw a synthetic research route and find a plate image.', locale: 'en', pins: pinCapabilitiesForTurn(), runCoreStages: async answer => answer });
            try {
              for (const [tag, input, labels] of requests) {
                const answer = await runTrustedChatPipeline(fence(tag, input), registry, runner, {onProblem: (_provider,error)=>{throw error;}});
                assert.match(answer, /nodus-artifact/, surface + ' ' + tag);
                assert.match(answer, /nodus-view/, surface + ' ' + tag + ' renders its result');
                if (labels) assert.match(answer, labels, surface + ' ' + tag + ' labels what it is');
              }
            } finally { await runner.dispose(); }
          }
          // A near-miss input is refused by name, not by "invalid request": the model that sent
          // an extra top-level field reads which field, and which ones the tool does take.
          const runner = createTrustedCapabilityRunner({ owner: chatAssetOwner('assistant', 'research-visuals-fixture'), question: 'Draw a 1940 route.', locale: 'en', pins: pinCapabilitiesForTurn(), runCoreStages: async answer => answer });
          try {
            const refused = await runTrustedChatPipeline(fence('historical-map-request', { ...reconstructed, period: source.period, timeframe: '1940' }), registry, runner);
            assert.match(refused, /historical-map-request was not run|was not run/, 'the refusal is reported as text');
            assert.match(refused, /unknown property "timeframe"/, 'and names the property it refused');
            assert.match(refused, /allowed: title, alt/, 'and lists what the tool does take');
          } finally { await runner.dispose(); }
          // The period's own boundaries, asked for the way a chat asks for them: an
          // openhistoricalmap query with a level and the period, retrieved inside the frame.
          // Off by default because it reaches a public endpoint, on with NODUS_LIVE_HISTORICAL=1.
          if (process.env.NODUS_LIVE_HISTORICAL === '1') {
            stage = 'a dated historical map through every chat surface';
            const dated = { title: 'Regiones históricas de España en 1940', alt: 'Dated historic regions of Spain in 1940, from OpenHistoricalMap.', period: { from: '1940-01-01', to: '1940-12-31' },
              projection: 'mercator', bounds: [-10, 35.5, 4.5, 44], width: 1200, height: 900,
              layers: [{ query: { provider: 'openhistoricalmap', level: 4, period: { from: '1940-01-01', to: '1940-12-31' } }, fill: '#dcd3bd', labelProperty: 'name' }],
              legend: [{ label: 'Región histórica (1833-1982)', color: '#dcd3bd' }] };
            for (const surface of ['assistant','nodi','deep-research','immersion']) {
              const runner = createTrustedCapabilityRunner({ owner: chatAssetOwner(surface, 'research-visuals-dated'), question: 'Mapa de las regiones históricas de España en 1940.', locale: 'es', pins: pinCapabilitiesForTurn(), runCoreStages: async answer => answer });
              try {
                // The public endpoint rate-limits bursts; wait it out rather than reporting the
                // endpoint's load as a defect in this build.
                let answer = '';
                for (let attempt = 1; ; attempt++) {
                  try {
                    answer = await runTrustedChatPipeline(fence('historical-map-request', dated), registry, runner, {onProblem: (_provider,error)=>{throw error;}});
                    break;
                  } catch (error) {
                    if (attempt >= 4 || !/busy or rate-limiting/.test(String(error.message))) throw error;
                    await new Promise(resolve => setTimeout(resolve, 20_000 * attempt));
                  }
                }
                assert.match(answer, /nodus-artifact/, surface + ' produced a map artifact');
                assert.match(answer, /nodus-view/, surface + ' renders its result');
                assert.match(answer, /Historical source period: 1940-01-01 to 1940-12-31/, surface + ' reports the period it was drawn for');
                assert.doesNotMatch(answer, /Approximate historical reconstruction/, surface + ' does not label dated boundaries as a reconstruction');
              } finally { await runner.dispose(); }
            }
            console.log('  Research Visuals: dated OpenHistoricalMap boundaries retrieved, rendered and labelled through all four chat pipelines.');
          }
          console.log('  Research Visuals: four real worker requests (provider, dated, reconstructed, image), property-named refusals and native SVG/provenance through Assistant, Nodi, Deep Research and Immersion pipelines.');
        }

        stage = 'permission gating';
        // The worker may only reach what its manifest declared; this asks for something else.
        await assert.rejects(
          createCapabilityHostServices({})({ runtime, channel: 'network', method: 'fetch', payload: { endpointId: 'not-declared', path: '/' }, signal: new AbortController().signal }),
          error => { assert.match(error.message, /not permitted/); return true; },
        );

        stage = 'uninstall';
        await handle.stop();
        removePluginV2(payload.packageId);
        assert.equal(listInstalledPluginsV2().length, 0);
        assert.equal(rebuildCapabilityRegistry().providers.has(provider.id), false, 'the capability is gone with its package');

        fs.writeFileSync(${JSON.stringify(verdict)}, 'pass');
        app.exit(0);
      } catch (error) {
        console.error('FAILED at ' + stage + ': ' + (error && error.stack || error));
        app.exit(1);
      } });
    `, resolveDir: root, loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'silent',
    // The application's adapters reach the model client, which carries native bindings
    // this verification never calls. They play no part in what is being checked.
    loader: { '.node': 'empty' },
    plugins: [
      { name: 'trusted-keys', setup(api) {
        api.onResolve({ filter: /trustedKeys\.json$/ }, () => ({ path: 'keys', namespace: 'test' }));
        api.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: JSON.stringify(trustedKeys), loader: 'json' }));
        api.onResolve({ filter: /^@shared\// }, ({ path: value }) => ({ path: path.join(root, 'shared', `${value.slice(8)}.ts`) }));
      } },
    ],
  });

  const electron = createRequire(import.meta.url)('electron');
  const { stdout } = await promisify(execFile)(electron, [outfile], { env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }, maxBuffer: 16 * 1024 * 1024 });
  if (stdout.trim()) console.log(stdout.trim());
  if (fs.readFileSync(verdict, 'utf8') !== 'pass') throw new Error('The package verification did not report a pass.');
  console.log(`CAPABILITY PACKAGE PASS (${asset}): signature, archive, manifests, declared migrations, registry, worker handshake, chat hook, permission gating and uninstall.`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
