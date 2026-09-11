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
const marketplace = process.env.NODUS_MARKETPLACE_DIR
  ?? path.resolve(root, '../../../nodus-research-skill-marketplace');
const packageId = process.argv[2] ?? 'legalize';

if (!fs.existsSync(path.join(marketplace, '.git'))) {
  console.log(`SKIP: no marketplace checkout at ${marketplace}. Set NODUS_MARKETPLACE_DIR to run this.`);
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

  const bootstrap = path.join(temporary, 'bootstrap.cjs');
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
      import { initializeCapabilityPluginStore, installVerifiedPlugin, resolveTrustedCapability, listInstalledPluginsV2, removePluginV2 } from './electron/capabilities/pluginStoreV2';
      import { rebuildCapabilityRegistry, capabilityRegistry, capabilityIsAvailable } from './electron/capabilities/registry';
      import { CapabilityWorkerHandle } from './electron/capabilities/workerHost';
      import { createCapabilityHostServices } from './electron/capabilities/hostServices';

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

        stage = 'worker';
        const runtime = resolveTrustedCapability(provider.id);
        assert.ok(runtime, 'the worker entry resolves inside the installed version');
        assert.ok(fs.existsSync(runtime.entryPath), 'the bundled worker is on disk');
        const handle = new CapabilityWorkerHandle(runtime, {
          services: createCapabilityHostServices({}),
          bootstrapPath: ${JSON.stringify(bootstrap)},
        });
        const health = await handle.call('health', { nodusVersion: '5.3.2', locale: 'en', platform: process.platform, arch: process.arch, dataVersion: 0 }, { timeoutMs: 30_000 });
        assert.equal(health.status, 'ready', 'the package reports itself ready');
        assert.ok(Number.isInteger(health.dataVersion));

        stage = 'chat hook';
        if (provider.chat.hooks.prepare) {
          // A fabricated citation must be refused by the package, not retrieved.
          const invented = await handle.call('prepareChat', {
            locale: 'en',
            question: 'Tell me about contract law.',
            nodes: [{ id: 'n0', kind: 'fence', fence: provider.chat.requestProtocols[0].fence, content: JSON.stringify({ version: 1, country: 'es', query: 'Ley Inventada 99/2099' }), complete: true }],
          }, { timeoutMs: 30_000 });
          assert.ok(invented.some(mutation => mutation.op === 'remove'), 'an ungrounded request is dropped');
          assert.ok(!invented.some(mutation => mutation.op === 'promote-request'), 'and never promoted to a real call');
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
    plugins: [
      { name: 'trusted-keys', setup(api) {
        api.onResolve({ filter: /trustedKeys\.json$/ }, () => ({ path: 'keys', namespace: 'test' }));
        api.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: JSON.stringify(trustedKeys), loader: 'json' }));
        api.onResolve({ filter: /^@shared\// }, ({ path: value }) => ({ path: path.join(root, 'shared', `${value.slice(8)}.ts`) }));
      } },
    ],
  });

  const electron = createRequire(import.meta.url)('electron');
  await promisify(execFile)(electron, [outfile], { env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
  if (fs.readFileSync(verdict, 'utf8') !== 'pass') throw new Error('The package verification did not report a pass.');
  console.log(`CAPABILITY PACKAGE PASS (${asset}): signature, archive, manifests, registry, worker handshake, chat hook, permission gating and uninstall.`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
