import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-plugin-assets-'));
process.on('exit',()=>fs.rmSync(scratch,{recursive:true,force:true}));
const bundle=path.join(scratch,'test.cjs');
await build({stdin:{contents:`export * from './electron/pluginAssets'; export * from './skill-capabilities/contracts'; export * from './packages/capability-api/src/pluginAssets';`,resolveDir:root,loader:'ts'},outfile:bundle,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
const lib=createRequire(import.meta.url)(bundle);
const doc=()=>({asset:{version:'2.0',extras:{provenance:{license:'CC0-1.0',source:'synthetic test fixture'}}},scene:0,scenes:[{nodes:[0]}],nodes:[{extras:{id:'collection'},translation:[1,2,3],children:[1,2]},{name:'A',extras:{id:'object-a',ontologyIds:['TEST:1']},mesh:0},{name:'B',extras:{id:'object-b'},mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}],bufferViews:[{buffer:0,byteLength:36}],buffers:[{byteLength:36,uri:'data:application/octet-stream;base64,'+Buffer.alloc(36).toString('base64')}]});
const pack=(d=doc())=>{const text=JSON.stringify(d);return {text,asset:{id:'objects',path:'assets/objects.gltf',mimeType:'model/gltf+json',bytes:Buffer.byteLength(text),sha256:crypto.createHash('sha256').update(text).digest('hex')}};};
test('declared assets are bounded, immutable data rather than paths or executables',()=>{
 const {asset}=pack();lib.validatePluginAssets([asset]);
 for(const value of ['../secret.json','assets/../secret.json','/etc/passwd','assets/x.js','assets/x.Gltf','assets\\objects.gltf','https://host/model.gltf'])assert.throws(()=>lib.validatePluginAssets([{...asset,path:value}]),/asset/);
 for(const change of [{bytes:0},{bytes:17_000_000},{mimeType:'text/html'},{sha256:'x'},{id:'../other'},{url:'https://host'}])assert.throws(()=>lib.validatePluginAssets([{...asset,...change}]),/asset/);
 assert.throws(()=>lib.validatePluginAssets([asset,asset]),/asset/);
});
test('every read verifies exact UTF-8 length and SHA-256',()=>{
 const p=pack();lib.verifyPluginAsset(p.text,p.asset);
 assert.throws(()=>lib.verifyPluginAsset(p.text.replace('TEST:1','TEST:2'),p.asset),/SHA-256/);
 assert.throws(()=>lib.verifyPluginAsset(p.text+' ',p.asset),/SHA-256/);
});
test('selected nodes retain identity, source metadata, transforms and hierarchy',()=>{
 const result=JSON.parse(lib.selectPackagedModel(pack(),['object-a']));
 assert.deepEqual(result.nodes[0].translation,[1,2,3]);assert.deepEqual(result.nodes[0].children,[1]);
 assert.equal(result.nodes[1].extras.id,'object-a');assert.deepEqual(result.nodes[1].extras.ontologyIds,['TEST:1']);
 assert.equal(result.asset.extras.provenance.license,'CC0-1.0');
 assert.equal(result.nodes.length,2);assert.ok(result.nodes.every(n=>!n.children||n.children.length));
 assert.deepEqual(lib.selectPackagedModel(pack(),['object-a']),lib.selectPackagedModel(pack(),['object-a']));
 assert.throws(()=>lib.selectPackagedModel(pack(),['unavailable']),/unavailable/);
});
test('invalid hierarchy, ambiguity, animated dependencies and remote resources fail',()=>{
 const cyclic=doc();cyclic.nodes[1].children=[0];assert.throws(()=>lib.selectPackagedModel(pack(cyclic),['object-a']),/cyclic/);
 const duplicate=doc();duplicate.nodes[2].extras.id='object-a';assert.throws(()=>lib.selectPackagedModel(pack(duplicate),['object-a']),/Ambiguous/);
 const external=doc();external.buffers[0].uri='https://example.com/private';assert.throws(()=>lib.verifyPluginAsset(pack(external).text,pack(external).asset),/outside/);
 const skin=doc();skin.skins=[{}];assert.throws(()=>lib.selectPackagedModel(pack(skin),['object-a']),/skinned/);
 const hidden=doc();hidden.nodes.push({extras:{id:'orphan'},mesh:0});assert.throws(()=>lib.selectPackagedModel(pack(hidden),['orphan']),/outside the active scene/);
});
test('model results accept references only, with bounded node selections and accessible text',()=>{
 const result={kind:'model',panels:[{assetId:'objects',nodeIds:['object-a'],title:'Objects',alt:'Synthetic reference objects'}],metadata:{license:'CC0-1.0'}};
 lib.validatePackagedModelResult(result);
 for(const change of [{url:'https://example.com'},{data:'AAAA'},{panels:[]},{panels:[{...result.panels[0],nodeIds:['../file']}]},{panels:[{...result.panels[0],alt:''}]}])assert.throws(()=>lib.validatePackagedModelResult({...result,...change}),/model/);
});
test('camelCase JSON tool properties coexist with legacy slugs; dangerous keys are refused',()=>{
 const manifest={schemaVersion:1,id:'test',version:'1.0.0',description:'Test',runtime:'javascript-sandbox-v1',entry:'runtime.js',permissions:{},tools:[{id:'render',description:'Test',inputSchema:{type:'object',properties:{labelMode:{type:'string'},'old-key':{type:'string'}}},resultKinds:['model']}]};
 lib.validateCapabilityManifest(manifest);
 manifest.tools[0].inputSchema.properties={constructor:{type:'string'}};assert.throws(()=>lib.validateCapabilityManifest(manifest),/schema property/);
});

test('binary GLB transport verifies bytes, preserves geometry and refuses corrupt containers', () => {
  const model = doc(); delete model.buffers[0].uri;
  const json = Buffer.from(JSON.stringify(model));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20); json.copy(padded);
  const binary = Buffer.alloc(36);
  const bytes = Buffer.alloc(28 + padded.length + binary.length);
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(padded.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); padded.copy(bytes, 20);
  bytes.writeUInt32LE(binary.length, 20 + padded.length); bytes.writeUInt32LE(0x004e4942, 24 + padded.length); binary.copy(bytes, 28 + padded.length);
  const asset = { id: 'objects', path: 'assets/objects.glb', mimeType: 'model/gltf-binary', bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  const text = bytes.toString('base64'); lib.verifyPluginAsset(text, asset);
  const selected = lib.selectPackagedModel({ text, asset }, ['object-a']);
  const selectedJson = JSON.parse(selected.subarray(20, 20 + selected.readUInt32LE(12)));
  assert.equal(selectedJson.nodes.length, 2); assert.equal(selectedJson.nodes[1].extras.id, 'object-a');
  assert.deepEqual(selected.subarray(20 + selected.readUInt32LE(12)), bytes.subarray(20 + padded.length));
  const corrupt = Buffer.from(bytes); corrupt[0] ^= 1;
  assert.throws(() => lib.verifyPluginAsset(corrupt.toString('base64'), asset), /SHA-256/);
  assert.throws(() => lib.verifyPluginAsset(corrupt.toString('base64'), { ...asset, sha256: crypto.createHash('sha256').update(corrupt).digest('hex') }), /GLB|glTF/);
});
