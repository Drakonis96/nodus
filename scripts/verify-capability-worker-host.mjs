// Real Electron verification for the trusted capability worker host: a plugin module is
// loaded in its own utility process and exercised through the actual protocol. No
// credentials and no external network.
//
// Electron exits 0 on SIGTERM, so a hang would otherwise read as a pass: the child
// reports through a verdict file, and its absence is the failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-capability-worker-host-'));

/** A GLB container, assembled by hand so the fixture is a real file rather than a
 *  library's idea of one. */
function makeGlb(json) {
  const pad = (bytes, filler) => {
    const remainder = bytes.length % 4;
    if (!remainder) return bytes;
    return Buffer.concat([bytes, Buffer.alloc(4 - remainder, filler)]);
  };
  const jsonChunk = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const binChunk = pad(Buffer.alloc(12), 0);
  const length = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const out = Buffer.alloc(length);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(length, 8);
  out.writeUInt32LE(jsonChunk.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(out, 20);
  const at = 20 + jsonChunk.length;
  out.writeUInt32LE(binChunk.length, at);
  out.writeUInt32LE(0x004e4942, at + 4);
  binChunk.copy(out, at + 8);
  return out;
}

try {
  const verdict = path.join(temporary, 'verdict.txt');
  const bootstrap = path.join(temporary, 'bootstrap.cjs');
  await build({
    entryPoints: [path.join(root, 'electron/capabilities/workerBootstrap.ts')],
    outfile: bootstrap, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'silent',
  });

  // A plausible plugin: it only ever talks to the host through the injected proxy.
  const plugin = path.join(temporary, 'plugin.cjs');
  fs.writeFileSync(plugin, `
    module.exports = host => ({
      async health() { return { status: 'ready', dataVersion: 1 }; },
      async invoke({ toolId, input }) {
        if (toolId === 'echo') return { view: { schemaVersion: 1, summary: 'echo', nodes: [{ kind: 'code', text: JSON.stringify(input) }] } };
        if (toolId === 'store') { await host.storage.state.set('count', input.count); return { view: { schemaVersion: 1, summary: 'stored', nodes: [{ kind: 'code', text: String(await host.storage.state.get('count')) }] } }; }
        if (toolId === 'cache') { await host.storage.cache.set('blob', 'x'.repeat(input.size)); return { view: { schemaVersion: 1, summary: 'cached', nodes: [{ kind: 'code', text: 'ok' }] } }; }
        if (toolId === 'reach') { await host.network.fetch(input.endpointId, { path: input.path, method: input.method }); return { view: { schemaVersion: 1, summary: 'reached', nodes: [{ kind: 'code', text: 'ok' }] } }; }
        if (toolId === 'peek') return { view: { schemaVersion: 1, summary: 'peek', nodes: [{ kind: 'code', text: JSON.stringify({ has: await host.secrets.has('api-key'), keys: Object.keys(host.secrets) }) }] } };
        if (toolId === 'read') return { view: { schemaVersion: 1, summary: 'read', nodes: [{ kind: 'code', text: JSON.stringify(await host.storage.state.get(input.key) ?? null) }] } };
        if (toolId === 'model') {
          const bytes = Uint8Array.from(Buffer.from(input.base64, 'base64'));
          const stored = input.storeIt
            ? await host.models.store({ bytes, mimeType: input.mimeType, name: input.name })
            : { info: await host.models.validate({ bytes, mimeType: input.mimeType }) };
          return { view: { schemaVersion: 1, summary: 'model', nodes: [{ kind: 'code', text: JSON.stringify(stored) }] } };
        }
        if (toolId === 'hang') return new Promise(() => {});
        if (toolId === 'crash') { process.exit(7); }
        if (toolId === 'garbage') { process.parentPort.postMessage({ type: 'not-a-real-frame' }); return { view: { schemaVersion: 1, summary: 'survived', nodes: [{ kind: 'code', text: 'ok' }] } }; }
        throw new Error('Unknown tool: ' + toolId);
      },
      async renderArtifact() { return { schemaVersion: 1, summary: 'rendered', nodes: [{ kind: 'code', text: 'artifact' }] }; },
      async shutdown() {},
    });
  `);

  // Four migration scripts, exactly as a package ships them: plain CommonJS files that
  // get the host and whatever the built-in left behind.
  const migrationOne = path.join(temporary, '001-one.js');
  fs.writeFileSync(migrationOne, `
    module.exports = async ({ host, legacy }) => {
      await host.storage.state.set('one', legacy.carried ?? 'nothing');
      return { notes: 'adopted from 5.3.1' };
    };
  `);
  const migrationTwo = path.join(temporary, '002-two.js');
  fs.writeFileSync(migrationTwo, `
    module.exports = async ({ host, toDataVersion }) => {
      await host.storage.state.set('two', toDataVersion);
    };
  `);
  const migrationBroken = path.join(temporary, '002-broken.js');
  fs.writeFileSync(migrationBroken, `
    module.exports = async () => { throw new Error('deliberately unfinished'); };
  `);
  const migrationCounting = path.join(temporary, '001-counting.js');
  fs.writeFileSync(migrationCounting, `
    module.exports = async ({ host }) => {
      await host.storage.state.set('runs', ((await host.storage.state.get('runs')) ?? 0) + 1);
    };
  `);

  // Two model fixtures: one self-contained GLB, and one glTF that points at a file next
  // to it. The second is the one that must never be stored.
  const glbBase64 = makeGlb({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], buffers: [{ byteLength: 12 }],
  }).toString('base64');
  const externalBase64 = Buffer.from(JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: 12, uri: 'scene.bin' }],
  })).toString('base64');

  const outfile = path.join(temporary, 'main.cjs');
  await build({ stdin: { contents: `
    import { app } from 'electron';
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { CapabilityWorkerHandle } from './electron/capabilities/workerHost';
    import { createCapabilityHostServices, writeCapabilitySecret } from './electron/capabilities/hostServices';

    app.setPath('userData', ${JSON.stringify(temporary)});
    app.on('window-all-closed', () => {});

    const manifest = (permissions = {}) => ({
      schemaVersion: 2, id: 'probe', provides: 'probe-kit:probe', version: '2.0.0', description: 'Probe.',
      runtime: { kind: 'nodus-trusted-worker-v1', protocol: 1, entry: 'worker.js' }, requires: [],
      tools: [], artifacts: [], permissions,
    });
    const runtimeFor = (permissions = {}) => ({
      capabilityId: 'probe-kit:probe',
      plugin: { id: 'probe-kit', version: '2.0.0', digest: 'a'.repeat(64) },
      manifest: manifest(permissions), entryPath: ${JSON.stringify(plugin)}, permissions,
    });
    const handleFor = (permissions = {}, adapters = {}) => new CapabilityWorkerHandle(runtimeFor(permissions), {
      services: createCapabilityHostServices(adapters), bootstrapPath: ${JSON.stringify(bootstrap)},
    });
    const text = result => result.view.nodes[0].text;
    const failure = async promise => { try { await promise; return 'allowed'; } catch (error) { return error.message; } };

    let stage = 'start';
    app.whenReady().then(async () => { try {
      // A plugin ships a module; the bootstrap turns it into a process that speaks the protocol.
      stage = 'handshake and round trip';
      const basic = handleFor();
      assert.deepEqual(await basic.call('health', { nodusVersion: '5.3.2', locale: 'en', platform: process.platform, arch: process.arch, dataVersion: 0 }, { timeoutMs: 10_000 }), { status: 'ready', dataVersion: 1 });
      assert.equal(text(await basic.call('invoke', { invocationId: 'i1', toolId: 'echo', input: { a: 1 }, locale: 'en' }, { timeoutMs: 10_000 })), '{"a":1}');
      assert.equal(basic.alive, true);

      // A method the module never implemented is an error the caller can act on.
      stage = 'unimplemented method';
      assert.match(await failure(basic.call('getSettings', {}, { timeoutMs: 5_000 })), /does not implement getSettings/);

      // A frame the host cannot parse is dropped; the call in flight still completes.
      stage = 'malformed frame';
      assert.equal(text(await basic.call('invoke', { invocationId: 'i2', toolId: 'garbage', input: {}, locale: 'en' }, { timeoutMs: 10_000 })), 'ok');
      await basic.stop();

      // Storage is namespaced, quota'd by the host and refused when undeclared.
      stage = 'storage';
      const stored = handleFor({ storage: { stateBytes: 4096, cacheBytes: 64, tempBytes: 0 } });
      assert.equal(text(await stored.call('invoke', { invocationId: 'i3', toolId: 'store', input: { count: 7 }, locale: 'en' }, { timeoutMs: 10_000 })), '7');
      assert.match(await failure(stored.call('invoke', { invocationId: 'i4', toolId: 'cache', input: { size: 4096 }, locale: 'en' }, { timeoutMs: 10_000 })), /storage quota exceeded/);
      await stored.stop();

      stage = 'storage without permission';
      const unstored = handleFor();
      assert.match(await failure(unstored.call('invoke', { invocationId: 'i5', toolId: 'store', input: { count: 1 }, locale: 'en' }, { timeoutMs: 10_000 })), /storage is not permitted/);
      await unstored.stop();

      // The network allowlist is the manifest's, not the request's.
      stage = 'network allowlist';
      const net = handleFor({ network: [{ id: 'api', origin: 'https://example.com', pathPrefixes: ['/v1/'], methods: ['GET'], maxResponseBytes: 65536, timeoutMs: 5000 }] });
      assert.match(await failure(net.call('invoke', { invocationId: 'i6', toolId: 'reach', input: { endpointId: 'other', path: '/v1/x' }, locale: 'en' }, { timeoutMs: 10_000 })), /endpoint is not permitted/);
      assert.match(await failure(net.call('invoke', { invocationId: 'i7', toolId: 'reach', input: { endpointId: 'api', path: '/admin' }, locale: 'en' }, { timeoutMs: 10_000 })), /exceeds its permission/);
      assert.match(await failure(net.call('invoke', { invocationId: 'i8', toolId: 'reach', input: { endpointId: 'api', path: '/v1/x', method: 'DELETE' }, locale: 'en' }, { timeoutMs: 10_000 })), /method is not permitted/);
      await net.stop();

      stage = 'private hosts stay unreachable';
      const local = handleFor({ network: [{ id: 'local', origin: 'https://localhost', pathPrefixes: ['/'], methods: ['GET'], maxResponseBytes: 65536, timeoutMs: 5000 }] });
      assert.match(await failure(local.call('invoke', { invocationId: 'i9', toolId: 'reach', input: { endpointId: 'local', path: '/' }, locale: 'en' }, { timeoutMs: 10_000 })), /not public/);
      await local.stop();

      // A worker learns that a credential exists. It never gets a way to read one.
      stage = 'secrets are never handed to the worker';
      const secretPermissions = {
        network: [{ id: 'api', origin: 'https://example.com', pathPrefixes: ['/v1/'], methods: ['GET'], maxResponseBytes: 65536, timeoutMs: 5000 }],
        secrets: [{ id: 'api-key', label: 'API key', required: true, injection: { kind: 'header', endpointId: 'api', header: 'Authorization', prefix: 'Bearer ' } }],
      };
      writeCapabilitySecret('probe-kit', 'probe', 'api-key', 'sk-live-not-a-real-key');
      const secret = handleFor(secretPermissions);
      const peeked = JSON.parse(text(await secret.call('invoke', { invocationId: 'i10', toolId: 'peek', input: {}, locale: 'en' }, { timeoutMs: 10_000 })));
      assert.equal(peeked.has, true, 'the worker can ask whether a credential is configured');
      assert.deepEqual(peeked.keys.sort(), ['delete', 'has', 'store'], 'and that is the whole secrets surface it is given');
      await secret.stop();

      // A worker past its deadline is cancelled, then killed; pending calls never dangle.
      stage = 'deadline';
      const slow = handleFor();
      const started = Date.now();
      assert.match(await failure(slow.call('invoke', { invocationId: 'i11', toolId: 'hang', input: {}, locale: 'en' }, { timeoutMs: 1_000 })), /exceeded 1 seconds/);
      assert.ok(Date.now() - started < 10_000, 'the deadline is enforced by the host, not by the worker');
      await new Promise(resolve => setTimeout(resolve, 3_000));
      assert.equal(slow.alive, false, 'a worker that ignores cancel is terminated after the grace period');

      // And the capability is not poisoned by it: the next call gets a fresh process.
      stage = 'restart after termination';
      assert.equal(text(await slow.call('invoke', { invocationId: 'i12', toolId: 'echo', input: { again: true }, locale: 'en' }, { timeoutMs: 10_000 })), '{"again":true}');
      await slow.stop();

      // An explicit cancellation surfaces as an AbortError, not as a generic failure.
      stage = 'cancellation';
      const cancelled = handleFor();
      const controller = new AbortController();
      const pending = cancelled.call('invoke', { invocationId: 'i13', toolId: 'hang', input: {}, locale: 'en' }, { timeoutMs: 30_000, signal: controller.signal });
      setTimeout(() => controller.abort(), 200);
      await assert.rejects(pending, error => error.name === 'AbortError');
      await cancelled.stop();

      // A crashed worker rejects what was in flight rather than leaving it unresolved.
      stage = 'crash';
      const crashing = handleFor();
      assert.match(await failure(crashing.call('invoke', { invocationId: 'i14', toolId: 'crash', input: {}, locale: 'en' }, { timeoutMs: 10_000 })), /exited \\(code 7\\)/);
      assert.equal(crashing.alive, false);
      assert.equal(text(await crashing.call('invoke', { invocationId: 'i15', toolId: 'echo', input: { recovered: true }, locale: 'en' }, { timeoutMs: 10_000 })), '{"recovered":true}');
      await crashing.stop();

      // Migrations are the package's declared scripts, run one rung at a time. This is the
      // claim the whole 5.3.1 -> 5.3.2 move rests on, so it is exercised against the real
      // bootstrap rather than a stub: a package cannot satisfy it by implementing a
      // migrate method that returns the number it was asked for.
      stage = 'migration ladder';
      const migrating = handleFor({ storage: { stateBytes: 4096, cacheBytes: 64, tempBytes: 0 } });
      const ladder = await migrating.call('migrate', {
        fromDataVersion: 0, toDataVersion: 2, legacy: { carried: 'from 5.3.1' },
        scripts: [${JSON.stringify(migrationOne)}, ${JSON.stringify(migrationTwo)}],
      }, { timeoutMs: 20_000 });
      assert.equal(ladder.dataVersion, 2, 'both declared migrations ran');
      assert.match(ladder.notes, /adopted from 5.3.1/, 'a migration receives what the built-in left behind');
      assert.equal(ladder.failed, undefined);
      assert.equal(text(await migrating.call('invoke', { invocationId: 'm1', toolId: 'read', input: { key: 'one' }, locale: 'en' }, { timeoutMs: 10_000 })), '"from 5.3.1"', 'the first rung wrote through the real host');
      assert.equal(text(await migrating.call('invoke', { invocationId: 'm2', toolId: 'read', input: { key: 'two' }, locale: 'en' }, { timeoutMs: 10_000 })), '2', 'and so did the second');

      // Nothing above the rung that failed is claimed, and what already succeeded stands.
      stage = 'migration stops at the rung that failed';
      const partial = await migrating.call('migrate', {
        fromDataVersion: 0, toDataVersion: 2, legacy: {},
        scripts: [${JSON.stringify(migrationOne)}, ${JSON.stringify(migrationBroken)}],
      }, { timeoutMs: 20_000 });
      assert.equal(partial.dataVersion, 1, 'the version reported is the one the data actually reached');
      assert.match(partial.failed, /deliberately unfinished/, 'and the reason travels back to the host');

      // A retry starts at the rung that did not finish; the ones below are not re-run.
      stage = 'migration resumes';
      const resumed = await migrating.call('migrate', {
        fromDataVersion: 1, toDataVersion: 2, legacy: {},
        scripts: [${JSON.stringify(migrationCounting)}, ${JSON.stringify(migrationTwo)}],
      }, { timeoutMs: 20_000 });
      assert.equal(resumed.dataVersion, 2);
      assert.equal(text(await migrating.call('invoke', { invocationId: 'm3', toolId: 'read', input: { key: 'runs' }, locale: 'en' }, { timeoutMs: 10_000 })), 'null', 'a rung already below the current version is never re-run');
      await migrating.stop();

      // nodus:3d — a capability hands over an asset and gets back a reference. The
      // format rule is the core's, and a capability that never declared the permission
      // does not reach it at all.
      stage = '3D models';
      const glbBase64 = ${JSON.stringify(glbBase64)};
      const externalBase64 = ${JSON.stringify(externalBase64)};

      const modelling = handleFor({ models: true, storage: { stateBytes: 1024, cacheBytes: 1024, tempBytes: 0 } }, {
        attachments: async (_runtime, request) => ({ attachmentId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', bytes: request.bytes.length }),
      });
      const validated = JSON.parse(text(await modelling.call('invoke', { invocationId: 'm1', toolId: 'model', input: { base64: glbBase64, mimeType: 'model/gltf-binary', name: 'probe.glb', storeIt: false }, locale: 'en' }, { timeoutMs: 20_000 })));
      assert.equal(validated.info.format, 'glb');
      assert.equal(validated.info.selfContained, true);

      const storedModel = JSON.parse(text(await modelling.call('invoke', { invocationId: 'm2', toolId: 'model', input: { base64: glbBase64, mimeType: 'model/gltf-binary', name: 'probe.glb', storeIt: true }, locale: 'en' }, { timeoutMs: 20_000 })));
      assert.match(storedModel.attachmentId, /^[a-z0-9][a-z0-9-]{7,63}$/, 'the capability gets back a reference it can put in a view');
      assert.ok(storedModel.bytes > 0);

      stage = '3D models that reach outside themselves';
      assert.match(
        await failure(modelling.call('invoke', { invocationId: 'm3', toolId: 'model', input: { base64: externalBase64, mimeType: 'model/gltf+json', name: 'probe.gltf', storeIt: true }, locale: 'en' }, { timeoutMs: 20_000 })),
        /outside itself/,
      );
      assert.match(
        await failure(modelling.call('invoke', { invocationId: 'm4', toolId: 'model', input: { base64: Buffer.from('not a model').toString('base64'), mimeType: 'model/gltf-binary', name: 'probe.glb', storeIt: true }, locale: 'en' }, { timeoutMs: 20_000 })),
        /readable GLB/,
      );
      await modelling.stop();

      stage = '3D without permission';
      const unmodelled = handleFor();
      assert.match(
        await failure(unmodelled.call('invoke', { invocationId: 'm5', toolId: 'model', input: { base64: glbBase64, mimeType: 'model/gltf-binary', name: 'probe.glb', storeIt: false }, locale: 'en' }, { timeoutMs: 10_000 })),
        /3D access is not permitted/,
      );
      await unmodelled.stop();

      fs.writeFileSync(${JSON.stringify(verdict)}, 'pass');
      app.exit(0);
    } catch (error) {
      console.error('FAILED at ' + stage + ': ' + (error && error.stack || error));
      app.exit(1);
    } });
  `, resolveDir: root, loader: 'ts' }, outfile, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'silent',
    plugins: [{ name: 'shared-alias', setup(api) { api.onResolve({ filter: /^@shared\// }, ({ path: value }) => ({ path: path.join(root, 'shared', `${value.slice(8)}.ts`) })); } }],
  });

  const electron = createRequire(import.meta.url)('electron');
  await promisify(execFile)(electron, [outfile], { env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
  if (fs.readFileSync(verdict, 'utf8') !== 'pass') throw new Error('The capability worker host verification did not report a pass.');
  console.log('CAPABILITY WORKER HOST PASS: handshake, host-call gating, storage quota, network allowlist, secret isolation, 3D validation and storage, deadline, cancellation, crash recovery, migration ladder.');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
