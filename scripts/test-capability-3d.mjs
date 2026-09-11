// `nodus:3d`: what the core accepts as a model, and what it refuses.
//
// The capability is deliberately generic — a molecule, a bone, a pot and a building are
// the same thing to it — so what is worth testing is not any discipline but the format
// boundary. A glTF file may reference buffers, images and shaders by URI, and a viewer
// that honoured them would fetch whatever a document asked for, whenever someone reopened
// an old conversation. Self-containment is the rule that stops that, and it is checked
// here, in the contract both the application and the marketplace enforce.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-capability-3d-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

const bundle = path.join(scratch, 'sdk.cjs');
await build({
  entryPoints: [path.join(root, 'packages/capability-api/src/index.ts')],
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
});
const sdk = createRequire(import.meta.url)(bundle);

// ---------------------------------------------------------------- fixtures

/** The smallest glTF 2.0 document that describes something to draw. */
const minimal = (overrides = {}) => ({
  asset: { version: '2.0', generator: 'nodus-test' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
  buffers: [{ byteLength: 36 }],
  ...overrides,
});

/** A real GLB container: header, JSON chunk, binary chunk, each padded as the
 *  specification requires. Built by hand so the test exercises the reader rather than a
 *  library's idea of what a GLB is. */
function glb(json, binary = new Uint8Array(36), options = {}) {
  const encoder = new TextEncoder();
  const jsonBytes = encoder.encode(JSON.stringify(json));
  const jsonPadded = pad(jsonBytes, 0x20);
  const binPadded = pad(binary, 0);
  const length = 12 + 8 + jsonPadded.length + (options.omitBinary ? 0 : 8 + binPadded.length);

  const out = new Uint8Array(options.actualLength ?? length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, options.version ?? 2, true);
  // What the header claims, which is not always what the file is: that mismatch is one of
  // the things being tested.
  view.setUint32(8, options.declaredLength ?? length, true);
  view.setUint32(12, jsonPadded.length, true);
  view.setUint32(16, options.jsonChunkType ?? 0x4e4f534a, true);
  out.set(jsonPadded, 20);
  if (!options.omitBinary) {
    const at = 20 + jsonPadded.length;
    view.setUint32(at, options.binaryChunkLength ?? binPadded.length, true);
    view.setUint32(at + 4, 0x004e4942, true);
    out.set(binPadded, at + 8);
  }
  return out;
}

function pad(bytes, filler) {
  const remainder = bytes.length % 4;
  if (!remainder) return bytes;
  const out = new Uint8Array(bytes.length + (4 - remainder));
  out.set(bytes);
  out.fill(filler, bytes.length);
  return out;
}

const gltfBytes = json => new TextEncoder().encode(JSON.stringify(json));
const GLB = 'model/gltf-binary';
const GLTF = 'model/gltf+json';

// ---------------------------------------------------------------- the identifier

test('3D is a core capability, named for what it does and not for a discipline', () => {
  assert.ok(sdk.CORE_CAPABILITY_IDS.includes('nodus:3d'), 'nodus:3d is provided by the core');
  assert.equal(sdk.isCoreCapabilityId('nodus:3d'), true);
  assert.equal(sdk.normalizeCapabilityId('3d'), 'nodus:3d', 'the short alias resolves like svg and image do');
  assert.equal(sdk.isCapabilityReference('nodus:3d'), true);

  // A package may depend on it and may never provide it, exactly like SVG.
  const manifest = { schemaVersion: 2, id: 'anything', name: 'Anything', version: '2.0.0', author: 'NodusResearch', description: 'x', license: 'AGPL-3.0-only', publisher: { id: 'NodusResearch', keyId: 'nr02' }, compatibility: { capabilityApi: 2, minNodusVersion: '5.3.2', targets: ['any'] }, replacesSkills: [], skills: ['skills/a/skill.json'], capabilities: ['capabilities/a/capability.json'], migrations: [] };
  assert.throws(() => sdk.assertMayProvide(manifest, 'nodus:3d'), /cannot provide a core capability/);
});

// ---------------------------------------------------------------- the format

test('a self-contained GLB is accepted, and says what it is', () => {
  const info = sdk.validateModelAsset(glb(minimal()), GLB);
  assert.equal(info.format, 'glb');
  assert.equal(info.version, '2.0');
  assert.equal(info.meshes, 1);
  assert.equal(info.nodes, 1);
  assert.equal(info.selfContained, true);
});

test('a self-contained glTF is accepted, including data URIs', () => {
  const info = sdk.validateModelAsset(gltfBytes(minimal({
    buffers: [{ byteLength: 36, uri: 'data:application/octet-stream;base64,AAAA' }],
    images: [{ uri: 'data:image/png;base64,iVBORw0KGgo=' }],
  })), GLTF);
  assert.equal(info.format, 'gltf');
  assert.equal(info.selfContained, true);
});

test('a model that reaches outside itself is refused', () => {
  for (const external of [
    { buffers: [{ byteLength: 36, uri: 'scene.bin' }] },
    { buffers: [{ byteLength: 36, uri: 'https://example.com/scene.bin' }] },
    { buffers: [{ byteLength: 36, uri: '../../etc/passwd' }] },
    { images: [{ uri: 'texture.png' }] },
    { images: [{ uri: 'https://example.com/texture.png' }] },
    { images: [{ uri: 'file:///etc/passwd' }] },
  ]) {
    assert.throws(() => sdk.validateModelAsset(gltfBytes(minimal(external)), GLTF), /outside itself/, JSON.stringify(external));
    assert.throws(() => sdk.validateModelAsset(glb(minimal(external)), GLB), /outside itself/, JSON.stringify(external));
  }
});

test('only glTF 2.0 is opened', () => {
  assert.throws(() => sdk.validateModelAsset(gltfBytes(minimal({ asset: { version: '1.0' } })), GLTF), /glTF 2\.0/);
  assert.throws(() => sdk.validateModelAsset(gltfBytes(minimal({ asset: {} })), GLTF), /glTF 2\.0/);
  assert.throws(() => sdk.validateModelAsset(glb(minimal(), undefined, { version: 1 }), GLB), /glTF 2\.0/);
});

test('a container that lies about its own shape is refused', () => {
  assert.throws(() => sdk.validateModelAsset(new Uint8Array(8), GLB), /readable GLB/);
  assert.throws(() => sdk.validateModelAsset(new TextEncoder().encode('not a model at all, not even close'), GLB), /readable GLB/);
  assert.throws(() => sdk.validateModelAsset(glb(minimal(), undefined, { declaredLength: 4_096 }), GLB), /length it does not have/);
  assert.throws(() => sdk.validateModelAsset(glb(minimal(), undefined, { actualLength: 4_096 }), GLB), /length it does not have/);
  assert.throws(() => sdk.validateModelAsset(glb(minimal(), undefined, { binaryChunkLength: 0xffff }), GLB), /past its end/);
  assert.throws(() => sdk.validateModelAsset(glb(minimal(), undefined, { jsonChunkType: 0x004e4942, omitBinary: true }), GLB), /no description/);
  assert.throws(() => sdk.validateModelAsset(gltfBytes('not an object'), GLTF), /no description/);
  assert.throws(() => sdk.validateModelAsset(new TextEncoder().encode('{ not json'), GLTF), /unreadable description/);
});

test('a model with nothing to draw is refused', () => {
  assert.throws(() => sdk.validateModelAsset(gltfBytes(minimal({ meshes: [] })), GLTF), /nothing to draw/);
});

test('an extension the viewer does not implement is refused rather than ignored', () => {
  // Required means the file cannot be drawn correctly without it; drawing it anyway would
  // show something that looks like the model and is not.
  assert.throws(
    () => sdk.validateModelAsset(gltfBytes(minimal({ extensionsRequired: ['KHR_draco_mesh_compression'] })), GLTF),
    /extension the viewer does not implement/,
  );
  // Merely used, not required: the viewer ignores what it does not know, as the
  // specification intends.
  assert.equal(sdk.validateModelAsset(gltfBytes(minimal({ extensionsUsed: ['KHR_materials_ior'] })), GLTF).format, 'gltf');
  assert.equal(sdk.validateModelAsset(gltfBytes(minimal({ extensionsRequired: ['KHR_materials_unlit'] })), GLTF).format, 'gltf');
});

test('anything that is not a model is refused before it is parsed', () => {
  assert.throws(() => sdk.validateModelAsset(glb(minimal()), 'application/octet-stream'), /must be model\/gltf/);
  assert.throws(() => sdk.validateModelAsset(glb(minimal()), 'text/html'), /must be model\/gltf/);
  assert.throws(() => sdk.validateModelAsset(new Uint8Array(0), GLB), /empty/);
  assert.throws(() => sdk.validateModelAsset('not bytes', GLB), /handed over as bytes/);
  assert.throws(() => sdk.validateModelAsset(new Uint8Array(sdk.LIMITS.modelBytes + 1), GLB), /may not exceed/);
});

// ---------------------------------------------------------------- the result kind

test('a capability returns a model the way it returns a drawing', () => {
  const view = sdk.validateViewDocument({
    schemaVersion: 1,
    summary: 'A scanned object.',
    nodes: [{
      kind: 'model',
      attachmentId: '3f8a1c0e-9b2d-4e77-8a10-5c6d7e8f9a0b',
      title: 'Scanned object',
      alt: 'A three-dimensional scan, rotatable in place.',
      name: 'object.glb',
      mimeType: GLB,
      bytes: 2_048,
    }],
  });
  assert.equal(view.nodes[0].kind, 'model');

  // The text projection carries what a reader who cannot see it is told, never markup.
  assert.match(sdk.viewToText(view), /\[Scanned object\] A three-dimensional scan/);
});

test('a model node cannot carry bytes, a path, or a format the core does not open', () => {
  const node = (overrides = {}) => ({
    kind: 'model', attachmentId: '3f8a1c0e-9b2d-4e77-8a10-5c6d7e8f9a0b', title: 'A', alt: 'B',
    name: 'object.glb', mimeType: GLB, bytes: 2_048, ...overrides,
  });
  const rejects = (overrides, hint = /Invalid view model/) =>
    assert.throws(() => sdk.validateViewDocument({ schemaVersion: 1, summary: 's', nodes: [node(overrides)] }), hint, JSON.stringify(overrides));

  rejects({ mimeType: 'application/octet-stream' });
  rejects({ mimeType: 'text/html' });
  rejects({ name: '../../etc/passwd' });
  rejects({ name: 'a/b.glb' });
  rejects({ attachmentId: '../secrets' });
  rejects({ attachmentId: 'short' });
  rejects({ bytes: 0 });
  rejects({ bytes: sdk.LIMITS.modelBytes + 1 });
  rejects({ alt: '' });
  // Bytes never travel inline; there is no key for them and an extra key is a refusal.
  rejects({ data: 'AAAA' });
});

// ---------------------------------------------------------------- the permission

test('reaching the 3D services is a declared permission, and widening it needs approval', () => {
  const permissions = sdk.validateTrustedPermissions({ models: true });
  assert.equal(permissions.models, true);
  assert.throws(() => sdk.validateTrustedPermissions({ models: 'yes' }), /3D permission/);

  assert.equal(sdk.permissionsExpandV2({}, { models: true }), true, 'a package that did not have it, asking for it, is an expansion');
  assert.equal(sdk.permissionsExpandV2({ models: true }, { models: true }), false);
  assert.equal(sdk.permissionsExpandV2({ models: true }, {}), false, 'giving it up is not an expansion');
  assert.notEqual(sdk.permissionFingerprint({ models: true }), sdk.permissionFingerprint({}));
});

test('the host channel exists and is spelled the same on both sides', () => {
  assert.ok(sdk.HOST_CHANNELS.includes('models'));
});

// ---------------------------------------------------------------- what survives a tidy-up

test('an attachment a saved result points at is not collected', async () => {
  const profile = path.join(scratch, 'reconcile');
  fs.mkdirSync(profile, { recursive: true });
  const assets = path.join(scratch, 'assets.cjs');
  await build({
    stdin: { contents: `export * from './electron/chatAssets';`, resolveDir: root, loader: 'ts' },
    outfile: assets, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
    plugins: [{
      name: 'test-environment',
      setup(api) {
        api.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'mock' }));
        api.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
          contents: `export const app = { getPath: () => ${JSON.stringify(profile)} };`
            + 'export const nativeImage = { createFromBuffer: () => ({ isEmpty: () => true }) };',
          loader: 'js',
        }));
        api.onResolve({ filter: /^@shared\// }, ({ path: value }) => ({ path: path.join(root, 'shared', `${value.slice(8)}.ts`) }));
      },
    }],
  });
  const lib = createRequire(import.meta.url)(assets);

  const owner = 'b'.repeat(64);
  const dir = path.join(profile, 'chat-assets', owner);
  fs.mkdirSync(dir, { recursive: true });

  // A capability result: the message refers to the artifact, and the artifact refers to
  // the model. Nothing in the message names the model at all.
  const artifactId = '11111111-2222-4333-8444-555555555555';
  const modelId = '66666666-7777-4888-8999-aaaaaaaaaaaa';
  const orphanId = 'cccccccc-dddd-4eee-8fff-000000000000';
  fs.writeFileSync(path.join(dir, `${modelId}.capability`), 'glb bytes');
  fs.writeFileSync(path.join(dir, `${modelId}.capability.json`), JSON.stringify({ mimeType: GLB, name: 'scan.glb', title: 'scan.glb' }));
  fs.writeFileSync(path.join(dir, `${orphanId}.capability`), 'nothing points here');
  fs.writeFileSync(path.join(dir, `${orphanId}.capability.json`), '{}');
  fs.writeFileSync(path.join(dir, `${artifactId}.artifact`), JSON.stringify({
    schemaVersion: 1, capabilityId: 'nodus:genomics', artifactType: 'scan', artifactVersion: 1,
    data: { view: { nodes: [{ kind: 'model', attachmentId: modelId }] } },
  }));
  fs.writeFileSync(path.join(dir, `${artifactId}.artifact.json`), JSON.stringify({ source: `nodus-artifact://chat/${owner}/${artifactId}` }));

  lib.reconcileChatAssets(owner, [{ content: `Here it is.\n\n\`\`\`nodus-artifact\n{"source":"nodus-artifact://chat/${owner}/${artifactId}"}\n\`\`\`` }]);

  assert.equal(fs.existsSync(path.join(dir, `${modelId}.capability`)), true, 'the model a live artifact points at was collected');
  assert.equal(fs.existsSync(path.join(dir, `${artifactId}.artifact`)), true, 'the artifact the message points at was collected');
  assert.equal(fs.existsSync(path.join(dir, `${orphanId}.capability`)), false, 'an attachment nothing refers to is still collected');

  // And when the message loses the artifact, everything it held goes with it.
  lib.reconcileChatAssets(owner, [{ content: 'The result was removed from this conversation.' }]);
  assert.equal(fs.existsSync(path.join(dir, `${artifactId}.artifact`)), false);
  assert.equal(fs.existsSync(path.join(dir, `${modelId}.capability`)), false, 'an attachment whose artifact is gone is collected too');
});
